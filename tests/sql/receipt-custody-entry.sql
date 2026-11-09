-- Private isolated data; the entire test is rolled back. No real accounts or PINs.
begin;
do $test$
declare
 owner_id uuid:=gen_random_uuid();admin_id uuid:=gen_random_uuid();staff_id uuid:=gen_random_uuid();org uuid:=gen_random_uuid();a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();
 batch uuid:=gen_random_uuid();receipt uuid:=gen_random_uuid();run_id uuid:=gen_random_uuid();next_run uuid:=gen_random_uuid();doc uuid:=gen_random_uuid();
 product uuid:=gen_random_uuid(); account_id uuid:=gen_random_uuid(); lot_id uuid:=gen_random_uuid(); 
 r jsonb;input jsonb;saved jsonb;req uuid; reminder uuid; wrong uuid; supplier uuid:=gen_random_uuid(); before_positions jsonb;
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
 union all select org,batch,run_id,'line-1',key,value,value,1,'TRUSTED' from jsonb_each(jsonb_build_object('product','供應商原單測試麵粉切片','unit','包','quantity',2,'unit_price_ex_tax',null,'subtotal_ex_tax',null));

 insert into public.products(id,organization_id,name,category,count_unit,base_unit) values(product,org,'測試麵粉','食材','包','包');
 insert into public.suppliers(id,organization_id,name,is_active) values(supplier,org,'核對測試廠商',true);
 insert into private.supplier_details(supplier_id,aliases,updated_by) values(supplier,array['核對測試'],owner_id) on conflict(supplier_id) do update set aliases=excluded.aliases;
 insert into private.custody_reminders(store_id,product_id,kind,name,supplier,unit,remaining,created_by) values
 (a,product,'supplier','測試麵粉','核對測試','包',51,owner_id),(b,product,'supplier','測試麵粉','核對測試','包',51,owner_id);
 select id into reminder from private.custody_reminders where store_id=a and product_id=product;
 select id into wrong from private.custody_reminders where store_id=b and product_id=product;
 assert not has_function_privilege('authenticated','private.sync_receipt_entry_custody(uuid,uuid,text,jsonb,jsonb,boolean)','EXECUTE'),'internal helper access';
 select coalesce(jsonb_agg(to_jsonb(p)),'[]') into before_positions from private.stock_positions p where store_id=a;
 r:=public.get_baihuayuan_receipt_accounts(a,null,null,null,batch)->0;
 input:=jsonb_build_object('source_fingerprint',r->>'source_fingerprint','revision',r->'revision','header',jsonb_build_object('supplier_name',r->>'supplier_name','receipt_date','2026-09-15','document_number','RR-ONLY'),
 'lines',jsonb_build_array((r->'lines'->0)||jsonb_build_object('custody_reminder_id',reminder,'handling','CUSTODY_RELEASE','quantity',2,'unit_price',null,'subtotal',0)), 'adjustment',0,'tax',null,'total',0,'note','','checked',false);
 perform set_config('request.jwt.claim.sub',staff_id::text,true);
 begin perform public.save_baihuayuan_receipt_review(a,batch,input,gen_random_uuid());raise exception 'staff write accepted';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 begin perform public.save_baihuayuan_receipt_review(a,batch,jsonb_set(input,'{lines,0,custody_reminder_id}',to_jsonb(wrong)),gen_random_uuid());raise exception 'cross-store reminder accepted';exception when sqlstate '22023' then assert sqlerrm='REMINDER_MISMATCH',sqlerrm;end;
 saved:=public.save_baihuayuan_receipt_review(a,batch,input,gen_random_uuid());
 assert (select remaining from private.custody_reminders where id=reminder)=51,'draft deducted';
 r:=saved->'account';
 input:=input||jsonb_build_object('source_fingerprint',r->>'source_fingerprint','revision',r->'revision','lines',r->'lines','entry_completed',true,'review_completed',true);
 req:=gen_random_uuid();saved:=public.save_baihuayuan_receipt_review(a,batch,input,req);
 assert (select remaining from private.custody_reminders where id=reminder)=49,'51 minus 2';
 assert saved#>>'{account,lines,0,product_name}'='供應商原單測試麵粉切片','printed item renamed';
 assert saved#>>'{account,lines,0,unit_price}' is null,'invented price';
 assert saved#>>'{account,lines,0,handling}'='CUSTODY_RELEASE','release handling missing';
 assert (saved#>>'{account,lines,0,subtotal}')::numeric=0,'release counted as charged purchase';
 assert public.save_baihuayuan_receipt_review(a,batch,input,req)=saved,'retry result changed';
 assert (select remaining from private.custody_reminders where id=reminder)=49,'retry deducted again';
 assert not exists(select 1 from private.receipt_custody_links where batch_id=batch),'duplicate legacy ledger entry';
 assert not exists(select 1 from private.receipt_entry_items where batch_id=batch),'prepaid custody created a purchase price';
 assert (select coalesce(jsonb_agg(to_jsonb(p)),'[]') from private.stock_positions p where store_id=a)=before_positions,'release added duplicate physical stock';
end $test$;
rollback;
