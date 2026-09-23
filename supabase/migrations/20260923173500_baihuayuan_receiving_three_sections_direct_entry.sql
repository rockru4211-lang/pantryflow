
create or replace function public.create_baihuayuan_direct_receipt(
  p_store_id uuid,
  p_supplier_name text,
  p_receipt_date date,
  p_document_number text,
  p_lines jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_store public.stores;
  v_supplier uuid;
  v_batch uuid;
  v_receipt uuid;
  v_line jsonb;
  v_product uuid;
  v_qty numeric;
  v_price numeric;
  v_unit text;
  v_name text;
  v_spec text;
  v_subtotal numeric:=0;
  v_all_priced boolean:=true;
  v_index integer:=0;
begin
  if auth.uid() is null or not private.baihuayuan_can_confirm_backoffice(p_store_id) then
    raise exception 'RECEIPT_REVIEWER_REQUIRED' using errcode='42501';
  end if;

  select * into v_store
  from public.stores
  where id=p_store_id and is_active and name in ('BeApe','Gras');
  if not found then
    raise exception 'BAIHUAYUAN_STORE_REQUIRED' using errcode='42501';
  end if;

  if btrim(coalesce(p_supplier_name,''))='' or p_receipt_date is null then
    raise exception 'SUPPLIER_AND_DATE_REQUIRED' using errcode='22023';
  end if;
  if jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 then
    raise exception 'RECEIPT_LINES_REQUIRED' using errcode='22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_store.organization_id::text||lower(btrim(p_supplier_name)),0)
  );

  select id into v_supplier
  from public.suppliers
  where organization_id=v_store.organization_id
    and lower(btrim(name))=lower(btrim(p_supplier_name))
    and is_active
  order by created_at
  limit 1;

  if v_supplier is null then
    insert into public.suppliers(organization_id,name)
    values(v_store.organization_id,btrim(p_supplier_name))
    returning id into v_supplier;
  end if;

  if nullif(btrim(coalesce(p_document_number,'')),'') is not null
     and exists(
       select 1 from public.goods_receipts g
       where g.store_id=p_store_id
         and g.supplier_id=v_supplier
         and g.receipt_date=p_receipt_date
         and g.document_number=btrim(p_document_number)
     )
  then
    raise exception 'DUPLICATE_RECEIPT_NUMBER' using errcode='22023';
  end if;

  insert into public.receipt_upload_batches(
    organization_id,uploaded_by,status,batch_number,store_name,work_date,store_id,
    group_mode,erp_required,upload_completed_at
  )
  values(
    v_store.organization_id,auth.uid(),'COMPLETED'::public.receipt_batch_status,
    'AD-'||to_char(clock_timestamp() at time zone 'Asia/Taipei','YYYYMMDDHH24MISS')||'-'||left(replace(gen_random_uuid()::text,'-',''),6),
    v_store.name,p_receipt_date,p_store_id,'ADMIN_DIRECT',false,now()
  )
  returning id into v_batch;

  insert into public.goods_receipts(
    organization_id,store_id,supplier_id,receipt_date,document_number,
    subtotal_ex_tax,tax,total_inc_tax,reviewed_by,reviewed_at,source_batch_id
  )
  values(
    v_store.organization_id,p_store_id,v_supplier,p_receipt_date,
    nullif(btrim(coalesce(p_document_number,'')),''),
    null,null,null,auth.uid(),now(),v_batch
  )
  returning id into v_receipt;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    v_index:=v_index+1;
    v_name:=btrim(coalesce(v_line->>'product_name',''));
    v_spec:=btrim(coalesce(v_line->>'specification',''));
    v_unit:=btrim(coalesce(v_line->>'unit',''));
    v_qty:=nullif(v_line->>'quantity','')::numeric;
    v_price:=nullif(v_line->>'unit_price','')::numeric;

    if v_name='' or v_unit='' or v_qty is null or v_qty<=0 or v_qty>=1000000000 then
      raise exception 'RECEIPT_LINE_INVALID' using errcode='22023';
    end if;
    if v_price is not null and v_price<0 then
      raise exception 'INVALID_PRICE' using errcode='22023';
    end if;

    v_product:=private.baihuayuan_resolve_receipt_product(
      v_store.organization_id,p_store_id,v_name,v_spec,v_unit
    );

    insert into public.receipt_lines(
      organization_id,receipt_id,product_id,supplier_id,quantity,unit,
      unit_price_ex_tax,line_subtotal_ex_tax,specification,
      ai_original,human_correction,modified_by,modified_at,source_row_key
    )
    values(
      v_store.organization_id,v_receipt,v_product,v_supplier,v_qty,v_unit,
      v_price,case when v_price is null then null else v_qty*v_price end,v_spec,
      null,
      jsonb_build_object(
        'manual_entry',true,
        'source','ADMIN_DIRECT',
        'product_name',v_name,
        'note',nullif(btrim(coalesce(v_line->>'note','')),'')
      ),
      auth.uid(),now(),'admin-direct-'||v_index::text
    );

    if v_price is null then
      v_all_priced:=false;
    else
      v_subtotal:=v_subtotal+(v_qty*v_price);
    end if;
  end loop;

  update public.goods_receipts
  set subtotal_ex_tax=case when v_all_priced then v_subtotal else null end,
      total_inc_tax=case when v_all_priced then v_subtotal else null end
  where id=v_receipt;

  insert into public.audit_logs(
    organization_id,entity_type,entity_id,action,new_value,user_id,store_id
  )
  values(
    v_store.organization_id,'goods_receipt',v_receipt::text,'RECEIPT_ADMIN_DIRECT_CREATED',
    jsonb_build_object(
      'store_id',p_store_id,
      'batch_id',v_batch,
      'supplier_name',btrim(p_supplier_name),
      'receipt_date',p_receipt_date,
      'document_number',nullif(btrim(coalesce(p_document_number,'')),''),
      'line_count',jsonb_array_length(p_lines)
    ),
    auth.uid(),p_store_id
  );

  return jsonb_build_object(
    'receipt_id',v_receipt,
    'batch_id',v_batch,
    'line_count',jsonb_array_length(p_lines)
  );
