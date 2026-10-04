-- Private isolated data; the entire test is rolled back. No real accounts or PINs.
begin;
do $test$
declare
 owner_id uuid:=gen_random_uuid();admin_id uuid:=gen_random_uuid();staff_id uuid:=gen_random_uuid();org uuid:=gen_random_uuid();a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();
 batch uuid:=gen_random_uuid();receipt uuid:=gen_random_uuid();run_id uuid:=gen_random_uuid();next_run uuid:=gen_random_uuid();doc uuid:=gen_random_uuid();
 product uuid:=gen_random_uuid(); account_id uuid:=gen_random_uuid(); lot_id uuid:=gen_random_uuid(); 
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
 begin perform public.save_baihuayuan_receipt_review(b,batch,input,req);raise exception 'cross-store write accepted';exception when insufficient_privilege then null;end;
 saved:=public.save_baihuayuan_receipt_review(a,batch,input,req);
 assert (saved->>'saved')::boolean and saved->'account'->>'status'='CHECKED','completed receipt cannot be corrected';
 assert (saved->'account'->>'net')::numeric=150 and (saved->'account'->>'total')::numeric=157.5,'corrected totals not synchronized';
 assert public.save_baihuayuan_receipt_review(a,batch,input,req)=saved,'request replay changed';
 assert (select count(*) from public.audit_logs where attempt_id=req)=1,'duplicate audit';
 assert (public.get_baihuayuan_receipt_detail_ledger(a)->0->>'quantity')::numeric=3,'detail ledger not corrected';
 assert (public.get_pilot_receipt_ledger(a)->0->>'subtotal')::numeric=150,'procurement ledger not corrected';
 assert (select to_jsonb(g) from public.goods_receipts g where id=receipt)=raw_goods,'source goods rewritten';
 assert (select jsonb_agg(to_jsonb(f) order by f.id) from public.receipt_ocr_fields f where batch_id=batch)=raw_fields,'OCR evidence rewritten';
 assert (select jsonb_agg(to_jsonb(m) order by m.store_id,m.user_id) from public.store_memberships m where organization_id=org)=raw_members,'roles rewritten';
 assert (select count(*) from private.staff_pin_credentials)=pin_count,'PIN records changed';
 begin perform public.save_baihuayuan_receipt_review(a,batch,input,gen_random_uuid());raise exception 'stale revision accepted';exception when serialization_failure then null;end;
 r:=public.get_baihuayuan_receipt_accounts(a,null,null,null,batch)->0;
 input:=input||jsonb_build_object('source_fingerprint',r->>'source_fingerprint','revision',r->'revision','checked',false);
 begin perform public.save_baihuayuan_receipt_review(a,batch,input||jsonb_build_object('lines','[]'::jsonb),gen_random_uuid());raise exception 'line omission accepted';exception when serialization_failure then null;end;
 begin perform public.save_baihuayuan_receipt_review(a,batch,input||jsonb_build_object('adjustment',-10),gen_random_uuid());raise exception 'unexplained adjustment accepted';exception when invalid_parameter_value then null;end;
 saved:=public.save_baihuayuan_receipt_review(a,batch,input||jsonb_build_object('tax',null,'total',null),gen_random_uuid());
 assert saved->'account'->>'status'='MISSING' and saved->'account'->'tax'='null'::jsonb,'unknown tax converted or checked';
 update public.store_memberships set access_mode='VIEW' where store_id=a and user_id=owner_id;
 begin perform public.save_baihuayuan_receipt_review(a,batch,input,req);raise exception 'read-only replay accepted';exception when insufficient_privilege then null;end;
 update public.store_memberships set access_mode='EDIT' where store_id=a and user_id=owner_id;
 perform set_config('request.jwt.claim.sub',staff_id::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',staff_id,'role','authenticated')::text,true);
 begin perform public.get_baihuayuan_receipt_accounts(a,null,null,null,batch);raise exception 'staff read accepted';exception when insufficient_privilege then null;end;
 begin perform public.save_baihuayuan_receipt_review(a,batch,input,req);raise exception 'staff write accepted';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.sub',admin_id::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
 r:=public.get_baihuayuan_receipt_accounts(a,null,null,null,batch)->0;
 input:=input||jsonb_build_object('source_fingerprint',r->>'source_fingerprint','revision',r->'revision');
 saved:=public.save_baihuayuan_receipt_review(a,batch,input,gen_random_uuid());
 assert (saved->>'saved')::boolean,'administration cannot correct';
 perform set_config('request.jwt.claim.sub',owner_id::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);
 -- Sending to reconciliation is persisted but does not mark supplier reconciliation complete.
 r:=saved->'account';
 assert not (r->>'reviewed')::boolean,'plain save submitted receipt';
 input:=input||jsonb_build_object('source_fingerprint',r->>'source_fingerprint','revision',r->'revision','checked',false,'reviewed',true);
 begin perform public.save_baihuayuan_receipt_review(a,batch,input||jsonb_build_object('tax',null),gen_random_uuid());raise exception 'unknown tax submitted';exception when invalid_parameter_value then null;end;
 req:=gen_random_uuid();saved:=public.save_baihuayuan_receipt_review(a,batch,input,req);
 assert (saved->'account'->>'reviewed')::boolean,'submission not persisted';
 assert saved->'account'->>'status'='UNCHECKED','submission marked supplier statement checked';
 assert public.save_baihuayuan_receipt_review(a,batch,input,req)=saved,'submission retry changed';
 r:=public.get_baihuayuan_receipt_accounts(a,null,null,null,batch)->0;
 assert (r->>'reviewed')::boolean,'submission lost after reload';
 input:=input||jsonb_build_object('source_fingerprint',r->>'source_fingerprint','revision',r->'revision','reviewed',false);
 saved:=public.save_baihuayuan_receipt_review(a,batch,input,gen_random_uuid());
 assert not (saved->'account'->>'reviewed')::boolean,'edit did not return receipt to verification';
 assert (select to_jsonb(g) from public.goods_receipts g where id=receipt)=raw_goods,'submission duplicated goods';

 -- Freight is a payable line, never a price candidate. Original evidence stays intact.
 r:=saved->'account';
 input:=input||jsonb_build_object('source_fingerprint',r->>'source_fingerprint','revision',r->'revision','reviewed',true,
 'lines',jsonb_build_array((r->'lines'->0)||jsonb_build_object('handling','FREIGHT','unit_price',50,'subtotal',150)));
 saved:=public.save_baihuayuan_receipt_review(a,batch,input,gen_random_uuid());
 assert (saved->'account'->>'net')::numeric=150,'freight omitted from total';
 assert not private.receipt_is_purchase_line(batch,'line-1'),'freight price leaked';
 assert (select to_jsonb(g) from public.goods_receipts g where id=receipt)=raw_goods,'freight rewrote evidence';
 -- Set up isolated supplier custody; never seed or rewrite real customer goods.
 insert into public.products(id,organization_id,name,base_unit,count_unit) values(product,org,'隔離鵝肝','包','包');
 insert into private.custody_accounts(id,store_id,product_id,kind,name,unit,party,created_by)
 values(account_id,a,product,'supplier','隔離鵝肝','包','核對測試廠商',owner_id);
 insert into private.custody_lots(id,account_id,label,quantity,remaining,expires_on,reference)
 values(lot_id,account_id,'原採購批次',10,10,current_date+365,'原採購單號 A');
 r:=saved->'account';
 input:=input||jsonb_build_object('source_fingerprint',r->>'source_fingerprint','revision',r->'revision','reviewed',false,
 'tax',0,'total',0,'lines',jsonb_build_array((r->'lines'->0)||jsonb_build_object('handling','CUSTODY_RELEASE','unit_price',null,'subtotal',0,'custody_lot_id',lot_id,'custody_event_id','')));
 saved:=public.save_baihuayuan_receipt_review(a,batch,input,gen_random_uuid());
 assert (saved->'account'->>'net')::numeric=0,'release creates new payable';
 assert (select remaining from private.custody_lots where id=lot_id)=10,'draft save collected custody';
 assert not exists(select 1 from private.receipt_custody_links where batch_id=batch),'draft save posted custody';
 r:=saved->'account';input:=input||jsonb_build_object('source_fingerprint',r->>'source_fingerprint','revision',r->'revision','reviewed',true);
 req:=gen_random_uuid();saved:=public.save_baihuayuan_receipt_review(a,batch,input,req);
 assert (saved->'account'->>'reviewed')::boolean,'release not submitted';
 assert (saved->'account'->'lines'->0->>'custody_posted')::boolean,'release link not visible';
 assert (select remaining from private.custody_lots where id=lot_id)=7,'wrong custody quantity';
 assert (select sum(quantity) from private.stock_postings where store_id=a and product_id=product and source_type='CUSTODY')=3,'arrival not posted';
 assert public.save_baihuayuan_receipt_review(a,batch,input,req)=saved,'retry result changed';
 assert (select remaining from private.custody_lots where id=lot_id)=7,'retry double collected';
 -- Fresh save, same release: no duplicate posting and no changes to raw receipt.
 r:=saved->'account';input:=input||jsonb_build_object('source_fingerprint',r->>'source_fingerprint','revision',r->'revision');
 saved:=public.save_baihuayuan_receipt_review(a,batch,input,gen_random_uuid());
 assert (select remaining from private.custody_lots where id=lot_id)=7,'fresh save double collected';
 r:=saved->'account';input:=input||jsonb_build_object('source_fingerprint',r->>'source_fingerprint','revision',r->'revision');
 begin
  perform public.save_baihuayuan_receipt_review(a,batch,input||jsonb_build_object('lines',jsonb_build_array((input->'lines'->0)||jsonb_build_object('quantity',4))),gen_random_uuid());
  raise exception 'posted quantity changed';
 exception when invalid_parameter_value then null;end;
 assert (select remaining from private.custody_lots where id=lot_id)=7,'failed edit changed custody';
 assert (select to_jsonb(g) from public.goods_receipts g where id=receipt)=raw_goods,'release rewrote original';
 assert (select jsonb_agg(to_jsonb(m) order by m.store_id,m.user_id) from public.store_memberships m where organization_id=org)=raw_members,'roles changed';
 assert (select count(*) from private.staff_pin_credentials)=pin_count,'PINs changed';
 raise notice 'freight/custody passed: payable totals, price exclusion, draft isolation, atomic arrival, retry and edit guards';
end;$test$;
rollback;
