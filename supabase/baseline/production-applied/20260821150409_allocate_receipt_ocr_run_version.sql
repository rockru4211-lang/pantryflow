-- Production-applied immutable snapshot
-- Project: tkedzwlzknetmhpsmths
-- Version: 20260821150409
-- Name: allocate_receipt_ocr_run_version
-- DO NOT apply to production; retained for blank-environment reconstruction only.

-- Allocate an OCR run version and mark its batch PROCESSING in one transaction.
-- The transaction-scoped advisory lock serializes concurrent reruns per batch.
create or replace function public.create_receipt_ocr_run(
  p_organization_id uuid,
  p_batch_id uuid,
  p_provider text,
  p_model text,
  p_prompt_version text,
  p_started_by uuid
)
returns table (id uuid, version integer)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_run_id uuid;
  v_version integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_batch_id::text, 0));

  if not exists (
    select 1
    from public.receipt_upload_batches b
    where b.id = p_batch_id
      and b.organization_id = p_organization_id
  ) then
    raise exception 'Receipt upload batch does not belong to the organization';
  end if;

  select coalesce(max(r.version), 0) + 1
  into v_version
  from public.receipt_ocr_runs r
  where r.batch_id = p_batch_id;

  insert into public.receipt_ocr_runs (
    organization_id,
    batch_id,
    version,
    provider,
    model,
    prompt_version,
    status,
    started_by
  ) values (
    p_organization_id,
    p_batch_id,
    v_version,
    p_provider,
    p_model,
    p_prompt_version,
    'PROCESSING',
    p_started_by
  ) returning receipt_ocr_runs.id into v_run_id;

  update public.receipt_upload_batches b
  set status = 'PROCESSING'
  where b.id = p_batch_id
    and b.organization_id = p_organization_id;

  if not found then
    raise exception 'Failed to mark receipt upload batch PROCESSING';
  end if;

  return query select v_run_id, v_version;
end;
$$;

revoke execute on function public.create_receipt_ocr_run(uuid, uuid, text, text, text, uuid)
from public, anon, authenticated;
grant execute on function public.create_receipt_ocr_run(uuid, uuid, text, text, text, uuid)
to service_role;

