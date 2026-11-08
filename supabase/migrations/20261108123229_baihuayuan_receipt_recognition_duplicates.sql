-- Identical files are rejected before upload. Different photos can only be
-- linked after recognition provides a trusted header and matching full lines.
create function private.receipt_duplicate_line_signature(p_run uuid)
returns jsonb language sql stable set search_path='' as $$
  with fields as (
    select row_key,jsonb_object_agg(field_name,value) as data
    from private.receipt_effective_fields(p_run)
    where row_key like 'line-%'
    group by row_key
  ), items as (
    select private.history_key(case when row_key ~ '^line-[0-9]{1,8}$'
      then regexp_replace(data->>'product','^'||substr(row_key,6)::integer||'\s+','')
      else data->>'product' end) as name,
      private.history_key(data->>'specification') as specification,
      private.recipe_unit(data->>'unit') as unit,
      private.recipe_factor(data->>'unit') as unit_factor,
      private.receipt_account_number(data->>'quantity') as quantity,
      private.receipt_account_number(data->>'unit_price_ex_tax') as price,
      private.receipt_account_number(data->>'subtotal_ex_tax') as subtotal
    from fields
  )
  select jsonb_agg(to_jsonb(items) order by name,specification,unit,unit_factor,quantity,price,subtotal)
  from items
  having count(*)>0 and bool_and(name<>'' and coalesce(unit,'')<>'' and
    coalesce(quantity>0,false) and price is not null and subtotal is not null)
$$;

create or replace function private.link_duplicate_receipt_ocr() returns trigger
language plpgsql security definer set search_path='' as $$
declare
  batch public.receipt_upload_batches;
  header jsonb;
  supplier_key text;
  document_key text;
  matched_date date;
  matched_total numeric;
  lines jsonb;
  original uuid;
begin
  if new.status<>'SUCCEEDED' or old.status='SUCCEEDED' or new.version<>1 then return new; end if;
  select * into strict batch from public.receipt_upload_batches where id=new.batch_id;
  if batch.store_name not in ('BeApe','Gras') or batch.group_mode='ADMIN_DIRECT'
    or private.receipt_duplicate_posted(batch.id)
    or exists(select 1 from private.receipt_account_edits where batch_id=batch.id)
    or exists(select 1 from private.receipt_photo_requests where batch_id=batch.id)
    or exists(select 1 from private.receipt_same_photo_entries where batch_id=batch.id or source_batch_id=batch.id)
    or exists(select 1 from private.receipt_duplicate_links where batch_id=batch.id or original_batch_id=batch.id)
    or exists(select 1 from private.baihuayuan_record_flags where organization_id=batch.organization_id
      and entity_type='RECEIPT_BATCH' and entity_id=batch.id and state<>'LIVE')
  then return new; end if;

  select jsonb_object_agg(field_name,normalized_value) into header
  from public.receipt_ocr_fields
  where ocr_run_id=new.id and row_key='document' and review_status='TRUSTED' and confidence>=0.88
    and field_name in ('supplier_name','receipt_date','document_number','total_inc_tax');
  supplier_key:=private.history_key(private.supplier_display_name(batch.organization_id,header->>'supplier_name'));
  document_key:=lower(btrim(header->>'document_number'));
  matched_date:=private.receipt_account_date(header->>'receipt_date');
  matched_total:=private.receipt_account_number(header->>'total_inc_tax');
  lines:=private.receipt_duplicate_line_signature(new.id);
  if supplier_key in ('','未提供') or coalesce(document_key,'')='' or matched_date is null
    or matched_total is null or lines is null then return new; end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'receipt-identity:'||batch.store_id||':'||matched_date||':'||document_key,0));
  select h.batch_id into original
  from private.receipt_duplicate_headers(batch.store_id,array(
    select candidate.id
    from public.receipt_upload_batches candidate
    where candidate.store_id=batch.store_id and candidate.id<>batch.id
      and (
        exists(select 1 from public.receipt_ocr_fields f where f.batch_id=candidate.id and f.row_key='document'
          and f.field_name='document_number' and lower(btrim(f.normalized_value#>>'{}'))=document_key)
        or exists(select 1 from private.receipt_account_edits e where e.batch_id=candidate.id
          and lower(btrim(e.header->>'document_number'))=document_key)
      )
  )) h
  join public.receipt_upload_batches other on other.id=h.batch_id
  join lateral(select r.id,r.status from public.receipt_ocr_runs r
    where r.batch_id=h.batch_id order by r.version desc limit 1) latest on latest.status='SUCCEEDED'
  where h.live and h.batch_id<>batch.id
    and other.group_mode<>'ADMIN_DIRECT' and h.hashes is not null
    and private.history_key(h.supplier_name)=supplier_key and h.receipt_date=matched_date
    and lower(btrim(h.document_number))=document_key and h.total=matched_total
    and not exists(select 1 from private.receipt_duplicate_links where batch_id=h.batch_id)
    and not exists(select 1 from private.receipt_same_photo_entries where batch_id=h.batch_id or source_batch_id=h.batch_id)
    and not exists(select 1 from private.receipt_manual_rows where batch_id=h.batch_id and deleted_at is null)
    and not exists(select 1 from private.receipt_line_decisions where batch_id=h.batch_id and run_id=latest.id)
    and not exists(select 1 from private.receipt_account_edits e cross join lateral jsonb_each(e.line_values) l
      where e.batch_id=h.batch_id and jsonb_strip_nulls(l.value) ?| array['product_name','specification','unit','quantity','unit_price','subtotal','discount'])
    and private.receipt_duplicate_line_signature(latest.id)=lines
  order by h.posted desc,h.uploaded_at,h.batch_id
  limit 1;

  if original is not null then
    insert into private.receipt_duplicate_links(batch_id,original_batch_id,run_id,reason)
    values(batch.id,original,new.id,'MATCHED_OCR') on conflict do nothing;
    if found then
      insert into public.audit_logs(organization_id,store_id,entity_type,entity_id,action,new_value,user_id)
      values(batch.organization_id,batch.store_id,'receipt_upload_batch',batch.id::text,'RECEIPT_DUPLICATE_SKIPPED',
        jsonb_build_object('original_batch_id',original,'run_id',new.id,'reason','MATCHED_OCR'),batch.uploaded_by);
    end if;
  end if;
  return new;
end $$;

revoke all on function private.receipt_duplicate_line_signature(uuid),private.link_duplicate_receipt_ocr()
from public,anon,authenticated;
create trigger receipt_ocr_duplicate_check after update of status on public.receipt_ocr_runs
for each row execute function private.link_duplicate_receipt_ocr();
