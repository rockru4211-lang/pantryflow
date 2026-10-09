-- Human takeover keeps the same batch, source images, and successful OCR evidence.
create table private.receipt_manual_handoffs (
 batch_id uuid primary key references public.receipt_upload_batches(id),
 run_id uuid not null references public.receipt_ocr_runs(id),
 actor_id uuid not null references auth.users(id),
 created_at timestamptz not null default now()
);
alter table private.receipt_manual_handoffs enable row level security;
revoke all on private.receipt_manual_handoffs from public,anon,authenticated;

create function public.begin_baihuayuan_receipt_manual_review(p_store_id uuid,p_batch_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare b public.receipt_upload_batches; r public.receipt_ocr_runs; doc uuid;
begin
 if auth.uid() is null or not private.can_review_receipt(p_batch_id) then raise exception 'RECEIPT_REVIEWER_REQUIRED' using errcode='42501';end if;
 perform private.assert_store_editable(p_store_id);
 select * into b from public.receipt_upload_batches where id=p_batch_id and store_id=p_store_id and store_name in ('BeApe','Gras');
 if not found then raise exception 'RECEIPT_ACCESS_DENIED' using errcode='42501';end if;
 if exists(select 1 from private.baihuayuan_record_flags where organization_id=b.organization_id and entity_type='RECEIPT_BATCH' and entity_id=b.id and state<>'LIVE') then raise exception 'RECEIPT_ACCOUNT_NOT_LIVE' using errcode='42501';end if;
 -- Dispatcher -> batch -> job. Commit owns the job row before writing its results.
 perform pg_advisory_xact_lock(hashtextextended('receipt-ocr-dispatch',0));
 perform pg_advisory_xact_lock(hashtextextended(p_batch_id::text,0));
 perform 1 from public.receipt_ocr_jobs where batch_id=p_batch_id order by id for update;
 select * into b from public.receipt_upload_batches where id=p_batch_id;
 select * into r from public.receipt_ocr_runs where batch_id=p_batch_id order by version desc limit 1;
 if exists(select 1 from private.receipt_manual_handoffs where batch_id=p_batch_id) or b.status='COMPLETED' then return r.id;end if;
 if not exists(select 1 from public.receipt_documents d join storage.objects o on o.bucket_id='receipt-documents' and o.name=d.storage_path and (o.metadata->>'size')::bigint=d.byte_size where d.batch_id=p_batch_id)
 then raise exception 'ORIGINAL_UPLOAD_INCOMPLETE';end if;
 update public.receipt_ocr_jobs set status='FAILED',last_error='MANUAL_REVIEW',completed_at=now(),locked_at=null,lease_token=null where batch_id=p_batch_id and status in ('QUEUED','RUNNING');
 if r.id is null or r.status<>'SUCCEEDED' then
  update public.receipt_ocr_runs set status='FAILED',error_code='MANUAL_REVIEW',error_message='Manual review started',completed_at=now() where batch_id=p_batch_id and status='PROCESSING';
  insert into public.receipt_ocr_runs(organization_id,batch_id,version,provider,model,prompt_version,status,started_by,completed_at)
  values(b.organization_id,b.id,coalesce(r.version,0)+1,'manual','manual-entry','manual-v1','SUCCEEDED',auth.uid(),now()) returning * into r;
  select id into doc from public.receipt_documents where batch_id=b.id order by page_order limit 1;
  insert into public.receipt_ocr_fields(organization_id,batch_id,document_id,ocr_run_id,row_key,field_name,raw_value,normalized_value,confidence,review_status,validation_notes)
  select b.organization_id,b.id,doc,r.id,'document',name,'null'::jsonb,'null'::jsonb,0,'UNREADABLE','["MANUAL_ENTRY"]'::jsonb
  from unnest(array['supplier_name','document_number','receipt_date','subtotal_ex_tax','tax','total_inc_tax']) name;
 end if;
 -- Keep partially legible named items visible even when quantity is unknown; honor prior deletions.
 insert into private.receipt_line_decisions(batch_id,run_id,row_key,decision,decided_by)
 select b.id,r.id,f.row_key,'INCLUDE',auth.uid() from private.receipt_effective_fields(r.id) f
 where f.row_key<>'document' and f.field_name='product' and nullif(btrim(f.value#>>'{}'),'') is not null
 on conflict do nothing;
 insert into private.receipt_manual_handoffs(batch_id,run_id,actor_id) values(b.id,r.id,auth.uid());
 update public.receipt_upload_batches set status='READY_FOR_REVIEW' where id=b.id;
 insert into public.audit_logs(organization_id,entity_type,entity_id,action,new_value,user_id)
 values(b.organization_id,'receipt_upload_batch',b.id::text,'RECEIPT_MANUAL_HANDOFF',jsonb_build_object('run_id',r.id),auth.uid());
 return r.id;
end $$;
revoke all on function public.begin_baihuayuan_receipt_manual_review(uuid,uuid) from public,anon;
grant execute on function public.begin_baihuayuan_receipt_manual_review(uuid,uuid) to authenticated;

-- Idempotent blank rows use the existing correction/audit system. Nulls are not zeroes.
create function public.add_baihuayuan_receipt_draft_row(p_store_id uuid,p_batch_id uuid,p_run_id uuid,p_request_id uuid)
returns text language plpgsql security definer set search_path='' as $$
declare b public.receipt_upload_batches; r uuid; doc uuid; key text;
begin
 if auth.uid() is null or not private.can_review_receipt(p_batch_id) then raise exception 'RECEIPT_REVIEWER_REQUIRED' using errcode='42501';end if;
 perform private.assert_store_editable(p_store_id);
 if p_request_id is null then raise exception 'INVALID_APP_INPUT';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_batch_id::text,0));
 select * into b from public.receipt_upload_batches where id=p_batch_id and store_id=p_store_id and store_name in ('BeApe','Gras');
 if not found then raise exception 'RECEIPT_ACCESS_DENIED' using errcode='42501';end if;
 if exists(select 1 from private.baihuayuan_record_flags where organization_id=b.organization_id and entity_type='RECEIPT_BATCH' and entity_id=b.id and state<>'LIVE') then raise exception 'RECEIPT_ACCOUNT_NOT_LIVE' using errcode='42501';end if;
 if b.status='COMPLETED' then raise exception 'PUBLISHED_RECEIPT_IMMUTABLE';end if;
 select id into r from public.receipt_ocr_runs where batch_id=p_batch_id order by version desc limit 1;
 if r is distinct from p_run_id or not exists(select 1 from private.receipt_manual_handoffs where batch_id=p_batch_id and run_id=r) then raise exception 'OCR_VERSION_CHANGED';end if;
 key:='entry-'||p_request_id;
 if exists(select 1 from public.receipt_ocr_fields where ocr_run_id=r and row_key=key) then return key;end if;
 if (select count(distinct row_key) from public.receipt_ocr_fields where ocr_run_id=r)>=501 then raise exception 'INVALID_APP_INPUT';end if;
 select id into doc from public.receipt_documents where batch_id=b.id order by page_order limit 1;
 insert into public.receipt_ocr_fields(organization_id,batch_id,document_id,ocr_run_id,row_key,field_name,raw_value,normalized_value,confidence,review_status,validation_notes)
 select b.organization_id,b.id,doc,r,key,name,'null'::jsonb,'null'::jsonb,0,'UNREADABLE','["MANUAL_ENTRY"]'::jsonb
 from unnest(array['product','specification','unit','quantity','unit_price_ex_tax','subtotal_ex_tax']) name;
 insert into private.receipt_line_decisions(batch_id,run_id,row_key,decision,decided_by) values(b.id,r,key,'INCLUDE',auth.uid());
 insert into public.audit_logs(organization_id,entity_type,entity_id,action,new_value,user_id)
 values(b.organization_id,'receipt_upload_batch',b.id::text,'RECEIPT_DRAFT_ROW_ADDED',jsonb_build_object('run_id',r,'row_key',key),auth.uid());
 return key;
end $$;
revoke all on function public.add_baihuayuan_receipt_draft_row(uuid,uuid,uuid,uuid) from public,anon;
grant execute on function public.add_baihuayuan_receipt_draft_row(uuid,uuid,uuid,uuid) to authenticated;

do $patch$
declare src text; anchor text;
begin
 src:=pg_get_functiondef('public.enqueue_receipt_ocr(uuid)'::regprocedure);
 anchor:='perform pg_advisory_xact_lock(hashtextextended(p_batch_id::text,0));';
 if strpos(src,anchor)=0 then raise exception 'ENQUEUE_ANCHOR_MISSING';end if;
 src:=replace(src,anchor,anchor||$code$
 if exists(select 1 from private.receipt_manual_handoffs where batch_id=p_batch_id) then raise exception 'RECEIPT_MANUAL_REVIEW_ACTIVE';end if;
 $code$);execute src;
 src:=pg_get_functiondef('public.create_receipt_ocr_run(uuid,uuid,text,text,text,uuid)'::regprocedure);
 anchor:='perform pg_advisory_xact_lock(hashtextextended(p_batch_id::text, 0));';
 if strpos(src,anchor)=0 then raise exception 'RUN_ANCHOR_MISSING';end if;
 src:=replace(src,anchor,anchor||$code$
 if exists(select 1 from private.receipt_manual_handoffs where batch_id=p_batch_id) then raise exception 'RECEIPT_MANUAL_REVIEW_ACTIVE';end if;
 $code$);execute src;
 -- Content failures need human input, not repeated identical paid/free requests.
 src:=pg_get_functiondef('public.fail_receipt_ocr_job(uuid,uuid,text)'::regprocedure);
 anchor:='if reason is not null then';
 if strpos(src,anchor)=0 then raise exception 'FAIL_ANCHOR_MISSING';end if;
 src:=replace(src,anchor,$code$
 if p_error like 'OCR_NO_%' or p_error like 'GEMINI_EMPTY_STRUCTURED_OUTPUT%' then
  update public.receipt_ocr_jobs set status='FAILED',completed_at=now(),locked_at=null,lease_token=null,last_error=left(p_error,4000) where id=job.id returning * into job;
  return job;
 end if;
 $code$||anchor);execute src;
end $patch$;
do $patch$
declare src text;
begin
 src:=pg_get_functiondef('public.get_baihuayuan_receipt_inbox(uuid)'::regprocedure);
 if strpos(src,'left join field_summary fs on fs.batch_id=b.id')=0 then raise exception 'INBOX_ANCHOR_MISSING';end if;
 src:=replace(src,'left join field_summary fs on fs.batch_id=b.id','left join field_summary fs on fs.batch_id=b.id left join private.receipt_account_edits e on e.batch_id=b.id and e.store_id=p_store_id');
 src:=replace(src,'fs.supplier_name',$code$(case when e.header ? 'supplier_name' then e.header->>'supplier_name' else fs.supplier_name end)$code$);
 src:=replace(src,'fs.receipt_date',$code$(case when e.header ? 'receipt_date' then e.header->>'receipt_date' else fs.receipt_date end)$code$);
 src:=replace(src,$code$when b.job_status='FAILED' then 'OCR_FAILED'$code$,$code$when exists(select 1 from private.receipt_manual_handoffs h where h.batch_id=b.id) then 'NEEDS_REVIEW'
          when b.job_status='FAILED' then 'OCR_FAILED'$code$);
 execute src;
end $patch$;
notify pgrst,'reload schema';
