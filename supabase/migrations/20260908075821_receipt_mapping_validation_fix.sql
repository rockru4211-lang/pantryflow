create or replace function public.map_pilot_receipt_product(p_batch_id uuid,p_row_key text,p_product_id uuid default null,p_create boolean default false)
returns uuid language plpgsql security definer set search_path='' as $$
declare b public.receipt_upload_batches; r uuid; v jsonb; product public.products; old_id uuid;
begin
 if auth.uid() is null or not private.can_review_receipt(p_batch_id) then raise exception using errcode='42501',message='RECEIPT_REVIEWER_REQUIRED'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_batch_id::text,0));
 select * into strict b from public.receipt_upload_batches where id=p_batch_id;
 if b.status='COMPLETED' then raise exception 'PUBLISHED_RECEIPT_IMMUTABLE'; end if;
 select id into r from public.receipt_ocr_runs where batch_id=b.id and status='SUCCEEDED' order by version desc limit 1;
 select jsonb_object_agg(field_name,value) into v from private.receipt_effective_fields(r) where row_key=p_row_key and row_key<>'document';
 if v is null then raise exception 'OCR_LINE_NOT_FOUND'; end if;
 if p_create then
  if exists(select 1 from public.organizations where id=b.organization_id and business_type='CHAIN_RESTAURANT') then raise exception 'COMPANY_PRODUCT_MAPPING_REQUIRED'; end if;
  if nullif(btrim(v->>'product'),'') is null or nullif(btrim(v->>'unit'),'') is null then raise exception 'PRODUCT_NAME_AND_UNIT_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(b.organization_id::text||lower(v->>'product')||coalesce(v->>'specification','')||(v->>'unit'),0));
  select * into product from public.products where organization_id=b.organization_id and lower(name)=lower(btrim(v->>'product')) and specification=coalesce(v->>'specification','') and base_unit=v->>'unit' and is_active limit 1;
  if not found then
   insert into public.products(organization_id,product_code,name,specification,base_unit,count_unit,category)
   values(b.organization_id,'RC-'||upper(left(gen_random_uuid()::text,8)),btrim(v->>'product'),coalesce(v->>'specification',''),v->>'unit',v->>'unit','其他') returning * into product;
  end if;
 else
  select * into product from public.products where id=p_product_id and organization_id=b.organization_id and is_active;
  if not found then raise exception 'PRODUCT_NOT_IN_ORGANIZATION'; end if;
 end if;
 select product_id into old_id from public.receipt_product_mappings where batch_id=b.id and row_key=p_row_key;
 insert into public.receipt_product_mappings(organization_id,batch_id,row_key,product_id,selected_by)
 values(b.organization_id,b.id,p_row_key,product.id,auth.uid()) on conflict(batch_id,row_key) do update set product_id=excluded.product_id,selected_by=excluded.selected_by,selected_at=now();
 insert into public.audit_logs(organization_id,entity_type,entity_id,action,old_value,new_value,user_id)
 values(b.organization_id,'receipt_product_mapping',b.id::text,'RECEIPT_PRODUCT_MAPPED',jsonb_build_object('row_key',p_row_key,'product_id',old_id),jsonb_build_object('row_key',p_row_key,'product_id',product.id),auth.uid());
 return product.id;
end $$;