end;
$$;

revoke all on function public.create_baihuayuan_direct_receipt(uuid,text,date,text,jsonb) from public;
grant execute on function public.create_baihuayuan_direct_receipt(uuid,text,date,text,jsonb) to authenticated;

create or replace function public.get_baihuayuan_receipt_inbox(p_store_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path=''
as $$
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
        j.attempt_count,
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
        select jj.status,jj.last_error,jj.attempt_count
        from public.receipt_ocr_jobs jj
        where jj.batch_id=b.id
        order by jj.created_at desc
        limit 1
      ) j on true
      where b.store_id=p_store_id
        and b.group_mode<>'ADMIN_DIRECT'
        and private.can_read_receipt(b.id)
    ),
    field_summary as (
      select
        b.id batch_id,
        max(case when f.row_key='document' and f.field_name='supplier_name' then nullif(f.value#>>'{}','') end) supplier_name,
        max(case when f.row_key='document' and f.field_name='receipt_date' then nullif(f.value#>>'{}','') end) receipt_date,
        count(distinct case when f.row_key<>'document' then f.row_key end)::int line_count,
        count(distinct case
          when f.row_key<>'document'
           and exists (
             select 1 from private.receipt_effective_fields(b.run_id) fx
             where fx.row_key=f.row_key and fx.field_name='product' and nullif(fx.value#>>'{}','') is not null
           )
           and exists (
             select 1 from private.receipt_effective_fields(b.run_id) fx
             where fx.row_key=f.row_key and fx.field_name='unit' and nullif(fx.value#>>'{}','') is not null
           )
           and exists (
             select 1 from private.receipt_effective_fields(b.run_id) fx
             where fx.row_key=f.row_key and fx.field_name='quantity' and nullif(fx.value#>>'{}','') is not null
           )
          then f.row_key end
        )::int complete_line_count
      from batches b
      left join lateral private.receipt_effective_fields(b.run_id) f
        on b.run_id is not null
      group by b.id
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
        'supplier_name',coalesce(fs.supplier_name,''),
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
$$;

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
        and b.group_mode<>'ADMIN_DIRECT'
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
        and private.baihuayuan_receipt_line_included(b.id,b.run_id,f.row_key)
      group by b.id,f.row_key
    ),
    ocr_rows as (
      select
        b.id batch_id,
        b.run_id,
        l.row_key,
        b.uploaded_at,
        coalesce(d.receipt_date,b.work_date::text) receipt_date,
        coalesce(nullif(d.supplier_name,''),'未提供') supplier_name,
        p.product_code,
        p.id product_id,
        coalesce(p.name,l.source_product,'未命名品項') product_name,
        coalesce(l.source_product,'未提供') source_product,
        coalesce(nullif(l.specification,''),p.specification,'未提供') specification,
        coalesce(nullif(l.unit,''),p.count_unit,p.base_unit,'未提供') unit,
        case when coalesce(l.quantity_text,'') ~ '^-?[0-9]+([.][0-9]+)?$' then l.quantity_text::numeric else null end quantity,
        case when coalesce(l.unit_price_text,'') ~ '^-?[0-9]+([.][0-9]+)?$' then l.unit_price_text::numeric else null end unit_price,
        case
          when coalesce(l.quantity_text,'') ~ '^-?[0-9]+([.][0-9]+)?$'
           and coalesce(l.unit_price_text,'') ~ '^-?[0-9]+([.][0-9]+)?$'
          then l.quantity_text::numeric*l.unit_price_text::numeric
          else null
        end subtotal,
        (m.product_id is not null) mapped,
        case
          when b.review_complete or b.status::text='COMPLETED' then 'COMPLETE'
          when m.product_id is null then 'NEEDS_MAPPING'
          else 'PENDING'
        end status,
        private.can_review_receipt(b.id) review_allowed,
        'OCR'::text source_kind
      from batches b
      join line_fields l on l.batch_id=b.id
      left join document_fields d on d.batch_id=b.id
      left join public.receipt_product_mappings m on m.batch_id=b.id and m.row_key=l.row_key
      left join public.products p on p.id=m.product_id
    ),
    manual_rows as (
      select
        b.id batch_id,
        null::uuid run_id,
        coalesce(l.source_row_key,'admin-direct-'||l.id::text) row_key,
        b.uploaded_at,
        g.receipt_date::text receipt_date,
        coalesce(s.name,'未提供') supplier_name,
        p.product_code,
        p.id product_id,
        p.name product_name,
        p.name source_product,
        coalesce(nullif(l.specification,''),p.specification,'未提供') specification,
        coalesce(nullif(l.unit,''),p.count_unit,p.base_unit,'未提供') unit,
        l.quantity,
        l.unit_price_ex_tax unit_price,
        l.line_subtotal_ex_tax subtotal,
        true mapped,
        'COMPLETE'::text status,
        true review_allowed,
        'MANUAL'::text source_kind
      from public.receipt_upload_batches b
      join public.goods_receipts g on g.source_batch_id=b.id and g.store_id=p_store_id
      join public.receipt_lines l on l.receipt_id=g.id
      left join public.suppliers s on s.id=g.supplier_id
      left join public.products p on p.id=l.product_id
      where b.store_id=p_store_id
        and b.group_mode='ADMIN_DIRECT'
        and private.can_read_receipt(b.id)
    ),
    all_rows as (
      select * from ocr_rows
      union all
      select * from manual_rows
    )
    select jsonb_agg(
      jsonb_build_object(
        'batch_id',batch_id,
        'run_id',run_id,
        'row_key',row_key,
        'uploaded_at',uploaded_at,
        'receipt_date',receipt_date,
        'supplier_name',supplier_name,
        'product_code',product_code,
        'product_id',product_id,
        'product_name',product_name,
        'source_product',source_product,
        'specification',specification,
        'unit',unit,
        'quantity',quantity,
        'unit_price',unit_price,
        'subtotal',subtotal,
        'mapped',mapped,
        'status',status,
        'review_allowed',review_allowed,
        'source_kind',source_kind
      )
      order by receipt_date desc nulls last,uploaded_at desc,row_key
    )
    from all_rows
  ),'[]'::jsonb);
end;
$$;
