-- Extend existing operational evidence; no historical rows, source files or quantities are rewritten.
-- Attempts are committed in separate requests so a failed business transaction cannot erase them.
create table private.app_attempts (
 id uuid primary key, actor_id uuid not null references public.profiles(id),
 store_id uuid references public.stores(id), resource_id uuid, operation_id uuid,
 operation text not null, app_version text not null, fingerprint text,
 phase text not null check(phase in ('START','PROGRESS','SUCCEEDED','PARTIAL','FAILED')),
 started_at timestamptz not null default clock_timestamp(), finished_at timestamptz,
 stats jsonb not null default '{}'
);
create index app_attempts_store_time on private.app_attempts(store_id,started_at);
create index app_attempts_actor_time on private.app_attempts(actor_id,started_at);
create index app_attempts_operation on private.app_attempts(store_id,operation_id) where operation_id is not null;
alter table private.app_attempts enable row level security;
revoke all on private.app_attempts from public,anon,authenticated;

-- Explicit enrollment, never a store-name heuristic. Missing enrollment is UNCLASSIFIED.
create table private.trial_stores (
 store_id uuid primary key references public.stores(id), cohort text not null check(cohort in ('QA','TRIAL','EXCLUDED')),
 timezone text not null default 'Asia/Taipei', enrolled_at timestamptz not null default clock_timestamp(),
 activated_at timestamptz, non_operating_dates date[] not null default '{}',
 enrollment_reason text not null
);
alter table private.trial_stores enable row level security;
revoke all on private.trial_stores from public,anon,authenticated;

create function private.safe_trace_uuid(value text) returns uuid language sql immutable set search_path='' as $$
 select case when value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then value::uuid end
