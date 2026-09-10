-- PF-RECEIVING-CODING-OPTIONAL-20260908.
-- Save human work independently of publication; the existing publication and
-- inventory validation rules remain unchanged. No data or historical row rewrite.
create table private.receipt_review_saves (
 ocr_run_id uuid not null references public.receipt_ocr_runs(id),
 row_key text not null check(row_key<>'document'),
 snapshot_hash text not null,
 saved_by uuid not null references public.profiles(id),
 saved_at timestamptz not null default now(),
 primary key(ocr_run_id,row_key,snapshot_hash)
);
alter table private.receipt_review_saves enable row level security;
revoke all on private.receipt_review_saves from public,anon,authenticated;

create function private.receipt_review_hash(p_run uuid,p_row text)
returns text language sql stable security definer set search_path='' as $$
 select md5(coalesce(jsonb_agg(jsonb_build_object('id',id,'value',value,'corrected',corrected,'status',review_status) order by row_key,field_name)::text,''))
 from private.receipt_effective_fields(p_run) where row_key in ('document',p_row)
$$;
revoke all on function private.receipt_review_hash(uuid,text) from public,anon,authenticated;

create function private.receipt_review_progress(p_run uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 with rows as (select distinct row_key from public.receipt_ocr_fields where ocr_run_id=p_run and row_key<>'document'),
 saved as (select r.row_key from rows r where exists(
  select 1 from private.receipt_review_saves s where s.ocr_run_id=p_run and s.row_key=r.row_key
  and s.snapshot_hash=private.receipt_review_hash(p_run,r.row_key)))
 select jsonb_build_object('saved_rows',coalesce((select jsonb_agg(row_key order by row_key) from saved),'[]'::jsonb),
 'complete',exists(select 1 from rows) and not exists(select 1 from rows r where not exists(select 1 from saved s where s.row_key=r.row_key)))
$$;
revoke all on function private.receipt_review_progress(uuid) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.correct_pilot_receipt_field(p_field_id uuid, p_value jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
 if f.field_name in ('product','specification','unit') and v_old is distinct from coalesce(p_value,'null'::jsonb) then
  insert into public.audit_logs(organization_id,entity_type,entity_id,action,old_value,new_value,user_id)
  select f.organization_id,'receipt_product_mapping',f.batch_id::text,'RECEIPT_PRODUCT_MAPPING_INVALIDATED',
   jsonb_build_object('row_key',f.row_key,'product_id',m.product_id),jsonb_build_object('field',f.field_name),auth.uid()
  from public.receipt_product_mappings m where m.batch_id=f.batch_id and m.row_key=f.row_key;
  delete from public.receipt_product_mappings where batch_id=f.batch_id and row_key=f.row_key;
 end if;
end $function$;

CREATE OR REPLACE FUNCTION public.confirm_pilot_receipt_row(p_batch_id uuid, p_row_key text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r uuid; f record;
begin
 if auth.uid() is null or not private.can_review_receipt(p_batch_id) then raise exception using errcode='42501',message='RECEIPT_REVIEWER_REQUIRED'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_batch_id::text,0));
 select id into r from public.receipt_ocr_runs where batch_id=p_batch_id and status='SUCCEEDED' order by version desc limit 1;
 for f in select * from private.receipt_effective_fields(r) where row_key in ('document',p_row_key) and not corrected and review_status='REVIEW' and value is not null and value not in ('null'::jsonb,'""'::jsonb) loop
  perform public.correct_pilot_receipt_field(f.id,f.value);
 end loop;
end $function$;


create function public.save_pilot_receipt_review(p_batch_id uuid,p_row_key text,p_run_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r uuid; receipt uuid; hash text; progress jsonb; issue text; inserted integer; org uuid;
begin
 if auth.uid() is null or not private.can_review_receipt(p_batch_id) then
  raise exception using errcode='42501',message='RECEIPT_REVIEWER_REQUIRED';
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_batch_id::text,0));
 select id into r from public.receipt_ocr_runs where batch_id=p_batch_id order by version desc limit 1;
 if r is null or r is distinct from p_run_id then raise exception 'OCR_VERSION_CHANGED'; end if;
 if not exists(select 1 from public.receipt_ocr_runs where id=r and status='SUCCEEDED') then raise exception 'OCR_NOT_READY'; end if;
 if p_row_key='document' or not exists(select 1 from public.receipt_ocr_fields where ocr_run_id=r and row_key=p_row_key) then raise exception 'OCR_LINE_NOT_FOUND'; end if;
 select id into receipt from public.goods_receipts where source_batch_id=p_batch_id;
 if receipt is not null then return jsonb_build_object('receipt_id',receipt,'saved',true,'complete',true); end if;
 perform public.confirm_pilot_receipt_row(p_batch_id,p_row_key);
 hash:=private.receipt_review_hash(r,p_row_key);
 insert into private.receipt_review_saves(ocr_run_id,row_key,snapshot_hash,saved_by)
 values(r,p_row_key,hash,auth.uid()) on conflict do nothing;
 get diagnostics inserted=row_count;
 if inserted>0 then
  select organization_id into org from public.receipt_upload_batches where id=p_batch_id;
  insert into public.audit_logs(organization_id,entity_type,entity_id,action,new_value,user_id)
  values(org,'receipt_upload_batch',p_batch_id::text,'RECEIPT_REVIEW_SAVED',
   jsonb_build_object('run_id',r,'row_key',p_row_key,'snapshot_hash',hash),auth.uid());
 end if;
 progress:=private.receipt_review_progress(r);
 if (progress->>'complete')::boolean then
  -- A rejected publication rolls back only its subtransaction; original values
  -- and human work remain saved. Never bypass mapping/uncertainty/unit checks.
  begin
   receipt:=private.publish_receipt(p_batch_id,auth.uid(),false);
  exception when raise_exception then
   if sqlerrm in ('PRODUCT_MAPPING_REQUIRED','COMPANY_PRODUCT_MAPPING_REQUIRED','RECEIPT_FIELDS_REQUIRE_REVIEW',
    'UNIT_MAPPING_CONFLICT','QUANTITY_AND_UNIT_REQUIRED','SUPPLIER_AND_DATE_REQUIRED',
    'RECEIPT_TOTAL_CONFLICT','LINE_TOTAL_CONFLICT','DUPLICATE_RECEIPT_NUMBER') then issue:=sqlerrm;
   else raise; end if;
  end;
 end if;
 return progress||jsonb_build_object('saved',true,'receipt_id',receipt,'publication_issue',issue);
