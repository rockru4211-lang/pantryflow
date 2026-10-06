-- Private isolated data; the entire test is rolled back. No real accounts or PINs.
begin;
do $test$
declare
 owner_id uuid:=gen_random_uuid();admin_id uuid:=gen_random_uuid();staff_id uuid:=gen_random_uuid();org uuid:=gen_random_uuid();a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();
 batch uuid:=gen_random_uuid();receipt uuid:=gen_random_uuid();run_id uuid:=gen_random_uuid();next_run uuid:=gen_random_uuid();doc uuid:=gen_random_uuid();
 r jsonb;input jsonb;saved jsonb;req uuid:=gen_random_uuid();raw_goods jsonb;raw_fields jsonb;raw_members jsonb;pin_count bigint;started timestamptz;
begin
 assert not has_function_privilege('anon','public.get_baihuayuan_receipt_accounts(uuid,date,date,text,uuid)','EXECUTE'),'anonymous read';
 assert not has_function_privilege('anon','public.save_baihuayuan_receipt_review(uuid,uuid,jsonb,uuid)','EXECUTE'),'anonymous write';
 assert not has_table_privilege('authenticated','private.receipt_account_edits','SELECT,INSERT,UPDATE,DELETE'),'direct correction table access';
 insert into auth.users(id,email,email_confirmed_at,created_at,updated_at) select id,id||'@receipt-review.invalid',now(),now(),now() from unnest(array[owner_id,admin_id,staff_id]) id;
 insert into public.profiles(id,display_name) select id,'隔離核對測試' from unnest(array[owner_id,admin_id,staff_id]) id on conflict(id) do nothing;
 insert into public.organizations(id,name,business_type,store_mode) values(org,'核對隔離測試','SINGLE_RESTAURANT','MULTI');
 insert into public.stores(id,organization_id,name,store_code,created_by) values(a,org,'BeApe','RR'||substr(a::text,1,8),owner_id),(b,org,'Gras','RR'||substr(b::text,1,8),owner_id);
 insert into public.organization_members(organization_id,user_id,role,is_owner,can_manage_business) values(org,owner_id,'OWNER',true,true),(org,admin_id,'LOGISTICS',false,false),(org,staff_id,'STAFF',false,false);
 insert into public.staff_identities(organization_id,user_id,display_name,created_by) select org,id,'隔離核對測試',owner_id from unnest(array[owner_id,admin_id,staff_id]) id;
 insert into public.store_memberships(store_id,organization_id,user_id,login_identifier,role,work_role,assigned_by,can_manage_business) values(a,org,owner_id,'rr-owner','OWNER','OWNER',owner_id,true),(a,org,admin_id,'rr-admin','LOGISTICS','LOGISTICS',owner_id,false),(a,org,staff_id,'rr-staff','STAFF','STAFF',owner_id,false),(b,org,owner_id,'rr-owner-b','OWNER','OWNER',owner_id,true);
 perform set_config('request.jwt.claim.sub',owner_id::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);
 insert into public.receipt_upload_batches(id,organization_id,store_id,store_name,work_date,uploaded_by,batch_number,status,group_mode) values(batch,org,a,'BeApe','2026-09-15',owner_id,'RR-ONLY','COMPLETED','SAME_RECEIPT');
 insert into public.receipt_ocr_runs(id,organization_id,batch_id,version,provider,model,prompt_version,status,started_by) values(run_id,org,batch,1,'FIXTURE','rollback-only','fixture-v1','SUCCEEDED',owner_id);
 insert into public.receipt_ocr_fields(organization_id,batch_id,ocr_run_id,row_key,field_name,raw_value,normalized_value,confidence,review_status)
 select org,batch,run_id,'document',key,value,value,1,'TRUSTED' from jsonb_each(jsonb_build_object('supplier_name','核對測試廠商','receipt_date','2026-09-15','document_number','RR-ONLY','subtotal_ex_tax',100,'tax',5,'total_inc_tax',105))
 union all select org,batch,run_id,'line-1',key,value,value,1,'TRUSTED' from jsonb_each(jsonb_build_object('product','測試麵粉','unit','包','quantity',2,'unit_price_ex_tax',50,'subtotal_ex_tax',100));
 insert into public.goods_receipts(id,organization_id,store_id,source_batch_id,receipt_date,document_number,subtotal_ex_tax,tax,total_inc_tax,reviewed_by,reviewed_at) values(receipt,org,a,batch,'2026-09-15','RR-ONLY',100,5,105,owner_id,now());
 insert into public.receipt_documents(id,organization_id,batch_id,storage_path,original_filename,page_order,mime_type,uploaded_by) values(doc,org,batch,org||'/'||batch||'/fixture.png','fixture.png',1,'image/png',owner_id);
 select to_jsonb(g) into raw_goods from public.goods_receipts g where id=receipt;
 select jsonb_agg(to_jsonb(f) order by f.id) into raw_fields from public.receipt_ocr_fields f where batch_id=batch;
 select jsonb_agg(to_jsonb(m) order by m.store_id,m.user_id) into raw_members from public.store_memberships m where organization_id=org;
 select count(*) into pin_count from private.staff_pin_credentials;
 started:=clock_timestamp();r:=public.get_baihuayuan_receipt_accounts(a,'2026-09-01','2026-09-30',null,batch)->0;
 raise notice 'single receipt read milliseconds: %',extract(epoch from clock_timestamp()-started)*1000;
 assert jsonb_array_length(r->'documents')=1 and r->'documents'->0->>'path'=org||'/'||batch||'/fixture.png','original source lost';
 assert public.get_baihuayuan_receipt_accounts(a,'2026-08-01','2026-08-31',null,null)='[]'::jsonb,'month filter';
 assert public.get_baihuayuan_receipt_accounts(a,null,null,'另一廠商',null)='[]'::jsonb,'supplier filter';
 assert public.get_baihuayuan_receipt_accounts(b,null,null,null,batch)='[]'::jsonb,'cross-store detail';
 input:=jsonb_build_object('source_fingerprint',r->>'source_fingerprint','revision',r->'revision','header',jsonb_build_object('supplier_name',r->>'supplier_name','receipt_date','2026-09-15','document_number','RR-CORRECTED'),
 'lines',jsonb_build_array((r->'lines'->0)||jsonb_build_object('quantity',3,'subtotal',150,'note','數量依原單更正')),'adjustment',0,'adjustment_note','','tax',7.5,'total',157.5,'note','逐張核對','checked',true);

 input:=input||jsonb_build_object('checked',false,'reviewed',false,'tax',null,'total',null,'lines',jsonb_build_array((input->'lines'->0)||jsonb_build_object('quantity',0,'unit_price',-10,'subtotal',0,'category','其他','unit','')));
 saved:=public.save_baihuayuan_receipt_review(a,batch,input,req);
 assert (saved->>'saved')::boolean,'spreadsheet draft rejected';
 assert (saved->'account'->'lines'->0->>'quantity')::numeric=0,'zero changed';
 assert (saved->'account'->'lines'->0->>'unit_price')::numeric=-10,'credit price changed';
 assert saved->'account'->'lines'->0->>'category'='其他','category changed';
 assert saved->'account'->'tax'='null'::jsonb,'missing tax invented';
 assert public.save_baihuayuan_receipt_review(a,batch,input,req)=saved,'retry not idempotent';
 assert (select to_jsonb(g) from public.goods_receipts g where id=receipt)=raw_goods,'source goods rewritten';
 r:=saved->'account';
 input:=input||jsonb_build_object('revision',r->'revision','source_fingerprint',r->>'source_fingerprint');
 begin perform public.save_baihuayuan_receipt_review(a,batch,input||jsonb_build_object('checked',true),gen_random_uuid());raise exception 'incomplete finance confirmation accepted';exception when invalid_parameter_value then assert sqlerrm='RECEIPT_ACCOUNT_INCOMPLETE';end;
 perform set_config('request.jwt.claim.sub',staff_id::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',staff_id,'role','authenticated')::text,true);
 begin perform public.save_baihuayuan_receipt_review(a,batch,input,gen_random_uuid());raise exception 'staff write accepted';exception when insufficient_privilege then null;end;
end;$test$;
rollback;
