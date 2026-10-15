begin;
do $test$
declare actor uuid:=gen_random_uuid(); org uuid; store uuid; batch uuid; data jsonb; j public.receipt_ocr_jobs; k public.receipt_ocr_jobs; first jsonb; again jsonb; denied boolean;
begin
 assert not has_function_privilege('anon','public.prepare_receipt_ocr_request(uuid,uuid,text,text,text)','execute');
 assert not has_function_privilege('authenticated','public.prepare_receipt_ocr_request(uuid,uuid,text,text,text)','execute');
 assert not (select prosecdef from pg_proc where oid='public.prepare_receipt_ocr_request(uuid,uuid,text,text,text)'::regprocedure);
 insert into auth.users(id,email,email_confirmed_at) values(actor,actor||'@ocr-access-qa.invalid',now());
 perform set_config('request.jwt.claim.sub',actor::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 data:=public.owner_setup();
 data:=public.owner_setup('business',jsonb_build_object('organization_name','OCR access QA','business_type','SINGLE_RESTAURANT','store_mode','MULTI'),0);
 data:=public.owner_setup('store',data->'draft'||jsonb_build_object('store_name','Gras','store_code','OCR'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12)),'staff_login_mode','NAME_OR_NICKNAME'),(data->>'revision')::integer);
 data:=public.owner_setup('identity',data->'draft'||'{"work_role":"OWNER"}',(data->>'revision')::integer);
 data:=public.owner_setup('complete',data->'draft',(data->>'revision')::integer);
 org:=(data->>'organization_id')::uuid;store:=(data->>'store_id')::uuid;
 insert into public.receipt_upload_batches(organization_id,store_id,store_name,uploaded_by,work_date)
 values(org,store,'Gras',actor,current_date) returning id into batch;

 insert into public.receipt_ocr_jobs(organization_id,batch_id,requested_by,status,locked_at,lease_token,attempt_count,started_at)
 values(org,batch,actor,'RUNNING',now(),gen_random_uuid(),1,now()) returning * into j;
 set local role service_role;
 first:=public.prepare_receipt_ocr_request(j.id,j.lease_token,'model','prompt',repeat('a',64));
 assert first->>'action'='SEND','first attempt not reserved';
 again:=public.prepare_receipt_ocr_request(j.id,j.lease_token,'model','prompt',repeat('a',64));
 assert again->>'action'='ALREADY_RESERVED','same lease double send';
 denied:=false;begin perform public.prepare_receipt_ocr_request(j.id,gen_random_uuid(),'model','prompt',repeat('a',64));exception when raise_exception then denied:=sqlerrm='OCR_JOB_LEASE_LOST';end;
 assert denied,'wrong lease accepted';
 reset role;
 assert (select count(*)=1 from receipt_ocr_runs where batch_id=batch),'duplicate worker created a new run';
 update receipt_ocr_runs set status='FAILED',error_message='save failed',raw_response=raw_response||'{"attempts":[{"status":200}],"response":{"candidates":[{"content":{"parts":[{"text":"{\"lines\":[]}"}]}}]}}'::jsonb where id=(first->>'id')::uuid;
 set local role service_role;
 j:=public.fail_receipt_ocr_job(j.id,j.lease_token,'save failed');
 assert j.status='FAILED','save failure requeued a model call';
 reset role;
 insert into public.receipt_ocr_jobs(organization_id,batch_id,requested_by,status,locked_at,lease_token,attempt_count,started_at)
 values(org,batch,actor,'RUNNING',now(),gen_random_uuid(),1,now()) returning * into k;
 set local role service_role;
 again:=public.prepare_receipt_ocr_request(k.id,k.lease_token,'model','prompt',repeat('a',64));
 assert again->>'action'='REUSE','lost cached successful response';
 assert again#>>'{snapshot,reused_from}'=first->>'id','wrong cached run';
 assert again#>'{snapshot,attempts}'='[]'::jsonb,'replay counted as provider request';
 k:=public.fail_receipt_ocr_job(k.id,k.lease_token,'GEMINI_503: busy');
 assert k.status='FAILED','busy response auto retried';
 reset role;
 insert into public.receipt_ocr_jobs(organization_id,batch_id,requested_by,status,locked_at,lease_token,attempt_count,started_at)
 values(org,batch,actor,'RUNNING',now(),gen_random_uuid(),1,now()) returning * into k;
 set local role service_role;
 again:=public.prepare_receipt_ocr_request(k.id,k.lease_token,'model','prompt',repeat('b',64));
 assert again->>'action'='SEND','changed photo reused old response';
 k:=public.fail_receipt_ocr_job(k.id,k.lease_token,'GEMINI_429: limit');
 assert k.status='FAILED','quota response auto retried';
 reset role;
 assert not exists(select 1 from goods_receipts where organization_id=org),'fixture posted inventory';
 assert (select count(*)=3 from receipt_ocr_runs where batch_id=batch),'run evidence lost';
end $test$;
rollback;
select 'PASS: service-only reservation, duplicate lease, saved-response reuse, changed-source isolation, no automatic retry, preserved history' as result;