end $$;
revoke all on function public.save_pilot_receipt_review(uuid,text,uuid) from public,anon;
grant execute on function public.save_pilot_receipt_review(uuid,text,uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.get_pilot_receipts(p_store_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if auth.uid() is null or not private.has_active_store_role(p_store_id,null) then raise exception using errcode='42501',message='STORE_MEMBERSHIP_REQUIRED'; end if;
 return coalesce((select jsonb_agg(row_data order by uploaded_at desc) from (
 select b.uploaded_at,jsonb_build_object('id',b.id,'batch_number',b.batch_number,'status',b.status,'uploaded_at',b.uploaded_at,'work_date',b.work_date,'erp_required',b.erp_required,'erp_completed_at',b.erp_completed_at,'erp_completed_by',p.display_name,
 'pages',(select count(*) from public.receipt_documents d where d.batch_id=b.id),'supplier',coalesce((select value#>>'{}' from private.receipt_effective_fields(r.id) where row_key='document' and field_name='supplier_name'),b.batch_number),
 'review_saved',coalesce((private.receipt_review_progress(r.id)->>'complete')::boolean,false),'ocr_status',r.status,'review_allowed',private.can_review_receipt(b.id),'retry_allowed',b.uploaded_by=auth.uid() or private.can_review_receipt(b.id),'job_status',j.status) as row_data
 from public.receipt_upload_batches b left join public.profiles p on p.id=b.erp_completed_by
 left join lateral(select id,status from public.receipt_ocr_runs where batch_id=b.id order by version desc limit 1)r on true
 left join lateral(select status from public.receipt_ocr_jobs where batch_id=b.id order by created_at desc limit 1)j on true
 where b.store_id=p_store_id and private.can_read_receipt(b.id)
 )q),'[]'::jsonb);
end $function$;

CREATE OR REPLACE FUNCTION public.get_pilot_receipt(p_batch_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare b public.receipt_upload_batches; r public.receipt_ocr_runs; full_access boolean;
begin
 if auth.uid() is null or not private.can_read_receipt(p_batch_id) then raise exception using errcode='42501',message='RECEIPT_ACCESS_DENIED'; end if;
 select * into strict b from public.receipt_upload_batches where id=p_batch_id;
 select * into r from public.receipt_ocr_runs where batch_id=b.id order by version desc limit 1;
 full_access:=private.has_active_store_role(b.store_id,array['ADMIN','SUPERVISOR','LOGISTICS','OWNER']::public.app_role[]);
 return jsonb_build_object('review',private.receipt_review_progress(r.id),'batch',to_jsonb(b)-'upload_fingerprint','review_allowed',private.can_review_receipt(b.id),'full_access',full_access,
 'job',(select jsonb_build_object('status',j.status,'attempt_count',j.attempt_count) from public.receipt_ocr_jobs j where j.batch_id=b.id order by j.created_at desc limit 1),
 'erp_actor',(select display_name from public.profiles where id=b.erp_completed_by),
 'documents',(select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'name',d.original_filename,'path',d.storage_path,'mime_type',d.mime_type,'page_order',d.page_order) order by d.page_order),'[]'::jsonb) from public.receipt_documents d where d.batch_id=b.id),
 'run',case when r.id is null then null else jsonb_build_object('id',r.id,'version',r.version,'status',r.status,'model',r.model,'provider',r.provider,'started_at',r.started_at,'completed_at',r.completed_at,'error_code',r.error_code) end,
 'fields',(select coalesce(jsonb_agg(to_jsonb(f) order by coalesce((f.source_region->>'page')::integer,1),f.row_key,f.field_name),'[]'::jsonb) from private.receipt_effective_fields(r.id)f where full_access or f.field_name in ('supplier_name','document_number','receipt_date','product','specification','unit','quantity')),
 'mappings',(select coalesce(jsonb_agg(jsonb_build_object('row_key',m.row_key,'product_id',p.id,'name',p.name,'code',p.product_code,'unit',p.base_unit,'specification',p.specification)),'[]'::jsonb) from public.receipt_product_mappings m join public.products p on p.id=m.product_id where m.batch_id=b.id),
 'receipt',(select to_jsonb(g)-case when full_access then array[]::text[] else array['subtotal_ex_tax','tax','total_inc_tax'] end from public.goods_receipts g where g.source_batch_id=b.id));
end $function$;

notify pgrst,'reload schema';
