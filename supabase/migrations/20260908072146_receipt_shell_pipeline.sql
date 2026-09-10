-- Connect the approved receiving shell to the existing receipt ledger.
-- Source documents, OCR fields, corrections and published lines remain append-only.
alter table public.receipt_upload_batches
  add column upload_fingerprint text,
  add column group_mode text not null default 'SAME_RECEIPT' check(group_mode in ('SAME_RECEIPT','SEPARATE_RECEIPTS')),
  add column erp_required boolean not null default false,
  add column erp_completed_by uuid references public.profiles(id),
  add column erp_completed_at timestamptz;
create unique index receipt_store_upload_fingerprint on public.receipt_upload_batches(store_id,upload_fingerprint) where upload_fingerprint is not null;
alter table public.receipt_documents add column content_sha256 text, add column byte_size bigint;
create unique index receipt_document_content_once on public.receipt_documents(batch_id,content_sha256) where content_sha256 is not null;
create unique index if not exists goods_receipts_batch_once on public.goods_receipts(source_batch_id);

create or replace function private.can_read_receipt(p_batch uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.receipt_upload_batches b where b.id=p_batch
 and private.has_active_store_role(b.store_id,null)
 and (b.uploaded_by=(select auth.uid()) or private.has_active_store_role(b.store_id,array['ADMIN','SUPERVISOR','LOGISTICS','OWNER']::public.app_role[])))
$$;
create or replace function private.can_review_receipt(p_batch uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.receipt_upload_batches b join public.organizations o on o.id=b.organization_id where b.id=p_batch
 and private.has_active_store_role(b.store_id,case when o.business_type='CHAIN_RESTAURANT'
 then array['ADMIN','SUPERVISOR']::public.app_role[] else array['ADMIN','LOGISTICS']::public.app_role[] end))
$$;
revoke all on function private.can_read_receipt(uuid),private.can_review_receipt(uuid) from public,anon;
grant execute on function private.can_read_receipt(uuid),private.can_review_receipt(uuid) to authenticated;

-- Replace old organization-wide receipt access with the current store memberships.
do $$ declare r record; begin
 for r in select schemaname,tablename,policyname from pg_policies where schemaname='public'
 and (tablename like 'receipt_%' or tablename='goods_receipts') loop
 execute format('drop policy %I on %I.%I',r.policyname,r.schemaname,r.tablename);
 end loop;
end $$;
create policy receipt_batches_read on public.receipt_upload_batches for select to authenticated using(private.can_read_receipt(id));
create policy receipt_documents_read on public.receipt_documents for select to authenticated using(private.can_read_receipt(batch_id));
create policy receipt_runs_read on public.receipt_ocr_runs for select to authenticated using(private.can_review_receipt(batch_id));
create policy receipt_fields_read on public.receipt_ocr_fields for select to authenticated using(private.can_review_receipt(batch_id));
create policy receipt_jobs_read on public.receipt_ocr_jobs for select to authenticated using(private.can_read_receipt(batch_id));
create policy receipt_corrections_read on public.receipt_review_corrections for select to authenticated using(private.can_review_receipt(batch_id));
create policy receipt_mappings_read on public.receipt_product_mappings for select to authenticated using(private.can_review_receipt(batch_id));
create policy goods_receipts_read on public.goods_receipts for select to authenticated using(private.can_read_receipt(source_batch_id));
create policy receipt_lines_read on public.receipt_lines for select to authenticated using(exists(select 1 from public.goods_receipts r where r.id=receipt_id and private.can_read_receipt(r.source_batch_id)));
create policy receipt_adjustments_read on public.receipt_adjustments for select to authenticated using(exists(select 1 from public.goods_receipts r where r.id=receipt_id and private.can_review_receipt(r.source_batch_id)));
revoke insert,update,delete on public.receipt_upload_batches,public.receipt_documents,public.receipt_ocr_runs,public.receipt_ocr_fields,public.receipt_ocr_jobs,public.receipt_review_corrections,public.receipt_product_mappings,public.goods_receipts,public.receipt_lines,public.receipt_adjustments from authenticated,anon;
revoke execute on function public.finalize_goods_receipt(uuid,uuid,date,text,numeric,numeric,numeric,jsonb) from public,anon,authenticated;

