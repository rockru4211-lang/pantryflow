-- Isolated roles, images, drafts and stale-worker checks; all data rolls back.
begin;
do $test$
declare
 owner_id uuid:=gen_random_uuid();admin_id uuid:=gen_random_uuid();staff_id uuid:=gen_random_uuid();org uuid:=gen_random_uuid();a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();
 batch uuid:=gen_random_uuid();run_id uuid;old_run uuid:=gen_random_uuid();doc uuid:=gen_random_uuid();job uuid:=gen_random_uuid();lease uuid:=gen_random_uuid();req uuid:=gen_random_uuid();
 r jsonb;input jsonb;saved jsonb;key text;original text;denied boolean;count_before bigint;batch2 uuid:=gen_random_uuid();run2 uuid:=gen_random_uuid();
begin
 assert not has_function_privilege('anon','public.begin_baihuayuan_receipt_manual_review(uuid,uuid)','execute');
 assert not has_table_privilege('authenticated','private.receipt_manual_handoffs','select,insert,update,delete');
 insert into auth.users(id,email,email_confirmed_at,created_at,updated_at) select id,id||'@receipt-review.invalid',now(),now(),now() from unnest(array[owner_id,admin_id,staff_id]) id;
 insert into public.profiles(id,display_name) select id,'隔離核對測試' from unnest(array[owner_id,admin_id,staff_id]) id on conflict(id) do nothing;
 insert into public.organizations(id,name,business_type,store_mode) values(org,'核對隔離測試','SINGLE_RESTAURANT','MULTI');
 insert into public.stores(id,organization_id,name,store_code,created_by) values(a,org,'BeApe','RR'||substr(a::text,1,8),owner_id),(b,org,'Gras','RR'||substr(b::text,1,8),owner_id);
 insert into public.organization_members(organization_id,user_id,role,is_owner,can_manage_business) values(org,owner_id,'OWNER',true,true),(org,admin_id,'LOGISTICS',false,false),(org,staff_id,'STAFF',false,false);
 insert into public.staff_identities(organization_id,user_id,display_name,created_by) select org,id,'隔離核對測試',owner_id from unnest(array[owner_id,admin_id,staff_id]) id;
 insert into public.store_memberships(store_id,organization_id,user_id,login_identifier,role,work_role,assigned_by,can_manage_business) values(a,org,owner_id,'rr-owner','OWNER','OWNER',owner_id,true),(a,org,admin_id,'rr-admin','LOGISTICS','LOGISTICS',owner_id,false),(a,org,staff_id,'rr-staff','STAFF','STAFF',owner_id,false),(b,org,owner_id,'rr-owner-b','OWNER','OWNER',owner_id,true);
 perform set_config('request.jwt.claim.sub',owner_id::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);

 insert into public.receipt_upload_batches(id,organization_id,store_id,store_name,work_date,uploaded_by,batch_number,status,group_mode) values(batch,org,a,'BeApe',current_date,owner_id,'HANDOFF-QA','PROCESSING','SAME_RECEIPT');
 original:=org||'/'||batch||'/fixture.jpg';
 insert into public.receipt_documents(id,organization_id,batch_id,original_filename,storage_path,mime_type,byte_size,content_sha256,page_order) values(doc,org,batch,'fixture.jpg',original,'image/jpeg',4,repeat('a',64),1);
 insert into storage.objects(bucket_id,name,metadata) values('receipt-documents',original,'{"size":4}');
 insert into public.receipt_ocr_runs(id,organization_id,batch_id,version,provider,model,prompt_version,status,started_by) values(old_run,org,batch,1,'FIXTURE','fixture','fixture','PROCESSING',owner_id);
 insert into public.receipt_ocr_jobs(id,organization_id,batch_id,requested_by,status,lease_token,locked_at) values(job,org,batch,owner_id,'RUNNING',lease,now());

 run_id:=public.begin_baihuayuan_receipt_manual_review(a,batch);
 key:=public.add_baihuayuan_receipt_draft_row(a,batch,run_id,req);
 r:=public.get_baihuayuan_receipt_accounts(a,null,null,null,batch)->0;
 input:=jsonb_build_object('source_fingerprint',r->>'source_fingerprint','revision',r->'revision','header',jsonb_build_object('supplier_name','測試廠商','receipt_date',current_date,'document_number',''),'lines',jsonb_build_array(jsonb_build_object('row_key',key,'product_name','牛奶','unit','瓶','quantity',2,'unit_price',null,'subtotal',null,'category','食材','handling','NORMAL')),'adjustment',0,'tax',null,'total',null,'note','','checked',false);
 set local role authenticated;
 saved:=public.save_baihuayuan_receipt_review(a,batch,input,gen_random_uuid());r:=saved->'account';
 denied:=false;begin perform public.submit_baihuayuan_receipt_finance(a,batch,(r->>'revision')::integer,r->>'source_fingerprint',gen_random_uuid());exception when invalid_parameter_value then denied:=true;end;assert denied,'missing price sent';
 input:=input||jsonb_build_object('source_fingerprint',r->>'source_fingerprint','revision',r->'revision');
 input:=jsonb_set(input,'{lines,0,unit_price}','90');input:=jsonb_set(input,'{lines,0,subtotal}','180');input:=jsonb_set(input,'{total}','180');
 saved:=public.save_baihuayuan_receipt_review(a,batch,input,gen_random_uuid());r:=saved->'account';
 denied:=false;begin perform public.submit_baihuayuan_receipt_finance(a,batch,-1,r->>'source_fingerprint',gen_random_uuid());exception when sqlstate 'PT409' then denied:=true;end;assert denied,'stale handoff allowed';
 denied:=false;begin perform public.submit_baihuayuan_receipt_finance(b,batch,(r->>'revision')::integer,r->>'source_fingerprint',gen_random_uuid());exception when insufficient_privilege then denied:=true;end;assert denied,'cross-store handoff';
 req:=gen_random_uuid();saved:=public.submit_baihuayuan_receipt_finance(a,batch,(r->>'revision')::integer,r->>'source_fingerprint',req);
 assert saved#>>'{account,finance_sent_at}' is not null,'handoff missing';
 assert saved#>'{account,tax}'='null'::jsonb,'blank tax became zero';
 assert saved#>'{account,lines}'=r->'lines','handoff changed lines';
 assert saved#>'{account,revision}'=r->'revision','handoff changed pricing revision';
 assert public.submit_baihuayuan_receipt_finance(a,batch,(r->>'revision')::integer,r->>'source_fingerprint',req)=saved,'retry differs';
 denied:=false;begin perform public.submit_baihuayuan_receipt_finance(a,batch,-1,r->>'source_fingerprint',req);exception when unique_violation then denied:=true;end;assert denied,'request reuse allowed';
 assert public.submit_baihuayuan_receipt_finance(a,batch,(r->>'revision')::integer,r->>'source_fingerprint',gen_random_uuid())=saved,'duplicate handoff changed data';
 reset role;
 assert not exists(select 1 from public.goods_receipts where source_batch_id=batch),'handoff posted inventory';
 assert (select count(*) from public.audit_logs where entity_id=batch::text and action='receipt.finance-handoff')=1,'duplicate audit';
 assert not has_function_privilege('anon','public.submit_baihuayuan_receipt_finance(uuid,uuid,integer,text,uuid)','execute');
 assert not has_table_privilege('authenticated','private.receipt_account_edits','select,insert,update,delete');
 perform set_config('request.jwt.claim.sub',staff_id::text,true);
 set local role authenticated;
 denied:=false;begin perform public.submit_baihuayuan_receipt_finance(a,batch,(r->>'revision')::integer,r->>'source_fingerprint',gen_random_uuid());exception when insufficient_privilege then denied:=true;end;assert denied,'staff handoff';
 reset role;
 update public.store_memberships set access_mode='VIEW' where store_id=a and user_id=admin_id;
 perform set_config('request.jwt.claim.sub',admin_id::text,true);set local role authenticated;
 denied:=false;begin perform public.submit_baihuayuan_receipt_finance(a,batch,(r->>'revision')::integer,r->>'source_fingerprint',gen_random_uuid());exception when insufficient_privilege then denied:=true;end;assert denied,'view-only handoff';
 reset role;
end $test$;
rollback;
