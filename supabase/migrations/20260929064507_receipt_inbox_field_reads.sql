-- Resolve each run's corrected fields once while retaining all existing role/store guards.
-- Latest field corrections are repeatedly consulted by review and inbox readers.
create index if not exists receipt_review_corrections_field_latest_idx
 on public.receipt_review_corrections (ocr_field_id, modified_at desc, id desc);

CREATE OR REPLACE FUNCTION public.get_baihuayuan_receipt_inbox(p_store_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_org uuid;
begin
  if auth.uid() is null or not private.has_active_store_role(
    p_store_id,
    array['ADMIN','SUPERVISOR','LOGISTICS','OWNER']::public.app_role[]
  ) then
    raise exception 'RECEIPT_REVIEWER_REQUIRED' using errcode='42501';
  end if;

  select organization_id into v_org
  from public.stores
  where id=p_store_id and is_active and name in ('BeApe','Gras');

  if v_org is null then
    raise exception 'BAIHUAYUAN_STORE_REQUIRED' using errcode='42501';
  end if;

  return coalesce((
    with batches as (
      select
        b.*,
        r.id run_id,
        r.status run_status,
        j.status job_status,
        j.last_error,
        j.attempt_count,j.available_at,
        coalesce((private.receipt_review_progress(r.id)->>'complete')::boolean,false) review_complete,
        (select count(*) from public.receipt_documents d where d.batch_id=b.id)::int page_count,
        (select count(*) from public.receipt_documents d
           where d.batch_id=b.id
             and exists(select 1 from storage.objects o where o.bucket_id='receipt-documents' and o.name=d.storage_path)
        )::int stored_page_count
      from public.receipt_upload_batches b
      left join lateral (
        select rr.id,rr.status
        from public.receipt_ocr_runs rr
        where rr.batch_id=b.id
        order by rr.version desc
        limit 1
      ) r on true
      left join lateral (
        select jj.status,jj.last_error,jj.attempt_count,jj.available_at
        from public.receipt_ocr_jobs jj
        where jj.batch_id=b.id
        order by jj.created_at desc
        limit 1
      ) j on true
      where b.store_id=p_store_id and not exists(select 1 from private.receipt_duplicate_links dl where dl.batch_id=b.id)
        and b.group_mode<>'ADMIN_DIRECT'
        and private.can_read_receipt(b.id)
    ),
    effective as materialized (
      select b.id batch_id,f.row_key,f.field_name,f.value
      from batches b
      cross join lateral private.receipt_effective_fields(b.run_id) f
      where b.run_id is not null
    ),
    receipt_rows as (
      select batch_id,row_key,
        max(case when field_name='supplier_name' then nullif(value#>>'{}','') end) supplier_name,
        max(case when field_name='receipt_date' then nullif(value#>>'{}','') end) receipt_date,
        bool_or(field_name='product' and nullif(value#>>'{}','') is not null) has_product,
        bool_or(field_name='unit' and nullif(value#>>'{}','') is not null) has_unit,
        bool_or(field_name='quantity' and nullif(value#>>'{}','') is not null) has_quantity
      from effective
      group by batch_id,row_key
    ),
    field_summary as (
      select batch_id,
        max(case when row_key='document' then supplier_name end) supplier_name,
        max(case when row_key='document' then receipt_date end) receipt_date,
        count(*) filter(where row_key<>'document')::int line_count,
        count(*) filter(where row_key<>'document' and has_product and has_unit and has_quantity)::int complete_line_count
      from receipt_rows group by batch_id
    )
    select jsonb_agg(
      jsonb_build_object(
        'batch_id',b.id,
        'batch_number',b.batch_number,
        'uploaded_at',b.uploaded_at,
        'work_date',b.work_date,
        'status',b.status::text,
        'page_count',b.page_count,
        'stored_page_count',b.stored_page_count,
        'job_status',b.job_status,
        'run_status',b.run_status,
        'attempt_count',coalesce(b.attempt_count,0),
        'last_error',b.last_error,
        'ocr_wait_reason',case when b.job_status='QUEUED' then (select pause_reason from private.receipt_ocr_dispatch where singleton and paused_until>now()) end,
        'retry_at',case when b.job_status='QUEUED' then greatest(b.available_at,(select greatest(paused_until,next_dispatch_at) from private.receipt_ocr_dispatch where singleton)) end,
        'raw_supplier_name',coalesce(fs.supplier_name,''),
        'supplier_id',private.supplier_identity(v_org,fs.supplier_name),
        'supplier_name',coalesce(private.supplier_display_name(v_org,fs.supplier_name),''),
        'receipt_date',coalesce(fs.receipt_date,b.work_date::text),
        'line_count',coalesce(fs.line_count,0),
        'complete_line_count',coalesce(fs.complete_line_count,0),
        'review_complete',b.review_complete,
        'has_goods_receipt',exists(select 1 from public.goods_receipts g where g.source_batch_id=b.id),
        'state',case
          when b.stored_page_count<b.page_count then 'FILE_MISSING'
          when b.job_status='FAILED' then 'OCR_FAILED'
          when b.job_status in ('QUEUED','RUNNING') then 'PROCESSING'
          when b.run_status='SUCCEEDED' and (
             coalesce(fs.supplier_name,'')=''
             or coalesce(fs.receipt_date,'')=''
             or coalesce(fs.line_count,0)=0
             or coalesce(fs.complete_line_count,0)<coalesce(fs.line_count,0)
          ) then 'NEEDS_REVIEW'
          when b.review_complete or b.status::text='COMPLETED' then 'COMPLETE'
          when b.run_status='SUCCEEDED' then 'NEEDS_REVIEW'
          else 'RECEIVED'
        end
      )
      order by b.uploaded_at desc
    )
    from batches b
    left join field_summary fs on fs.batch_id=b.id
  ),'[]'::jsonb);
end;
$function$