drop policy if exists receipt_storage_read on storage.objects;
drop policy if exists receipt_storage_select on storage.objects;
drop policy if exists receipt_storage_insert on storage.objects;
create policy receipt_source_read on storage.objects for select to authenticated
 using(bucket_id='receipt-documents' and exists(select 1 from public.receipt_documents d where d.storage_path=name and private.can_read_receipt(d.batch_id)));
create policy receipt_source_insert on storage.objects for insert to authenticated
 with check(bucket_id='receipt-documents' and exists(select 1 from public.receipt_documents d join public.receipt_upload_batches b on b.id=d.batch_id
 where d.storage_path=name and b.uploaded_by=(select auth.uid()) and private.has_active_store_role(b.store_id,array['ADMIN','SUPERVISOR','STAFF']::public.app_role[])));

create or replace function public.begin_pilot_receipt_upload(p_store_id uuid,p_fingerprint text,p_documents jsonb,p_group_mode text default 'SAME_RECEIPT')
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.stores; b public.receipt_upload_batches; d jsonb; n integer:=0; existed boolean:=false; v_erp boolean;
begin
 if auth.uid() is null or not private.has_active_store_role(p_store_id,array['ADMIN','SUPERVISOR','STAFF']::public.app_role[]) then raise exception using errcode='42501',message='STORE_UPLOADER_REQUIRED'; end if;
 if p_fingerprint is null or p_group_mode is null or p_documents is null or p_fingerprint !~ '^[a-f0-9]{64}$' or p_group_mode not in ('SAME_RECEIPT','SEPARATE_RECEIPTS') or jsonb_typeof(p_documents)<>'array' or jsonb_array_length(p_documents) not between 1 and 10 then raise exception 'INVALID_UPLOAD_MANIFEST'; end if;
 if p_fingerprint<>encode(extensions.digest(convert_to(p_group_mode||':'||(select string_agg(value->>'sha256',',' order by ord) from jsonb_array_elements(p_documents) with ordinality x(value,ord)),'UTF8'),'sha256'),'hex') then raise exception 'UPLOAD_FINGERPRINT_MISMATCH'; end if;
 select * into strict s from public.stores where id=p_store_id;
 perform pg_advisory_xact_lock(hashtextextended(p_store_id::text||p_fingerprint,0));
 select * into b from public.receipt_upload_batches where store_id=p_store_id and upload_fingerprint=p_fingerprint;
 if found then
  if not private.can_read_receipt(b.id) then raise exception 'DUPLICATE_UPLOAD_IN_STORE'; end if;
  existed:=true;
 else
  select business_type='CHAIN_RESTAURANT' into v_erp from public.organizations where id=s.organization_id;
  insert into public.receipt_upload_batches(organization_id,store_id,store_name,work_date,uploaded_by,batch_number,upload_fingerprint,group_mode,erp_required)
  values(s.organization_id,s.id,s.name,(now() at time zone 'Asia/Taipei')::date,auth.uid(),'RC-'||to_char(now(),'YYYYMMDDHH24MISS')||'-'||left(p_fingerprint,6),p_fingerprint,p_group_mode,coalesce(v_erp,false)) returning * into b;
  for d in select value from jsonb_array_elements(p_documents) loop
   n:=n+1;
   if not (d ?& array['sha256','mime_type','byte_size','name']) or nullif(d->>'name','') is null or d->>'sha256' is null or d->>'mime_type' is null or d->>'byte_size' is null or d->>'sha256' !~ '^[a-f0-9]{64}$' or d->>'mime_type' not in ('image/jpeg','image/png','image/webp','application/pdf') or (d->>'byte_size')::bigint not between 1 and 10485760 then raise exception 'INVALID_RECEIPT_FILE'; end if;
   insert into public.receipt_documents(organization_id,batch_id,storage_path,original_filename,page_order,mime_type,uploaded_by,content_sha256,byte_size)
   values(s.organization_id,b.id,s.organization_id::text||'/'||b.id::text||'/'||(d->>'sha256'),left(d->>'name',240),n,d->>'mime_type',auth.uid(),d->>'sha256',(d->>'byte_size')::bigint);
  end loop;
 end if;
 return jsonb_build_object('batch_id',b.id,'existing',existed,'status',b.status,'uploaded_by',b.uploaded_by,
 'documents',(select jsonb_agg(jsonb_build_object('id',x.id,'sha256',x.content_sha256,'storage_path',x.storage_path,'stored',exists(select 1 from storage.objects o where o.bucket_id='receipt-documents' and o.name=x.storage_path)) order by x.page_order) from public.receipt_documents x where x.batch_id=b.id));
