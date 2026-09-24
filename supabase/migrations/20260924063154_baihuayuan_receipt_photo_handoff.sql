-- Photo-only field work. Original documents and completed OCR runs stay immutable.
create table private.receipt_photo_requests (
 id uuid primary key default gen_random_uuid(),
 batch_id uuid not null references public.receipt_upload_batches(id),
 document_id uuid not null references public.receipt_documents(id),
 reason text not null check(reason in ('BLUR','GLARE','CROPPED')),
 requested_by uuid references public.profiles(id),
 created_at timestamptz not null default now(),
 replacement_path text, replacement_hash text, replacement_name text,
 replacement_mime text, replacement_size bigint, prepared_by uuid references public.profiles(id),
 completed_at timestamptz
);
create unique index receipt_photo_request_open on private.receipt_photo_requests(document_id) where completed_at is null;
create index receipt_photo_request_batch on private.receipt_photo_requests(batch_id,created_at desc);
alter table private.receipt_photo_requests enable row level security;
revoke all on private.receipt_photo_requests from public,anon,authenticated;

create function private.receipt_ocr_sources(p_batch uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object(
  'id',d.id,'storage_path',coalesce(r.replacement_path,d.storage_path),
  'original_filename',coalesce(r.replacement_name,d.original_filename),
  'mime_type',coalesce(r.replacement_mime,d.mime_type),'page_order',d.page_order,
  'content_sha256',coalesce(r.replacement_hash,d.content_sha256),
  'byte_size',coalesce(r.replacement_size,d.byte_size)) order by d.page_order),'[]'::jsonb)
 from public.receipt_documents d left join lateral (
  select * from private.receipt_photo_requests x where x.document_id=d.id and x.completed_at is not null
  order by x.completed_at desc,x.id desc limit 1
 )r on true where d.batch_id=p_batch
$$;
revoke all on function private.receipt_ocr_sources(uuid) from public,anon,authenticated;
create function public.get_receipt_ocr_sources(p_batch uuid) returns jsonb
language sql security invoker set search_path='' as $$select private.receipt_ocr_sources(p_batch)$$;
revoke all on function public.get_receipt_ocr_sources(uuid) from public,anon,authenticated;
grant execute on function private.receipt_ocr_sources(uuid),public.get_receipt_ocr_sources(uuid) to service_role;

