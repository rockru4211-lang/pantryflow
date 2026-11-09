-- Private isolated data; the entire test is rolled back. No real accounts or PINs.
begin;
do $test$
declare
 owner_id uuid:=gen_random_uuid();admin_id uuid:=gen_random_uuid();staff_id uuid:=gen_random_uuid();org uuid:=gen_random_uuid();a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();
 batch uuid:=gen_random_uuid();receipt uuid:=gen_random_uuid();run_id uuid:=gen_random_uuid();next_run uuid:=gen_random_uuid();doc uuid:=gen_random_uuid();
 product uuid:=gen_random_uuid(); account_id uuid:=gen_random_uuid(); lot_id uuid:=gen_random_uuid(); 
 r jsonb;input jsonb;details jsonb;
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
 insert into public.receipt_upload_batches(id,organization_id,store_id,store_name,work_date,uploaded_by,batch_number,status,group_mode) values(batch,org,a,'BeApe','2026-09-15',owner_id,'RR-ONLY','READY_FOR_REVIEW','SAME_RECEIPT');
 insert into public.receipt_ocr_runs(id,organization_id,batch_id,version,provider,model,prompt_version,status,started_by) values(run_id,org,batch,1,'FIXTURE','rollback-only','fixture-v1','SUCCEEDED',owner_id);
 insert into public.receipt_ocr_fields(organization_id,batch_id,ocr_run_id,row_key,field_name,raw_value,normalized_value,confidence,review_status)
 select org,batch,run_id,'document',key,value,value,1,'TRUSTED' from jsonb_each(jsonb_build_object('supplier_name','核對測試廠商','receipt_date','2026-09-15','document_number','RR-ONLY','subtotal_ex_tax',100,'tax',5,'total_inc_tax',105))
 union all select org,batch,run_id,'line-0001',key,value,value,1,'TRUSTED' from jsonb_each(jsonb_build_object('product','蝸牛肉','unit','包','quantity',2,'unit_price_ex_tax',null,'subtotal_ex_tax',null));


 insert into public.receipt_ocr_fields(organization_id,batch_id,ocr_run_id,row_key,field_name,raw_value,normalized_value,confidence,review_status)
 select org,batch,run_id,'candidate-0002',key,value,value,1,'TRUSTED' from jsonb_each(jsonb_build_object('product','待核對品名','unit','包','quantity',3,'unit_price_ex_tax',50,'subtotal_ex_tax',150));
 r:=public.get_baihuayuan_receipt_accounts(a,null,null,null,batch)->0;
 assert jsonb_array_length(r->'lines')=1 and r#>>'{lines,0,product_name}'='蝸牛肉','candidate entered purchase rows';
 details:=public.get_pilot_receipt(batch);
 assert exists(select 1 from jsonb_array_elements(details->'fields') f where f->>'row_key'='candidate-0002' and f->>'field_name'='product'),'candidate missing for review';
 assert not private.baihuayuan_receipt_line_included(batch,run_id,'candidate-0002'),'candidate used by legacy publishing';
 input:=jsonb_build_object('source_fingerprint',r->>'source_fingerprint','revision',r->'revision','header',jsonb_build_object('supplier_name',r->>'supplier_name','receipt_date','2026-09-15','document_number','RR-ONLY'),
 'lines',r->'lines','adjustment',0,'tax',null,'total',0,'note','','checked',false,'review_completed',true);
 begin perform public.save_baihuayuan_receipt_review(a,batch,input,gen_random_uuid());raise exception 'unresolved candidate completed';exception when sqlstate '22023' then assert sqlerrm='RECEIPT_PURCHASE_EVIDENCE_REVIEW',sqlerrm;end;
 perform set_config('request.jwt.claim.sub',staff_id::text,true);
 begin perform public.set_baihuayuan_receipt_line_decision(a,batch,run_id,'candidate-0002','INCLUDE');raise exception 'staff accepted candidate';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 perform public.set_baihuayuan_receipt_line_decision(a,batch,run_id,'candidate-0002','INCLUDE');
 r:=public.get_baihuayuan_receipt_accounts(a,null,null,null,batch)->0;
 assert exists(select 1 from jsonb_array_elements(r->'lines') f where f->>'row_key'='candidate-0002' and f->>'quantity'='3'),'selected candidate values not retained';
 perform public.set_baihuayuan_receipt_line_decision(a,batch,run_id,'candidate-0002','IGNORE');
 assert jsonb_array_length(public.get_baihuayuan_receipt_accounts(a,null,null,null,batch)->0->'lines')=1,'ignore did not exclude';
end $test$;
rollback;
