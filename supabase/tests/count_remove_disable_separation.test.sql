begin;
select '1..1';
do $test$
#variable_conflict use_variable
declare
  actor uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid(); staff_user uuid:=gen_random_uuid(); data jsonb;
  org uuid; store_id uuid; other_store uuid; file_a jsonb; payload jsonb; result jsonb;
  milk uuid; manual_product uuid; current_count uuid; current_zone uuid; history jsonb;
  opening numeric; before_receipts bigint; previous_setting text;
begin
  insert into auth.users(id,email,email_confirmed_at,created_at,updated_at)
  values(actor,actor||'@separate-removal.invalid',now(),now(),now()),(outsider,outsider||'@separate-removal.invalid',now(),now(),now()),(staff_user,staff_user||'@separate-removal.invalid',now(),now(),now());
  perform set_config('request.jwt.claim.sub',actor::text,true);
  data:=public.owner_setup();
  data:=public.owner_setup('business','{"organization_name":"停用移除分離測試","business_type":"SINGLE_RESTAURANT","store_mode":"SINGLE"}',0);
  data:=public.owner_setup('store',data->'draft'||jsonb_build_object('store_name','測試店','store_code','RS'||substr(replace(gen_random_uuid()::text,'-',''),1,12)),(data->>'revision')::int);
  data:=public.owner_setup('identity',data->'draft'||'{"work_role":"OWNER"}',(data->>'revision')::int);
  data:=public.owner_setup('complete',data->'draft',(data->>'revision')::int);
  store_id:=(data->>'store_id')::uuid; org:=(data->>'organization_id')::uuid;
  other_store:=(public.app_operation(store_id,'store.create','{"name":"另一門市"}',gen_random_uuid())->>'id')::uuid;
  insert into public.organization_members(organization_id,user_id,role,work_role) values(org,staff_user,'STAFF','STAFF');
  insert into public.staff_identities(organization_id,user_id,display_name,created_by) values(org,staff_user,'測試員工',actor);
  insert into public.store_memberships(store_id,organization_id,user_id,login_identifier,role,work_role,assigned_by) values(store_id,org,staff_user,'removal-staff','STAFF','STAFF',actor);
  file_a:=jsonb_build_object('original_filename','盤點.xlsx','file_sha256',repeat('a',64),'storage_path',org||'/'||store_id||'/a.xlsx','sheet_names','["盤點"]'::jsonb);
  payload:='[{"source_id":"milk","name":"鮮奶","product_code":"SEPARATE-MILK","count_unit":"瓶","opening_quantity":3,"unit_price":10},
    {"source_id":"manual","name":"手動停用","product_code":"SEPARATE-MANUAL","count_unit":"包","opening_quantity":5}]'::jsonb;
  previous_setting:=current_setting('app.opening_balance_maintenance',true);
  result:=public.import_pilot_inventory_quick(store_id,jsonb_build_object('file',file_a,'rows',payload));
  assert result->0->>'status'='ADDED' and result->1->>'status'='ADDED',result::text;
  milk:=(result->0->>'product_id')::uuid; manual_product:=(result->1->>'product_id')::uuid;
  perform public.app_operation(store_id,'product.lifecycle',jsonb_build_object('ids',jsonb_build_array(manual_product),'mode','DISABLE'),gen_random_uuid());
  perform public.assign_pilot_product_to_zone(public.create_pilot_zone(other_store,'共用區'),milk);
  current_count:=public.start_pilot_count(store_id,null);
  select id into current_zone from public.count_zones z where z.store_id=store_id and z.name='未分類' and z.is_active;
  perform public.save_pilot_count_draft(current_count,current_zone,milk,0,null);
  begin
    perform public.undo_inventory_import_batch(store_id,repeat('a',64)); raise exception 'batch removal ignored entered zero';
  exception when sqlstate '22023' then assert sqlerrm='COUNT_IN_PROGRESS'; end;
  begin
    perform public.remove_single_imported_product_safely(store_id,milk); raise exception 'single removal ignored entered zero';
  exception when sqlstate '22023' then assert sqlerrm='COUNT_IN_PROGRESS'; end;
  begin
    perform public.app_operation(store_id,'count.catalog-lifecycle',jsonb_build_object('ids',jsonb_build_array(milk),'mode','REMOVE'),gen_random_uuid()); raise exception 'catalog removal ignored entered zero';
  exception when sqlstate '22023' then assert sqlerrm='COUNT_IN_PROGRESS'; end;
  begin
    perform public.reset_pilot_count_setup(store_id); raise exception 'reset ignored entered zero';
  exception when sqlstate '22023' then assert sqlerrm='COUNT_IN_PROGRESS'; end;
  assert (select quantity=0 from public.count_drafts where session_id=current_count and product_id=milk),'zero draft stays intact';
  perform public.complete_pilot_count_zone(current_count,current_zone);
  history:=public.get_pilot_count_details(current_count);
  assert jsonb_array_length(history)=1 and (history->0->>'unit_price')::numeric=10,'historical valuation fixture exists';

  perform public.undo_inventory_import_batch(store_id,repeat('a',64));
  assert (select is_active from public.products where id=milk),'batch removal never disables enterprise product';
  assert not (select is_active from public.products where id=manual_product),'manual disable remains separate';
  assert not exists(select 1 from public.zone_products zp join public.count_zones z on z.id=zp.zone_id where z.store_id=store_id),'removed store has no current assignments';
  assert exists(select 1 from public.zone_products zp join public.count_zones z on z.id=zp.zone_id where z.store_id=other_store and zp.product_id=milk),'other store assignment survives';
  result:=public.get_pilot_inventory_catalog(store_id);
  assert exists(select 1 from jsonb_array_elements(result) x where x->>'product_id'=milk::text and x->>'catalog_state'='REMOVED' and (x->>'product_is_active')::boolean and not (x->>'is_configured')::boolean),'removed-without-zone remains explicitly visible in management';
  assert exists(select 1 from jsonb_array_elements(result) x where x->>'product_id'=manual_product::text and x->>'catalog_state'='REMOVED' and not (x->>'product_is_active')::boolean),'removal and disable can coexist without being conflated';
  result:=public.app_workspace(store_id,'product-options','{}');
  assert not exists(select 1 from jsonb_array_elements(result->'products') x where x->>'id'=milk::text),'removed product excluded from local new-selection picker';
  result:=public.app_workspace(other_store,'product-options','{}');
  assert exists(select 1 from jsonb_array_elements(result->'products') x where x->>'id'=milk::text),'other store picker retains shared product';
  begin
    perform public.app_operation(store_id,'stock.open',jsonb_build_object('product_id',milk),gen_random_uuid()); raise exception 'removed product selected via forged ID';
  exception when sqlstate '22023' then assert sqlerrm='INVALID_PRODUCT'; end;
  assert public.get_pilot_count_details(current_count)=history,'removal preserves completed quantities and amounts';

  result:=public.import_pilot_inventory_quick(store_id,jsonb_build_object('file',file_a,'rows',payload));
  assert not exists(select 1 from jsonb_array_elements(result) x where x->>'status'='FAILED'),result::text;
  perform public.import_pilot_inventory_quick(store_id,jsonb_build_object('file',file_a,'rows',payload));
  assert (select quantity=3 from public.store_product_opening_balances b where b.store_id=store_id and b.product_id=milk),'same source rebuild and retry apply opening only once';
  result:=public.get_pilot_inventory_catalog(store_id);
  assert exists(select 1 from jsonb_array_elements(result) x where x->>'product_id'=milk::text and x->>'catalog_state'='ACTIVE' and (x->>'is_configured')::boolean),'reimport re-establishes valid local setup';
  assert exists(select 1 from jsonb_array_elements(result) x where x->>'product_id'=manual_product::text and x->>'catalog_state'='DISABLED'),'reimport does not re-enable true manual disable';
  perform set_config('request.jwt.claim.sub',staff_user::text,true);
  result:=public.app_workspace(store_id,'product-options','{}');
  assert exists(select 1 from jsonb_array_elements(result->'products') x where x->>'id'=milk::text),'staff can read basic product picker';
  assert not exists(select 1 from jsonb_array_elements(result->'products') x cross join lateral jsonb_object_keys(x) k(key)
    where k.key not in ('id','name','base_unit','specification')),'staff picker contains no price or management fields';
  begin
    perform public.app_workspace(store_id,'catalog','{}'); raise exception 'staff read management catalogue';
  exception when insufficient_privilege then null; end;
  begin
    perform public.undo_inventory_import_batch(store_id,repeat('a',64)); raise exception 'staff removed source';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claim.sub',actor::text,true);
  perform public.remove_single_imported_product_safely(store_id,milk);
  assert (select is_active from public.products where id=milk),'single removal also leaves enterprise state active';
  perform public.import_pilot_inventory_quick(store_id,jsonb_build_object('file',file_a,'rows',payload));
  assert (select quantity=3 from public.store_product_opening_balances b where b.store_id=store_id and b.product_id=milk),'single removal is reconstructible from source without double counting';

  perform public.app_operation(store_id,'count.catalog-lifecycle',jsonb_build_object('ids',jsonb_build_array(manual_product),'mode','DISABLE'),gen_random_uuid());
  perform public.app_operation(store_id,'count.catalog-lifecycle',jsonb_build_object('ids',jsonb_build_array(manual_product),'mode','RESTORE'),gen_random_uuid());
  assert not (select is_active from public.products where id=manual_product),'legacy count DISABLE means local removal; RESTORE cannot enable';
  result:=public.get_pilot_inventory_catalog(store_id);
  assert exists(select 1 from jsonb_array_elements(result) x where x->>'product_id'=manual_product::text and x->>'catalog_state'='DISABLED' and (x->>'is_configured')::boolean),'re-add configures disabled product without claiming it is countable';
  perform public.app_operation(store_id,'product.save',jsonb_build_object('id',manual_product,'name','手動停用','unit','包','aliases','[]'::jsonb,'updated_at',(select updated_at from public.products where id=manual_product),'is_active',true),gen_random_uuid());
  assert not (select is_active from public.products where id=manual_product),'ordinary metadata save cannot implicitly enable old clients payload';
  perform public.app_operation(store_id,'product.lifecycle',jsonb_build_object('ids',jsonb_build_array(milk),'mode','DELETE'),gen_random_uuid());
  assert (select is_active from public.products where id=milk),'legacy DELETE routes to local removal, never implicit disable or hard delete';

  perform public.reset_pilot_count_setup(store_id);
  assert (select is_active from public.products where id=milk),'rebuild leaves enterprise lifecycle state unchanged';
  assert not (select is_active from public.products where id=manual_product),'rebuild preserves manual disable';
  perform public.import_pilot_inventory_quick(store_id,jsonb_build_object('file',file_a,'rows',payload));
  perform public.import_pilot_inventory_quick(store_id,jsonb_build_object('file',file_a,'rows',payload));
  assert (select quantity=3 from public.store_product_opening_balances b where b.store_id=store_id and b.product_id=milk),'reset then same-file replay applies opening once';
  assert not (select is_active from public.products where id=manual_product),'reset/reimport never silently enables manually disabled product';
  assert public.get_pilot_count_details(current_count)=history,'rebuild preserves original history and prices';
  assert exists(select 1 from public.zone_products zp join public.count_zones z on z.id=zp.zone_id where z.store_id=other_store and zp.product_id=milk),'all lifecycle routes preserve other store';

  select count(*) into before_receipts from private.import_removal_receipts;
  perform set_config('request.jwt.claim.sub',outsider::text,true);
  begin
    perform public.undo_inventory_import_batch(store_id,repeat('a',64)); raise exception 'outsider removal succeeded';
  exception when insufficient_privilege then null; end;
  begin
    perform public.reset_pilot_count_setup(store_id); raise exception 'outsider reset succeeded';
  exception when insufficient_privilege then null; end;
  begin
    perform public.app_workspace(store_id,'product-options','{}'); raise exception 'outsider picker leaked';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claim.sub','',true);
  begin
    perform public.remove_single_imported_product_safely(store_id,milk); raise exception 'anonymous removal succeeded';
  exception when insufficient_privilege then null; end;
  assert (select count(*)=before_receipts from private.import_removal_receipts),'denied calls do not alter provenance';
  assert not has_function_privilege('authenticated','private.remove_store_count_products(uuid,uuid[])','EXECUTE'),'private removal helper is not an API';
  assert nullif(current_setting('app.opening_balance_maintenance',true),'') is not distinct from nullif(previous_setting,''),'maintenance scope does not leak';
end $test$;
select 'ok 1 - removal, disable, rebuild, store isolation and historical count preservation';
rollback;
