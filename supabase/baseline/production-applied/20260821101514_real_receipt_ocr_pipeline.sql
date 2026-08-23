-- Production-applied immutable snapshot
-- Project: tkedzwlzknetmhpsmths
-- Version: 20260821101514
-- Name: real_receipt_ocr_pipeline
-- DO NOT apply to production; retained for blank-environment reconstruction only.

-- PantryFlow Pilot v0.1: real, versioned receipt OCR pipeline.
-- Original documents and OCR runs are append-only. Human corrections remain
-- separate in receipt_review_corrections.

create table if not exists public.receipt_ocr_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  batch_id uuid not null references public.receipt_upload_batches(id),
  version integer not null,
  provider text not null,
  model text not null,
  prompt_version text not null,
  status text not null check (status in ('PROCESSING', 'SUCCEEDED', 'FAILED')),
  raw_response jsonb,
  error_code text,
  error_message text,
  started_by uuid not null references public.profiles(id),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (batch_id, version)
);

alter table public.receipt_ocr_fields
  add column if not exists ocr_run_id uuid references public.receipt_ocr_runs(id),
  add column if not exists review_status text,
  add column if not exists source_region jsonb,
  add column if not exists validation_notes jsonb not null default '[]'::jsonb;

alter table public.receipt_ocr_fields
  drop constraint if exists receipt_ocr_fields_batch_id_row_key_field_name_key;

alter table public.receipt_ocr_fields
  drop constraint if exists receipt_ocr_fields_review_status_check;

alter table public.receipt_ocr_fields
  add constraint receipt_ocr_fields_review_status_check
  check (review_status in ('TRUSTED', 'REVIEW', 'UNREADABLE'));

create unique index if not exists receipt_ocr_fields_run_row_field_uidx
  on public.receipt_ocr_fields (ocr_run_id, row_key, field_name)
  where ocr_run_id is not null;

create index if not exists receipt_ocr_runs_batch_created_idx
  on public.receipt_ocr_runs (batch_id, created_at desc);

create index if not exists receipt_ocr_fields_batch_run_idx
  on public.receipt_ocr_fields (batch_id, ocr_run_id, row_key);

create or replace function public.protect_receipt_ocr_run()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'PantryFlow OCR runs are append-only';
  end if;
  if old.status <> 'PROCESSING' then
    raise exception 'Completed PantryFlow OCR runs are immutable';
  end if;
  if new.id <> old.id
    or new.organization_id <> old.organization_id
    or new.batch_id <> old.batch_id
    or new.version <> old.version
    or new.provider <> old.provider
    or new.model <> old.model
    or new.prompt_version <> old.prompt_version
    or new.started_by <> old.started_by
    or new.started_at <> old.started_at
    or new.created_at <> old.created_at then
    raise exception 'OCR run identity cannot be changed';
  end if;
  return new;
end;
$$;

drop trigger if exists immutable_receipt_ocr_runs on public.receipt_ocr_runs;
create trigger immutable_receipt_ocr_runs
before update or delete on public.receipt_ocr_runs
for each row execute function public.protect_receipt_ocr_run();

alter table public.receipt_ocr_runs enable row level security;

create policy receipt_ocr_runs_admin_select
on public.receipt_ocr_runs for select to authenticated
using (
  organization_id = public.current_organization_id()
  and public.is_admin()
);

-- Edge Functions write with the server-side key. Browser roles only read their
-- own organization through RLS and cannot forge AI results.
revoke insert, update, delete on public.receipt_ocr_runs from anon, authenticated;
revoke insert, update, delete on public.receipt_ocr_fields from anon, authenticated;

grant select on public.receipt_ocr_runs to authenticated;
grant select on public.receipt_ocr_fields to authenticated;

-- New Supabase projects do not necessarily auto-expose new tables.
grant usage on schema public to authenticated;

comment on table public.receipt_ocr_runs is
  'Immutable provider executions. Re-running OCR creates a new version.';
comment on column public.receipt_ocr_fields.review_status is
  'TRUSTED, REVIEW, or UNREADABLE after conservative validation.';
comment on column public.receipt_ocr_fields.source_region is
  'Normalized page region {page,x,y,width,height}; null when provider cannot locate it.';

