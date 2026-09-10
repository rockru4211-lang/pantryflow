-- Receipt confirmation uses the existing durable review snapshots. Inventory
-- publication keeps its existing mapping, unit and quantity checks.
create or replace function private.receipt_review_progress(p_run uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 with rows as (
  select distinct row_key from public.receipt_ocr_fields
  where ocr_run_id=p_run and row_key<>'document'
 ), saved as (
  select distinct on (r.row_key) r.row_key,s.saved_at,s.saved_by
  from rows r join private.receipt_review_saves s
   on s.ocr_run_id=p_run and s.row_key=r.row_key
   and s.snapshot_hash=private.receipt_review_hash(p_run,r.row_key)
  order by r.row_key,s.saved_at desc
 ), state as (
  select exists(select 1 from rows) and
   not exists(select 1 from rows r where not exists(select 1 from saved s where s.row_key=r.row_key)) as complete
 )
 select jsonb_build_object(
  'saved_rows',coalesce((select jsonb_agg(row_key order by row_key) from saved),'[]'::jsonb),
  'complete',state.complete,
  'confirmed_at',case when state.complete then (select max(saved_at) from saved) end,
  'confirmed_by',case when state.complete then (
   select p.display_name from saved s join public.profiles p on p.id=s.saved_by
   order by s.saved_at desc,s.row_key desc limit 1) end)
 from state
$$;
revoke all on function private.receipt_review_progress(uuid) from public,anon,authenticated;

-- Only extend the existing receipt bucket's format list. Keep its privacy,
-- maximum file size, storage policies and every existing object unchanged.
update storage.buckets set allowed_mime_types=array(
 select distinct mime from unnest(allowed_mime_types||array['image/heic','image/heif']) as mime
) where id='receipt-documents' and allowed_mime_types is not null;

CREATE OR REPLACE FUNCTION public.begin_pilot_receipt_upload(p_store_id uuid, p_fingerprint text, p_documents jsonb, p_group_mode text DEFAULT 'SAME_RECEIPT'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
   if not (d ?& array['sha256','mime_type','byte_size','name']) or nullif(d->>'name','') is null or d->>'sha256' is null or d->>'mime_type' is null or d->>'byte_size' is null or d->>'sha256' !~ '^[a-f0-9]{64}$' or d->>'mime_type' not in ('image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf') or (d->>'byte_size')::bigint not between 1 and 10485760 then raise exception 'INVALID_RECEIPT_FILE'; end if;
   insert into public.receipt_documents(organization_id,batch_id,storage_path,original_filename,page_order,mime_type,uploaded_by,content_sha256,byte_size)
   values(s.organization_id,b.id,s.organization_id::text||'/'||b.id::text||'/'||(d->>'sha256'),left(d->>'name',240),n,d->>'mime_type',auth.uid(),d->>'sha256',(d->>'byte_size')::bigint);
  end loop;
 end if;
 return jsonb_build_object('batch_id',b.id,'existing',existed,'status',b.status,'uploaded_by',b.uploaded_by,
 'documents',(select jsonb_agg(jsonb_build_object('id',x.id,'sha256',x.content_sha256,'storage_path',x.storage_path,'stored',exists(select 1 from storage.objects o where o.bucket_id='receipt-documents' and o.name=x.storage_path)) order by x.page_order) from public.receipt_documents x where x.batch_id=b.id));
end $function$;

notify pgrst,'reload schema';
