-- Synthetic organizations and receipts only; every write is rolled back.
begin;
do $$
declare owner_id uuid:=gen_random_uuid(); other_owner uuid:=gen_random_uuid(); person uuid;
 org uuid; sid uuid; other_org uuid; other_store uuid; target uuid; typo uuid; foreign_supplier uuid; alternate uuid;
 batch uuid; old_batch uuid; run uuid; product uuid; req uuid:=gen_random_uuid(); payload jsonb; result jsonb; data jsonb; before_ocr text; r text; denied boolean; receipt uuid; before_receipt jsonb; before_product jsonb; before_aliases jsonb; saved_revision text;
begin
 assert not has_table_privilege('authenticated','private.supplier_name_links','select,insert,update,delete'),'private links exposed';
 assert not has_function_privilege('authenticated','private.resolve_supplier_name(uuid,jsonb)','execute'),'private writer exposed';
 assert (select relrowsecurity from pg_class where oid='private.supplier_name_links'::regclass),'links RLS missing';
 insert into auth.users(id,email,email_confirmed_at,created_at,updated_at) values(owner_id,owner_id||'@supplier-name-fixture.invalid',now(),now(),now()),(other_owner,other_owner||'@supplier-name-fixture.invalid',now(),now(),now());
 foreach person in array array[other_owner,owner_id] loop
  perform set_config('request.jwt.claim.sub',person::text,true);
  data:=public.owner_setup();data:=public.owner_setup('business',jsonb_build_object('organization_name','Name fixture','business_type','SINGLE_RESTAURANT','store_mode','SINGLE'),0);
  data:=public.owner_setup('store',data->'draft'||jsonb_build_object('store_name','BeApe','store_code','QA'||substr(replace(gen_random_uuid()::text,'-',''),1,14),'staff_login_mode','NAME_OR_NICKNAME'),(data->>'revision')::int);
  data:=public.owner_setup('complete','{}',(data->>'revision')::int);
  if person=other_owner then other_org:=(data->>'organization_id')::uuid;other_store:=(data->>'store_id')::uuid;
  else org:=(data->>'organization_id')::uuid;sid:=(data->>'store_id')::uuid;end if;
 end loop;
 insert into public.suppliers(organization_id,name) values(org,'正式供應商') returning id into target;
 insert into public.suppliers(organization_id,name) values(org,'誤植供應商') returning id into typo;
 insert into public.suppliers(organization_id,name) values(org,'另一供應商') returning id into alternate;
 insert into public.suppliers(organization_id,name) values(other_org,'外部供應商') returning id into foreign_supplier;
 insert into public.products(organization_id,name,product_code,base_unit,count_unit,current_supplier_id) values(org,'名稱測試品項','QA-NAMES','包','包',typo) returning id into product;
 insert into public.receipt_upload_batches(organization_id,store_id,store_name,uploaded_by,work_date,status)
 values(org,sid,'BeApe',owner_id,'2026-09-09','READY_FOR_REVIEW') returning id into batch;
 select id into run from public.create_receipt_ocr_run(org,batch,'qa-fixture','qa-fixture','supplier-name-test',owner_id);
 insert into public.receipt_ocr_fields(organization_id,batch_id,ocr_run_id,row_key,field_name,raw_value,normalized_value,confidence,review_status)
 select org,batch,run,x.r,x.f,x.v,x.v,0.99,'TRUSTED' from (values
 ('document','supplier_name','"誤植供應商"'::jsonb),('document','receipt_date','"2026-09-09"'::jsonb),('document','document_number','"NAME-001"'::jsonb),
 ('line-0001','product','"名稱測試品項"'::jsonb),('line-0001','unit','"包"'::jsonb),('line-0001','quantity','2'::jsonb),('line-0001','unit_price_ex_tax','50'::jsonb),('line-0001','subtotal_ex_tax','100'::jsonb)
 )x(r,f,v);
 update public.receipt_ocr_runs set status='SUCCEEDED',completed_at=now() where id=run;
 select md5(string_agg(to_jsonb(f)::text,'' order by f.id)) into before_ocr from public.receipt_ocr_fields f where batch_id=batch;

 -- Prepare a confirmed alias and an already-published historical receipt.
 perform public.app_operation(sid,'supplier.resolve-name',jsonb_build_object('source_name','誤植供應商','expected_supplier_id',typo,'supplier_id',target),gen_random_uuid());
 receipt:=private.publish_receipt(batch,owner_id,false);
 insert into private.supplier_details(supplier_id,aliases,company_name,bank_account,updated_by)
 values(target,array['正式簡稱'],'原正式公司有限公司','001234',owner_id);
 select to_jsonb(g) into before_receipt from public.goods_receipts g where id=receipt;
 select to_jsonb(p) into before_product from public.products p where id=product;
 select updated_at::text into saved_revision from public.suppliers where id=target;
 payload:=jsonb_build_object('id',target,'name','統一新名稱','updated_at',saved_revision,'aliases',jsonb_build_array('正式簡稱','新貨單別名'));
 req:=gen_random_uuid();result:=public.app_operation(sid,'supplier.save',payload,req);
 assert public.app_operation(sid,'supplier.save',payload,req)=result,'rename retry changed result';
 assert (select count(*) from private.app_requests where store_id=sid and request_id=req)=1,'rename retry duplicated request';
 assert (select count(*) from public.audit_logs where attempt_id=req)=1,'rename retry duplicated audit';
 assert result->>'id'=target::text,'rename changed identity';
 assert result->'value'->>'company_name'='原正式公司有限公司' and result->'value'->>'bank_account'='001234','rename lost company/finance';
 assert private.supplier_identity(org,'正式供應商')=target,'old name not retained';
 assert private.supplier_identity(org,'新貨單別名')=target,'new alias missing';
 assert private.supplier_display_name(org,'誤植供應商')='統一新名稱','confirmed alias not renamed';
 assert public.get_baihuayuan_receipt_inbox(sid)->0->>'supplier_name'='統一新名稱','inbox display stale';
 assert public.get_pilot_receipt_ledger(sid)->0->>'supplier_name'='統一新名稱','ledger display stale';
 assert public.get_baihuayuan_receipt_accounts(sid,null,null,'正式供應商',null)->0->>'supplier_name'='統一新名稱','account old-name filter stale';
 assert (select x->>'supplier_name' from jsonb_array_elements(public.app_workspace(sid,'catalog')->'products') x where x->>'id'=product::text)='統一新名稱','product display stale';
 assert exists(select 1 from jsonb_array_elements(public.field_product_options(sid,sid)->'suppliers') x where x->>'id'=target::text and x->>'name'='統一新名稱'),'field supplier stale';
 assert before_receipt=(select to_jsonb(g) from public.goods_receipts g where id=receipt),'historical receipt mutated';
 assert before_product=(select to_jsonb(p) from public.products p where id=product),'product identity mutated';
 assert before_ocr=(select md5(string_agg(to_jsonb(f)::text,'' order by f.id)) from public.receipt_ocr_fields f where batch_id=batch),'OCR source mutated';
 -- Clearing editable aliases cannot erase a previously used canonical name.
 result:=public.app_operation(sid,'supplier.save',jsonb_build_object('id',target,'name','統一新名稱','updated_at',result->'value'->>'updated_at','aliases','[]'::jsonb),gen_random_uuid());
 assert private.supplier_identity(org,'正式供應商')=target,'clearing aliases erased prior canonical name';
 assert result->'value'->'aliases' ? '正式供應商','save response omitted retained name';
 assert result->'value'->'aliases' ? '誤植供應商','save response omitted confirmed alias';
 saved_revision:=result->'value'->>'updated_at';
 -- A name, alias or former name owned by another supplier cannot be claimed, even if paused.
 update public.suppliers set is_active=false where id=alternate;
 foreach r in array array['另一供應商','另 一 供應商'] loop
  denied:=false;begin perform public.app_operation(sid,'supplier.save',jsonb_build_object('id',target,'name',r,'updated_at',saved_revision),gen_random_uuid());exception when unique_violation then denied:=true;end;assert denied,'conflicting rename accepted';
  denied:=false;begin perform public.app_operation(sid,'supplier.save',jsonb_build_object('id',target,'name','統一新名稱','updated_at',saved_revision,'aliases',jsonb_build_array(r)),gen_random_uuid());exception when unique_violation then denied:=true;end;assert denied,'conflicting alias accepted';
 end loop;
 denied:=false;begin perform public.app_operation(sid,'supplier.save',jsonb_build_object('name','新廠商','aliases',jsonb_build_array('正式供應商')),gen_random_uuid());exception when unique_violation then denied:=true;end;assert denied,'new supplier claimed former name';
 denied:=false;begin perform public.app_operation(sid,'supplier.save',jsonb_build_object('id',typo,'name','偷改舊檔','updated_at',(select updated_at from public.suppliers where id=typo)),gen_random_uuid());exception when invalid_parameter_value then denied:=true;end;assert denied,'shadow edited directly';
 assert (select count(*) from public.suppliers where organization_id=org)=3,'rejected save left new supplier';
 -- Other organizations may use the same spelling without becoming the same identity.
 perform set_config('request.jwt.claim.sub',other_owner::text,true);
 data:=public.app_operation(other_store,'supplier.save',jsonb_build_object('name','統一新名稱'),gen_random_uuid());
 assert data->>'id'<>target::text,'cross organization identity reused';
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 denied:=false;begin perform public.app_operation(other_store,'supplier.save',payload,gen_random_uuid());exception when insufficient_privilege then denied:=true;end;assert denied,'cross organization write allowed';
 denied:=false;begin perform public.app_operation(sid,'supplier.save',jsonb_build_object('id',target,'name','過期修改','updated_at',(saved_revision::timestamptz-interval '1 second')),gen_random_uuid());exception when serialization_failure then denied:=true;end;assert denied,'stale rename accepted';
 update public.store_memberships set access_mode='VIEW' where store_id=sid and user_id=owner_id;
 denied:=false;begin perform public.app_operation(sid,'supplier.save',payload,req);exception when insufficient_privilege then denied:=true;end;assert denied,'read-only replay allowed';
 update public.store_memberships set access_mode='EDIT' where store_id=sid and user_id=owner_id;
 -- Pause keeps historical display canonical while the supplier remains unavailable for new receipts.
 result:=public.app_operation(sid,'supplier.save',jsonb_build_object('id',target,'name','再次統一名稱','updated_at',saved_revision,'is_active',false),gen_random_uuid());
 assert private.supplier_identity(org,'正式供應商') is null,'paused supplier became selectable';
 assert private.supplier_display_name(org,'正式供應商')='再次統一名稱','paused supplier history lost';
 assert (select is_active from public.suppliers where id=target)=false,'pause state lost';
 assert before_receipt=(select to_jsonb(g) from public.goods_receipts g where id=receipt),'historical receipt changed';
 assert before_product=(select to_jsonb(p) from public.products p where id=product),'product changed';
 assert before_ocr=(select md5(string_agg(to_jsonb(f)::text,'' order by f.id)) from public.receipt_ocr_fields f where batch_id=batch),'original OCR changed';
end $$;
rollback;
select 'PASS: central rename, aliases, all readers, original records, conflicts, retry, scope and read-only' as result;
