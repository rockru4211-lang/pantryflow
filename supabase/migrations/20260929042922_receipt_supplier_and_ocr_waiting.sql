-- Resolve an explicitly typed existing name without creating a duplicate.
-- Preserve the existing role, organization, optimistic revision and cycle guards.
do $patch$
declare source text; old text;
begin
 source:=pg_get_functiondef('private.resolve_supplier_name(uuid,jsonb)'::regprocedure);
 old:=$old$  if private.supplier_identity(org,v_new_name) is not null or exists(select 1 from public.suppliers where organization_id=org and private.history_key(suppliers.name)=private.history_key(v_new_name)) then raise exception 'SUPPLIER_NAME_EXISTS' using errcode='23505';end if;
  insert into public.suppliers(organization_id,name) values(org,v_new_name) returning id into target;$old$;
 if strpos(source,old)=0 then raise exception 'SUPPLIER_EXISTING_NAME_ANCHOR_MISSING';end if;
 source:=replace(source,old,$new$  target:=private.supplier_identity(org,v_new_name);
  if target is null then
   if exists(select 1 from public.suppliers where organization_id=org and private.history_key(suppliers.name)=private.history_key(v_new_name)) then raise exception 'SUPPLIER_NAME_EXISTS' using errcode='23505';end if;
   insert into public.suppliers(organization_id,name) values(org,v_new_name) returning id into target;
  end if;$new$);
 execute source;
end $patch$;

create table private.receipt_ocr_dispatch (
 singleton boolean primary key default true check(singleton),
 paused_until timestamptz,
 pause_reason text check(pause_reason in ('DAILY_QUOTA','RATE_LIMIT','PROVIDER_BUSY')),
 next_dispatch_at timestamptz not null default '-infinity',
 updated_at timestamptz not null default now()
);
insert into private.receipt_ocr_dispatch(singleton) values(true);
alter table private.receipt_ocr_dispatch enable row level security;
revoke all on private.receipt_ocr_dispatch from public,anon,authenticated;
alter table public.receipt_ocr_jobs add column provider_defer_count integer not null default 0 check(provider_defer_count>=0);

create or replace function public.claim_receipt_ocr_jobs(p_limit integer default 2)
returns setof public.receipt_ocr_jobs language plpgsql security definer set search_path='' as $$
declare control private.receipt_ocr_dispatch; capacity integer; claimed integer;
begin
 -- Shared lock order with fail_receipt_ocr_job: dispatcher first, then job.
 perform pg_advisory_xact_lock(hashtextextended('receipt-ocr-dispatch',0));
 select * into strict control from private.receipt_ocr_dispatch where singleton;
 if control.paused_until>now() or control.next_dispatch_at>now() then return;end if;
 update public.receipt_ocr_jobs set status='FAILED',last_error='OCR_WORKER_TIMEOUT',completed_at=now(),lease_token=null,locked_at=null
 where status='RUNNING' and locked_at<now()-interval '5 minutes' and attempt_count>=max_attempts;
 select greatest(0,2-count(*)::integer) into capacity from public.receipt_ocr_jobs
 where status='RUNNING' and locked_at>=now()-interval '5 minutes';
 if capacity=0 then return;end if;
 return query with candidates as (
  select id from public.receipt_ocr_jobs where attempt_count<max_attempts
  and ((status='QUEUED' and available_at<=now()) or (status='RUNNING' and locked_at<now()-interval '5 minutes'))
  order by available_at,created_at,id for update skip locked limit least(greatest(p_limit,1),capacity)
 ) update public.receipt_ocr_jobs j set status='RUNNING',attempt_count=j.attempt_count+1,locked_at=now(),lease_token=gen_random_uuid(),
 started_at=coalesce(j.started_at,now()),completed_at=null from candidates c where j.id=c.id returning j.*;
 get diagnostics claimed=row_count;
 if claimed>0 then update private.receipt_ocr_dispatch set next_dispatch_at=now()+interval '60 seconds',updated_at=now() where singleton;end if;
end $$;

