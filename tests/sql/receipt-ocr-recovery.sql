-- Isolated roles, images, drafts and stale-worker checks; all data rolls back.
begin;
do $test$
declare
 owner_id uuid:=gen_random_uuid();admin_id uuid:=gen_random_uuid();staff_id uuid:=gen_random_uuid();org uuid:=gen_random_uuid();a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();
 batch uuid:=gen_random_uuid();run_id uuid;old_run uuid:=gen_random_uuid();doc uuid:=gen_random_uuid();job uuid:=gen_random_uuid();lease uuid:=gen_random_uuid();req uuid:=gen_random_uuid();
 r jsonb;input jsonb;saved jsonb;key text;original text;denied boolean;count_before bigint; fresh uuid; denied_worker boolean;batch2 uuid:=gen_random_uuid();run2 uuid:=gen_random_uuid();
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

 run_id:=public.begin_baihuayuan_receipt_manual_review(a,batch);
 -- A service-role read must work, while worker creation still honors takeover.
 set local role service_role;
 perform 1 from private.receipt_manual_handoffs where batch_id=batch;
 denied_worker:=false;
 begin perform public.create_receipt_ocr_run(org,batch,'qa-fixture','fixture','fixture',owner_id);
 exception when others then if sqlerrm='RECEIPT_MANUAL_REVIEW_ACTIVE' then denied_worker:=true;else raise;end if;end;
 reset role;
 assert denied_worker,'worker ignored manual takeover';
 assert not has_table_privilege('authenticated','private.receipt_manual_handoffs','SELECT');
 assert not has_table_privilege('anon','private.receipt_manual_handoffs','SELECT');
 assert not has_table_privilege('service_role','private.receipt_manual_handoffs','DELETE');
 assert not has_function_privilege('anon','public.retry_baihuayuan_receipt_ocr(uuid,uuid)','EXECUTE');
 denied:=false;begin perform public.retry_baihuayuan_receipt_ocr(b,batch);exception when insufficient_privilege then denied:=true;end;assert denied,'cross-store retry';
 perform set_config('request.jwt.claim.sub',staff_id::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',staff_id,'role','authenticated')::text,true);
 denied:=false;begin perform public.retry_baihuayuan_receipt_ocr(a,batch);exception when insufficient_privilege then denied:=true;end;assert denied,'staff retry';
 perform set_config('request.jwt.claim.sub',owner_id::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);
 set local role authenticated;
 r:=public.retry_baihuayuan_receipt_ocr(a,batch);
 assert (r->>'queued')::boolean;
 assert public.retry_baihuayuan_receipt_ocr(a,batch)=r,'retry is not idempotent';
 reset role;
 assert (select count(*) from public.receipt_ocr_jobs where batch_id=batch)=1,'duplicated job';
 assert exists(select 1 from public.receipt_ocr_runs where id=run_id),'manual run history deleted';
 assert (select storage_path from public.receipt_documents where id=doc)=original,'source changed';
 set local role service_role;
 select id into fresh from public.create_receipt_ocr_run(org,batch,'qa-fixture','fixture','fixture',owner_id);
 reset role;
 assert fresh is not null,'worker did not create run';
 assert (select version from public.receipt_ocr_runs where id=fresh)=2;
 -- A named partial row remains visible without inventing quantity/price.
 update public.receipt_ocr_runs set status='SUCCEEDED' where id=fresh;
 update public.receipt_ocr_jobs set status='SUCCEEDED' where batch_id=batch;
 update public.receipt_upload_batches set status='READY_FOR_REVIEW' where id=batch;
 insert into public.receipt_ocr_fields(organization_id,batch_id,ocr_run_id,row_key,field_name,raw_value,normalized_value,confidence,review_status)
 values(org,batch,fresh,'line-1','product','"部分品項"','"部分品項"',0.5,'REVIEW'),(org,batch,fresh,'line-1','quantity','null','null',0,'UNREADABLE');
 r:=private.receipt_account_rows(a,null,null,null,batch)->0;
 assert jsonb_array_length(r->'lines')=1,'partial named row hidden';
 assert r#>'{lines,0,quantity}'='null'::jsonb,'invented quantity';
 denied:=false;begin perform public.retry_baihuayuan_receipt_ocr(a,batch);exception when others then if sqlerrm='RECEIPT_RETRY_HAS_RESULTS' then denied:=true;else raise;end if;end;assert denied,'existing OCR replaced';
 -- Persisted edits cannot be retried, including empty forms with header edits.
 insert into private.receipt_account_edits(batch_id,store_id,run_id,header,source_fingerprint,updated_by)
 values(batch,a,fresh,'{"supplier_name":"人工名稱"}','qa',owner_id);
 denied:=false;begin perform public.retry_baihuayuan_receipt_ocr(a,batch);exception when others then if sqlerrm='RECEIPT_RETRY_HAS_EDITS' then denied:=true;else raise;end if;end;assert denied,'saved edits overwritten';
 assert (select header->>'supplier_name' from private.receipt_account_edits where batch_id=batch)='人工名稱';
 assert not exists(select 1 from public.goods_receipts where source_batch_id=batch),'retry received stock';
end $test$;
rollback;
select 'PASS: actual service role, handoff protection, role/store isolation, retry idempotency, immutable history, partial rows, saved edits' as result;
