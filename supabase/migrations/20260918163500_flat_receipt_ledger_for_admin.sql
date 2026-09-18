create or replace function public.get_pilot_receipt_ledger(p_store_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
begin
  if auth.uid() is null
     or not private.has_active_store_role(
       p_store_id,
       array['ADMIN','SUPERVISOR','LOGISTICS','OWNER']::public.app_role[]
     )
  then
    raise exception using errcode='42501',message='RECEIPT_REVIEWER_REQUIRED';
  end if;

  return coalesce((
    with batches as (
      select b.*,
             r.id run_id,
             r.status run_status,
             coalesce((private.receipt_review_progress(r.id)->>'complete')::boolean,false) review_complete
      from public.receipt_upload_batches b
      left join lateral (
        select rr.id,rr.status
        from public.receipt_ocr_runs rr
        where rr.batch_id=b.id
        order by rr.version desc
        limit 1
      ) r on true
      where b.store_id=p_store_id
        and private.can_read_receipt(b.id)
    ),
    document_fields as (
      select b.id batch_id,
             max(case when f.field_name='supplier_name' then f.value#>>'{}' end) supplier_name,
             max(case when f.field_name='receipt_date' then f.value#>>'{}' end) receipt_date
      from batches b
      left join lateral private.receipt_effective_fields(b.run_id) f
        on b.run_id is not null and f.row_key='document'
      group by b.id
    ),
    line_fields as (
      select b.id batch_id,
             f.row_key,
             max(case when f.field_name='product' then f.value#>>'{}' end) source_product,
             max(case when f.field_name='specification' then f.value#>>'{}' end) specification,
             max(case when f.field_name='unit' then f.value#>>'{}' end) unit,
             max(case when f.field_name='quantity' then f.value#>>'{}' end) quantity_text,
             max(case when f.field_name='unit_price_ex_tax' then f.value#>>'{}' end) unit_price_text
      from batches b
      join lateral private.receipt_effective_fields(b.run_id) f
        on b.run_id is not null
      where f.row_key<>'document'
      group by b.id,f.row_key
    )
    select jsonb_agg(
      jsonb_build_object(
        'batch_id',b.id,
        'row_key',l.row_key,
        'uploaded_at',b.uploaded_at,
        'receipt_date',coalesce(d.receipt_date,b.work_date::text),
        'supplier_name',coalesce(nullif(d.supplier_name,''),'未提供'),
        'product_code',p.product_code,
        'product_id',p.id,
        'product_name',coalesce(p.name,l.source_product,'未命名品項'),
        'source_product',coalesce(l.source_product,'未提供'),
        'specification',coalesce(nullif(l.specification,''),p.specification,'未提供'),
        'unit',coalesce(nullif(l.unit,''),p.count_unit,p.base_unit,'未提供'),
        'quantity',case when coalesce(l.quantity_text,'') ~ '^-?[0-9]+(\.[0-9]+)?$' then l.quantity_text::numeric else null end,
        'unit_price',case when coalesce(l.unit_price_text,'') ~ '^-?[0-9]+(\.[0-9]+)?$' then l.unit_price_text::numeric else null end,
        'subtotal',case
          when coalesce(l.quantity_text,'') ~ '^-?[0-9]+(\.[0-9]+)?$'
           and coalesce(l.unit_price_text,'') ~ '^-?[0-9]+(\.[0-9]+)?$'
          then l.quantity_text::numeric*l.unit_price_text::numeric
          else null
        end,
        'mapped',m.product_id is not null,
        'status',case
          when b.review_complete or b.status::text='COMPLETED' then 'COMPLETE'
          when m.product_id is null then 'NEEDS_MAPPING'
          else 'PENDING'
        end,
        'review_allowed',private.can_review_receipt(b.id)
      )
      order by coalesce(d.receipt_date,b.work_date::text) desc nulls last,b.uploaded_at desc,l.row_key
    )
    from batches b
    join line_fields l on l.batch_id=b.id
    left join document_fields d on d.batch_id=b.id
    left join public.receipt_product_mappings m on m.batch_id=b.id and m.row_key=l.row_key
    left join public.products p on p.id=m.product_id
  ),'[]'::jsonb);
end;
$$;

revoke all on function public.get_pilot_receipt_ledger(uuid) from public,anon;
grant execute on function public.get_pilot_receipt_ledger(uuid) to authenticated;
