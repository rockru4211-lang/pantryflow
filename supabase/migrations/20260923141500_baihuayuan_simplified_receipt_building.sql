
create table if not exists private.receipt_manual_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.receipt_upload_batches(id) on delete cascade,
  run_id uuid not null references public.receipt_ocr_runs(id) on delete cascade,
  supplier_name text not null default '',
  product_name text not null,
  specification text not null default '',
  unit text not null,
  quantity numeric not null check (quantity > 0 and quantity < 1000000000),
  unit_price_ex_tax numeric check (unit_price_ex_tax is null or unit_price_ex_tax >= 0),
  line_subtotal_ex_tax numeric check (line_subtotal_ex_tax is null or line_subtotal_ex_tax >= 0),
  note text not null default '',
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists receipt_manual_rows_batch_run
  on private.receipt_manual_rows(batch_id,run_id,created_at,id);

create or replace function private.baihuayuan_resolve_receipt_product(
  p_organization uuid,
  p_store uuid,
  p_name text,
  p_specification text,
  p_unit text
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_product uuid;
  v_name text:=btrim(coalesce(p_name,''));
  v_spec text:=btrim(coalesce(p_specification,''));
  v_unit text:=btrim(coalesce(p_unit,''));
begin
  if not exists(
    select 1 from public.stores
    where id=p_store and organization_id=p_organization and is_active and name in ('BeApe','Gras')
  ) then
    raise exception 'BAIHUAYUAN_STORE_REQUIRED' using errcode='42501';
  end if;

  if v_name='' or v_unit='' then
    raise exception 'PRODUCT_NAME_AND_UNIT_REQUIRED' using errcode='22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_organization::text||lower(v_name)||lower(v_spec)||lower(v_unit),0)
  );

  select p.id into v_product
  from public.products p
  where p.organization_id=p_organization
    and p.is_active
    and lower(btrim(p.name))=lower(v_name)
    and lower(btrim(coalesce(p.specification,'')))=lower(v_spec)
    and lower(btrim(coalesce(p.base_unit,'')))=lower(v_unit)
  order by p.created_at,p.id
  limit 1;

  if v_product is null then
    insert into public.products(
      organization_id,product_code,name,specification,base_unit,count_unit,category
    )
    values(
      p_organization,
      'BH-'||upper(left(replace(gen_random_uuid()::text,'-',''),8)),
      v_name,v_spec,v_unit,v_unit,'其他'
    )
    returning id into v_product;
  end if;

  return v_product;
end;
$$;

revoke all on function private.baihuayuan_resolve_receipt_product(uuid,uuid,text,text,text) from public,anon,authenticated;

