begin;
select '1..1';
do $test$
#variable_conflict use_variable
declare
  actor uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid();
  data jsonb; org uuid; store_id uuid; other_store uuid;
  file_a jsonb; file_b jsonb; file_c jsonb; payload jsonb; result jsonb;
  product_id uuid; manual_product uuid; current_session uuid; frozen jsonb;
  opening numeric; row_total bigint; prior_setting text;
begin
  insert into auth.users(id,email,email_confirmed_at,created_at,updated_at)
  values(actor,actor||'@import-retry.invalid',now(),now(),now()),(outsider,outsider||'@import-retry.invalid',now(),now(),now());
  perform set_config('request.jwt.claim.sub',actor::text,true);
  data:=public.owner_setup();
  data:=public.owner_setup('business','{"organization_name":"匯入重試隔離測試","business_type":"SINGLE_RESTAURANT","store_mode":"SINGLE"}',0);
  data:=public.owner_setup('store',data->'draft'||jsonb_build_object('store_name','匯入測試','store_code','IR'||substr(replace(gen_random_uuid()::text,'-',''),1,12)),(data->>'revision')::int);
  data:=public.owner_setup('identity',data->'draft'||'{"work_role":"OWNER"}',(data->>'revision')::int);
  data:=public.owner_setup('complete',data->'draft',(data->>'revision')::int);
  store_id:=(data->>'store_id')::uuid;org:=(data->>'organization_id')::uuid;
  other_store:=(public.app_operation(store_id,'store.create','{"name":"另一門市"}',gen_random_uuid())->>'id')::uuid;
  file_a:=jsonb_build_object('original_filename','內場.xlsx','file_sha256',repeat('a',64),'storage_path',org||'/'||store_id||'/a.xlsx','sheet_names','["盤點"]'::jsonb);
  file_b:=file_a||jsonb_build_object('original_filename','吧台.xlsx','file_sha256',repeat('b',64),'storage_path',org||'/'||store_id||'/b.xlsx');
  file_c:=file_a||jsonb_build_object('original_filename','重新匯入.xlsx','file_sha256',repeat('c',64),'storage_path',org||'/'||store_id||'/c.xlsx');
  payload:='[{"source_id":"盤點:2","sheet_name":"盤點","source_row":2,"product_code":"RETRY-MILK","name":"鮮奶","count_unit":"瓶","opening_quantity":3,"zone_name":"冷藏","raw_values":{}}]'::jsonb;
  prior_setting:=current_setting('app.opening_balance_maintenance',true);
  result:=public.import_pilot_inventory_quick(store_id,jsonb_build_object('file',file_a,'rows',payload));
  assert result->0->>'status'='ADDED','first file must build';
  product_id:=(result->0->>'product_id')::uuid;
  current_session:=public.start_pilot_count(store_id,null);
  select snapshot into frozen from public.inventory_count_sessions where id=current_session;
  result:=public.import_pilot_inventory_quick(store_id,jsonb_build_object('file',file_b,'rows',jsonb_set(payload,'{0,opening_quantity}','2')));
  assert result->0->>'status'='EXISTING','second file must not hit append-only trigger';
  select b.quantity into opening from public.store_product_opening_balances b where b.store_id=store_id and b.product_id=product_id;
  assert opening=5,'separate sources aggregate their opening quantities';
  result:=public.import_pilot_inventory_quick(store_id,jsonb_build_object('file',file_b,'rows',jsonb_set(payload,'{0,opening_quantity}','2')));
  select b.quantity into opening from public.store_product_opening_balances b where b.store_id=store_id and b.product_id=product_id;
  assert opening=5,'retry must not add opening quantity twice';
  assert (select snapshot=frozen from public.inventory_count_sessions where id=current_session),'existing count snapshot must remain unchanged';
  assert nullif(current_setting('app.opening_balance_maintenance',true),'') is not distinct from nullif(prior_setting,''),'maintenance setting must not leak';
  begin
    update public.store_product_opening_balances b set quantity=99 where b.store_id=store_id and b.product_id=product_id;
    raise exception 'Direct history update unexpectedly allowed';
  exception when others then
    if sqlerrm<>'PILOT_HISTORY_IS_APPEND_ONLY' then raise; end if;
  end;
  -- Reproduce old removal state: inactive product, removed sources, stale opening.
  update public.inventory_import_files f set removed_at=now() where f.store_id=store_id;
  update public.products p set is_active=false where p.id=product_id;
  result:=public.import_pilot_inventory_quick(store_id,jsonb_build_object('file',file_c,'rows',payload));
  assert result->0->>'status'='EXISTING','removed source product should re-import successfully';
  assert (select is_active from public.products where id=product_id),'removed product must become countable';
  select b.quantity into opening from public.store_product_opening_balances b where b.store_id=store_id and b.product_id=product_id;
  assert opening=3,'removed source opening must not be counted again';
  perform public.import_pilot_inventory_quick(store_id,jsonb_build_object('file',file_c,'rows',payload));
  select b.quantity into opening from public.store_product_opening_balances b where b.store_id=store_id and b.product_id=product_id;
  assert opening=3,'restored source retry is idempotent';
  assert (select snapshot=frozen from public.inventory_count_sessions where id=current_session),'restoration must preserve old count history';
  -- A deliberately disabled product with no removed source must stay disabled.
  insert into public.products(organization_id,product_code,name,base_unit,count_unit,is_active)
  values(org,'RETRY-MANUAL','手動停用品項','瓶','瓶',false) returning id into manual_product;
  result:=public.import_pilot_inventory_quick(store_id,jsonb_build_object('file',file_c,'rows',jsonb_build_array(jsonb_build_object('source_id','manual','name','手動停用品項','product_code','RETRY-MANUAL','count_unit','瓶','zone_name','冷藏'))));
  assert not (select is_active from public.products where id=manual_product),'manual disabled product remains disabled';
  -- Restoring in one store must not activate an inactive product used elsewhere.
  perform public.assign_pilot_product_to_zone(public.create_pilot_zone(other_store,'共享區'),product_id);
  update public.inventory_import_files f set removed_at=now() where f.store_id=store_id;
  update public.products p set is_active=false where p.id=product_id;
  result:=public.import_pilot_inventory_quick(store_id,jsonb_build_object('file',file_c||jsonb_build_object('file_sha256',repeat('d',64)),'rows',payload));
  assert not (select is_active from public.products where id=product_id),'another store association prevents global reactivation';
  assert not exists(select 1 from public.inventory_import_files f where f.store_id=other_store),'import never writes another store file';
  assert not has_function_privilege('authenticated','private.restore_removed_import_product(uuid,uuid,uuid,boolean)','EXECUTE'),'private restoration helper cannot be called directly';
  select count(*) into row_total from public.inventory_import_rows;
  perform set_config('request.jwt.claim.sub',outsider::text,true);
  begin
    perform public.import_pilot_inventory_quick(store_id,jsonb_build_object('file',file_a,'rows',payload));
    raise exception 'Unauthorized import unexpectedly allowed';
  exception when insufficient_privilege then null;
  end;
  assert (select count(*)=row_total from public.inventory_import_rows),'denied import writes nothing';
  perform set_config('request.jwt.claim.sub','',true);
  begin
    perform public.import_pilot_inventory_quick(store_id,jsonb_build_object('file',file_a,'rows',payload));
    raise exception 'Anonymous import unexpectedly allowed';
  exception when insufficient_privilege then null;
  end;
  assert nullif(current_setting('app.opening_balance_maintenance',true),'') is not distinct from nullif(prior_setting,''),'denied call must restore maintenance setting';
end $test$;
select 'ok 1 - multi-file opening maintenance, restoration, retry, history and authorization';
rollback;