create function private.baihuayuan_receipt_photo(p_action text,p_store uuid,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.receipt_upload_batches; d public.receipt_documents; r private.receipt_photo_requests;
 v_id uuid; v_hash text; v_path text; v_job uuid;
begin
 if auth.uid() is null or not private.has_active_store_role(p_store,null)
 or not exists(select 1 from public.stores where id=p_store and is_active and name in ('BeApe','Gras')) then
  raise exception 'RECEIPT_ACCESS_DENIED' using errcode='42501';
 end if;
 if p_action='list' then
  return coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'batch_id',x.batch_id,
   'batch_number',lb.batch_number,'document_id',x.document_id,'page',ld.page_order,'reason',x.reason,
   'name',s->>'original_filename','path',s->>'storage_path','mime',s->>'mime_type',
   'created_at',x.created_at) order by x.created_at desc)
   from private.receipt_photo_requests x join public.receipt_upload_batches lb on lb.id=x.batch_id
   join public.receipt_documents ld on ld.id=x.document_id
   cross join lateral jsonb_array_elements(private.receipt_ocr_sources(lb.id)) s
   where lb.store_id=p_store and x.completed_at is null and s->>'id'=ld.id::text
   and private.can_read_receipt(lb.id)),'[]'::jsonb);
 end if;
 if p_action='request' then
  select * into strict d from public.receipt_documents where id=(p_data->>'document_id')::uuid;
  select * into strict b from public.receipt_upload_batches where id=d.batch_id;
 else
  select * into strict r from private.receipt_photo_requests where id=(p_data->>'request_id')::uuid;
  select * into strict b from public.receipt_upload_batches where id=r.batch_id;
 end if;
 if b.store_id<>p_store or not private.can_read_receipt(b.id) then raise exception 'RECEIPT_ACCESS_DENIED' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(b.id::text,0));
 if exists(select 1 from public.goods_receipts where source_batch_id=b.id) or b.status='COMPLETED' then raise exception 'PUBLISHED_RECEIPT_IMMUTABLE'; end if;
 if p_action='request' then
  if not private.can_review_receipt(b.id) then raise exception 'RECEIPT_REVIEWER_REQUIRED' using errcode='42501'; end if;
  if p_data->>'reason' is null or p_data->>'reason' not in ('BLUR','GLARE','CROPPED') then raise exception 'INVALID_PHOTO_REASON'; end if;
  insert into private.receipt_photo_requests(batch_id,document_id,reason,requested_by)
  values(b.id,d.id,p_data->>'reason',auth.uid()) on conflict(document_id) where completed_at is null do nothing;
  return jsonb_build_object('requested',true);
 end if;
 select * into strict r from private.receipt_photo_requests where id=r.id for update;
 if r.completed_at is not null then return jsonb_build_object('completed',true,'batch_id',b.id); end if;
 if p_action='prepare' then
  v_hash:=p_data->>'sha256';
  if v_hash is null or v_hash !~ '^[a-f0-9]{64}$' or coalesce(p_data->>'mime','') not in ('image/jpeg','image/png','image/webp','image/heic','application/pdf')
  or coalesce((p_data->>'size')::bigint,0) not between 1 and 10485760 or nullif(p_data->>'name','') is null then raise exception 'INVALID_RECEIPT_FILE'; end if;
  if exists(select 1 from jsonb_array_elements(private.receipt_ocr_sources(b.id)) s where s->>'content_sha256'=v_hash) then raise exception 'RETAKE_SAME_PHOTO'; end if;
  v_path:=b.organization_id::text||'/'||b.id::text||'/retake-'||r.id::text||'-'||v_hash;
  update private.receipt_photo_requests set replacement_path=v_path,replacement_hash=v_hash,
   replacement_name=left(p_data->>'name',240),replacement_mime=p_data->>'mime',replacement_size=(p_data->>'size')::bigint,prepared_by=auth.uid() where id=r.id;
  return jsonb_build_object('path',v_path,'stored',exists(select 1 from storage.objects where bucket_id='receipt-documents' and name=v_path));
 elsif p_action='complete' then
  if r.prepared_by is distinct from auth.uid() or r.replacement_path is null then raise exception 'RECEIPT_ACCESS_DENIED' using errcode='42501'; end if;
  if not exists(select 1 from storage.objects where bucket_id='receipt-documents' and name=r.replacement_path and (metadata->>'size')::bigint=r.replacement_size) then raise exception 'ORIGINAL_UPLOAD_INCOMPLETE'; end if;
  if exists(select 1 from public.receipt_ocr_jobs where batch_id=b.id and status in ('QUEUED','RUNNING')) then raise exception 'PHOTO_PROCESSING_BUSY'; end if;
  update private.receipt_photo_requests set completed_at=now() where id=r.id;
  insert into public.audit_logs(organization_id,store_id,entity_type,entity_id,action,new_value,user_id)
   values(b.organization_id,b.store_id,'receipt_upload_batch',b.id::text,'RECEIPT_PHOTO_RETAKEN',jsonb_build_object('request_id',r.id,'document_id',r.document_id),auth.uid());
  if not exists(select 1 from private.receipt_photo_requests where batch_id=b.id and completed_at is null) then
   -- OCR row identities may move after a clearer photo; retain previous choices in audit history.
   insert into public.audit_logs(organization_id,store_id,entity_type,entity_id,action,old_value,user_id)
    select b.organization_id,b.store_id,'receipt_upload_batch',b.id::text,'RECEIPT_RETAKE_RESET_MAPPINGS',coalesce(jsonb_agg(to_jsonb(m)),'[]'),auth.uid()
    from public.receipt_product_mappings m where m.batch_id=b.id;
   delete from public.receipt_product_mappings where batch_id=b.id;
   insert into public.receipt_ocr_jobs(organization_id,batch_id,requested_by) values(b.organization_id,b.id,auth.uid()) returning id into v_job;
   update public.receipt_upload_batches set status='PROCESSING' where id=b.id;
  end if;
  return jsonb_build_object('completed',true,'batch_id',b.id,'queued',v_job is not null);
 end if;
 raise exception 'INVALID_PHOTO_ACTION';
