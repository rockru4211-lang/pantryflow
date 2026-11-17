-- A saved legacy approval can supply an original price without claiming an uncertain product.
begin;
do $test$
declare
 owner_id uuid:=gen_random_uuid();
 org uuid:=gen_random_uuid();
 beape uuid:=gen_random_uuid();
 gras uuid:=gen_random_uuid();
 supplier uuid:=gen_random_uuid();
 ingredient uuid:=gen_random_uuid();
 product uuid:=gen_random_uuid();
 alternate_product uuid:=gen_random_uuid();
 reference_id uuid:=gen_random_uuid();
 receipt_batch uuid:=gen_random_uuid();
 approved_at timestamptz:='2026-10-19 08:23Z';
 item_name text:='隔離測試蝦 340g';
 line jsonb;
 approval jsonb;
 fingerprint text;
 recovered record;
begin
 assert not has_function_privilege('anon','private.legacy_receipt_ingredient_prices(uuid)','EXECUTE'),'anonymous legacy price read';
 assert not has_function_privilege('authenticated','private.legacy_receipt_ingredient_prices(uuid)','EXECUTE'),'direct legacy price read';
 insert into auth.users(id,email,email_confirmed_at) values(owner_id,owner_id||'@legacy-price.invalid',now());
 insert into public.organizations(id,name,business_type,store_mode) values(org,'歷史進價隔離測試','SINGLE_RESTAURANT','MULTI');
 insert into public.stores(id,organization_id,name,store_code,created_by)
 values(beape,org,'BeApe','LP'||substr(beape::text,1,8),owner_id),(gras,org,'Gras','LP'||substr(gras::text,1,8),owner_id);
 insert into public.suppliers(id,organization_id,name,is_active) values(supplier,org,'歷史進價測試商',true);
 insert into private.supplier_name_links(organization_id,name_key,source_name,supplier_id,evidence)
 values(org,private.history_key('歷史進價測試商別名'),'歷史進價測試商別名',supplier,'隔離測試');
 insert into public.products(id,organization_id,product_code,name,base_unit,count_unit,specification)
 values(product,org,'LP-PRODUCT',item_name,'罐','罐','340g'),(alternate_product,org,'LP-PRODUCT-ALT',item_name||'另一品號','罐','罐','340g');
 insert into private.ingredient_masters(id,store_id,name,unit) values(ingredient,beape,item_name,'g');
 insert into private.recipe_price_entries(id,store_id,name,unit,price,source,effective_date,actor_id,source_kind,review_status,source_ref,purchase)
 values(reference_id,beape,item_name,'g',2.35,'請購表：隔離測試',current_date,owner_id,'purchase','confirmed',
  '{"supplier_name":"歷史進價測試商別名"}','{"amount":800,"quantity":1,"unit":"罐","content_quantity":340,"content_unit":"g"}');
 insert into private.ingredient_aliases(store_id,ingredient_id,name,source_key,source_unit,specification,reference_ids)
 values(beape,ingredient,item_name,'p:'||product,'g','340g',array[reference_id]);
 insert into public.receipt_upload_batches(id,organization_id,store_id,store_name,work_date,uploaded_by,batch_number,status,group_mode)
 values(receipt_batch,org,beape,'BeApe','2026-10-02',owner_id,'LP-LEGACY','READY_FOR_REVIEW','SAME_RECEIPT');
 line:=jsonb_build_object('row_key','lp-1','product_name',item_name,'unit','罐','quantity',3,'unit_price',900,'handling','NORMAL');
 approval:=jsonb_build_object('batch_id',receipt_batch,'edit_revision',2,'raw_fingerprint','legacy-raw','source_fingerprint','legacy-scoped',
  'entry_completed',true,'review_completed',true,'net',2700,'tax',0,'total',2700,'lines',jsonb_build_array(line));
 fingerprint:=md5(jsonb_build_array('legacy-scoped',2700,0,2700,'')::text);
 insert into private.app_requests(store_id,request_id,actor_id,action,payload,result,created_at)
 values(beape,gen_random_uuid(),owner_id,'receipt.review-correct','{}',jsonb_build_object('saved',true,'account',approval),approved_at);
 insert into private.receipt_account_edits(batch_id,store_id,header,line_values,source_fingerprint,revision,updated_by,updated_at,review_completed_source,entry_completed_source)
 values(receipt_batch,beape,'{"receipt_date":"2026-10-02","supplier_name":"歷史進價測試商"}',jsonb_build_object('lp-1',line),'legacy-raw',2,owner_id,approved_at,fingerprint,fingerprint);

 select * into strict recovered from private.legacy_receipt_ingredient_prices(beape);
 assert recovered.ingredient_id=ingredient and recovered.product_id=product and recovered.price=900 and recovered.unit='罐','receipt identity or original price changed';
 assert recovered.product_name=item_name and recovered.supplier='歷史進價測試商' and recovered.purchase->>'content_quantity'='340','receipt name, supplier alias or package changed';
 assert not exists(select 1 from private.legacy_receipt_ingredient_prices(gras)),'legacy receipt crossed the store boundary';
 insert into private.ingredient_aliases(store_id,ingredient_id,name,source_key,source_unit,specification,reference_ids)
 values(beape,ingredient,item_name,'p:'||alternate_product,'g','340g',array[reference_id]);
 select * into strict recovered from private.legacy_receipt_ingredient_prices(beape);
 assert recovered.product_id is null and recovered.ingredient_id=ingredient,'ambiguous product should preserve only the ingredient link';
 update private.receipt_account_edits set revision=3 where batch_id=receipt_batch;
 assert not exists(select 1 from private.legacy_receipt_ingredient_prices(beape)),'stale approval supplied a price';
end $test$;
rollback;