end $$;
revoke all on function public.begin_pilot_receipt_upload(uuid,text,jsonb,text) from public,anon;
grant execute on function public.begin_pilot_receipt_upload(uuid,text,jsonb,text) to authenticated;

create or replace function public.enqueue_receipt_ocr(p_batch_id uuid)
returns public.receipt_ocr_jobs language plpgsql security definer set search_path='' as $$
declare b public.receipt_upload_batches; j public.receipt_ocr_jobs;
begin
 select * into b from public.receipt_upload_batches where id=p_batch_id;
 if auth.uid() is null or not private.can_read_receipt(p_batch_id) or not(b.uploaded_by=auth.uid() or private.can_review_receipt(p_batch_id)) then raise exception using errcode='42501',message='RECEIPT_ACCESS_DENIED'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_batch_id::text,0));
 if not exists(select 1 from public.receipt_documents where batch_id=b.id) or exists(select 1 from public.receipt_documents d where d.batch_id=b.id and not exists(select 1 from storage.objects o where o.bucket_id='receipt-documents' and o.name=d.storage_path and (o.metadata->>'size')::bigint=d.byte_size)) then raise exception 'ORIGINAL_UPLOAD_INCOMPLETE'; end if;
 select * into j from public.receipt_ocr_jobs where batch_id=b.id and status in ('QUEUED','RUNNING','SUCCEEDED') order by created_at desc limit 1;
 if found then return j; end if;
 if b.status='COMPLETED' then raise exception 'RECEIPT_ALREADY_PUBLISHED'; end if;
 insert into public.receipt_ocr_jobs(organization_id,batch_id,requested_by) values(b.organization_id,b.id,auth.uid()) returning * into j;
 update public.receipt_upload_batches set status='PROCESSING' where id=b.id;
 return j;
end $$;

create or replace function private.receipt_effective_fields(p_run uuid)
returns table(id uuid,row_key text,field_name text,raw_value jsonb,value jsonb,review_status text,confidence numeric,source_region jsonb,corrected boolean)
language sql stable security definer set search_path='' as $$
 select f.id,f.row_key,f.field_name,f.raw_value,case when c.id is not null then c.new_value else f.normalized_value end,f.review_status,f.confidence,f.source_region,c.id is not null
 from public.receipt_ocr_fields f left join lateral(select x.id,x.new_value from public.receipt_review_corrections x where x.ocr_field_id=f.id order by x.modified_at desc,x.id desc limit 1)c on true
 where f.ocr_run_id=p_run
$$;
revoke all on function private.receipt_effective_fields(uuid) from public,anon,authenticated;

