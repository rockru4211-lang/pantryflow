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
 -- Cross-store and staff writes must be denied before takeover.
 denied:=false;begin perform public.begin_baihuayuan_receipt_manual_review(b,batch);exception when insufficient_privilege then denied:=true;end;assert denied;
 perform set_config('request.jwt.claim.sub',staff_id::text,true);
 denied:=false;begin perform public.begin_baihuayuan_receipt_manual_review(a,batch);exception when insufficient_privilege then denied:=true;end;assert denied;
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 set local role authenticated;
 run_id:=public.begin_baihuayuan_receipt_manual_review(a,batch);
 assert public.begin_baihuayuan_receipt_manual_review(a,batch)=run_id,'takeover not idempotent';
 key:=public.add_baihuayuan_receipt_draft_row(a,batch,run_id,req);
 assert public.add_baihuayuan_receipt_draft_row(a,batch,run_id,req)=key,'row retry duplicated';
 reset role;
 assert (select count(*) from public.receipt_ocr_fields where ocr_run_id=run_id and row_key=key)=6;
 assert (select status='FAILED' and lease_token is null and last_error='MANUAL_REVIEW' from public.receipt_ocr_jobs where id=job);
 denied:=false;begin perform public.commit_pilot_receipt_ocr(job,lease,old_run,'[]','{}');exception when raise_exception then denied:=sqlerrm='OCR_JOB_LEASE_LOST';end;assert denied,'late OCR committed';
 denied:=false;begin perform public.create_receipt_ocr_run(org,batch,'x','x','x',owner_id);exception when raise_exception then denied:=sqlerrm='RECEIPT_MANUAL_REVIEW_ACTIVE';end;assert denied,'new worker replaced manual draft';
 denied:=false;begin perform public.enqueue_receipt_ocr(batch);exception when raise_exception then denied:=sqlerrm='RECEIPT_MANUAL_REVIEW_ACTIVE';end;assert denied,'manual batch requeued';
 r:=public.get_baihuayuan_receipt_accounts(a,null,null,null,batch)->0;
 assert jsonb_array_length(r->'lines')=1,'blank draft row missing';
 input:=jsonb_build_object('source_fingerprint',r->>'source_fingerprint','revision',r->'revision','header',jsonb_build_object('supplier_name','測試廠商','receipt_date',current_date,'document_number',''),'lines',jsonb_build_array(jsonb_build_object('row_key',key,'product_name','牛邊條','specification','','unit','公斤','quantity',null,'unit_price',380,'subtotal',null,'category','食材','note','','handling','NORMAL')),'adjustment',0,'adjustment_note','','tax',null,'total',null,'note','','checked',false);
 set local role authenticated;
 saved:=public.save_baihuayuan_receipt_review(a,batch,input,req);
 assert (saved->>'saved')::boolean,'partial draft rejected';
 assert public.save_baihuayuan_receipt_review(a,batch,input,req)=saved,'save retry not idempotent';
 reset role;
 r:=public.get_baihuayuan_receipt_accounts(a,null,null,null,batch)->0;
 assert r#>>'{lines,0,product_name}'='牛邊條';assert r#>'{lines,0,quantity}'='null'::jsonb,'missing quantity became zero';
 r:=(select x from jsonb_array_elements(public.get_baihuayuan_receipt_inbox(a)) x where x->>'batch_id'=batch::text);
 assert r->>'supplier_name'='測試廠商','archive did not follow saved header';
 assert r->>'state'='NEEDS_REVIEW','manual draft mislabeled OCR failure';
 assert (select storage_path=original from public.receipt_documents where id=doc),'original changed';
 assert (select count(*) from public.receipt_ocr_runs where batch_id=batch)=2,'run history changed';
 assert not exists(select 1 from public.goods_receipts where source_batch_id=batch),'draft published';
 -- A successful partial extraction remains the original version/evidence.
 insert into public.receipt_upload_batches(id,organization_id,store_id,store_name,work_date,uploaded_by,batch_number,status,group_mode) values(batch2,org,a,'BeApe',current_date,owner_id,'PARTIAL-QA','READY_FOR_REVIEW','SAME_RECEIPT');
 insert into public.receipt_documents(organization_id,batch_id,storage_path,mime_type,byte_size,page_order) values(org,batch2,original,'image/jpeg',4,1);
 insert into public.receipt_ocr_runs(id,organization_id,batch_id,version,provider,model,prompt_version,status,started_by) values(run2,org,batch2,1,'FIXTURE','fixture','fixture','SUCCEEDED',owner_id);
 insert into public.receipt_ocr_fields(organization_id,batch_id,ocr_run_id,row_key,field_name,raw_value,normalized_value,confidence,review_status)
 values(org,batch2,run2,'line-1','product','"手寫品項"','"手寫品項"',0.5,'REVIEW'),(org,batch2,run2,'line-1','quantity','null','null',0,'UNREADABLE');
 assert public.begin_baihuayuan_receipt_manual_review(a,batch2)=run2;
 assert (select count(*) from public.receipt_ocr_runs where batch_id=batch2)=1,'successful extraction was replaced';
 assert (select normalized_value from public.receipt_ocr_fields where ocr_run_id=run2 and field_name='product')='"手寫品項"'::jsonb;
 assert private.baihuayuan_receipt_line_included(batch2,run2,'line-1'),'partial named item disappeared';
 -- View-only membership cannot take over or add rows.
 update public.store_memberships set access_mode='VIEW' where store_id=a and user_id=admin_id;
 perform set_config('request.jwt.claim.sub',admin_id::text,true);
 denied:=false;begin perform public.begin_baihuayuan_receipt_manual_review(a,batch2);exception when insufficient_privilege then denied:=true;end;assert denied,'read-only takeover';
end $test$;
rollback;
