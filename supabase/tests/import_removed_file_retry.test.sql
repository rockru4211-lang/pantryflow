begin;
select '1..1';
do $test$
#variable_conflict use_variable
declare
  actor uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid(); data jsonb;
  org uuid; store_id uuid; other_store uuid; file_a jsonb; file_b jsonb; file_c jsonb;
  payload jsonb; result jsonb; milk uuid; manual_product uuid; shared_product uuid;
  source_file uuid; legacy_file uuid; count_session uuid; zone_id uuid; details jsonb;
  removed_stamp timestamptz; original_created timestamptz; prior_setting text;
  total bigint;
begin
  insert into auth.users(id,email,email_confirmed_at,created_at,updated_at)
  values(actor,actor||'@removed-import.invalid',now(),now(),now()),
    (outsider,outsider||'@removed-import.invalid',now(),now(),now());
  perform set_config('request.jwt.claim.sub',actor::text,true);
  data:=public.owner_setup();
  data:=public.owner_setup('business','{"organization_name":"同檔重匯隔離測試","business_type":"SINGLE_RESTAURANT","store_mode":"SINGLE"}',0);
  data:=public.owner_setup('store',data->'draft'||jsonb_build_object('store_name','重匯測試','store_code','RR'||substr(replace(gen_random_uuid()::text,'-',''),1,12)),(data->>'revision')::int);
  data:=public.owner_setup('identity',data->'draft'||'{"work_role":"OWNER"}',(data->>'revision')::int);
  data:=public.owner_setup('complete',data->'draft',(data->>'revision')::int);
  store_id:=(data->>'store_id')::uuid; org:=(data->>'organization_id')::uuid;
  other_store:=(public.app_operation(store_id,'store.create','{"name":"另一門市"}',gen_random_uuid())->>'id')::uuid;
  file_a:=jsonb_build_object('original_filename','原始盤點.xlsx','file_sha256',repeat('a',64),'storage_path',org||'/'||store_id||'/a.xlsx','sheet_names','["盤點"]'::jsonb);
  file_b:=file_a||jsonb_build_object('original_filename','補充盤點.xlsx','file_sha256',repeat('b',64),'storage_path',org||'/'||store_id||'/b.xlsx');
  file_c:=file_a||jsonb_build_object('original_filename','新檔.xlsx','file_sha256',repeat('c',64),'storage_path',org||'/'||store_id||'/c.xlsx');
  payload:='[{"source_id":"milk","name":"鮮奶","product_code":"REMOVED-MILK","count_unit":"瓶","opening_quantity":3,"unit_price":10,"raw_values":{"原始值":"鮮奶 3"}},
    {"source_id":"manual","name":"手動停用品項","product_code":"REMOVED-MANUAL","count_unit":"瓶","opening_quantity":7},
    {"source_id":"shared","name":"跨店共用品項","product_code":"REMOVED-SHARED","count_unit":"瓶","opening_quantity":11,"unit_price":2}]'::jsonb;
  prior_setting:=current_setting('app.opening_balance_maintenance',true);
  result:=public.import_pilot_inventory_quick(store_id,jsonb_build_object('file',file_a,'rows',payload));
  assert not exists(select 1 from jsonb_array_elements(result) r where r->>'status'<>'ADDED'),result::text;
  milk:=(result->0->>'product_id')::uuid; manual_product:=(result->1->>'product_id')::uuid;
  shared_product:=(result->2->>'product_id')::uuid;
  select id,created_at into source_file,original_created from public.inventory_import_files f where f.store_id=store_id and f.file_sha256=repeat('a',64);
  update public.products set is_active=false where id=manual_product;
  perform public.assign_pilot_product_to_zone(public.create_pilot_zone(other_store,'另一門市儲物區'),shared_product);
  count_session:=public.start_pilot_count(store_id,null);
  select id into zone_id from public.count_zones z where z.store_id=store_id and z.name='未分類';
  perform public.save_pilot_count_draft(count_session,zone_id,milk,4,null);
  perform public.save_pilot_count_draft(count_session,zone_id,shared_product,12,null);
  perform public.complete_pilot_count_zone(count_session,zone_id);
  details:=public.get_pilot_count_details(count_session);
  assert jsonb_array_length(details)=2,'fixture has completed historical count entries';

  result:=public.undo_inventory_import_batch(store_id,repeat('a',64));
  select removed_at into removed_stamp from public.inventory_import_files where id=source_file;
  assert removed_stamp is not null,'whole source is marked removed';
  assert not (select is_active from public.products where id=milk),'unused product is disabled by removal';
  assert not (select is_active from public.products where id=manual_product),'manual disable remains disabled';
  assert (select is_active from public.products where id=shared_product),'another store keeps shared product active';
  assert not exists(select 1 from public.zone_products zp join public.count_zones z on z.id=zp.zone_id where z.store_id=store_id),'current store setup removed';
  assert exists(select 1 from public.zone_products zp join public.count_zones z on z.id=zp.zone_id where z.store_id=other_store and zp.product_id=shared_product),'other store setup preserved';
  assert public.get_pilot_count_details(count_session)=details,'removal preserves completed count and values';
  -- Duplicate removal does not replace proof or create a second operation.
  perform public.undo_inventory_import_batch(store_id,repeat('a',64));
  assert (select removed_at=removed_stamp from public.inventory_import_files where id=source_file),'duplicate remove is idempotent';
  select count(*) into total from private.import_removal_receipts;
  perform set_config('request.jwt.claim.sub',outsider::text,true);
  begin
    perform public.import_pilot_inventory_quick(store_id,jsonb_build_object('file',file_a,'rows',payload));
    raise exception 'outsider reopened source';
  exception when insufficient_privilege then null; end;
  assert (select removed_at=removed_stamp from public.inventory_import_files where id=source_file),'authorization precedes source reopen';
  perform set_config('request.jwt.claim.sub','',true);
  begin
    perform public.import_pilot_inventory_quick(store_id,jsonb_build_object('file',file_a,'rows',payload));
    raise exception 'anonymous reopened source';
  exception when insufficient_privilege then null; end;
  assert (select count(*)=total from private.import_removal_receipts),'denied requests preserve removal evidence';
  perform set_config('request.jwt.claim.sub',actor::text,true);

  result:=public.import_pilot_inventory_quick(store_id,jsonb_build_object('file',file_a||'{"original_filename":"不應覆寫.xlsx","storage_path":"attempted-replacement"}'::jsonb,'rows',jsonb_set(payload,'{0,raw_values}','{"原始值":"不應覆寫"}'::jsonb)));
  assert not exists(select 1 from jsonb_array_elements(result) r where r->>'status'<>'EXISTING'),result::text;
  assert (select removed_at is null and removed_by is null and original_filename='原始盤點.xlsx' and storage_path=file_a->>'storage_path' and created_at=original_created from public.inventory_import_files where id=source_file),'reopen preserves source identity and metadata';
  assert (select raw_values->>'原始值'='鮮奶 3' from public.inventory_import_rows where import_file_id=source_file and source_id='milk'),'source bytes cannot be replaced on replay';
  assert (select is_active from public.products where id=milk),'same-file removal restores its own disabled product';
  assert not (select is_active from public.products where id=manual_product),'same-file replay cannot restore manually disabled product';
  assert (select quantity=3 from public.store_product_opening_balances b where b.store_id=store_id and b.product_id=milk),'removed opening is rebuilt once';
  assert (select count(*)=3 from public.zone_products zp join public.count_zones z on z.id=zp.zone_id where z.store_id=store_id),'same-file replay recreates store assignments';
  perform public.import_pilot_inventory_quick(store_id,jsonb_build_object('file',file_a,'rows',payload));
  assert (select quantity=3 from public.store_product_opening_balances b where b.store_id=store_id and b.product_id=milk),'successful replay never adds opening twice';
  assert public.get_pilot_count_details(count_session)=details,'re-import preserves completed quantities and amounts';
  assert exists(select 1 from public.audit_logs where entity_id=store_id::text and action='INVENTORY_IMPORT_REOPENED' and new_value->>'import_file_id'=source_file::text),'reopen leaves removal audit evidence';

  -- A remaining source retains the aggregate: remove A from A(3)+B(2), then
  -- re-add A. Opening must remain 5 rather than become 8.
  result:=public.import_pilot_inventory_quick(store_id,jsonb_build_object('file',file_b,'rows',jsonb_build_array((payload->0)||'{"opening_quantity":2}'::jsonb)));
  assert result->0->>'status'='EXISTING';
  update public.inventory_import_rows r set status='PENDING' from public.inventory_import_files f
    where r.import_file_id=f.id and f.store_id=store_id and f.file_sha256=repeat('b',64);
  drop table pg_temp.tmp_remove_products;
  perform public.undo_inventory_import_batch(store_id,repeat('a',64));
  assert (select quantity=5 from public.store_product_opening_balances b where b.store_id=store_id and b.product_id=milk),'pending-but-built shared source is retained';
  perform public.import_pilot_inventory_quick(store_id,jsonb_build_object('file',file_a,'rows',payload));
  assert (select quantity=5 from public.store_product_opening_balances b where b.store_id=store_id and b.product_id=milk),'shared opening is not double counted on same-file reopen';

  -- If the final source is later removed, retained contributions are no longer
  -- present. Reopen them beside a new C(4): A(3)+B(2)+C(4) must become 9.
  drop table pg_temp.tmp_remove_products;
  perform public.undo_inventory_import_batch(store_id,repeat('a',64));
  drop table pg_temp.tmp_remove_products;
  perform public.undo_inventory_import_batch(store_id,repeat('b',64));
  assert not exists(select 1 from public.store_product_opening_balances b where b.store_id=store_id and b.product_id=milk),'last removal clears aggregate opening';
  perform public.import_pilot_inventory_quick(store_id,jsonb_build_object('file',file_c,'rows',jsonb_build_array((payload->0)||'{"opening_quantity":4}'::jsonb)));
  perform public.import_pilot_inventory_quick(store_id,jsonb_build_object('file',file_a,'rows',payload));
  perform public.import_pilot_inventory_quick(store_id,jsonb_build_object('file',file_b,'rows',jsonb_build_array((payload->0)||'{"opening_quantity":2}'::jsonb)));
  assert (select quantity=9 from public.store_product_opening_balances b where b.store_id=store_id and b.product_id=milk),'removed retained contributions are applied once after last-source cleanup';

  -- A manual change after removal is distinct from removal itself. The product
  -- trigger replaces updated_at with transaction-stable now(). Age only this
  -- fixture's private receipt to represent a removal from an earlier RPC.
  drop table pg_temp.tmp_remove_products;
  perform public.undo_inventory_import_batch(store_id,repeat('a',64));
  update private.import_removal_receipts set removed_at=removed_at-interval '1 second' where import_file_id=source_file and product_id=shared_product;
  perform public.app_operation(store_id,'product.lifecycle',jsonb_build_object('ids',jsonb_build_array(shared_product),'mode','DISABLE'),gen_random_uuid());
  perform public.import_pilot_inventory_quick(store_id,jsonb_build_object('file',file_a,'rows',payload));
  assert not (select is_active from public.products where id=shared_product),'later manual disable with cross-store use stays disabled';

  -- Also protect a later manual disable of an otherwise unshared product.
  file_c:=file_a||jsonb_build_object('file_sha256',repeat('f',64),'storage_path',org||'/'||store_id||'/later.xlsx');
  result:=public.import_pilot_inventory_quick(store_id,jsonb_build_object('file',file_c,'rows','[{"source_id":"later","name":"稍後停用","product_code":"REMOVED-LATER","count_unit":"瓶","opening_quantity":1}]'::jsonb));
  manual_product:=(result->0->>'product_id')::uuid;
  drop table pg_temp.tmp_remove_products;
  perform public.undo_inventory_import_batch(store_id,repeat('f',64));
  assert exists(select 1 from private.import_removal_receipts rr where rr.product_id=manual_product and rr.reactivate_product),'fixture records removal-owned deactivation';
  update private.import_removal_receipts set removed_at=removed_at-interval '1 second' where product_id=manual_product;
  perform public.app_operation(store_id,'product.lifecycle',jsonb_build_object('ids',jsonb_build_array(manual_product),'mode','DISABLE'),gen_random_uuid());
  assert exists(select 1 from public.products p join private.import_removal_receipts rr on rr.product_id=p.id where p.id=manual_product and p.updated_at>rr.removed_at),'fixture represents a later manual update despite transaction-stable now()';
  perform public.import_pilot_inventory_quick(store_id,jsonb_build_object('file',file_c,'rows','[{"source_id":"later","name":"稍後停用","product_code":"REMOVED-LATER","count_unit":"瓶","opening_quantity":1}]'::jsonb));
  assert not (select is_active from public.products where id=manual_product),'subsequent manual change invalidates automatic activation';

  -- Old deleted sources without provenance are protected, never reported as
  -- successful while staying removed or guessed back into service.
  file_c:=file_a||jsonb_build_object('file_sha256',repeat('d',64),'storage_path',org||'/'||store_id||'/legacy.xlsx');
  result:=public.import_pilot_inventory_quick(store_id,jsonb_build_object('file',file_c,'rows','[{"source_id":"legacy","name":"舊版移除資料","product_code":"REMOVED-LEGACY","count_unit":"瓶","opening_quantity":6}]'::jsonb));
  select id into legacy_file from public.inventory_import_files f where f.store_id=store_id and f.file_sha256=repeat('d',64);
  update public.inventory_import_files set removed_at=now(),removed_by=actor where id=legacy_file;
  update public.inventory_import_rows set status='SKIPPED' where import_file_id=legacy_file;
  begin
    perform public.import_pilot_inventory_quick(store_id,jsonb_build_object('file',file_c,'rows','[{"source_id":"legacy","name":"舊版移除資料","product_code":"REMOVED-LEGACY","count_unit":"瓶","opening_quantity":6}]'::jsonb));
    raise exception 'unproven legacy removal was reopened';
  exception when sqlstate '22023' then assert sqlerrm='IMPORT_REMOVED_REVIEW_REQUIRED'; end;
  assert (select removed_at is not null from public.inventory_import_files where id=legacy_file),'legacy failure leaves source untouched';

  -- Partial failure retries only the missing row; successful siblings preserve
  -- their identity and opening even though both rows are submitted again.
  file_c:=file_a||jsonb_build_object('file_sha256',repeat('e',64),'storage_path',org||'/'||store_id||'/partial.xlsx');
  payload:='[{"source_id":"salt","name":"鹽","product_code":"REMOVED-SALT","count_unit":"包","opening_quantity":2},
    {"source_id":"pepper","name":"胡椒","product_code":"REMOVED-PEPPER","count_unit":"包","opening_quantity":-1}]'::jsonb;
  result:=public.import_pilot_inventory_quick(store_id,jsonb_build_object('file',file_c,'rows',payload));
  assert result->0->>'status'='ADDED' and result->1->>'status'='FAILED','partial fixture keeps successful sibling';
  result:=public.import_pilot_inventory_quick(store_id,jsonb_build_object('file',file_c,'rows',jsonb_set(payload,'{1,opening_quantity}','3'::jsonb)));
  assert result->0->>'status'='EXISTING' and result->1->>'status'='ADDED','retry builds only failed row';
  assert (select quantity=2 from public.store_product_opening_balances b where b.store_id=store_id and b.product_id=(result->0->>'product_id')::uuid),'successful sibling opening is unchanged';
  assert not has_table_privilege('authenticated','private.import_removal_receipts','SELECT'),'removal receipts are private';
  assert not has_table_privilege('authenticated','private.import_removal_receipts','INSERT'),'clients cannot forge restoration evidence';
  assert nullif(current_setting('app.opening_balance_maintenance',true),'') is not distinct from nullif(prior_setting,''),'maintenance flag does not leak';
  assert public.get_pilot_count_details(count_session)=details,'all retry scenarios preserve historical count values';
end $test$;
select 'ok 1 - same-file restore, partial retries, shared openings, history and authorization';
rollback;
