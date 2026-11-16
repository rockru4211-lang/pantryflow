-- Store-scoped fixture. Every change, including alias and audit rows, rolls back.
begin;
do $test$
declare
 owner_id uuid:=gen_random_uuid(); staff_id uuid:=gen_random_uuid(); org uuid:=gen_random_uuid();
 store_a uuid:=gen_random_uuid(); store_b uuid:=gen_random_uuid();
 zone_a uuid:=gen_random_uuid(); zone_b uuid:=gen_random_uuid();
 drop_id uuid:=gen_random_uuid(); foreign_id uuid:=gen_random_uuid(); chosen_id uuid:=gen_random_uuid();
 supplier_a uuid:=gen_random_uuid(); supplier_b uuid:=gen_random_uuid();
 source_batch uuid:=gen_random_uuid(); second_batch uuid:=gen_random_uuid();
 ingredient_id uuid:=gen_random_uuid();
 req uuid:=gen_random_uuid(); payload jsonb; source_row jsonb; target_row jsonb; response jsonb;
 denied boolean; events_before bigint;
begin
 assert not has_function_privilege('anon','public.baihuayuan_receipt_count_candidates(uuid,text,jsonb,uuid)','execute');
 assert not has_table_privilege('authenticated','private.receipt_count_matches','select,insert,update,delete');
 insert into auth.users(id,email,email_confirmed_at,created_at,updated_at)
 select id,id||'@receipt-count-match.invalid',now(),now(),now() from unnest(array[owner_id,staff_id]) id;
 insert into public.profiles(id,display_name)
 select id,'配對隔離驗證' from unnest(array[owner_id,staff_id]) id on conflict(id) do nothing;
 insert into public.organizations(id,name,business_type,store_mode) values(org,'配對隔離驗證','SINGLE_RESTAURANT','MULTI');
 insert into public.stores(id,organization_id,name,store_code,created_by) values
  (store_a,org,'BeApe','CM'||substr(store_a::text,1,8),owner_id),(store_b,org,'Gras','CM'||substr(store_b::text,1,8),owner_id);
 insert into public.organization_members(organization_id,user_id,role,is_owner,can_manage_business)
 values(org,owner_id,'OWNER',true,true),(org,staff_id,'STAFF',false,false);
 insert into public.staff_identities(organization_id,user_id,display_name,created_by)
 select org,id,'配對隔離驗證',owner_id from unnest(array[owner_id,staff_id]) id;
 insert into public.store_memberships(store_id,organization_id,user_id,login_identifier,role,work_role,assigned_by,can_manage_business) values
  (store_a,org,owner_id,'cm-owner','OWNER','OWNER',owner_id,true),
  (store_b,org,owner_id,'cm-owner-b','OWNER','OWNER',owner_id,true),
  (store_a,org,staff_id,'cm-staff','STAFF','STAFF',owner_id,false);
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);
 insert into public.suppliers(id,organization_id,name) values
  (supplier_a,org,'配對測試供應商'),(supplier_b,org,'另一供應商');
 insert into public.products(id,organization_id,product_code,name,base_unit,count_unit,current_supplier_id,specification)
 values(drop_id,org,'CM-IN','測試食材（小）','包','包',supplier_a,'500克'),
  (chosen_id,org,'CM-COUNT','測試食材','公斤','公斤',supplier_a,''),
  (foreign_id,org,'CM-OTHER','其他店盤點品項','包','包',supplier_a,'');
 insert into public.count_zones(id,organization_id,store_id,name,is_active)
 values(zone_a,org,store_a,'食材',true),(zone_b,org,store_b,'食材',true);
 insert into public.zone_products(zone_id,product_id,count_unit) values(zone_a,chosen_id,'公斤'),(zone_b,foreign_id,'包');
 insert into private.ingredient_masters(id,store_id,name,unit,manual) values(ingredient_id,store_a,'測試食材','g',true);
 insert into private.ingredient_aliases(store_id,ingredient_id,name,source_key,source_unit)
 values(store_a,ingredient_id,'測試食材','p:'||chosen_id,'g');
 insert into public.receipt_upload_batches(id,organization_id,store_id,store_name,work_date,uploaded_by,batch_number,status,group_mode) values
  (source_batch,org,store_a,'BeApe',current_date,owner_id,'CM-A','PROCESSING','SAME_RECEIPT'),
  (second_batch,org,store_a,'BeApe',current_date-1,owner_id,'CM-B','PROCESSING','SAME_RECEIPT');
 insert into private.receipt_entry_items(batch_id,row_key,product_id,supplier_id,supplier_name,receipt_date,unit,unit_price,recorded_by) values
  (source_batch,'item-a',drop_id,supplier_a,'配對測試供應商',current_date,'包',123,owner_id),
  (second_batch,'item-b',drop_id,supplier_b,'另一供應商',current_date-1,'包',135,owner_id);
 select count(*) into events_before from public.inventory_lot_events where organization_id=org;

 set local role authenticated;
 source_row:=public.baihuayuan_receipt_count_candidates(store_a)#>'{rows,0}';
 target_row:=public.baihuayuan_receipt_count_candidates(store_a,'match-options')#>'{items,0}';
 assert source_row->>'receipt_name'='測試食材（小）' and source_row->>'purchase_unit'='包','invoice evidence changed';
 assert target_row->>'id'=chosen_id::text and target_row->'units'='["公斤"]'::jsonb and (target_row->>'can_remember')::boolean;
 assert not(target_row ? 'ingredient_id'),'internal ingredient id exposed';
 payload:=jsonb_build_object('source_id',drop_id,'source_revision',source_row->>'revision','target_id',chosen_id,
  'target_revision',target_row->>'revision','remember',true);
 reset role;
 perform set_config('request.jwt.claim.sub',staff_id::text,true);
 denied:=false;
 begin perform public.baihuayuan_receipt_count_candidates(store_a,'match',payload,req);
 exception when insufficient_privilege then denied:=true;end;
 assert denied,'staff matched a candidate';
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 update public.store_memberships set access_mode='VIEW' where store_id=store_a and user_id=owner_id;
 denied:=false;
 begin perform public.baihuayuan_receipt_count_candidates(store_a,'match',payload,req);
 exception when insufficient_privilege then denied:=true;end;
 assert denied,'view role could pair';
 update public.store_memberships set access_mode='EDIT' where store_id=store_a and user_id=owner_id;
 denied:=false;
 begin perform public.baihuayuan_receipt_count_candidates(store_a,'match',payload||jsonb_build_object('target_id',foreign_id),req);
 exception when serialization_failure then denied:=sqlerrm='COUNT_TARGET_CHANGED';end;
 assert denied,'another store target accepted';
 denied:=false;
 begin perform public.baihuayuan_receipt_count_candidates(store_a,'match',payload||'{"source_revision":"stale"}',req);
 exception when serialization_failure then denied:=sqlerrm='COUNT_CANDIDATES_CHANGED';end;
 assert denied,'a stale candidate was matched';

 set local role authenticated;
 response:=public.baihuayuan_receipt_count_candidates(store_a,'match',payload,req);
 assert response->>'target_name'='測試食材';
 assert public.baihuayuan_receipt_count_candidates(store_a,'match',payload,req)=response,'duplicate retry';
 source_row:=public.baihuayuan_receipt_count_candidates(store_a)#>'{rows,0}';
 assert source_row->>'supplier'='另一供應商','a different vendor was silently matched';
 assert exists(select 1 from jsonb_array_elements(public.get_baihuayuan_ingredient_matching(store_a)->'bindings') x
  where x->>'ingredient_id'=ingredient_id::text and x->>'name'='測試食材(小)' and x->>'unit'='包'
   and x->>'specification'='500克'),'saved alias is unavailable to receipt entry';
 reset role;
 assert (select count(*)=1 from private.receipt_count_matches where store_id=store_a and target_product_id=chosen_id);
 assert (select product_id=drop_id and unit='包' and unit_price=123 from private.receipt_entry_items where batch_id=source_batch);
 assert (select count_unit='公斤' from public.zone_products where zone_id=zone_a and product_id=chosen_id);
 assert not exists(select 1 from public.zone_products where zone_id=zone_a and product_id=drop_id),'created a duplicate count item';
 assert (select count(*)=events_before from public.inventory_lot_events where organization_id=org),'inventory was posted';
 assert not exists(select 1 from private.receipt_count_decisions where store_id=store_a),'pair was treated as a dismissal';

 payload:=payload||jsonb_build_object('source_revision',source_row->>'revision','remember',false);
 perform public.baihuayuan_receipt_count_candidates(store_a,'match',payload,gen_random_uuid());
 assert jsonb_array_length(public.baihuayuan_receipt_count_candidates(store_a)->'rows')=0;
 assert (select count(*)=1 from private.receipt_ingredient_bindings where store_id=store_a),'unchecked alias was learned';
end
$test$;
select 'receipt_count_existing_match_ok' result;
rollback;
