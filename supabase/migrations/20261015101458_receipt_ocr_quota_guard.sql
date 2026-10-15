-- One provider request per explicit job. Reserve before sending, under the job lock.
-- Invoker rights + service-only EXECUTE: never expose saved model output to clients.
create function public.prepare_receipt_ocr_request(p_job uuid,p_lease uuid,p_model text,p_prompt text,p_source_key text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare j public.receipt_ocr_jobs; b public.receipt_upload_batches; cached public.receipt_ocr_runs; allocated record; snapshot jsonb;
begin
 -- Match manual takeover/retry lock order: dispatcher, batch, then job.
 perform pg_advisory_xact_lock(hashtextextended('receipt-ocr-dispatch',0));
 select * into j from public.receipt_ocr_jobs where id=p_job;
 perform pg_advisory_xact_lock(hashtextextended(j.batch_id::text,0));
 select * into j from public.receipt_ocr_jobs where id=p_job for update;
 if j.id is null or j.status<>'RUNNING' or j.lease_token is distinct from p_lease then raise exception 'OCR_JOB_LEASE_LOST';end if;
 select * into strict b from public.receipt_upload_batches where id=j.batch_id;
 if p_source_key is null or p_source_key !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_OCR_SOURCE_KEY';end if;
 -- Two workers with the same lease cannot send twice, including after a lost response.
 if exists(select 1 from public.receipt_ocr_runs r where r.job_id=j.id
   and (r.raw_response ? 'request_job_id' or jsonb_array_length(coalesce(r.raw_response->'attempts','[]'))>0)) then
  return jsonb_build_object('action','ALREADY_RESERVED');
 end if;
 -- Reuse only exact source bytes/order + model/prompt, within the same batch.
 -- A failed save may still contain a successful HTTP response. No fuzzy photo matching.
 select * into cached from public.receipt_ocr_runs r where r.batch_id=b.id and r.status in ('FAILED','PROCESSING')
 and not exists(select 1 from public.receipt_ocr_jobs active_job where active_job.id=r.job_id and active_job.status='RUNNING')
 and r.provider='google-gemini' and r.model=p_model and r.prompt_version=p_prompt
 and r.raw_response->>'source_key'=p_source_key
 and (exists(select 1 from jsonb_array_elements(coalesce(r.raw_response->'attempts','[]')) a where a->>'status'='200') or r.raw_response ? 'reused_from')
 and jsonb_typeof(r.raw_response#>'{response,candidates}')='array'
 order by r.version desc limit 1;
 select * into allocated from public.create_receipt_ocr_run(b.organization_id,b.id,'google-gemini',p_model,p_prompt,j.requested_by);
 snapshot:=jsonb_build_object('source_key',p_source_key,'request_job_id',j.id,'request_sent',cached.id is null,'reserved_at',clock_timestamp(),'attempts','[]'::jsonb);
 if cached.id is not null then snapshot:=snapshot||jsonb_build_object('reused_from',cached.id,'response',cached.raw_response->'response');end if;
 update public.receipt_ocr_runs set raw_response=snapshot where id=allocated.id;
 return jsonb_build_object('action',case when cached.id is null then 'SEND' else 'REUSE' end,'id',allocated.id,'version',allocated.version,'snapshot',snapshot);
end $$;
revoke all on function public.prepare_receipt_ocr_request(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.prepare_receipt_ocr_request(uuid,uuid,text,text,text) to service_role;

-- Preserve shared provider cooldowns but stop this receipt after an error.
-- Explicit retries create a new authorized job; successful saved output is reused.
do $patch$
declare src text; needle text;
begin
 src:=pg_get_functiondef('public.fail_receipt_ocr_job(uuid,uuid,text)'::regprocedure);
 needle:=$code$ if p_error like 'OCR_NO_%'$code$;
 if strpos(src,needle)=0 then raise exception 'OCR_FAILURE_ANCHOR_MISSING';end if;
 src:=replace(src,needle,$code$ if exists(select 1 from public.receipt_upload_batches where id=job.batch_id and store_name in ('BeApe','Gras')) then
  if reason is not null then
   update private.receipt_ocr_dispatch set paused_until=greatest(coalesce(paused_until,'-infinity'),resume_at),
    pause_reason=case when paused_until>resume_at then pause_reason else reason end,updated_at=now() where singleton;
  end if;
  update public.receipt_ocr_jobs set status='FAILED',completed_at=now(),locked_at=null,lease_token=null,last_error=left(p_error,4000)
   where id=job.id returning * into job;
  return job;
 end if;
 if p_error like 'OCR_NO_%'$code$);
 execute src;
 -- An expired worker may have sent a request without saving its response. Never reclaim it automatically.
 src:=pg_get_functiondef('public.claim_receipt_ocr_jobs(integer)'::regprocedure);
 needle:=$code$ and attempt_count>=max_attempts;$code$;
 if strpos(src,needle)=0 then raise exception 'OCR_CLAIM_ANCHOR_MISSING';end if;
 src:=replace(src,needle,$code$ and (attempt_count>=max_attempts or exists(select 1 from public.receipt_upload_batches b where b.id=receipt_ocr_jobs.batch_id and b.store_name in ('BeApe','Gras')));$code$);
 execute src;
end $patch$;

-- Stop only already-attempted automatic retries, preserving untouched queued uploads.
update public.receipt_ocr_jobs j set status='FAILED',completed_at=now(),locked_at=null,lease_token=null
from public.receipt_upload_batches b
where b.id=j.batch_id and b.store_name in ('BeApe','Gras') and j.status='QUEUED'
and (j.attempt_count>0 or j.provider_defer_count>0);
notify pgrst,'reload schema';
