-- Explicit exceptional entry: shared original evidence, independent accounting.
create table private.receipt_same_photo_entries (
 batch_id uuid primary key references public.receipt_upload_batches(id),
 source_batch_id uuid not null references public.receipt_upload_batches(id),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now()
);
create index receipt_same_photo_source on private.receipt_same_photo_entries(source_batch_id);
alter table private.receipt_same_photo_entries enable row level security;
revoke all on private.receipt_same_photo_entries from public,anon,authenticated;

create function private.create_receipt_same_photo(p_store uuid,p_batch uuid,p_data jsonb,p_request uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.receipt_upload_batches; child uuid:=gen_random_uuid(); run uuid; doc uuid; source jsonb; sources jsonb; saved jsonb; result jsonb; cached private.app_requests; payload jsonb;
begin
 if auth.uid() is null or not private.has_active_store_role(p_store,array['LOGISTICS','OWNER']::public.app_role[]) then raise exception 'RECEIPT_REVIEWER_REQUIRED' using errcode='42501';end if;
 perform private.assert_store_editable(p_store);
 if p_request is null then raise exception 'INVALID_REQUEST';end if;
 select * into b from public.receipt_upload_batches where id=p_batch and store_id=p_store and store_name in ('BeApe','Gras');
 if not found then raise exception 'RECEIPT_ACCESS_DENIED' using errcode='42501';end if;
 if exists(select 1 from private.baihuayuan_record_flags where entity_type='RECEIPT_BATCH' and entity_id=b.id and state<>'LIVE') then raise exception 'RECEIPT_ACCOUNT_NOT_LIVE' using errcode='42501';end if;
 payload:=jsonb_build_object('batch_id',p_batch,'data',p_data);
 perform pg_advisory_xact_lock(hashtextextended(p_store::text||p_request::text,0));
 select * into cached from private.app_requests where store_id=p_store and request_id=p_request;
 if found then
  if cached.actor_id<>auth.uid() or cached.action<>'receipt.same_photo.create' or cached.payload<>payload then raise exception 'IDEMPOTENCY_CONFLICT' using errcode='40001';end if;
  return cached.result;
 end if;
 sources:=private.receipt_ocr_sources(p_batch);
 if jsonb_array_length(sources)=0 or exists(select 1 from jsonb_array_elements(sources) d where not exists(select 1 from storage.objects o where o.bucket_id='receipt-documents' and o.name=d->>'storage_path')) then raise exception 'ORIGINAL_UPLOAD_INCOMPLETE';end if;
 -- Save a dirty source draft in the same transaction. Any error leaves both untouched.
 if p_data is not null then
  if p_data ? 'removed_row_keys' then saved:=public.save_baihuayuan_receipt_entry(p_store,p_batch,p_data,gen_random_uuid());
  else saved:=public.save_baihuayuan_receipt_review(p_store,p_batch,p_data,gen_random_uuid());end if;
 end if;
 source:=private.receipt_account_rows(p_store,null,null,null,p_batch)->0;
 insert into public.receipt_upload_batches(id,organization_id,store_id,store_name,work_date,uploaded_by,status,batch_number,group_mode,upload_completed_at)
 values(child,b.organization_id,p_store,b.store_name,b.work_date,auth.uid(),'READY_FOR_REVIEW','RC-'||to_char(clock_timestamp(),'YYYYMMDDHH24MISS')||'-'||substr(child::text,1,8),'SAME_RECEIPT',now());
 insert into public.receipt_documents(organization_id,batch_id,storage_path,original_filename,page_order,mime_type,uploaded_by,content_sha256,byte_size)
 select b.organization_id,child,d->>'storage_path',d->>'original_filename',(d->>'page_order')::integer,d->>'mime_type',auth.uid(),d->>'content_sha256',(d->>'byte_size')::bigint from jsonb_array_elements(sources) d;
 select id into doc from public.receipt_documents where batch_id=child order by page_order limit 1;
 insert into public.receipt_ocr_runs(organization_id,batch_id,version,provider,model,prompt_version,status,started_by,completed_at)
 values(b.organization_id,child,1,'manual','same-photo-entry','manual-v1','SUCCEEDED',auth.uid(),now()) returning id into run;
 insert into public.receipt_ocr_fields(organization_id,batch_id,document_id,ocr_run_id,row_key,field_name,raw_value,normalized_value,confidence,review_status,validation_notes)
 select b.organization_id,child,doc,run,'document',name,'null'::jsonb,case when name='receipt_date' then coalesce(source->'receipt_date','null'::jsonb) else 'null'::jsonb end,0,'UNREADABLE','["MANUAL_ENTRY"]'::jsonb
 from unnest(array['supplier_name','document_number','receipt_date','subtotal_ex_tax','tax','total_inc_tax']) name;
 insert into private.receipt_manual_handoffs(batch_id,run_id,actor_id) values(child,run,auth.uid());
 insert into private.receipt_same_photo_entries(batch_id,source_batch_id,created_by) values(child,p_batch,auth.uid());
 insert into public.audit_logs(organization_id,entity_type,entity_id,action,new_value,user_id,attempt_id,store_id)
 values(b.organization_id,'receipt_batch',child::text,'receipt.same_photo.create',jsonb_build_object('source_batch_id',p_batch),auth.uid(),p_request,p_store);
 result:=jsonb_build_object('saved',true,'source_account',source,'account',private.receipt_account_rows(p_store,null,null,null,child)->0);
 insert into private.app_requests(store_id,request_id,actor_id,action,payload,result) values(p_store,p_request,auth.uid(),'receipt.same_photo.create',payload,result);
 return result;
end $$;
revoke all on function private.create_receipt_same_photo(uuid,uuid,jsonb,uuid) from public,anon,authenticated;
grant execute on function private.create_receipt_same_photo(uuid,uuid,jsonb,uuid) to authenticated;
create function public.create_receipt_same_photo(p_store_id uuid,p_batch_id uuid,p_data jsonb,p_request_id uuid)
returns jsonb language sql security invoker set search_path='' as $$select private.create_receipt_same_photo(p_store_id,p_batch_id,p_data,p_request_id)$$;
revoke all on function public.create_receipt_same_photo(uuid,uuid,jsonb,uuid) from public,anon;
grant execute on function public.create_receipt_same_photo(uuid,uuid,jsonb,uuid) to authenticated;
notify pgrst,'reload schema';