end $$;
revoke all on function private.baihuayuan_receipt_photo(text,uuid,jsonb) from public,anon;
grant execute on function private.baihuayuan_receipt_photo(text,uuid,jsonb) to authenticated;
create function public.baihuayuan_receipt_photo(p_action text,p_store uuid,p_data jsonb default '{}') returns jsonb
language sql security invoker set search_path='' as $$select private.baihuayuan_receipt_photo(p_action,p_store,p_data)$$;
revoke all on function public.baihuayuan_receipt_photo(text,uuid,jsonb) from public,anon;
grant execute on function public.baihuayuan_receipt_photo(text,uuid,jsonb) to authenticated;

create function private.can_access_receipt_retake(p_path text,p_write boolean) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from private.receipt_photo_requests r where r.replacement_path=p_path
 and private.can_read_receipt(r.batch_id) and (not p_write or (r.prepared_by=auth.uid() and r.completed_at is null)))
$$;
revoke all on function private.can_access_receipt_retake(text,boolean) from public,anon;
grant execute on function private.can_access_receipt_retake(text,boolean) to authenticated;
create policy receipt_retake_read on storage.objects for select to authenticated
 using(bucket_id='receipt-documents' and private.can_access_receipt_retake(name,false));
create policy receipt_retake_insert on storage.objects for insert to authenticated
 with check(bucket_id='receipt-documents' and private.can_access_receipt_retake(name,true));