create or replace function public.get_pilot_receipts(p_store_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not private.has_active_store_role(p_store_id,null) then raise exception using errcode='42501',message='STORE_MEMBERSHIP_REQUIRED'; end if;
 return coalesce((select jsonb_agg(row_data order by uploaded_at desc) from (
 select b.uploaded_at,jsonb_build_object('id',b.id,'batch_number',b.batch_number,'status',b.status,'uploaded_at',b.uploaded_at,'work_date',b.work_date,'erp_required',b.erp_required,'erp_completed_at',b.erp_completed_at,'erp_completed_by',p.display_name,
 'pages',(select count(*) from public.receipt_documents d where d.batch_id=b.id),'supplier',coalesce((select value#>>'{}' from private.receipt_effective_fields(r.id) where row_key='document' and field_name='supplier_name'),b.batch_number),
 'ocr_status',r.status,'review_allowed',private.can_review_receipt(b.id),'retry_allowed',b.uploaded_by=auth.uid() or private.can_review_receipt(b.id),'job_status',j.status) as row_data
 from public.receipt_upload_batches b left join public.profiles p on p.id=b.erp_completed_by
 left join lateral(select id,status from public.receipt_ocr_runs where batch_id=b.id order by version desc limit 1)r on true
 left join lateral(select status from public.receipt_ocr_jobs where batch_id=b.id order by created_at desc limit 1)j on true
 where b.store_id=p_store_id and private.can_read_receipt(b.id)
 )q),'[]'::jsonb);
end $$;

create or replace function public.get_pilot_receipt(p_batch_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.receipt_upload_batches; r public.receipt_ocr_runs; full_access boolean;
begin
 if auth.uid() is null or not private.can_read_receipt(p_batch_id) then raise exception using errcode='42501',message='RECEIPT_ACCESS_DENIED'; end if;
 select * into strict b from public.receipt_upload_batches where id=p_batch_id;
 select * into r from public.receipt_ocr_runs where batch_id=b.id order by version desc limit 1;
 full_access:=private.has_active_store_role(b.store_id,array['ADMIN','SUPERVISOR','LOGISTICS','OWNER']::public.app_role[]);
 return jsonb_build_object('batch',to_jsonb(b)-'upload_fingerprint','review_allowed',private.can_review_receipt(b.id),'full_access',full_access,
 'job',(select jsonb_build_object('status',j.status,'attempt_count',j.attempt_count) from public.receipt_ocr_jobs j where j.batch_id=b.id order by j.created_at desc limit 1),
 'erp_actor',(select display_name from public.profiles where id=b.erp_completed_by),
 'documents',(select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'name',d.original_filename,'path',d.storage_path,'mime_type',d.mime_type,'page_order',d.page_order) order by d.page_order),'[]'::jsonb) from public.receipt_documents d where d.batch_id=b.id),
 'run',case when r.id is null then null else jsonb_build_object('id',r.id,'version',r.version,'status',r.status,'model',r.model,'provider',r.provider,'started_at',r.started_at,'completed_at',r.completed_at,'error_code',r.error_code) end,
 'fields',(select coalesce(jsonb_agg(to_jsonb(f) order by coalesce((f.source_region->>'page')::integer,1),f.row_key,f.field_name),'[]'::jsonb) from private.receipt_effective_fields(r.id)f where full_access or f.field_name in ('supplier_name','document_number','receipt_date','product','specification','unit','quantity')),
 'mappings',(select coalesce(jsonb_agg(jsonb_build_object('row_key',m.row_key,'product_id',p.id,'name',p.name,'code',p.product_code,'unit',p.base_unit,'specification',p.specification)),'[]'::jsonb) from public.receipt_product_mappings m join public.products p on p.id=m.product_id where m.batch_id=b.id),
 'receipt',(select to_jsonb(g)-case when full_access then array[]::text[] else array['subtotal_ex_tax','tax','total_inc_tax'] end from public.goods_receipts g where g.source_batch_id=b.id));
end $$;
revoke all on function public.get_pilot_receipts(uuid),public.get_pilot_receipt(uuid) from public,anon;
grant execute on function public.get_pilot_receipts(uuid),public.get_pilot_receipt(uuid) to authenticated;

create or replace function public.correct_pilot_receipt_field(p_field_id uuid,p_value jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare f public.receipt_ocr_fields; v_old jsonb;
begin
 select * into strict f from public.receipt_ocr_fields where id=p_field_id;
 if auth.uid() is null or not private.can_review_receipt(f.batch_id) then raise exception using errcode='42501',message='RECEIPT_REVIEWER_REQUIRED'; end if;
 perform pg_advisory_xact_lock(hashtextextended(f.batch_id::text,0));
 if exists(select 1 from public.goods_receipts where source_batch_id=f.batch_id) then raise exception 'PUBLISHED_RECEIPT_IMMUTABLE'; end if;
 if f.ocr_run_id<>(select id from public.receipt_ocr_runs where batch_id=f.batch_id order by version desc limit 1) then raise exception 'OCR_VERSION_CHANGED'; end if;
 if f.field_name in ('quantity','unit_price_ex_tax','subtotal_ex_tax','tax','total_inc_tax') and jsonb_typeof(p_value) not in ('number','null') then raise exception 'NUMBER_REQUIRED'; end if;
 if f.field_name not in ('quantity','unit_price_ex_tax','subtotal_ex_tax','tax','total_inc_tax') and jsonb_typeof(p_value) not in ('string','null') then raise exception 'TEXT_REQUIRED'; end if;
 select value into v_old from private.receipt_effective_fields(f.ocr_run_id) where id=f.id;
 insert into public.receipt_review_corrections(organization_id,batch_id,ocr_field_id,old_value,new_value,modified_by)
 values(f.organization_id,f.batch_id,f.id,v_old,coalesce(p_value,'null'::jsonb),auth.uid());
end $$;

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
  perform pg_advisory_xact_lock(hashtextextended(b.organization_id::text||lower(v->>'product')||coalesce(v->>'specification','')||v->>'unit',0));
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
revoke all on function public.correct_pilot_receipt_field(uuid,jsonb),public.map_pilot_receipt_product(uuid,text,uuid,boolean) from public,anon;
grant execute on function public.correct_pilot_receipt_field(uuid,jsonb),public.map_pilot_receipt_product(uuid,text,uuid,boolean) to authenticated;

create or replace function public.complete_pilot_receipt_erp(p_batch_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.receipt_upload_batches;
begin
 select * into strict b from public.receipt_upload_batches where id=p_batch_id for update;
 if auth.uid() is null or not private.has_active_store_role(b.store_id,array['ADMIN','SUPERVISOR','STAFF']::public.app_role[]) or not b.erp_required then raise exception using errcode='42501',message='ERP_REPORT_NOT_ALLOWED'; end if;
 if not exists(select 1 from public.receipt_ocr_jobs where batch_id=b.id) then raise exception 'ORIGINAL_UPLOAD_INCOMPLETE'; end if;
 if b.erp_completed_at is null then
  update public.receipt_upload_batches set erp_completed_at=now(),erp_completed_by=auth.uid() where id=b.id returning * into b;
  insert into public.audit_logs(organization_id,entity_type,entity_id,action,new_value,user_id)
  values(b.organization_id,'receipt_upload_batch',b.id::text,'RECEIPT_ERP_REPORTED',jsonb_build_object('store_id',b.store_id,'completed_at',b.erp_completed_at),auth.uid());
 end if;
 return jsonb_build_object('completed_at',b.erp_completed_at,'completed_by',(select display_name from public.profiles where id=b.erp_completed_by));
end $$;
revoke all on function public.complete_pilot_receipt_erp(uuid) from public,anon;
grant execute on function public.complete_pilot_receipt_erp(uuid) to authenticated;

-- A review acknowledgement uses the same append-only correction history as edits.
create or replace function public.confirm_pilot_receipt_row(p_batch_id uuid,p_row_key text)
returns void language plpgsql security definer set search_path='' as $$
declare r uuid; f record;
begin
 if auth.uid() is null or not private.can_review_receipt(p_batch_id) then raise exception using errcode='42501',message='RECEIPT_REVIEWER_REQUIRED'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_batch_id::text,0));
 select id into r from public.receipt_ocr_runs where batch_id=p_batch_id and status='SUCCEEDED' order by version desc limit 1;
 for f in select * from private.receipt_effective_fields(r) where row_key in ('document',p_row_key) and not corrected and review_status<>'TRUSTED' loop
  perform public.correct_pilot_receipt_field(f.id,f.value);
 end loop;
end $$;
revoke all on function public.confirm_pilot_receipt_row(uuid,text) from public,anon;
grant execute on function public.confirm_pilot_receipt_row(uuid,text) to authenticated;

-- Only saved OCR values and product mappings can become a receipt. No client totals payload.
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
  if v->>'unit'<>product.base_unit then raise exception 'UNIT_MAPPING_CONFLICT'; end if;
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
revoke all on function private.publish_receipt(uuid,uuid,boolean) from public,anon,authenticated;
create or replace function public.publish_pilot_receipt(p_batch_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not private.can_review_receipt(p_batch_id) then raise exception using errcode='42501',message='RECEIPT_REVIEWER_REQUIRED'; end if;
 return private.publish_receipt(p_batch_id,auth.uid(),false);
end $$;
revoke all on function public.publish_pilot_receipt(uuid) from public,anon;
grant execute on function public.publish_pilot_receipt(uuid) to authenticated;

create or replace function public.commit_pilot_receipt_ocr(p_job uuid,p_lease uuid,p_run uuid,p_fields jsonb,p_raw jsonb,p_warning text default null)
returns void language plpgsql security definer set search_path='' as $$
declare j public.receipt_ocr_jobs; b public.receipt_upload_batches; item record; candidates uuid[];
begin
 select * into j from public.receipt_ocr_jobs where id=p_job for update;
 if j.status<>'RUNNING' or j.lease_token is distinct from p_lease or not exists(select 1 from public.receipt_ocr_runs where id=p_run and batch_id=j.batch_id and status='PROCESSING') then raise exception 'OCR_JOB_LEASE_LOST'; end if;
 select * into strict b from public.receipt_upload_batches where id=j.batch_id;
 if jsonb_array_length(p_fields)<12 then raise exception 'OCR_NO_LINES'; end if;
 insert into public.receipt_ocr_fields(organization_id,batch_id,document_id,ocr_run_id,row_key,field_name,raw_value,normalized_value,confidence,review_status,source_region,validation_notes)
 select b.organization_id,b.id,(f->>'document_id')::uuid,p_run,f->>'row_key',f->>'field_name',f->'raw_value',f->'normalized_value',(f->>'confidence')::numeric,f->>'review_status',f->'source_region',f->'validation_notes' from jsonb_array_elements(p_fields)f;
 update public.receipt_ocr_runs set status='SUCCEEDED',raw_response=p_raw,error_code=case when p_warning is not null then 'OCR_INCOMPLETE_OUTPUT' end,error_message=p_warning,completed_at=now() where id=p_run;
 update public.receipt_upload_batches set status='READY_FOR_REVIEW' where id=b.id;
 perform public.complete_receipt_ocr_job(j.id,p_lease,p_run);
 -- A match is automatic only when name, specification and original unit agree uniquely.
 for item in select row_key,jsonb_object_agg(field_name,value) as v from private.receipt_effective_fields(p_run) where row_key<>'document' group by row_key loop
  select array_agg(id) into candidates from public.products where organization_id=b.organization_id and is_active and lower(btrim(name))=lower(btrim(item.v->>'product')) and btrim(specification)=btrim(coalesce(item.v->>'specification','')) and base_unit=item.v->>'unit';
  if cardinality(candidates)=1 then
   insert into public.receipt_product_mappings(organization_id,batch_id,row_key,product_id,selected_by) values(b.organization_id,b.id,item.row_key,candidates[1],j.requested_by) on conflict(batch_id,row_key) do nothing;
  end if;
 end loop;
 if b.erp_required then
  begin perform private.publish_receipt(b.id,j.requested_by,true);
  exception when others then
   insert into public.audit_logs(organization_id,entity_type,entity_id,action,new_value,user_id) values(b.organization_id,'receipt_upload_batch',b.id::text,'RECEIPT_MANAGER_REVIEW_REQUIRED',jsonb_build_object('reason',sqlerrm),j.requested_by);
  end;
 end if;
end $$;
revoke all on function public.commit_pilot_receipt_ocr(uuid,uuid,uuid,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.commit_pilot_receipt_ocr(uuid,uuid,uuid,jsonb,jsonb,text) to service_role;

-- Abandoned leases are bounded by the same retry limit as returned failures.
create or replace function public.claim_receipt_ocr_jobs(p_limit integer default 2)
returns setof public.receipt_ocr_jobs language plpgsql security definer set search_path='' as $$
begin
 update public.receipt_ocr_jobs set status='FAILED',last_error='OCR_WORKER_TIMEOUT',completed_at=now(),lease_token=null,locked_at=null where status='RUNNING' and locked_at<now()-interval '5 minutes' and attempt_count>=max_attempts;
 return query with candidates as(select id from public.receipt_ocr_jobs where attempt_count<max_attempts and ((status='QUEUED' and available_at<=now()) or (status='RUNNING' and locked_at<now()-interval '5 minutes')) order by available_at,created_at for update skip locked limit least(greatest(p_limit,1),2))
 update public.receipt_ocr_jobs j set status='RUNNING',attempt_count=j.attempt_count+1,locked_at=now(),lease_token=gen_random_uuid(),started_at=coalesce(j.started_at,now()),completed_at=null from candidates c where j.id=c.id returning j.*;
end $$;
revoke all on function public.enqueue_receipt_ocr(uuid) from public,anon;
grant execute on function public.enqueue_receipt_ocr(uuid) to authenticated;
revoke all on function public.claim_receipt_ocr_jobs(integer),public.complete_receipt_ocr_job(uuid,uuid,uuid),public.fail_receipt_ocr_job(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.claim_receipt_ocr_jobs(integer),public.complete_receipt_ocr_job(uuid,uuid,uuid),public.fail_receipt_ocr_job(uuid,uuid,text) to service_role;

-- Durable wake-ups keep OCR moving after the uploader leaves the app.
create extension if not exists pg_net with schema extensions;
create or replace function public.configure_receipt_queue(p_url text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if p_url !~ '^https://[a-z]{20}\.supabase\.co/functions/v1/enqueue-receipt-ocr$' then raise exception 'INVALID_QUEUE_URL'; end if;
 perform pg_advisory_xact_lock(hashtextextended('receipt-queue-config',0));
 if not exists(select 1 from vault.secrets where name='receipt_queue_secret') then perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'receipt_queue_secret'); end if;
 if not exists(select 1 from vault.secrets where name='receipt_queue_url') then perform vault.create_secret(p_url,'receipt_queue_url'); end if;
end $$;
create or replace function public.verify_receipt_queue_secret(p_secret text)
returns boolean language sql stable security definer set search_path='' as $$
 select p_secret is not null and exists(select 1 from vault.decrypted_secrets where name='receipt_queue_secret' and extensions.digest(decrypted_secret,'sha256')=extensions.digest(p_secret,'sha256'))
$$;
revoke all on function public.configure_receipt_queue(text),public.verify_receipt_queue_secret(text) from public,anon,authenticated;
grant execute on function public.configure_receipt_queue(text),public.verify_receipt_queue_secret(text) to service_role;
create or replace function private.wake_receipt_ocr()
returns void language plpgsql security definer set search_path='' as $$
declare endpoint text; secret text;
begin
 if not exists(select 1 from public.receipt_ocr_jobs where (status='QUEUED' and available_at<=now()) or (status='RUNNING' and locked_at<now()-interval '5 minutes')) then return; end if;
 select decrypted_secret into endpoint from vault.decrypted_secrets where name='receipt_queue_url';
 select decrypted_secret into secret from vault.decrypted_secrets where name='receipt_queue_secret';
 if endpoint is null or secret is null then return; end if;
 perform net.http_post(url:=endpoint,headers:=jsonb_build_object('Content-Type','application/json','x-receipt-queue-secret',secret),body:='{"drain":true}'::jsonb,timeout_milliseconds:=5000);
end $$;
revoke all on function private.wake_receipt_ocr() from public,anon,authenticated;
select cron.schedule('receipt-ocr-wake','* * * * *','select private.wake_receipt_ocr()');
