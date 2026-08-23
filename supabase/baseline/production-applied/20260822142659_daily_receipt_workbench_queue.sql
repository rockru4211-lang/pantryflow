-- Production-applied immutable snapshot
-- Project: tkedzwlzknetmhpsmths
-- Version: 20260822142659
-- Name: daily_receipt_workbench_queue
-- DO NOT apply to production; retained for blank-environment reconstruction only.

-- Durable OCR queue and stable daily-workbench dimensions.
-- Additive only: existing receipt documents, OCR runs, corrections, and formal
-- receipts remain untouched and traceable.

alter table public.receipt_upload_batches
  add column if not exists store_name text,
  add column if not exists work_date date;

update public.receipt_upload_batches b
set store_name = coalesce(nullif(p.store, ''), '未指定門市'),
    work_date = (b.uploaded_at at time zone 'Asia/Taipei')::date
from public.profiles p
where p.id = b.uploaded_by
  and (b.store_name is null or b.work_date is null);

update public.receipt_upload_batches
set store_name = coalesce(nullif(store_name, ''), '未指定門市'),
    work_date = coalesce(work_date, (uploaded_at at time zone 'Asia/Taipei')::date)
where store_name is null or work_date is null;

alter table public.receipt_upload_batches
  alter column store_name set not null,
  alter column work_date set not null;

create index if not exists receipt_batches_daily_workbench_idx
  on public.receipt_upload_batches (organization_id, work_date desc, store_name, status);

