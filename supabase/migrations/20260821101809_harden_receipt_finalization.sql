-- Make formal receiving idempotent and reject incomplete/unvalidated OCR review.
create or replace function public.finalize_goods_receipt(
  p_batch_id uuid,
  p_supplier_id uuid,
  p_receipt_date date,
  p_document_number text,
  p_subtotal_ex_tax numeric,
  p_tax numeric,
  p_total_inc_tax numeric,
  p_lines jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_org_id uuid := public.current_organization_id();
  v_receipt_id uuid;
  v_run_id uuid;
  v_line jsonb;
  v_line_count integer;
  v_line_subtotal numeric;
  v_line_tax numeric;
  v_line_total numeric;
  v_sum_subtotal numeric := 0;
  v_sum_tax numeric := 0;
  v_sum_total numeric := 0;
begin
  if not public.is_admin() then
    raise exception 'Only ADMIN can finalize a goods receipt';
  end if;

  -- Serializes retries and double-clicks for the same upload batch.
  perform pg_advisory_xact_lock(hashtextextended(p_batch_id::text, 0));

  select id into v_receipt_id
  from public.goods_receipts
  where source_batch_id = p_batch_id and organization_id = v_org_id;
  if v_receipt_id is not null then
    return v_receipt_id;
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'At least one receipt line is required';
  end if;
  if not exists (
    select 1 from public.receipt_upload_batches
    where id = p_batch_id and organization_id = v_org_id and status <> 'COMPLETED'
  ) then
    raise exception 'Receipt upload batch is missing or already completed';
  end if;
  if p_supplier_id is not null and not exists (
    select 1 from public.suppliers where id = p_supplier_id and organization_id = v_org_id
  ) then
    raise exception 'Supplier does not belong to this organization';
  end if;

  select id into v_run_id
  from public.receipt_ocr_runs
  where batch_id = p_batch_id and organization_id = v_org_id and status = 'SUCCEEDED'
  order by version desc limit 1;
  if v_run_id is null then
    raise exception 'A successful real OCR run is required';
  end if;

  if exists (
    select 1
    from public.receipt_ocr_fields f
    where f.ocr_run_id = v_run_id
      and f.review_status <> 'TRUSTED'
      and not exists (
        select 1 from public.receipt_review_corrections c where c.ocr_field_id = f.id
      )
  ) then
    raise exception 'All REVIEW and UNREADABLE fields require a saved human correction';
  end if;

  select count(distinct row_key) into v_line_count
  from public.receipt_ocr_fields
  where ocr_run_id = v_run_id and row_key <> 'document';
  if v_line_count <> jsonb_array_length(p_lines) then
    raise exception 'Submitted lines do not match the latest OCR run';
  end if;
  if exists (
    select 1
    from (select distinct row_key from public.receipt_ocr_fields where ocr_run_id = v_run_id and row_key <> 'document') rows
    where not exists (
      select 1 from public.receipt_product_mappings m
      where m.batch_id = p_batch_id and m.row_key = rows.row_key and m.organization_id = v_org_id
    )
  ) then
    raise exception 'Every OCR line must be mapped to a product';
  end if;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    if nullif(v_line->>'product_id', '') is null or not exists (
      select 1 from public.products
      where id = (v_line->>'product_id')::uuid and organization_id = v_org_id
    ) then
      raise exception 'Receipt product does not belong to this organization';
    end if;
    if nullif(v_line->>'supplier_id', '') is not null and not exists (
      select 1 from public.suppliers
      where id = (v_line->>'supplier_id')::uuid and organization_id = v_org_id
    ) then
      raise exception 'Receipt line supplier does not belong to this organization';
    end if;
    if nullif(v_line->>'quantity', '') is null or (v_line->>'quantity')::numeric <= 0 then
      raise exception 'Receipt quantity must be greater than zero';
    end if;
    if nullif(v_line->>'unit', '') is null then
      raise exception 'Receipt unit is required';
    end if;

    v_line_subtotal := nullif(v_line->>'line_subtotal_ex_tax', '')::numeric;
    v_line_tax := nullif(v_line->>'tax', '')::numeric;
    v_line_total := nullif(v_line->>'line_total_inc_tax', '')::numeric;
    if v_line_subtotal is not null
      and nullif(v_line->>'unit_price_ex_tax', '') is not null
      and abs(((v_line->>'quantity')::numeric * (v_line->>'unit_price_ex_tax')::numeric) - v_line_subtotal) > greatest(1, abs(v_line_subtotal) * 0.01) then
      raise exception 'Receipt line arithmetic is inconsistent';
    end if;
    if v_line_subtotal is not null and v_line_tax is not null and v_line_total is not null
      and abs((v_line_subtotal + v_line_tax) - v_line_total) > 1 then
      raise exception 'Receipt line tax arithmetic is inconsistent';
    end if;
    v_sum_subtotal := v_sum_subtotal + coalesce(v_line_subtotal, 0);
    v_sum_tax := v_sum_tax + coalesce(v_line_tax, 0);
    v_sum_total := v_sum_total + coalesce(v_line_total, coalesce(v_line_subtotal, 0) + coalesce(v_line_tax, 0));
  end loop;

  if abs(v_sum_subtotal - coalesce(p_subtotal_ex_tax, 0)) > 1
    or abs(v_sum_tax - coalesce(p_tax, 0)) > 1
    or abs(v_sum_total - coalesce(p_total_inc_tax, 0)) > 1 then
    raise exception 'Receipt totals do not match submitted lines';
  end if;

  insert into public.goods_receipts (
    organization_id, supplier_id, receipt_date, document_number,
    subtotal_ex_tax, tax, total_inc_tax, reviewed_by, source_batch_id
  ) values (
    v_org_id, p_supplier_id, p_receipt_date, nullif(p_document_number, ''),
    p_subtotal_ex_tax, p_tax, p_total_inc_tax, (select auth.uid()), p_batch_id
  ) returning id into v_receipt_id;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    insert into public.receipt_lines (
      organization_id, receipt_id, product_id, supplier_id, specification,
      quantity, unit, unit_price_ex_tax, line_subtotal_ex_tax, tax_rate,
      tax, line_total_inc_tax, batch_or_expiry, storage_location
    ) values (
      v_org_id, v_receipt_id, (v_line->>'product_id')::uuid,
      coalesce(nullif(v_line->>'supplier_id', '')::uuid, p_supplier_id),
      coalesce(v_line->>'specification', ''), (v_line->>'quantity')::numeric,
      v_line->>'unit', nullif(v_line->>'unit_price_ex_tax', '')::numeric,
      nullif(v_line->>'line_subtotal_ex_tax', '')::numeric,
      nullif(v_line->>'tax_rate', '')::numeric, nullif(v_line->>'tax', '')::numeric,
      nullif(v_line->>'line_total_inc_tax', '')::numeric,
      nullif(v_line->>'batch_or_expiry', ''), nullif(v_line->>'storage_location', '')
    );
  end loop;

  update public.receipt_upload_batches set status = 'COMPLETED'
  where id = p_batch_id and organization_id = v_org_id;

  insert into public.audit_logs (
    organization_id, entity_type, entity_id, action, old_value, new_value, user_id
  ) values (
    v_org_id, 'goods_receipt', v_receipt_id, 'RECEIPT_FINALIZED', null,
    jsonb_build_object('batch_id', p_batch_id, 'ocr_run_id', v_run_id,
      'subtotal_ex_tax', p_subtotal_ex_tax, 'tax', p_tax, 'total_inc_tax', p_total_inc_tax),
    (select auth.uid())
  );

  return v_receipt_id;
end;
$$;

revoke execute on function public.finalize_goods_receipt(uuid, uuid, date, text, numeric, numeric, numeric, jsonb) from public, anon;
grant execute on function public.finalize_goods_receipt(uuid, uuid, date, text, numeric, numeric, numeric, jsonb) to authenticated;