create or replace function private.publish_receipt(p_batch uuid,p_actor uuid,p_automatic boolean default false)
returns uuid language plpgsql security definer set search_path='' as $$
declare b public.receipt_upload_batches; rid uuid; run_id uuid; header jsonb; item record; v jsonb; product public.products; supplier uuid; chain boolean; n integer:=0;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_batch::text,0));
 select id into rid from public.goods_receipts where source_batch_id=p_batch;
 if found then return rid; end if;
 select * into strict b from public.receipt_upload_batches where id=p_batch;
 select business_type='CHAIN_RESTAURANT' into chain from public.organizations where id=b.organization_id;
 if p_automatic and not chain then raise exception 'MANUAL_REVIEW_REQUIRED'; end if;
 select id into run_id from public.receipt_ocr_runs where batch_id=b.id and status='SUCCEEDED' order by version desc limit 1;
 if run_id is null then raise exception 'OCR_NOT_READY'; end if;
 -- Empty optional values remain null; any uncertain value actually used must be acknowledged.
 if exists(select 1 from private.receipt_effective_fields(run_id) f where not f.corrected and f.review_status<>'TRUSTED'
 and (not chain or f.field_name in ('supplier_name','receipt_date','document_number','product','specification','unit','quantity'))
 and (f.value not in ('null'::jsonb,'""'::jsonb) or f.field_name in ('supplier_name','receipt_date','product','unit','quantity'))) then raise exception 'RECEIPT_FIELDS_REQUIRE_REVIEW'; end if;
 select jsonb_object_agg(field_name,value) into header from private.receipt_effective_fields(run_id) where row_key='document';
 if nullif(btrim(header->>'supplier_name'),'') is null or nullif(header->>'receipt_date','') is null then raise exception 'SUPPLIER_AND_DATE_REQUIRED'; end if;
 if not chain and header->>'subtotal_ex_tax' is not null and header->>'tax' is not null and header->>'total_inc_tax' is not null
 and abs((header->>'subtotal_ex_tax')::numeric+(header->>'tax')::numeric-(header->>'total_inc_tax')::numeric)>1 then raise exception 'RECEIPT_TOTAL_CONFLICT'; end if;
 perform pg_advisory_xact_lock(hashtextextended(b.organization_id::text||lower(btrim(header->>'supplier_name')),0));
 select id into supplier from public.suppliers where organization_id=b.organization_id and lower(btrim(name))=lower(btrim(header->>'supplier_name')) and is_active order by created_at limit 1;
 if supplier is null then insert into public.suppliers(organization_id,name) values(b.organization_id,btrim(header->>'supplier_name')) returning id into supplier; end if;
 if nullif(header->>'document_number','') is not null then
  perform pg_advisory_xact_lock(hashtextextended(b.store_id::text||supplier::text||(header->>'document_number'),0));
  if exists(select 1 from public.goods_receipts g where g.store_id=b.store_id and g.supplier_id=supplier and g.document_number=header->>'document_number' and g.receipt_date=(header->>'receipt_date')::date) then raise exception 'DUPLICATE_RECEIPT_NUMBER'; end if;
 end if;
 insert into public.goods_receipts(organization_id,store_id,supplier_id,receipt_date,document_number,subtotal_ex_tax,tax,total_inc_tax,reviewed_by,reviewed_at,source_batch_id)
 values(b.organization_id,b.store_id,supplier,(header->>'receipt_date')::date,nullif(header->>'document_number',''),(header->>'subtotal_ex_tax')::numeric,(header->>'tax')::numeric,(header->>'total_inc_tax')::numeric,case when p_automatic then null else p_actor end,case when p_automatic then null else now() end,b.id) returning id into rid;
 for item in select row_key,jsonb_object_agg(field_name,value) as values from private.receipt_effective_fields(run_id) where row_key<>'document' group by row_key order by row_key loop
  n:=n+1; v:=item.values;
  select p.* into product from public.receipt_product_mappings m join public.products p on p.id=m.product_id where m.batch_id=b.id and m.row_key=item.row_key and p.organization_id=b.organization_id and p.is_active;
  if not found then raise exception 'PRODUCT_MAPPING_REQUIRED'; end if;
  if nullif(v->>'unit','') is null or v->>'quantity' is null or (v->>'quantity')::numeric<=0 then raise exception 'QUANTITY_AND_UNIT_REQUIRED'; end if;
  if (v->>'unit') is distinct from product.base_unit then raise exception 'UNIT_MAPPING_CONFLICT'; end if;
  if not chain and v->>'unit_price_ex_tax' is not null and v->>'subtotal_ex_tax' is not null and abs((v->>'quantity')::numeric*(v->>'unit_price_ex_tax')::numeric-(v->>'subtotal_ex_tax')::numeric)>greatest(1,abs((v->>'subtotal_ex_tax')::numeric)*0.01) then raise exception 'LINE_TOTAL_CONFLICT'; end if;
  insert into public.receipt_lines(organization_id,receipt_id,product_id,supplier_id,quantity,unit,unit_price_ex_tax,line_subtotal_ex_tax,specification,ai_original,human_correction,modified_by,modified_at)
  values(b.organization_id,rid,product.id,supplier,(v->>'quantity')::numeric,v->>'unit',(v->>'unit_price_ex_tax')::numeric,(v->>'subtotal_ex_tax')::numeric,coalesce(v->>'specification',''),
  (select jsonb_object_agg(field_name,raw_value) from private.receipt_effective_fields(run_id) where row_key=item.row_key),
  (select jsonb_object_agg(field_name,value) from private.receipt_effective_fields(run_id) where row_key=item.row_key and corrected),case when p_automatic then null else p_actor end,case when p_automatic then null else now() end);
 end loop;
 if n=0 then raise exception 'OCR_NO_LINES'; end if;
 update public.receipt_upload_batches set status='COMPLETED' where id=b.id;
 insert into public.audit_logs(organization_id,entity_type,entity_id,action,new_value,user_id) values(b.organization_id,'goods_receipt',rid::text,case when p_automatic then 'RECEIPT_AUTO_PUBLISHED' else 'RECEIPT_REVIEW_PUBLISHED' end,jsonb_build_object('batch_id',b.id,'run_id',run_id,'lines',n),p_actor);
 return rid;
end $$;
