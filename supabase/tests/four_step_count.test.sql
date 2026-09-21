begin;
select '1..1';
do $test$
#variable_conflict use_variable
declare
 actor uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid(); data jsonb; org uuid; store_id uuid; other_store uuid;
 file_a jsonb; file_b jsonb; result jsonb; product_id uuid; egg uuid; current_session uuid; cold uuid; unclassified uuid;
 expected jsonb; frozen jsonb; stamp timestamptz; details jsonb; request_id uuid:=gen_random_uuid();
begin
 insert into auth.users(id,email,email_confirmed_at,created_at,updated_at)
 values(actor,actor||'@four-step.invalid',now(),now(),now()),(outsider,outsider||'@four-step.invalid',now(),now(),now());
 perform set_config('request.jwt.claim.sub',actor::text,true);
 data:=public.owner_setup();
 data:=public.owner_setup('business','{"organization_name":"四步盤點測試","business_type":"SINGLE_RESTAURANT","store_mode":"SINGLE"}',0);
 data:=public.owner_setup('store',data->'draft'||jsonb_build_object('store_name','測試店','store_code','FS'||substr(replace(gen_random_uuid()::text,'-',''),1,12)),(data->>'revision')::int);
 data:=public.owner_setup('identity',data->'draft'||'{"work_role":"OWNER"}',(data->>'revision')::int);
 data:=public.owner_setup('complete',data->'draft',(data->>'revision')::int);
 store_id:=(data->>'store_id')::uuid; org:=(data->>'organization_id')::uuid;
 other_store:=(public.app_operation(store_id,'store.create','{"name":"另一門市"}',gen_random_uuid())->>'id')::uuid;
 file_a:=jsonb_build_object('original_filename','盤點.xlsx','file_sha256',repeat('a',64),'storage_path',org||'/'||store_id||'/a.xlsx','sheet_names','["盤點"]'::jsonb);
 file_b:=file_a||jsonb_build_object('original_filename','追加.xlsx','file_sha256',repeat('b',64),'storage_path',org||'/'||store_id||'/b.xlsx');
 result:=public.import_pilot_inventory_quick(store_id,jsonb_build_object('file',file_a,'rows','[{"source_id":"milk","name":"鮮奶（瓶）","product_code":"MILK","count_unit":"瓶","unit_price":10,"opening_quantity":3},{"source_id":"egg","name":"雞蛋","product_code":"EGG","count_unit":"顆"}]'::jsonb));
 assert result->0->>'status'='ADDED',result::text;
 product_id:=(result->0->>'product_id')::uuid;egg:=(result->1->>'product_id')::uuid;
 assert not exists(select 1 from public.inventory_count_sessions where inventory_count_sessions.store_id=store_id),'import must not create a count';
 result:=public.import_pilot_inventory_quick(store_id,jsonb_build_object('file',file_b,'rows','[{"source_id":"milk2","name":"鮮奶(瓶)","product_code":"MILK","count_unit":"瓶","unit_price":99},{"source_id":"different","name":"真正不同品項","product_code":"MILK","count_unit":"瓶"}]'::jsonb));
 assert result->0->>'status'='EXISTING','NFKC equivalent names match';
 assert result->1->>'status'='FAILED','a real code conflict is still rejected';
 assert private.count_price(store_id,product_id,'瓶')=10,'additional sources cannot silently replace a price';
 current_session:=public.start_pilot_count(store_id,null);
 assert jsonb_array_length((select snapshot->'zones' from public.inventory_count_sessions where id=current_session))=2,'full count has two products';
 perform public.assign_pilot_product_to_zone(public.create_pilot_zone(other_store,'冷藏'),product_id);
 result:=public.app_operation(store_id,'count.catalog-lifecycle',jsonb_build_object('ids',jsonb_build_array(product_id),'mode','DISABLE'),request_id);
 result:=public.app_operation(store_id,'count.catalog-lifecycle',jsonb_build_object('ids',jsonb_build_array(product_id),'mode','DISABLE'),request_id);
 assert (select is_active from public.products where id=product_id),'removing in one store cannot deactivate a shared product';
 assert (select count(*) from public.zone_products zp join public.count_zones z on z.id=zp.zone_id where z.store_id=other_store and zp.product_id=product_id)=1,'other store assignment preserved';
 assert jsonb_array_length((select snapshot->'zones' from public.inventory_count_sessions where id=current_session))=1,'empty count follows catalogue removal';
 result:=public.app_operation(store_id,'count.catalog-lifecycle',jsonb_build_object('ids',jsonb_build_array(product_id),'mode','RESTORE'),gen_random_uuid());
 assert not exists(select 1 from public.store_product_opening_balances b where b.store_id=store_id and b.product_id=product_id),'re-adding a removed product does not silently restore removed source quantities';
 perform public.fill_pilot_opening(store_id,product_id,3);
 perform public.app_operation(store_id,'count.prepare','{}',gen_random_uuid());
 cold:=public.create_pilot_zone(store_id,'冷藏區');
 select id into unclassified from public.count_zones where count_zones.store_id=store_id and name='未分類';
 select jsonb_object_agg(z.id::text,jsonb_build_object('name',z.name,'product_ids',coalesce((select jsonb_agg(zp.product_id order by zp.sort_order,zp.product_id) from public.zone_products zp where zp.zone_id=z.id),'[]'::jsonb))) into expected from public.count_zones z where z.store_id=store_id and z.is_active;
 perform public.save_pilot_zone_configuration_v2(cold,'冷藏區',array[product_id],expected,true);
 assert (select snapshot->'zones' @> jsonb_build_array(jsonb_build_object('zone_id',cold,'product_id',product_id)) from public.inventory_count_sessions where id=current_session),'untouched active count follows zone change';
 result:=public.app_operation(store_id,'count.catalog-edit',jsonb_build_object('id',product_id,'name','鮮奶(瓶)','unit','瓶','unit_price',12,'updated_at',(select updated_at from public.products where id=product_id)),gen_random_uuid());
 assert private.count_price(store_id,product_id,'瓶')=12,'manager can save count unit price';
 assert (select unit_price from private.count_price_snapshots where session_id=current_session and count_price_snapshots.product_id=product_id)=12,'empty count price refreshes';
 stamp:=public.save_pilot_count_draft(current_session,cold,product_id,0,null);
 select snapshot into frozen from public.inventory_count_sessions where id=current_session;
 result:=public.app_operation(store_id,'count.prepare','{}',gen_random_uuid());
 assert (select snapshot=frozen from public.inventory_count_sessions where id=current_session),'zero is entered work and freezes the snapshot';
 begin
   perform public.save_pilot_zone_configuration_v2(cold,'變更',array[product_id],expected,false);
   raise exception 'zone should be locked';
 exception when sqlstate '22023' then assert sqlerrm='COUNT_IN_PROGRESS'; end;
 begin
   perform public.app_operation(store_id,'count.catalog-lifecycle',jsonb_build_object('ids',jsonb_build_array(egg),'mode','DISABLE'),gen_random_uuid());
   raise exception 'removal should be locked';
 exception when sqlstate '22023' then assert sqlerrm='COUNT_IN_PROGRESS'; end;
 stamp:=public.save_pilot_count_draft(current_session,cold,product_id,5,stamp);
 perform public.complete_pilot_count_zone(current_session,cold);
 perform public.save_pilot_count_draft(current_session,unclassified,product_id,4,null);
 perform public.save_pilot_count_draft(current_session,unclassified,egg,2,null);
 perform public.complete_pilot_count_zone(current_session,unclassified);
 perform public.resolve_pilot_count_discrepancy((select d.id from public.inventory_count_discrepancies d where d.session_id=current_session and d.product_id=product_id),'INPUT_ERROR','CORRECTION',6);
 details:=public.get_pilot_count_details(current_session);
 assert (select sum((d->>'amount')::numeric) from jsonb_array_elements(details) d)=108,'cross-zone product correction must not replace a zone value with a whole-product total';
 assert exists(select 1 from jsonb_array_elements(details) d where d->>'product_id'=product_id::text and (d->>'amount')::numeric=60 and (d->>'unit_price')::numeric=12),'completed count amount uses its unit price';
 assert exists(select 1 from jsonb_array_elements(details) d where d->>'product_id'=egg::text and d->>'amount' is null),'missing price stays unknown';
 result:=public.get_pilot_count_results(current_session);
 assert not exists(select 1 from jsonb_array_elements(result) d where d ? 'amount' or d ? 'unit_price'),'counter results do not disclose prices';
 result:=public.app_operation(store_id,'count.catalog-edit',jsonb_build_object('id',product_id,'name','鮮奶(瓶)','unit','瓶','unit_price',99,'updated_at',(select updated_at from public.products where id=product_id)),gen_random_uuid());
 assert public.get_pilot_count_details(current_session)=details,'later edits preserve historical valuations';
 assert not has_function_privilege('authenticated','private.count_catalog_operation(uuid,text,jsonb)','EXECUTE'),'private mutation helper cannot be called directly';
 assert not has_table_privilege('authenticated','private.count_price_snapshots','SELECT'),'price snapshots are private';
 perform set_config('request.jwt.claim.sub',outsider::text,true);
 begin
   perform public.app_operation(store_id,'count.catalog-lifecycle',jsonb_build_object('ids',jsonb_build_array(product_id),'mode','DISABLE'),request_id);
   raise exception 'outsider replay accepted';
 exception when insufficient_privilege then null; end;
 begin
   perform public.get_pilot_count_details(current_session);
   raise exception 'outsider prices leaked';
 exception when insufficient_privilege then null; end;
 perform set_config('request.jwt.claim.sub','',true);
 begin
   perform public.app_operation(store_id,'count.prepare','{}',gen_random_uuid());
   raise exception 'anonymous prepare accepted';
 exception when insufficient_privilege then null; end;
end $test$;
select 'ok 1 - four-step setup, scoped removal, NFKC, values and permissions';
rollback;