-- Service-only, leased result. Only explicit physical image problems stop the job.
create function public.report_receipt_photo_issues(p_job uuid,p_lease uuid,p_run uuid,p_issues jsonb,p_raw jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare j public.receipt_ocr_jobs; b public.receipt_upload_batches; x jsonb;
begin
 select * into strict j from public.receipt_ocr_jobs where id=p_job for update;
 if j.status<>'RUNNING' or j.lease_token is distinct from p_lease
 or not exists(select 1 from public.receipt_ocr_runs where id=p_run and batch_id=j.batch_id and status='PROCESSING') then raise exception 'OCR_JOB_LEASE_LOST'; end if;
 select * into strict b from public.receipt_upload_batches where id=j.batch_id;
 if b.store_name not in ('BeApe','Gras') or jsonb_typeof(p_issues)<>'array' or jsonb_array_length(p_issues)=0 then return false; end if;
 perform pg_advisory_xact_lock(hashtextextended(b.id::text,0));
 for x in select value from jsonb_array_elements(p_issues) loop
  if x->>'reason' not in ('BLUR','GLARE','CROPPED') then raise exception 'INVALID_PHOTO_REASON'; end if;
  insert into private.receipt_photo_requests(batch_id,document_id,reason)
   select b.id,d.id,x->>'reason' from public.receipt_documents d where d.batch_id=b.id and d.page_order=(x->>'page')::integer
   on conflict(document_id) where completed_at is null do nothing;
 end loop;
 if not exists(select 1 from private.receipt_photo_requests where batch_id=b.id and completed_at is null) then return false; end if;
 update public.receipt_ocr_runs set status='FAILED',error_code='PHOTO_RETAKE_REQUIRED',error_message='Photo replacement requested',raw_response=p_raw,completed_at=now() where id=p_run;
 update public.receipt_ocr_jobs set status='FAILED',ocr_run_id=p_run,last_error='PHOTO_RETAKE_REQUIRED',completed_at=now(),lease_token=null where id=j.id;
 update public.receipt_upload_batches set status='READY_FOR_REVIEW' where id=b.id;
 return true;
end $$;
revoke all on function public.report_receipt_photo_issues(uuid,uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.report_receipt_photo_issues(uuid,uuid,uuid,jsonb,jsonb) to service_role;

-- Same-store file-set comparison is serialized across users and upload grouping modes.
create function private.begin_baihuayuan_receipt_upload(p_store_id uuid,p_fingerprint text,p_documents jsonb,p_group_mode text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_batch uuid; v_hashes text[];
begin
 if auth.uid() is null or not private.has_active_store_role(p_store_id,array['ADMIN','SUPERVISOR','STAFF']::public.app_role[])
 or not exists(select 1 from public.stores where id=p_store_id and name in ('BeApe','Gras') and is_active) then raise exception 'STORE_UPLOADER_REQUIRED' using errcode='42501'; end if;
 if p_documents is null or jsonb_typeof(p_documents)<>'array' or jsonb_array_length(p_documents) not between 1 and 10 then raise exception 'INVALID_UPLOAD_MANIFEST'; end if;
 select array_agg(value->>'sha256' order by value->>'sha256') into v_hashes from jsonb_array_elements(p_documents);
 perform pg_advisory_xact_lock(hashtextextended('receipt-upload:'||p_store_id::text,0));
 select b.id into v_batch from public.receipt_upload_batches b where b.store_id=p_store_id
 and v_hashes=(select array_agg(d.content_sha256 order by d.content_sha256) from public.receipt_documents d where d.batch_id=b.id)
 and not exists(select 1 from public.receipt_documents d where d.batch_id=b.id and not exists(select 1 from storage.objects o where o.bucket_id='receipt-documents' and o.name=d.storage_path))
 and exists(select 1 from public.receipt_ocr_jobs where batch_id=b.id)
 order by b.uploaded_at,b.id limit 1;
 if v_batch is not null then return jsonb_build_object('duplicate',true); end if;
 return public.begin_pilot_receipt_upload(p_store_id,p_fingerprint,p_documents,p_group_mode);
end $$;
revoke all on function private.begin_baihuayuan_receipt_upload(uuid,text,jsonb,text) from public,anon;
grant execute on function private.begin_baihuayuan_receipt_upload(uuid,text,jsonb,text) to authenticated;
create function public.begin_baihuayuan_receipt_upload(p_store_id uuid,p_fingerprint text,p_documents jsonb,p_group_mode text) returns jsonb
language sql security invoker set search_path='' as $$select private.begin_baihuayuan_receipt_upload(p_store_id,p_fingerprint,p_documents,p_group_mode)$$;
revoke all on function public.begin_baihuayuan_receipt_upload(uuid,text,jsonb,text) from public,anon;
grant execute on function public.begin_baihuayuan_receipt_upload(uuid,text,jsonb,text) to authenticated;

-- Additive guards protect even old clients: pending photos cannot be published/retried.
do $$declare src text; needle text;begin
 src:=pg_get_functiondef('private.publish_receipt(uuid,uuid,boolean)'::regprocedure);
 needle:='  select id into rid from public.goods_receipts where source_batch_id=p_batch;';
 if position(needle in src)=0 then raise exception 'PUBLISH_GUARD_ANCHOR_MISSING'; end if;
 src:=replace(src,needle,'  if exists(select 1 from private.receipt_photo_requests where batch_id=p_batch and completed_at is null) then raise exception ''PHOTO_RETAKE_REQUIRED''; end if;'||chr(10)||'  if exists(select 1 from private.receipt_photo_requests where batch_id=p_batch) and exists(select 1 from public.receipt_ocr_jobs where batch_id=p_batch and status in (''QUEUED'',''RUNNING'')) then raise exception ''OCR_NOT_READY''; end if;'||chr(10)||needle);execute src;
 src:=pg_get_functiondef('public.enqueue_receipt_ocr(uuid)'::regprocedure);
 needle:=' perform pg_advisory_xact_lock(hashtextextended(p_batch_id::text,0));';
 if position(needle in src)=0 then raise exception 'QUEUE_GUARD_ANCHOR_MISSING'; end if;
 src:=replace(src,needle,needle||chr(10)||' if exists(select 1 from private.receipt_photo_requests where batch_id=p_batch_id and completed_at is null) then raise exception ''PHOTO_RETAKE_REQUIRED''; end if;');execute src;
 -- Administrative source viewer displays current photos, while original documents stay intact.
 src:=pg_get_functiondef('public.get_pilot_receipt(uuid)'::regprocedure);
 needle:='''path'',d.storage_path,''mime_type'',d.mime_type';
 if position(needle in src)=0 then raise exception 'SOURCE_VIEW_ANCHOR_MISSING'; end if;
 src:=replace(src,needle,'''path'',coalesce((select s->>''storage_path'' from jsonb_array_elements(private.receipt_ocr_sources(b.id)) s where s->>''id''=d.id::text),d.storage_path),''mime_type'',coalesce((select s->>''mime_type'' from jsonb_array_elements(private.receipt_ocr_sources(b.id)) s where s->>''id''=d.id::text),d.mime_type)');execute src;
end $$;

-- Rephotographed duplicates: only trusted identity plus identical normalized content.
-- Changed/uncertain contents continue to the administrative review queue.
create table private.receipt_duplicate_links (
 batch_id uuid primary key references public.receipt_upload_batches(id),
 original_batch_id uuid not null references public.receipt_upload_batches(id),
 run_id uuid not null references public.receipt_ocr_runs(id),
 created_at timestamptz not null default now(),
 check(batch_id<>original_batch_id)
);
alter table private.receipt_duplicate_links enable row level security;
revoke all on private.receipt_duplicate_links from public,anon,authenticated;
create function private.receipt_extraction_signature(p_run uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_agg(jsonb_build_array(row_key,field_name,normalized_value) order by row_key,field_name)
 from public.receipt_ocr_fields where ocr_run_id=p_run
$$;
revoke all on function private.receipt_extraction_signature(uuid) from public,anon,authenticated;
create function private.link_duplicate_receipt_ocr() returns trigger
language plpgsql security definer set search_path='' as $$
declare b public.receipt_upload_batches; h jsonb; match_id uuid;
begin
 if new.status<>'SUCCEEDED' or old.status='SUCCEEDED' then return new; end if;
 select * into strict b from public.receipt_upload_batches where id=new.batch_id;
 if b.store_name not in ('BeApe','Gras') then return new; end if;
 select jsonb_object_agg(field_name,normalized_value) into h from public.receipt_ocr_fields
 where ocr_run_id=new.id and row_key='document' and field_name in ('supplier_name','receipt_date','document_number')
 and review_status='TRUSTED' and confidence>=0.88 and nullif(btrim(normalized_value#>>'{}'),'') is not null;
 if not coalesce(h ?& array['supplier_name','receipt_date','document_number'],false) then return new; end if;
 perform pg_advisory_xact_lock(hashtextextended('receipt-identity:'||b.store_id::text||h::text,0));
 select other.id into match_id from public.receipt_upload_batches other
 join lateral(select r.id from public.receipt_ocr_runs r where r.batch_id=other.id order by r.version desc limit 1) latest on true
 where other.store_id=b.store_id and other.id<>b.id
 and not exists(select 1 from private.receipt_duplicate_links where batch_id=other.id)
 and exists(select 1 from public.receipt_ocr_runs where id=latest.id and status='SUCCEEDED')
 and not exists(select 1 from private.receipt_photo_requests where batch_id=other.id and completed_at is null)
 and private.receipt_extraction_signature(latest.id)=private.receipt_extraction_signature(new.id)
 and 3=(select count(*) from public.receipt_ocr_fields f where f.ocr_run_id=latest.id and f.row_key='document'
  and f.field_name in ('supplier_name','receipt_date','document_number') and f.review_status='TRUSTED' and f.confidence>=0.88)
 order by other.uploaded_at,other.id limit 1;
 if match_id is not null then
  insert into private.receipt_duplicate_links(batch_id,original_batch_id,run_id) values(b.id,match_id,new.id) on conflict do nothing;
  insert into public.audit_logs(organization_id,store_id,entity_type,entity_id,action,new_value,user_id)
   values(b.organization_id,b.store_id,'receipt_upload_batch',b.id::text,'RECEIPT_DUPLICATE_SKIPPED',jsonb_build_object('original_batch_id',match_id,'run_id',new.id),b.uploaded_by);
 end if;
 return new;
end $$;
revoke all on function private.link_duplicate_receipt_ocr() from public,anon,authenticated;
create trigger receipt_ocr_duplicate_check after update of status on public.receipt_ocr_runs
 for each row execute function private.link_duplicate_receipt_ocr();

do $$declare src text; needle text; fn text;begin
 src:=pg_get_functiondef('private.publish_receipt(uuid,uuid,boolean)'::regprocedure);
 needle:='  select id into rid from public.goods_receipts where source_batch_id=p_batch;';
 if position(needle in src)=0 then raise exception 'DUPLICATE_GUARD_ANCHOR_MISSING'; end if;
 src:=replace(src,needle,'  if exists(select 1 from private.receipt_duplicate_links where batch_id=p_batch) then raise exception ''DUPLICATE_RECEIPT_NUMBER''; end if;'||chr(10)||needle);execute src;
 foreach fn in array array['public.get_pilot_receipts(uuid)','public.get_baihuayuan_receipt_inbox(uuid)','public.get_pilot_receipt_ledger(uuid)'] loop
  src:=pg_get_functiondef(fn::regprocedure);needle:='b.store_id=p_store_id';
  if position(needle in src)=0 then raise exception 'DUPLICATE_LIST_ANCHOR_MISSING %',fn; end if;
  src:=replace(src,needle,needle||' and not exists(select 1 from private.receipt_duplicate_links dl where dl.batch_id=b.id)');execute src;
 end loop;
end $$;