create or replace function public.save_baihuayuan_manual_receipt_line(
  p_store_id uuid,
  p_batch_id uuid,
  p_run_id uuid,
  p_supplier_name text,
  p_product_name text,
  p_specification text,
  p_unit text,
  p_quantity numeric,
  p_unit_price numeric,
  p_note text,
  p_line_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_batch public.receipt_upload_batches;
  v_run uuid;
  v_row private.receipt_manual_rows;
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
  if v_batch.status='COMPLETED' then
    raise exception 'PUBLISHED_RECEIPT_IMMUTABLE' using errcode='22023';
  end if;

  select id into v_run
  from public.receipt_ocr_runs
  where batch_id=p_batch_id
  order by version desc
  limit 1;

  if v_run is null or v_run is distinct from p_run_id then
    raise exception 'OCR_VERSION_CHANGED';
  end if;

  if btrim(coalesce(p_product_name,''))='' or btrim(coalesce(p_unit,''))='' then
    raise exception 'PRODUCT_NAME_AND_UNIT_REQUIRED' using errcode='22023';
  end if;
  if p_quantity is null or p_quantity<=0 or p_quantity>=1000000000 then
    raise exception 'INVALID_QUANTITY' using errcode='22023';
  end if;
  if p_unit_price is not null and p_unit_price<0 then
    raise exception 'INVALID_PRICE' using errcode='22023';
  end if;

  if p_line_id is null then
    insert into private.receipt_manual_rows(
      batch_id,run_id,supplier_name,product_name,specification,unit,quantity,
      unit_price_ex_tax,line_subtotal_ex_tax,note,created_by
    )
    values(
      p_batch_id,p_run_id,btrim(coalesce(p_supplier_name,'')),btrim(p_product_name),
      btrim(coalesce(p_specification,'')),btrim(p_unit),p_quantity,p_unit_price,
      case when p_unit_price is null then null else p_quantity*p_unit_price end,
      btrim(coalesce(p_note,'')),auth.uid()
    )
    returning * into v_row;
  else
    update private.receipt_manual_rows
    set supplier_name=btrim(coalesce(p_supplier_name,'')),
        product_name=btrim(p_product_name),
        specification=btrim(coalesce(p_specification,'')),
        unit=btrim(p_unit),
        quantity=p_quantity,
        unit_price_ex_tax=p_unit_price,
        line_subtotal_ex_tax=case when p_unit_price is null then null else p_quantity*p_unit_price end,
        note=btrim(coalesce(p_note,'')),
        updated_at=now(),
        deleted_at=null
    where id=p_line_id and batch_id=p_batch_id and run_id=p_run_id
    returning * into v_row;

    if not found then raise exception 'MANUAL_RECEIPT_LINE_NOT_FOUND' using errcode='P0002'; end if;
  end if;

  insert into public.audit_logs(
    organization_id,entity_type,entity_id,action,new_value,user_id,store_id
  )
  values(
    v_batch.organization_id,'receipt_manual_line',v_row.id::text,
    case when p_line_id is null then 'RECEIPT_MANUAL_LINE_CREATED' else 'RECEIPT_MANUAL_LINE_UPDATED' end,
    to_jsonb(v_row),auth.uid(),p_store_id
  );

  return to_jsonb(v_row);
end;
$$;

create or replace function public.set_baihuayuan_manual_receipt_line_deleted(
  p_store_id uuid,
  p_batch_id uuid,
  p_line_id uuid,
  p_deleted boolean
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_batch public.receipt_upload_batches;
  v_row private.receipt_manual_rows;
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
  if v_batch.status='COMPLETED' then
    raise exception 'PUBLISHED_RECEIPT_IMMUTABLE' using errcode='22023';
  end if;

  update private.receipt_manual_rows
  set deleted_at=case when p_deleted then now() else null end,
      updated_at=now()
  where id=p_line_id and batch_id=p_batch_id
  returning * into v_row;

  if not found then raise exception 'MANUAL_RECEIPT_LINE_NOT_FOUND' using errcode='P0002'; end if;

  insert into public.audit_logs(
    organization_id,entity_type,entity_id,action,new_value,user_id,store_id
  )
  values(
    v_batch.organization_id,'receipt_manual_line',v_row.id::text,
    case when p_deleted then 'RECEIPT_MANUAL_LINE_DELETED' else 'RECEIPT_MANUAL_LINE_RESTORED' end,
    to_jsonb(v_row),auth.uid(),p_store_id
  );

  return to_jsonb(v_row);
end;
$$;

revoke all on function public.save_baihuayuan_manual_receipt_line(uuid,uuid,uuid,text,text,text,text,numeric,numeric,text,uuid) from public;
revoke all on function public.set_baihuayuan_manual_receipt_line_deleted(uuid,uuid,uuid,boolean) from public;
grant execute on function public.save_baihuayuan_manual_receipt_line(uuid,uuid,uuid,text,text,text,text,numeric,numeric,text,uuid) to authenticated;
grant execute on function public.set_baihuayuan_manual_receipt_line_deleted(uuid,uuid,uuid,boolean) to authenticated;

create or replace function private.publish_receipt(p_batch uuid, p_actor uuid, p_automatic boolean default false)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  b public.receipt_upload_batches;
  rid uuid;
  run_id uuid;
  header jsonb;
  item record;
  v jsonb;
  product public.products;
  supplier uuid;
  line_supplier uuid;
  chain boolean;
  baihuayuan boolean;
  n integer:=0;
  manual private.receipt_manual_rows;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_batch::text,0));
  select id into rid from public.goods_receipts where source_batch_id=p_batch;
  if found then return rid; end if;

  select * into strict b from public.receipt_upload_batches where id=p_batch;
  select business_type='CHAIN_RESTAURANT' into chain from public.organizations where id=b.organization_id;
  baihuayuan:=b.store_name in ('BeApe','Gras');

  if p_automatic and not chain then raise exception 'MANUAL_REVIEW_REQUIRED'; end if;

  select id into run_id
  from public.receipt_ocr_runs
  where batch_id=b.id and status='SUCCEEDED'
  order by version desc
  limit 1;
  if run_id is null then raise exception 'OCR_NOT_READY'; end if;

  if exists(
    select 1
    from private.receipt_effective_fields(run_id) f
    where not f.corrected
      and f.review_status<>'TRUSTED'
      and (f.row_key='document' or private.baihuayuan_receipt_line_included(b.id,run_id,f.row_key))
      and (not chain or f.field_name in ('supplier_name','receipt_date','document_number','product','specification','unit','quantity'))
      and (f.value not in ('null'::jsonb,'""'::jsonb) or f.field_name in ('supplier_name','receipt_date','product','unit','quantity'))
  ) then
    raise exception 'RECEIPT_FIELDS_REQUIRE_REVIEW';
  end if;

  select jsonb_object_agg(field_name,value) into header
  from private.receipt_effective_fields(run_id)
  where row_key='document';

  if nullif(btrim(header->>'supplier_name'),'') is null or nullif(header->>'receipt_date','') is null then
    raise exception 'SUPPLIER_AND_DATE_REQUIRED';
  end if;

  if not chain
     and header->>'subtotal_ex_tax' is not null
     and header->>'tax' is not null
     and header->>'total_inc_tax' is not null
     and abs((header->>'subtotal_ex_tax')::numeric+(header->>'tax')::numeric-(header->>'total_inc_tax')::numeric)>1
  then raise exception 'RECEIPT_TOTAL_CONFLICT'; end if;

  perform pg_advisory_xact_lock(hashtextextended(b.organization_id::text||lower(btrim(header->>'supplier_name')),0));
  select id into supplier
  from public.suppliers
  where organization_id=b.organization_id
    and lower(btrim(name))=lower(btrim(header->>'supplier_name'))
    and is_active
  order by created_at
  limit 1;
  if supplier is null then
    insert into public.suppliers(organization_id,name)
    values(b.organization_id,btrim(header->>'supplier_name'))
    returning id into supplier;
  end if;

  if nullif(header->>'document_number','') is not null then
    perform pg_advisory_xact_lock(hashtextextended(b.store_id::text||supplier::text||(header->>'document_number'),0));
    if exists(
      select 1 from public.goods_receipts g
      where g.store_id=b.store_id
        and g.supplier_id=supplier
        and g.document_number=header->>'document_number'
        and g.receipt_date=(header->>'receipt_date')::date
    ) then raise exception 'DUPLICATE_RECEIPT_NUMBER'; end if;
  end if;

  insert into public.goods_receipts(
    organization_id,store_id,supplier_id,receipt_date,document_number,
    subtotal_ex_tax,tax,total_inc_tax,reviewed_by,reviewed_at,source_batch_id
  )
  values(
    b.organization_id,b.store_id,supplier,(header->>'receipt_date')::date,
    nullif(header->>'document_number',''),
    (header->>'subtotal_ex_tax')::numeric,(header->>'tax')::numeric,(header->>'total_inc_tax')::numeric,
    case when p_automatic then null else p_actor end,
    case when p_automatic then null else now() end,
    b.id
  )
  returning id into rid;

  for item in
    select row_key,jsonb_object_agg(field_name,value) as values
    from private.receipt_effective_fields(run_id)
    where row_key<>'document'
      and private.baihuayuan_receipt_line_included(b.id,run_id,row_key)
    group by row_key
    order by row_key
  loop
    v:=item.values;

    select p.* into product
    from public.receipt_product_mappings m
    join public.products p on p.id=m.product_id
    where m.batch_id=b.id
      and m.row_key=item.row_key
      and p.organization_id=b.organization_id
      and p.is_active;

    if not found and baihuayuan then
      select * into product
      from public.products
      where id=private.baihuayuan_resolve_receipt_product(
        b.organization_id,b.store_id,v->>'product',coalesce(v->>'specification',''),v->>'unit'
      );
    end if;

    if not found and not baihuayuan then raise exception 'PRODUCT_MAPPING_REQUIRED'; end if;
    if product.id is null then raise exception 'PRODUCT_MAPPING_REQUIRED'; end if;

    if nullif(v->>'unit','') is null or v->>'quantity' is null or (v->>'quantity')::numeric<=0 then
      raise exception 'QUANTITY_AND_UNIT_REQUIRED';
    end if;
    if not baihuayuan and (v->>'unit') is distinct from product.base_unit then
      raise exception 'UNIT_MAPPING_CONFLICT';
    end if;
    if not chain
       and v->>'unit_price_ex_tax' is not null
       and v->>'subtotal_ex_tax' is not null
       and abs((v->>'quantity')::numeric*(v->>'unit_price_ex_tax')::numeric-(v->>'subtotal_ex_tax')::numeric)>greatest(1,abs((v->>'subtotal_ex_tax')::numeric)*0.01)
    then raise exception 'LINE_TOTAL_CONFLICT'; end if;

    insert into public.receipt_lines(
      organization_id,receipt_id,product_id,supplier_id,quantity,unit,
      unit_price_ex_tax,line_subtotal_ex_tax,specification,ai_original,human_correction,
      modified_by,modified_at,source_row_key
    )
    values(
      b.organization_id,rid,product.id,supplier,(v->>'quantity')::numeric,v->>'unit',
      (v->>'unit_price_ex_tax')::numeric,
      coalesce((v->>'subtotal_ex_tax')::numeric,
               case when v->>'unit_price_ex_tax' is null then null else (v->>'quantity')::numeric*(v->>'unit_price_ex_tax')::numeric end),
      coalesce(v->>'specification',''),
      (select jsonb_object_agg(field_name,raw_value) from private.receipt_effective_fields(run_id) where row_key=item.row_key),
      (select jsonb_object_agg(field_name,value) from private.receipt_effective_fields(run_id) where row_key=item.row_key and corrected),
      case when p_automatic then null else p_actor end,
      case when p_automatic then null else now() end,
      item.row_key
    );
    n:=n+1;
  end loop;

  if baihuayuan then
    for manual in
      select *
      from private.receipt_manual_rows
      where batch_id=b.id and run_id=run_id and deleted_at is null
      order by created_at,id
    loop
      select id into line_supplier
      from public.suppliers
      where organization_id=b.organization_id
        and lower(btrim(name))=lower(btrim(coalesce(nullif(manual.supplier_name,''),header->>'supplier_name')))
        and is_active
      order by created_at
      limit 1;

      if line_supplier is null then
        insert into public.suppliers(organization_id,name)
        values(b.organization_id,btrim(coalesce(nullif(manual.supplier_name,''),header->>'supplier_name')))
        returning id into line_supplier;
      end if;

      select * into product
      from public.products
      where id=private.baihuayuan_resolve_receipt_product(
        b.organization_id,b.store_id,manual.product_name,manual.specification,manual.unit
      );

      insert into public.receipt_lines(
        organization_id,receipt_id,product_id,supplier_id,quantity,unit,
        unit_price_ex_tax,line_subtotal_ex_tax,specification,ai_original,human_correction,
        modified_by,modified_at,source_row_key
      )
      values(
        b.organization_id,rid,product.id,line_supplier,manual.quantity,manual.unit,
        manual.unit_price_ex_tax,manual.line_subtotal_ex_tax,manual.specification,
        null,
        jsonb_build_object(
          'manual_entry',true,'supplier_name',manual.supplier_name,'product_name',manual.product_name,
          'note',manual.note
        ),
        p_actor,now(),'manual-'||manual.id::text
      );
      n:=n+1;
    end loop;
  end if;

  if n=0 then raise exception 'OCR_NO_LINES'; end if;

  update public.receipt_upload_batches set status='COMPLETED' where id=b.id;
  insert into public.audit_logs(organization_id,entity_type,entity_id,action,new_value,user_id,store_id)
  values(
    b.organization_id,'goods_receipt',rid::text,
    case when p_automatic then 'RECEIPT_AUTO_PUBLISHED' else 'RECEIPT_REVIEW_PUBLISHED' end,
    jsonb_build_object('batch_id',b.id,'run_id',run_id,'lines',n,'store_id',b.store_id),
    p_actor,b.store_id
  );
  return rid;