$$;
create function private.trace_stats(p jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare result jsonb:='{}'; k text; v jsonb; reasons jsonb:='{}';
begin
 for k,v in select * from jsonb_each(coalesce(p,'{}')) loop
  if k=any(array['source_rows','parse_failed','blank_rows','non_product_rows','header_rows','opening_pending','added','existing','failed','skipped','duration_ms','http_status']) and jsonb_typeof(v)='number' and (v::text)::numeric between 0 and 100000000 then result:=result||jsonb_build_object(k,v);
  elsif k='stage' and v#>>'{}'=any(array['read_file','parse','upload','database','request']) then result:=result||jsonb_build_object(k,v);
  elsif k='error_code' and v#>>'{}' ~ '^(?:[0-9A-Z]{5}|PGRST[0-9]{3}|[A-Z][A-Z0-9_]{2,63})$' then result:=result||jsonb_build_object(k,v);
  elsif k='reasons' and jsonb_typeof(v)='object' then
   select coalesce(jsonb_object_agg(key,value),'{}') into reasons from jsonb_each(v) where key=any(array['INVALID_OPENING','MISSING_NAME','UNRECOGNIZED_SHEET','DATABASE_REJECTED']) and jsonb_typeof(value)='number' and (value::text)::numeric between 0 and 1000000;
   result:=result||jsonb_build_object('reasons',reasons);
  end if;
 end loop;
 return result;
end $$;

create function private.record_app_attempt(p_id uuid,p_phase text,p jsonb) returns void language plpgsql security definer set search_path='' as $$
declare a private.app_attempts; s uuid; r uuid; op text:=p->>'operation'; version text:=p->>'app_version';
begin
 if auth.uid() is null then raise exception using errcode='42501',message='AUTH_REQUIRED'; end if;
 if p_phase<>all(array['START','PROGRESS','SUCCEEDED','PARTIAL','FAILED']) or p_id is null then raise exception 'INVALID_TRACE'; end if;
 select * into a from private.app_attempts where id=p_id for update;
 if found then
  if a.actor_id<>auth.uid() then raise exception using errcode='42501',message='TRACE_ACCESS_DENIED'; end if;
  -- A delivered terminal event is immutable; retrying its delivery is harmless.
  if a.finished_at is not null then return; end if;
  update private.app_attempts set phase=p_phase,finished_at=case when p_phase in ('SUCCEEDED','PARTIAL','FAILED') then clock_timestamp() end,
   fingerprint=coalesce(fingerprint,case when p->>'fingerprint' ~ '^[0-9a-f]{64}$' then p->>'fingerprint' end),
   stats=stats||private.trace_stats(p) where id=p_id;
  return;
 end if;
 if p_phase<>'START' or op !~ '^[a-z][a-z_]{2,79}$' then raise exception 'INVALID_TRACE'; end if;
 if (select count(*) from private.app_attempts where actor_id=auth.uid() and started_at>clock_timestamp()-interval '1 minute')>=180 then return; end if;
 s:=private.safe_trace_uuid(p->>'store_id'); r:=private.safe_trace_uuid(p->>'resource_id');
 if s is null and r is not null then
  select store_id into s from public.inventory_count_sessions where id=r;
  if s is null then select store_id into s from public.receipt_upload_batches where id=r; end if;
  if s is null then select b.store_id into s from public.receipt_ocr_fields f join public.receipt_upload_batches b on b.id=f.batch_id where f.id=r; end if;
  if s is null then select store_id into s from public.count_zones where id=r; end if;
  if s is null then select c.store_id into s from public.inventory_count_discrepancies d join public.inventory_count_sessions c on c.id=d.session_id where d.id=r; end if;
 end if;
 -- Failed unauthorized calls can be traced to the actor, never attributed to another merchant.
 if s is not null and private.app_role(s) is null then s:=null; end if;
 insert into private.app_attempts(id,actor_id,store_id,resource_id,operation_id,operation,app_version,fingerprint,phase)
 values(p_id,auth.uid(),s,r,private.safe_trace_uuid(p->>'operation_id'),op,
  case when version ~ '^[0-9a-f]{40}$' then version else 'unversioned' end,
  case when p->>'fingerprint' ~ '^[0-9a-f]{64}$' then p->>'fingerprint' end,'START');
 if op in ('inventory_import','start_pilot_count','save_pilot_count_drafts','begin_pilot_receipt_upload','app_operation') then
  update private.trial_stores set activated_at=coalesce(activated_at,clock_timestamp()) where store_id=s and cohort='TRIAL';
 end if;
end $$;
create function public.record_app_attempt(p_attempt_id uuid,p_phase text,p_context jsonb default '{}') returns void language sql security invoker set search_path='' as $$ select private.record_app_attempt(p_attempt_id,p_phase,p_context) $$;
revoke all on function public.record_app_attempt(uuid,text,jsonb),private.record_app_attempt(uuid,text,jsonb) from public,anon;
grant execute on function public.record_app_attempt(uuid,text,jsonb),private.record_app_attempt(uuid,text,jsonb) to authenticated;
revoke all on function private.safe_trace_uuid(text),private.trace_stats(jsonb) from public,anon,authenticated;

alter table public.audit_logs add column attempt_id uuid,add column app_version text,add column store_id uuid;
create index audit_logs_attempt on public.audit_logs(attempt_id) where attempt_id is not null;
create index audit_logs_store_time on public.audit_logs(store_id,created_at) where store_id is not null;
create function private.attach_audit_trace() returns trigger language plpgsql security definer set search_path='' as $$
declare h jsonb:=coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb; a private.app_attempts;
begin
 select * into a from private.app_attempts where id=private.safe_trace_uuid(h->>'x-pf-attempt-id') and actor_id=auth.uid();
 if found then new.attempt_id:=a.id;new.app_version:=a.app_version;new.store_id:=a.store_id; end if;
 return new;
end $$;
create trigger attach_app_trace before insert on public.audit_logs for each row execute function private.attach_audit_trace();
revoke all on function private.attach_audit_trace() from public,anon,authenticated;

-- Status transitions, not completed_at, define submission vs. formal completion.
create function private.audit_count_transition() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if (tg_op='INSERT' and new.status::text='IN_PROGRESS') or (tg_op='UPDATE' and new.status is distinct from old.status) then
  insert into public.audit_logs(organization_id,entity_type,entity_id,action,new_value,user_id,store_id)
  values(new.organization_id,'inventory_count_session',new.id::text,
   case new.status::text when 'IN_PROGRESS' then 'COUNT_STARTED' when 'REVIEWING' then 'COUNT_SUBMITTED' when 'CLOSED' then 'COUNT_CLOSED' else 'COUNT_STATE_CHANGED' end,
   jsonb_build_object('status',new.status,'store_id',new.store_id),coalesce(auth.uid(),new.started_by),new.store_id);
 end if;return new;
end $$;
create trigger audit_count_transition after insert or update of status on public.inventory_count_sessions for each row execute function private.audit_count_transition();
revoke all on function private.audit_count_transition() from public,anon,authenticated;

alter table public.receipt_upload_batches add column upload_completed_at timestamptz;
alter table public.receipt_ocr_jobs add column app_version text,add column attempt_id uuid;
alter table public.receipt_ocr_runs add column app_version text,add column attempt_id uuid,add column queued_at timestamptz,add column job_id uuid;
create function private.attach_receipt_trace() returns trigger language plpgsql security definer set search_path='' as $$
declare h jsonb:=coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb; a private.app_attempts; j public.receipt_ocr_jobs;
begin
 if tg_table_name='receipt_ocr_jobs' then
  if tg_op='INSERT' or new.status='QUEUED' then
   select * into a from private.app_attempts where id=private.safe_trace_uuid(h->>'x-pf-attempt-id') and actor_id=auth.uid();
   if found then new.app_version:=a.app_version;new.attempt_id:=a.id; end if;
   update public.receipt_upload_batches set upload_completed_at=coalesce(upload_completed_at,clock_timestamp()) where id=new.batch_id;
  end if;
 else
  select * into j from public.receipt_ocr_jobs where batch_id=new.batch_id and status='RUNNING' order by locked_at desc limit 1;
  new.app_version:=j.app_version;new.attempt_id:=j.attempt_id;new.queued_at:=j.available_at;new.job_id:=j.id;
 end if;
 return new;
end $$;
create trigger attach_receipt_job_trace before insert or update of status on public.receipt_ocr_jobs for each row execute function private.attach_receipt_trace();
create trigger attach_receipt_run_trace before insert on public.receipt_ocr_runs for each row execute function private.attach_receipt_trace();
revoke all on function private.attach_receipt_trace() from public,anon,authenticated;

-- Service-only, atomic rate limits; denied requests still commit their counter.
create table private.staff_login_limits(key_hash text primary key,window_start timestamptz not null,hits integer not null);
alter table private.staff_login_limits enable row level security;
revoke all on private.staff_login_limits from public,anon,authenticated;
create function public.check_staff_login_rate(p_key_hash text,p_limit integer default 30) returns boolean language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 if p_key_hash !~ '^[0-9a-f]{64}$' then return false; end if;
 insert into private.staff_login_limits values(p_key_hash,clock_timestamp(),1)
 on conflict(key_hash) do update set hits=case when staff_login_limits.window_start<clock_timestamp()-interval '1 minute' then 1 else staff_login_limits.hits+1 end,
 window_start=case when staff_login_limits.window_start<clock_timestamp()-interval '1 minute' then clock_timestamp() else staff_login_limits.window_start end returning hits into n;
 delete from private.staff_login_limits where window_start<clock_timestamp()-interval '1 day';
 return n<=least(greatest(p_limit,5),120);
end $$;
revoke all on function public.check_staff_login_rate(text,integer) from public,anon,authenticated;
grant execute on function public.check_staff_login_rate(text,integer) to service_role;
-- Only the rate-limited Edge endpoint may resolve a pre-login identity now.
-- Anonymous access is removed by a follow-up migration after the replacement client is live.
grant execute on function public.get_pilot_staff_login_context(text,text) to service_role;

-- Restricted operational report, queried by the product operator; no new merchant dashboard.
-- The window is local-calendar days 1–7 from first real activity, with partial first-day boundaries.
create function private.trial_daily_report(p_store uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare t private.trial_stores; report jsonb;
begin
 select * into t from private.trial_stores where store_id=p_store;
 if not found then return jsonb_build_object('cohort','UNCLASSIFIED','days','[]'::jsonb); end if;
 if t.activated_at is null then return jsonb_build_object('cohort',t.cohort,'activated_at',null,'days','[]'::jsonb); end if;
 with days as (
  select n+1 trial_day,(t.activated_at at time zone t.timezone)::date+n local_date,
   greatest(t.activated_at,((t.activated_at at time zone t.timezone)::date+n)::timestamp at time zone t.timezone) lo,
   ((t.activated_at at time zone t.timezone)::date+n+1)::timestamp at time zone t.timezone hi from generate_series(0,6)n
 ), daily as (
  select d.*,jsonb_build_object(
   'attempts',count(a.id),'succeeded',count(a.id) filter(where a.phase='SUCCEEDED'),'partial',count(*) filter(where a.phase='PARTIAL'),
   'failed',count(*) filter(where a.phase='FAILED'),'unfinished',count(*) filter(where a.finished_at is null),
   'distinct_files',count(distinct a.fingerprint),'repeat_attempts',count(a.fingerprint)-count(distinct a.fingerprint),
   'source_rows',coalesce(sum((stats->>'source_rows')::int),0),'added',coalesce(sum((stats->>'added')::int),0),
   'existing',coalesce(sum((stats->>'existing')::int),0),'failed_rows',coalesce(sum(coalesce((stats->>'failed')::int,(stats->>'parse_failed')::int)),0),
   'skipped',coalesce(sum((stats->>'skipped')::int),0),'blank_rows',coalesce(sum((stats->>'blank_rows')::int),0),
   'header_rows',coalesce(sum((stats->>'header_rows')::int),0),'non_product_rows',coalesce(sum((stats->>'non_product_rows')::int),0),
   'opening_pending',coalesce(sum((stats->>'opening_pending')::int),0)
  ) imports from days d left join private.app_attempts a on a.store_id=p_store and a.operation='inventory_import' and a.started_at>=d.lo and a.started_at<d.hi
  group by d.trial_day,d.local_date,d.lo,d.hi
 )
 select jsonb_agg(jsonb_build_object('trial_day',d.trial_day,'local_date',d.local_date,
  'day_state',case when d.local_date>(clock_timestamp() at time zone t.timezone)::date then 'FUTURE'
    when d.local_date=any(t.non_operating_dates) then 'NOT_OPERATING'
    when exists(select 1 from public.inventory_count_sessions c where c.store_id=p_store and c.started_at>=d.lo and c.started_at<d.hi and c.status<>'CLOSED') then 'INCOMPLETE'
    when exists(select 1 from private.app_attempts a where a.store_id=p_store and a.started_at>=d.lo and a.started_at<d.hi) then 'ACTIVE' else 'NO_ACTIVITY' end,
  'imports',d.imports,
  'errors',(select coalesce(jsonb_agg(e),'[]') from (select operation,stats->>'stage' stage,stats->>'error_code' code,count(*) occurrences from private.app_attempts where store_id=p_store and started_at>=d.lo and started_at<d.hi and phase='FAILED' group by operation,stats->>'stage',stats->>'error_code')e),
  'versions',(select coalesce(jsonb_agg(distinct app_version),'[]') from private.app_attempts where store_id=p_store and started_at>=d.lo and started_at<d.hi),
  'counts',(select jsonb_build_object('started',count(*),'reviewing',count(*) filter(where status='REVIEWING'),'closed',count(*) filter(where status='CLOSED'),'unfinished',count(*) filter(where status not in ('REVIEWING','CLOSED')))
    from public.inventory_count_sessions where store_id=p_store and started_at>=d.lo and started_at<d.hi),
  'count_events',(select jsonb_build_object('draft_saved',count(*) filter(where action='COUNT_DRAFT_SAVED'),'submitted',count(*) filter(where action='COUNT_SUBMITTED'),'closed',count(*) filter(where action='COUNT_CLOSED')) from public.audit_logs where store_id=p_store and created_at>=d.lo and created_at<d.hi),
  'ocr',(select jsonb_build_object('runs',count(*),'batches',count(distinct r.batch_id),'succeeded',count(*) filter(where r.status='SUCCEEDED'),'failed',count(*) filter(where r.status='FAILED'),
    'processing',count(*) filter(where r.status='PROCESSING'),'timing_samples',count(*) filter(where r.completed_at is not null and r.queued_at is not null),
    'success_processing_ms',jsonb_agg(round(extract(epoch from(r.completed_at-r.started_at))*1000)) filter(where r.status='SUCCEEDED' and r.completed_at is not null),
    'failed_processing_ms',jsonb_agg(round(extract(epoch from(r.completed_at-r.started_at))*1000)) filter(where r.status='FAILED' and r.completed_at is not null),
    'model_request_ms',jsonb_agg((select jsonb_agg(jsonb_build_object('status',m->'status','duration_ms',m->'duration_ms')) from jsonb_array_elements(coalesce(r.raw_response->'attempts','[]'))m where m ? 'duration_ms')),
    'queue_ms',jsonb_agg(greatest(0,round(extract(epoch from(r.started_at-r.queued_at))*1000))) filter(where r.queued_at is not null),
    'upload_to_review_ms',jsonb_agg(round(extract(epoch from(r.completed_at-b.upload_completed_at))*1000)) filter(where r.status='SUCCEEDED' and b.upload_completed_at is not null),
    'models',jsonb_agg(distinct jsonb_build_object('model',r.model,'prompt_version',r.prompt_version)),
    'failures',jsonb_agg(jsonb_build_object('run_id',r.id,'job_id',r.job_id,'code',r.error_code)) filter(where r.status='FAILED'))
    from public.receipt_ocr_runs r join public.receipt_upload_batches b on b.id=r.batch_id where b.store_id=p_store and r.started_at>=d.lo and r.started_at<d.hi),
  'review',(select jsonb_build_object('reviewed_fields',count(*),'finally_changed_fields',count(*) filter(where coalesce(c.new_value,f.normalized_value) is distinct from f.normalized_value),
    'edited_fields',count(*) filter(where c.id is not null),'reverted_fields',count(*) filter(where c.id is not null and c.new_value is not distinct from f.normalized_value))
    from public.goods_receipts g join public.receipt_ocr_runs r on r.batch_id=g.source_batch_id
    join public.receipt_ocr_fields f on f.ocr_run_id=r.id
    left join lateral(select id,new_value from public.receipt_review_corrections where ocr_field_id=f.id order by modified_at desc,id desc limit 1)c on true
    where g.store_id=p_store and g.reviewed_at>=d.lo and g.reviewed_at<d.hi and r.version=(select max(version) from public.receipt_ocr_runs where batch_id=r.batch_id))
 ) order by d.trial_day) into report from daily d;
 return jsonb_build_object('cohort',t.cohort,'timezone',t.timezone,'activated_at',t.activated_at,'as_of',clock_timestamp(),'days',report,
  'notes','No activity does not prove closure. Only explicitly marked non-operating dates are NOT_OPERATING. Reviewed fields are not automatically OCR-correct; final changes are compared to normalized OCR output. No seven-day result before day 7.');
end $$;
revoke all on function private.trial_daily_report(uuid) from public,anon,authenticated;
