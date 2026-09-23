
create or replace function public.confirm_baihuayuan_receipt_missing_fields(
  p_store_id uuid,
  p_batch_id uuid,
  p_run_id uuid,
  p_field_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_batch public.receipt_upload_batches;
  v_current_run uuid;
  v_field uuid;
  v_confirmed integer:=0;
begin
  if auth.uid() is null or not private.can_review_receipt(p_batch_id) then
    raise exception 'RECEIPT_REVIEWER_REQUIRED' using errcode='42501';
  end if;

  select * into v_batch
  from public.receipt_upload_batches
  where id=p_batch_id and store_id=p_store_id;

  if not found or v_batch.store_name not in ('BeApe','Gras') then
    raise exception 'BAIHUAYUAN_RECEIPT_REQUIRED' using errcode='42501';
  end if;

  select id into v_current_run
  from public.receipt_ocr_runs
  where batch_id=p_batch_id
  order by version desc
  limit 1;

  if v_current_run is null or v_current_run is distinct from p_run_id then
    raise exception 'OCR_VERSION_CHANGED';
  end if;

  if coalesce(array_length(p_field_ids,1),0)=0 then
    return jsonb_build_object('confirmed',0);
  end if;

  foreach v_field in array p_field_ids loop
    if not exists(
      select 1
      from private.receipt_effective_fields(p_run_id) f
      where f.id=v_field
        and f.row_key='document'
        and f.field_name in ('subtotal_ex_tax','tax','total_inc_tax')
        and f.review_status<>'TRUSTED'
        and f.corrected=false
        and f.value is null
    ) then
      raise exception 'MISSING_FIELD_ACK_INVALID' using errcode='22023';
    end if;

    perform public.correct_pilot_receipt_field(v_field,'null'::jsonb);
    v_confirmed:=v_confirmed+1;
  end loop;

  insert into public.audit_logs(
    organization_id,entity_type,entity_id,action,new_value,user_id,store_id
  )
  values(
    v_batch.organization_id,
    'receipt_upload_batch',
    p_batch_id::text,
    'RECEIPT_MISSING_FIELDS_CONFIRMED',
    jsonb_build_object('run_id',p_run_id,'field_ids',to_jsonb(p_field_ids),'confirmed',v_confirmed),
    auth.uid(),
    p_store_id
  );

  return jsonb_build_object('confirmed',v_confirmed);
end;
$$;

revoke all on function public.confirm_baihuayuan_receipt_missing_fields(uuid,uuid,uuid,uuid[]) from public;
grant execute on function public.confirm_baihuayuan_receipt_missing_fields(uuid,uuid,uuid,uuid[]) to authenticated;
