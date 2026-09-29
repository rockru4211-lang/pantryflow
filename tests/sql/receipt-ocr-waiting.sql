-- Synthetic two-store backlog; all writes and scheduling state roll back.
begin;
do $test$
declare actor uuid:=gen_random_uuid(); org uuid; a uuid; b uuid; batch uuid; data jsonb; chosen uuid[];
 job public.receipt_ocr_jobs; run uuid; message text; denied boolean; resume_at timestamptz; result jsonb; n integer;
begin
 perform pg_advisory_xact_lock(hashtextextended('receipt-ocr-dispatch',0));
 assert not exists(select 1 from public.receipt_ocr_jobs where status='RUNNING' and locked_at>=now()-interval '5 minutes'),'run this rollback fixture after active production leases complete';
 assert not has_table_privilege('authenticated','private.receipt_ocr_dispatch','select,insert,update,delete'),'dispatcher exposed';
 assert not has_function_privilege('authenticated','public.fail_receipt_ocr_job(uuid,uuid,text)','execute'),'client worker access';
 insert into auth.users(id,email,email_confirmed_at) values(actor,actor||'@ocr-waiting-qa.invalid',now());
 perform set_config('request.jwt.claim.sub',actor::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 data:=public.owner_setup();
 data:=public.owner_setup('business',jsonb_build_object('organization_name','OCR waiting QA','business_type','SINGLE_RESTAURANT','store_mode','MULTI'),0);
 data:=public.owner_setup('store',data->'draft'||jsonb_build_object('store_name','BeApe','store_code','OCRWAIT'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12)),'staff_login_mode','NAME_OR_NICKNAME'),(data->>'revision')::integer);
 data:=public.owner_setup('identity',data->'draft'||'{"work_role":"OWNER"}',(data->>'revision')::integer);
 data:=public.owner_setup('complete',data->'draft',(data->>'revision')::integer);org:=(data->>'organization_id')::uuid;a:=(data->>'store_id')::uuid;
 data:=public.app_operation(a,'store.create','{"name":"Gras"}',gen_random_uuid());b:=(data->>'id')::uuid;
 for n in 1..100 loop
  insert into public.receipt_upload_batches(organization_id,store_id,store_name,uploaded_by,work_date)
  values(org,case when n<=50 then a else b end,case when n<=50 then 'BeApe' else 'Gras' end,actor,current_date) returning id into batch;
  insert into public.receipt_ocr_jobs(organization_id,batch_id,requested_by,available_at,created_at)
  values(org,batch,actor,'1900-01-01','1900-01-01');
 end loop;
 update private.receipt_ocr_dispatch set paused_until=null,pause_reason=null,next_dispatch_at='-infinity';
 set local role service_role;
 select array_agg(id) into chosen from public.claim_receipt_ocr_jobs(2);
 assert cardinality(chosen)=2,'first wave missing';
 assert (select count(*) from public.claim_receipt_ocr_jobs(2))=0,'parallel wake bypassed dispatch interval';
 reset role;
 assert not exists(select 1 from public.receipt_ocr_jobs where id=any(chosen) and organization_id<>org),'claimed outside fixture';
 update private.receipt_ocr_dispatch set next_dispatch_at='-infinity';
 assert (select count(*) from public.claim_receipt_ocr_jobs(2))=0,'active worker capacity exceeded';
 select * into job from public.receipt_ocr_jobs where id=chosen[1];
 denied:=false;begin perform public.fail_receipt_ocr_job(job.id,gen_random_uuid(),'GEMINI_429: fixture');exception when raise_exception then denied:=sqlerrm='OCR_JOB_LEASE_LOST';end;
 assert denied,'stale worker changed quota pause';
 select id into run from public.create_receipt_ocr_run(org,job.batch_id,'qa-fixture','qa-fixture','waiting-test',actor);
 message:='GEMINI_429: daily fixture';
 update public.receipt_ocr_runs set status='FAILED',completed_at=now(),error_message=message,
 raw_response='{"response":{"error":{"details":[{"violations":[{"quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier"}]},{"retryDelay":"56s"}]}},"attempts":[]}' where id=run;
 set local role service_role;
 job:=public.fail_receipt_ocr_job(job.id,job.lease_token,message);
 assert job.status='QUEUED' and job.attempt_count=0 and job.provider_defer_count=1,'quota used up technical attempts';
 assert (select count(*) from public.claim_receipt_ocr_jobs(2))=0,'day quota did not stop shared queue';
 reset role;
 resume_at:=((now() at time zone 'America/Los_Angeles')::date+1)::timestamp at time zone 'America/Los_Angeles';
 assert job.available_at=resume_at+interval '10 seconds','daily quota obeyed short minute hint instead of Pacific reset';
 set local role authenticated;
 result:=public.get_baihuayuan_receipt_inbox(b);
 reset role;
 assert exists(select 1 from jsonb_array_elements(result)x where x->>'ocr_wait_reason'='DAILY_QUOTA'),'other store did not see shared quota';
 assert not exists(select 1 from jsonb_array_elements(result)x where (x->>'batch_id')::uuid not in(select id from receipt_upload_batches where store_id=b)),'inbox leaked other store';
 denied:=false;begin perform public.fail_receipt_ocr_job(job.id,gen_random_uuid(),message);exception when raise_exception then denied:=sqlerrm='OCR_JOB_LEASE_LOST';end;
 assert denied,'duplicate failure changed job';
 -- Expiring the pause and releasing only synthetic jobs resumes work.
 update private.receipt_ocr_dispatch set paused_until=now()-interval '1 second',next_dispatch_at='-infinity';
 update public.receipt_ocr_jobs set status='QUEUED',locked_at=null,lease_token=null,available_at='1899-01-01' where id=any(chosen);
 select * into job from public.claim_receipt_ocr_jobs(1) limit 1;
 assert job.organization_id=org and job.status='RUNNING','queue did not resume';
 select id into run from public.create_receipt_ocr_run(org,job.batch_id,'qa-fixture','qa-fixture','waiting-minute',actor);
 message:='GEMINI_429: minute fixture';
 update public.receipt_ocr_runs set status='FAILED',completed_at=now(),error_message=message,
 raw_response='{"response":{"error":{"details":[{"violations":[{"quotaId":"GenerateRequestsPerMinutePerProjectPerModel-FreeTier"}]},{"retryDelay":"180s"}]}}}' where id=run;
 job:=public.fail_receipt_ocr_job(job.id,job.lease_token,message);
 assert job.available_at>=now()+interval '185 seconds','RetryInfo ignored';
 assert (select pause_reason='RATE_LIMIT' from private.receipt_ocr_dispatch),'minute quota misclassified';
 -- A bounded number of provider failures escalates instead of looping forever.
 update public.receipt_ocr_jobs set status='RUNNING',lease_token=gen_random_uuid(),locked_at=now(),attempt_count=1,provider_defer_count=8 where id=job.id returning * into job;
 job:=public.fail_receipt_ocr_job(job.id,job.lease_token,'GEMINI_503: busy fixture');
 assert job.status='FAILED' and job.provider_defer_count=9,'unbounded provider retry';
 assert (select pause_reason='PROVIDER_BUSY' from private.receipt_ocr_dispatch),'busy response not paused';
 -- Permanent application failures still stop at the original attempt limit.
 update public.receipt_ocr_jobs set status='RUNNING',lease_token=gen_random_uuid(),locked_at=now(),attempt_count=max_attempts where id=job.id returning * into job;
 job:=public.fail_receipt_ocr_job(job.id,job.lease_token,'NO_DOCUMENTS');
 assert job.status='FAILED','permanent error deferred forever';
 assert (select count(*) from public.receipt_ocr_jobs where organization_id=org)=100,'queue duplicated or lost jobs';
 assert not exists(select 1 from public.goods_receipts where organization_id=org),'queue posted stock';
end $test$;
rollback;
select 'PASS: 100 jobs/two stores, shared throttle/pause, day/minute reset, bounded retry, lease safety, no duplicate jobs or posting' result;