create table if not exists public.receipt_ocr_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  batch_id uuid not null references public.receipt_upload_batches(id),
  requested_by uuid not null references public.profiles(id),
  status text not null default 'QUEUED'
    check (status in ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  lease_token uuid,
  ocr_run_id uuid references public.receipt_ocr_runs(id),
  last_error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

create unique index if not exists receipt_ocr_jobs_one_active_batch_idx
  on public.receipt_ocr_jobs (batch_id)
  where status in ('QUEUED', 'RUNNING');

create index if not exists receipt_ocr_jobs_claim_idx
  on public.receipt_ocr_jobs (status, available_at, created_at)
  where status in ('QUEUED', 'RUNNING');

alter table public.receipt_ocr_jobs enable row level security;

drop policy if exists receipt_ocr_jobs_admin_select on public.receipt_ocr_jobs;
create policy receipt_ocr_jobs_admin_select
on public.receipt_ocr_jobs for select to authenticated
using (
  organization_id = public.current_organization_id()
  and public.is_admin()
);

revoke all on public.receipt_ocr_jobs from public, anon, authenticated;
grant select on public.receipt_ocr_jobs to authenticated;
grant all on public.receipt_ocr_jobs to service_role;

create or replace function public.enqueue_receipt_ocr(p_batch_id uuid)
returns public.receipt_ocr_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_org_id uuid;
  v_role text;
  v_uploaded_by uuid;
  v_job public.receipt_ocr_jobs;
begin
  select p.organization_id, p.role
  into v_org_id, v_role
  from public.profiles p
  where p.id = v_user_id;

  if v_org_id is null then
    raise exception 'PROFILE_NOT_FOUND';
  end if;

  select b.uploaded_by into v_uploaded_by
  from public.receipt_upload_batches b
  where b.id = p_batch_id and b.organization_id = v_org_id;

  if v_uploaded_by is null then
    raise exception 'BATCH_NOT_FOUND';
  end if;
  if v_role <> 'ADMIN' and v_uploaded_by <> v_user_id then
    raise exception 'FORBIDDEN';
  end if;
  if not exists (
    select 1 from public.receipt_documents d
    where d.batch_id = p_batch_id and d.organization_id = v_org_id
  ) then
    raise exception 'NO_DOCUMENTS';
  end if;

  select j.* into v_job
  from public.receipt_ocr_jobs j
  where j.batch_id = p_batch_id and j.status in ('QUEUED', 'RUNNING');
  if found then
    return v_job;
  end if;

  insert into public.receipt_ocr_jobs (
    organization_id, batch_id, requested_by
  ) values (
    v_org_id, p_batch_id, v_user_id
  ) returning * into v_job;

  update public.receipt_upload_batches
  set status = 'PROCESSING'
  where id = p_batch_id and status <> 'COMPLETED';

  return v_job;
end;
$$;

revoke execute on function public.enqueue_receipt_ocr(uuid) from public, anon;
grant execute on function public.enqueue_receipt_ocr(uuid) to authenticated;

create or replace function public.claim_receipt_ocr_jobs(p_limit integer default 2)
returns setof public.receipt_ocr_jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with candidates as (
    select j.id
    from public.receipt_ocr_jobs j
    where (
      j.status = 'QUEUED' and j.available_at <= now()
    ) or (
      j.status = 'RUNNING' and j.locked_at < now() - interval '5 minutes'
    )
    order by j.available_at, j.created_at
    for update skip locked
    limit least(greatest(p_limit, 1), 2)
  )
  update public.receipt_ocr_jobs j
  set status = 'RUNNING',
      attempt_count = j.attempt_count + 1,
      locked_at = now(),
      lease_token = gen_random_uuid(),
      started_at = coalesce(j.started_at, now()),
      completed_at = null
  from candidates c
  where j.id = c.id
  returning j.*;
end;
$$;

create or replace function public.complete_receipt_ocr_job(
  p_job_id uuid, p_lease_token uuid, p_ocr_run_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.receipt_ocr_jobs
  set status = 'SUCCEEDED', ocr_run_id = p_ocr_run_id,
      completed_at = now(), locked_at = null, lease_token = null, last_error = null
  where id = p_job_id and status = 'RUNNING' and lease_token = p_lease_token;
  if not found then raise exception 'OCR_JOB_LEASE_LOST'; end if;
end;
$$;

create or replace function public.fail_receipt_ocr_job(
  p_job_id uuid, p_lease_token uuid, p_error text
)
returns public.receipt_ocr_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare v_job public.receipt_ocr_jobs;
begin
  update public.receipt_ocr_jobs j
  set status = case when j.attempt_count < j.max_attempts then 'QUEUED' else 'FAILED' end,
      available_at = case
        when j.attempt_count < j.max_attempts
          then now() + make_interval(secs => least(300, 15 * power(2, j.attempt_count - 1)::integer))
        else j.available_at
      end,
      completed_at = case when j.attempt_count < j.max_attempts then null else now() end,
      locked_at = null, lease_token = null, last_error = left(p_error, 4000)
  where j.id = p_job_id and j.status = 'RUNNING' and j.lease_token = p_lease_token
  returning * into v_job;
  if not found then raise exception 'OCR_JOB_LEASE_LOST'; end if;
  return v_job;
end;
$$;

revoke execute on function public.claim_receipt_ocr_jobs(integer) from public, anon, authenticated;
revoke execute on function public.complete_receipt_ocr_job(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.fail_receipt_ocr_job(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.claim_receipt_ocr_jobs(integer) to service_role;
grant execute on function public.complete_receipt_ocr_job(uuid, uuid, uuid) to service_role;
grant execute on function public.fail_receipt_ocr_job(uuid, uuid, text) to service_role;

comment on table public.receipt_ocr_jobs is
  'Durable OCR scheduling attempts. OCR outputs remain versioned in receipt_ocr_runs.';
comment on column public.receipt_upload_batches.store_name is
  'Store snapshot at upload time for the daily receipt workbench.';
comment on column public.receipt_upload_batches.work_date is
  'Actual local receipt work date; initialized from Asia/Taipei upload date.';

create or replace function public.sync_receipt_batch_work_date()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.receipt_upload_batches
  set work_date = new.receipt_date
  where id = new.source_batch_id and organization_id = new.organization_id;
  return new;
end;
$$;

drop trigger if exists sync_receipt_batch_work_date_on_finalize on public.goods_receipts;
create trigger sync_receipt_batch_work_date_on_finalize
after insert on public.goods_receipts
for each row execute function public.sync_receipt_batch_work_date();