end;
$$;

create or replace function public.complete_baihuayuan_receipt(
  p_store_id uuid,
  p_batch_id uuid,
  p_run_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_batch public.receipt_upload_batches;
  v_current_run uuid;
  v_included integer;
  v_receipt uuid;
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

  select count(distinct f.row_key) into v_included
  from public.receipt_ocr_fields f
  where f.ocr_run_id=p_run_id
    and f.row_key<>'document'
    and private.baihuayuan_receipt_line_included(p_batch_id,p_run_id,f.row_key);

  if v_included>0 and not coalesce((private.receipt_review_progress(p_run_id)->>'complete')::boolean,false) then
    raise exception 'RECEIPT_REVIEW_REQUIRED';
  end if;

  if v_included=0 and not exists(
    select 1 from private.receipt_manual_rows
    where batch_id=p_batch_id and run_id=p_run_id and deleted_at is null
  ) then
    raise exception 'OCR_NO_LINES';
  end if;

  v_receipt:=private.publish_receipt(p_batch_id,auth.uid(),false);

  return jsonb_build_object('receipt_id',v_receipt,'complete',true);
end;
$$;

revoke all on function public.complete_baihuayuan_receipt(uuid,uuid,uuid) from public;
grant execute on function public.complete_baihuayuan_receipt(uuid,uuid,uuid) to authenticated;

create or replace function public.get_pilot_receipt(p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  b public.receipt_upload_batches;
  v_run public.receipt_ocr_runs;
  full_access boolean;
begin
  if auth.uid() is null or not private.can_read_receipt(p_batch_id) then
    raise exception using errcode='42501',message='RECEIPT_ACCESS_DENIED';
  end if;

  select * into strict b from public.receipt_upload_batches where id=p_batch_id;
  select * into v_run from public.receipt_ocr_runs where batch_id=b.id order by version desc limit 1;
  full_access:=private.has_active_store_role(b.store_id,array['ADMIN','SUPERVISOR','LOGISTICS','OWNER']::public.app_role[]);

  return jsonb_build_object(
    'review',private.receipt_review_progress(v_run.id),
    'batch',(to_jsonb(b)-'upload_fingerprint')||jsonb_build_object('delivery',private.receipt_delivery_json(b.id)),
    'review_allowed',private.can_review_receipt(b.id),
    'full_access',full_access,
    'job',(select jsonb_build_object('status',j.status,'attempt_count',j.attempt_count) from public.receipt_ocr_jobs j where j.batch_id=b.id order by j.created_at desc limit 1),
    'erp_actor',(select display_name from public.profiles where id=b.erp_completed_by),
    'documents',(select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'name',d.original_filename,'path',d.storage_path,'mime_type',d.mime_type,'page_order',d.page_order) order by d.page_order),'[]'::jsonb) from public.receipt_documents d where d.batch_id=b.id),
    'run',case when v_run.id is null then null else jsonb_build_object('id',v_run.id,'version',v_run.version,'status',v_run.status,'model',v_run.model,'provider',v_run.provider,'started_at',v_run.started_at,'completed_at',v_run.completed_at,'error_code',v_run.error_code) end,
    'fields',(select coalesce(jsonb_agg(to_jsonb(f) order by coalesce((f.source_region->>'page')::integer,1),f.row_key,f.field_name),'[]'::jsonb) from private.receipt_effective_fields(v_run.id)f where full_access or f.field_name in ('supplier_name','document_number','receipt_date','product','specification','unit','quantity')),
    'line_states',(select coalesce(jsonb_agg(jsonb_build_object(
      'row_key',x.row_key,
      'included',private.baihuayuan_receipt_line_included(b.id,v_run.id,x.row_key),
      'source',case when exists(select 1 from private.receipt_line_decisions d where d.batch_id=b.id and d.run_id=v_run.id and d.row_key=x.row_key) then 'MANUAL' else 'AUTO' end,
      'decision',(select d.decision from private.receipt_line_decisions d where d.batch_id=b.id and d.run_id=v_run.id and d.row_key=x.row_key)
    ) order by x.row_key),'[]'::jsonb)
      from (select distinct f.row_key from public.receipt_ocr_fields f where f.ocr_run_id=v_run.id and f.row_key<>'document') x),
    'manual_lines',(select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at,m.id),'[]'::jsonb)
      from private.receipt_manual_rows m where m.batch_id=b.id and m.run_id=v_run.id),
    'mappings',(select coalesce(jsonb_agg(jsonb_build_object('row_key',m.row_key,'product_id',p.id,'name',p.name,'code',p.product_code,'unit',p.base_unit,'specification',p.specification)),'[]'::jsonb)
      from public.receipt_product_mappings m join public.products p on p.id=m.product_id where m.batch_id=b.id),
    'receipt',(select to_jsonb(g)-case when full_access then array[]::text[] else array['subtotal_ex_tax','tax','total_inc_tax'] end from public.goods_receipts g where g.source_batch_id=b.id)
  );
end;
$$;
