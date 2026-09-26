-- Synthetic organizations and receipts only; every write is rolled back.
begin;
do $$
declare owner_id uuid:=gen_random_uuid(); other_owner uuid:=gen_random_uuid(); person uuid;
 org uuid; sid uuid; other_org uuid; other_store uuid; target uuid; typo uuid; foreign_supplier uuid; alternate uuid;
 batch uuid; old_batch uuid; run uuid; product uuid; req uuid:=gen_random_uuid(); payload jsonb; result jsonb; data jsonb; before_ocr text; r text; denied boolean; receipt uuid;
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
 payload:=jsonb_build_object('source_name','誤植供應商','expected_supplier_id',typo,'supplier_id',target);
 denied:=false;begin perform public.app_operation(sid,'supplier.resolve-name',payload||jsonb_build_object('supplier_id',foreign_supplier),gen_random_uuid());exception when invalid_parameter_value then denied:=true;end;assert denied,'foreign target accepted';
 denied:=false;begin perform public.app_operation(other_store,'supplier.resolve-name',payload,gen_random_uuid());exception when insufficient_privilege then denied:=true;end;assert denied,'foreign store write accepted';
 result:=public.app_operation(sid,'supplier.resolve-name',payload,req);
 assert private.supplier_identity(org,' 誤植 供應商 ')=target,'normalized alias failed';
 assert private.supplier_identity(other_org,'誤植供應商') is null,'cross organization alias leak';
 assert result=public.app_operation(sid,'supplier.resolve-name',payload,req),'retry result changed';
 assert (select count(*) from private.app_requests where store_id=sid and request_id=req)=1,'request duplicated';
 assert (select count(*) from public.audit_logs where attempt_id=req)=1,'audit duplicated';
 assert (public.get_baihuayuan_receipt_inbox(sid)->0->>'supplier_name')='正式供應商','inbox not canonical';
 assert (public.get_baihuayuan_receipt_inbox(sid)->0->>'raw_supplier_name')='誤植供應商','raw name lost';
 assert (public.get_pilot_receipt_ledger(sid)->0->>'supplier_name')='正式供應商','ledger not canonical';
 assert (public.get_pilot_receipt_ledger(sid)->0->>'unit_price')::numeric=50,'price changed';
 assert (select x->>'current_supplier_id' from jsonb_array_elements(public.app_workspace(sid,'catalog')->'products') x where x->>'id'=product::text)=target::text,'catalog supplier projection failed';
 assert (select current_supplier_id from public.products where id=product)=typo,'stored product identity changed';
 assert not exists(select 1 from jsonb_array_elements(public.app_workspace(sid,'suppliers')->'suppliers') x where x->>'id'=typo::text),'shadow supplier shown';
 assert exists(select 1 from public.suppliers where id=typo),'original supplier deleted';
 assert before_ocr=(select md5(string_agg(to_jsonb(f)::text,'' order by f.id)) from public.receipt_ocr_fields f where batch_id=batch),'OCR mutated';
 denied:=false;begin perform public.app_operation(sid,'supplier.resolve-name',payload||jsonb_build_object('supplier_id',alternate),gen_random_uuid());exception when serialization_failure then denied:=true;end;assert denied,'stale selection overwrote link';
 denied:=false;begin perform public.app_operation(sid,'supplier.resolve-name',payload||jsonb_build_object('expected_supplier_id',target,'supplier_id',typo),gen_random_uuid());exception when invalid_parameter_value then denied:=true;end;assert denied,'link cycle accepted';
 receipt:=private.publish_receipt(batch,owner_id,false);
 assert (select supplier_id from public.goods_receipts where id=receipt)=target,'publisher ignored alias';
 assert (select count(*) from public.suppliers where organization_id=org)=3,'publisher created duplicate supplier';
 assert (select supplier_id from public.receipt_lines where receipt_id=receipt limit 1)=target,'published line ignored alias';
 -- New names require an explicit creation; OCR alone does not create a supplier.
 old_batch:=batch;
 insert into public.receipt_upload_batches(organization_id,store_id,store_name,uploaded_by,work_date,status)
 values(org,sid,'BeApe',owner_id,'2026-09-10','READY_FOR_REVIEW') returning id into batch;
 select id into run from public.create_receipt_ocr_run(org,batch,'qa-fixture','qa-fixture','supplier-name-test-new',owner_id);
 insert into public.receipt_ocr_fields(organization_id,batch_id,ocr_run_id,row_key,field_name,raw_value,normalized_value,confidence,review_status)
 select org,batch,run,f.row_key,f.field_name,
 case when f.field_name='supplier_name' then '"新廠商OCR"'::jsonb else f.raw_value end,
 case when f.field_name='supplier_name' then '"新廠商OCR"'::jsonb else f.normalized_value end,f.confidence,f.review_status
 from public.receipt_ocr_fields f where f.batch_id=old_batch;
 update public.receipt_ocr_runs set status='SUCCEEDED',completed_at=now() where id=run;
 denied:=false;begin perform private.publish_receipt(batch,owner_id,false);exception when raise_exception then if sqlerrm='SUPPLIER_NAME_REQUIRED' then denied:=true;else raise;end if;end;assert denied,'unknown OCR supplier published';
 payload:=jsonb_build_object('source_name','新廠商OCR','expected_supplier_id',null,'supplier_id',null,'new_name','新廠商正式名稱');
 result:=public.app_operation(sid,'supplier.resolve-name',payload,gen_random_uuid());
 assert private.supplier_identity(org,'新廠商OCR')=(result->>'id')::uuid,'new supplier mapping failed';
 -- Role downgrade must be checked before returning an idempotent cached response.
 foreach r in array array['LOGISTICS','SUPERVISOR','STAFF'] loop
  person:=gen_random_uuid();insert into auth.users(id,email,email_confirmed_at,created_at,updated_at) values(person,person||'@supplier-name-fixture.invalid',now(),now(),now());
  update public.profiles set organization_id=org,role=r::public.app_role where id=person;
  insert into public.organization_members(organization_id,user_id,role) values(org,person,r::public.app_role);
  insert into public.staff_identities(organization_id,user_id,display_name,created_by) values(org,person,'Name fixture '||r,owner_id);
  insert into public.store_memberships(store_id,organization_id,user_id,role,work_role,login_identifier,assigned_by) values(sid,org,person,r::public.app_role,r::public.app_role,lower(r),owner_id);
  perform set_config('request.jwt.claim.sub',person::text,true);
  payload:=jsonb_build_object('source_name','新廠商OCR','expected_supplier_id',private.supplier_identity(org,'新廠商OCR'),'supplier_id',target);req:=gen_random_uuid();
  if r='LOGISTICS' then
   perform public.app_operation(sid,'supplier.resolve-name',payload,req);
   update public.store_memberships set role='STAFF',work_role='STAFF' where store_id=sid and user_id=person;
  end if;
  denied:=false;begin perform public.app_operation(sid,'supplier.resolve-name',payload,req);exception when insufficient_privilege then denied:=true;end;assert denied,'unprivileged write/replay allowed';
 end loop;
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 update public.stores set is_active=false where id=sid;
 denied:=false;begin perform public.app_operation(sid,'supplier.resolve-name',payload,gen_random_uuid());exception when insufficient_privilege then denied:=true;end;assert denied,'inactive store write allowed';
 update public.stores set is_active=true where id=sid;
 update public.organizations set business_type='CHAIN_RESTAURANT' where id=org;
 denied:=false;begin perform public.app_operation(sid,'supplier.resolve-name',payload,gen_random_uuid());exception when insufficient_privilege then denied:=true;end;assert denied,'chain identity edit allowed';
 perform set_config('request.jwt.claim.sub','',true);
 denied:=false;begin perform public.app_operation(sid,'supplier.resolve-name',payload,gen_random_uuid());exception when insufficient_privilege then denied:=true;end;assert denied,'anonymous edit allowed';
end $$;
rollback;
select 'PASS: canonical inbox/ledger/catalog/publish, preserved sources, explicit creation, retry, stale/cycle/foreign/role guards' result;