create or replace function public.fail_receipt_ocr_job(p_job_id uuid,p_lease_token uuid,p_error text)
returns public.receipt_ocr_jobs language plpgsql security definer set search_path='' as $$
declare job public.receipt_ocr_jobs; raw jsonb; reason text; resume_at timestamptz; seconds numeric;
begin
 perform pg_advisory_xact_lock(hashtextextended('receipt-ocr-dispatch',0));
 select * into job from public.receipt_ocr_jobs where id=p_job_id and status='RUNNING' and lease_token=p_lease_token for update;
 if not found then raise exception 'OCR_JOB_LEASE_LOST';end if;
 -- Only the failed run belonging to this lease may classify its provider error.
 select r.raw_response into raw from public.receipt_ocr_runs r where r.batch_id=job.batch_id
 and r.started_at>=job.locked_at and r.status='FAILED' and r.error_message=p_error order by r.version desc limit 1;
 if p_error like 'GEMINI_429:%' then
  if coalesce(raw#>'{response,error,details}','[]')::text ~ 'PerDay' then
   reason:='DAILY_QUOTA';
   -- Google RPD resets at Pacific midnight; use the zone to handle DST.
   resume_at:=((now() at time zone 'America/Los_Angeles')::date+1)::timestamp at time zone 'America/Los_Angeles';
   resume_at:=resume_at+interval '10 seconds';
  else
   reason:='RATE_LIMIT';seconds:=60;
   select greatest(60,max(regexp_replace(d->>'retryDelay','s$','')::numeric)) into seconds
   from jsonb_array_elements(coalesce(raw#>'{response,error,details}','[]'))d where d->>'retryDelay' ~ '^[0-9]+(\.[0-9]+)?s$';
   resume_at:=now()+make_interval(secs=>coalesce(seconds,60)::double precision)+interval '5 seconds';
  end if;
 elsif p_error like 'GEMINI_503:%' or p_error like 'GEMINI_500:%' or p_error like 'GEMINI_502:%' or p_error like 'GEMINI_504:%' then
  reason:='PROVIDER_BUSY';resume_at:=now()+make_interval(secs=>least(1800,60*power(2,least(job.provider_defer_count,5)))::double precision);
 end if;
 if reason is not null then
  update private.receipt_ocr_dispatch set paused_until=greatest(coalesce(paused_until,'-infinity'),resume_at),
   pause_reason=case when paused_until>resume_at then pause_reason else reason end,updated_at=now() where singleton;
  update public.receipt_ocr_jobs set status=case when provider_defer_count<8 then 'QUEUED' else 'FAILED' end,
   provider_defer_count=provider_defer_count+1,attempt_count=greatest(0,attempt_count-1),available_at=resume_at,
   completed_at=case when provider_defer_count<8 then null else now() end,locked_at=null,lease_token=null,last_error=left(p_error,4000)
   where id=job.id returning * into job;
 else
  update public.receipt_ocr_jobs set status=case when attempt_count<max_attempts then 'QUEUED' else 'FAILED' end,
   available_at=case when attempt_count<max_attempts then now()+make_interval(secs=>least(300,15*power(2,greatest(attempt_count-1,0)))::integer) else available_at end,
   completed_at=case when attempt_count<max_attempts then null else now() end,
   locked_at=null,lease_token=null,last_error=left(p_error,4000) where id=job.id returning * into job;
 end if;
 return job;
end $$;
revoke all on function public.claim_receipt_ocr_jobs(integer),public.fail_receipt_ocr_job(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.claim_receipt_ocr_jobs(integer),public.fail_receipt_ocr_job(uuid,uuid,text) to service_role;

-- Expose only safe waiting metadata through the existing store-authorized inbox.
do $patch$
declare source text; old text;
begin
 source:=pg_get_functiondef('public.get_baihuayuan_receipt_inbox(uuid)'::regprocedure);
 old:='j.attempt_count,';
 if strpos(source,old)=0 then raise exception 'OCR_INBOX_ATTEMPT_ANCHOR_MISSING';end if;
 source:=replace(source,old,'j.attempt_count,j.available_at,');
 old:='select jj.status,jj.last_error,jj.attempt_count';
 if strpos(source,old)=0 then raise exception 'OCR_INBOX_JOB_ANCHOR_MISSING';end if;
 source:=replace(source,old,'select jj.status,jj.last_error,jj.attempt_count,jj.available_at');
 old:='''last_error'',b.last_error,';
 if strpos(source,old)=0 then raise exception 'OCR_INBOX_WAIT_ANCHOR_MISSING';end if;
 source:=replace(source,old,$new$'last_error',b.last_error,
        'ocr_wait_reason',case when b.job_status='QUEUED' then (select pause_reason from private.receipt_ocr_dispatch where singleton and paused_until>now()) end,
        'retry_at',case when b.job_status='QUEUED' then greatest(b.available_at,(select greatest(paused_until,next_dispatch_at) from private.receipt_ocr_dispatch where singleton)) end,$new$);
  execute source;
 source:=pg_get_functiondef('public.get_pilot_receipt(uuid)'::regprocedure);
 old:='jsonb_build_object(''status'',j.status,''attempt_count'',j.attempt_count)';
 if strpos(source,old)=0 then raise exception 'OCR_DETAIL_WAIT_ANCHOR_MISSING';end if;
 source:=replace(source,old,$new$jsonb_build_object('status',j.status,'attempt_count',j.attempt_count,
  'ocr_wait_reason',case when j.status='QUEUED' then (select pause_reason from private.receipt_ocr_dispatch where singleton and paused_until>now()) end,
  'retry_at',case when j.status='QUEUED' then greatest(j.available_at,(select greatest(paused_until,next_dispatch_at) from private.receipt_ocr_dispatch where singleton)) end)$new$);
 execute source;
end $patch$;
notify pgrst,'reload schema';
