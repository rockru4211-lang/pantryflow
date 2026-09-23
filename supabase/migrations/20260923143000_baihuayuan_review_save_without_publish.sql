
create or replace function public.save_pilot_receipt_review(p_batch_id uuid, p_row_key text, p_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  r uuid;
  receipt uuid;
  hash text;
  progress jsonb;
  issue text;
  inserted integer;
  org uuid;
  store_name text;
begin
  if auth.uid() is null or not private.can_review_receipt(p_batch_id) then
    raise exception using errcode='42501',message='RECEIPT_REVIEWER_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_batch_id::text,0));

  select id into r
  from public.receipt_ocr_runs
  where batch_id=p_batch_id
  order by version desc
  limit 1;

  if r is null or r is distinct from p_run_id then raise exception 'OCR_VERSION_CHANGED'; end if;
  if not exists(select 1 from public.receipt_ocr_runs where id=r and status='SUCCEEDED') then raise exception 'OCR_NOT_READY'; end if;
  if p_row_key='document' or not exists(select 1 from public.receipt_ocr_fields where ocr_run_id=r and row_key=p_row_key) then raise exception 'OCR_LINE_NOT_FOUND'; end if;

  select id into receipt from public.goods_receipts where source_batch_id=p_batch_id;
  if receipt is not null then
    return jsonb_build_object('receipt_id',receipt,'saved',true,'complete',true);
  end if;

  perform public.confirm_pilot_receipt_row(p_batch_id,p_row_key);
  hash:=private.receipt_review_hash(r,p_row_key);

  insert into private.receipt_review_saves(ocr_run_id,row_key,snapshot_hash,saved_by)
  values(r,p_row_key,hash,auth.uid())
  on conflict do nothing;

  get diagnostics inserted=row_count;
  if inserted>0 then
    select organization_id,store_name into org,store_name
    from public.receipt_upload_batches where id=p_batch_id;

    insert into public.audit_logs(organization_id,entity_type,entity_id,action,new_value,user_id)
    values(
      org,'receipt_upload_batch',p_batch_id::text,'RECEIPT_REVIEW_SAVED',
      jsonb_build_object('run_id',r,'row_key',p_row_key,'snapshot_hash',hash),
      auth.uid()
    );
  else
    select organization_id,store_name into org,store_name
    from public.receipt_upload_batches where id=p_batch_id;
  end if;

  progress:=private.receipt_review_progress(r);

  -- 百花猿專屬：儲存修改不等於正式建檔。
  -- 行政可先修改、刪除、補新增明細，最後才由 complete_baihuayuan_receipt 一次完成。
  if store_name in ('BeApe','Gras') then
    return progress||jsonb_build_object('saved',true,'receipt_id',null,'publication_issue',null);
  end if;

  if (progress->>'complete')::boolean then
    begin
      receipt:=private.publish_receipt(p_batch_id,auth.uid(),false);
    exception when raise_exception then
      if sqlerrm in (
        'PRODUCT_MAPPING_REQUIRED','COMPANY_PRODUCT_MAPPING_REQUIRED','RECEIPT_FIELDS_REQUIRE_REVIEW',
        'UNIT_MAPPING_CONFLICT','QUANTITY_AND_UNIT_REQUIRED','SUPPLIER_AND_DATE_REQUIRED',
        'RECEIPT_TOTAL_CONFLICT','LINE_TOTAL_CONFLICT','DUPLICATE_RECEIPT_NUMBER'
      ) then issue:=sqlerrm;
      else raise;
      end if;
    end;

    if receipt is null and issue is distinct from 'DUPLICATE_RECEIPT_NUMBER' then
      receipt:=private.confirm_receipt_details(p_batch_id,auth.uid(),issue);
    end if;
  end if;

  return progress||jsonb_build_object('saved',true,'receipt_id',receipt,'publication_issue',issue);
end;
$$;
