-- Reviewer notes travel with the existing page-specific photo request.
-- Automatic OCR quality reports retain their original set of reasons.
alter table private.receipt_photo_requests
  drop constraint receipt_photo_requests_reason_check,
  add constraint receipt_photo_requests_reason_check
    check (reason in ('BLUR','GLARE','CROPPED','INCOMPLETE')),
  add column note text check (char_length(note) between 1 and 500);

create function private.receipt_retake_has_draft(p_batch uuid)
returns boolean language sql stable set search_path='' as $$
  select exists (select 1 from private.receipt_account_edits where batch_id=p_batch)
    or exists (select 1 from private.receipt_reconciliations where batch_id=p_batch)
    or exists (select 1 from private.receipt_manual_handoffs where batch_id=p_batch)
    or exists (select 1 from private.receipt_manual_rows where batch_id=p_batch)
    or exists (select 1 from private.receipt_line_decisions where batch_id=p_batch)
    or exists (select 1 from private.receipt_ledger_annotations where batch_id=p_batch)
    or exists (select 1 from public.receipt_product_mappings where batch_id=p_batch)
    or exists (select 1 from public.receipt_review_corrections where batch_id=p_batch)
    or exists (
      select 1 from private.receipt_review_saves saved join public.receipt_ocr_runs run
        on run.id=saved.ocr_run_id where run.batch_id=p_batch
    )
$$;
revoke all on function private.receipt_retake_has_draft(uuid) from public,anon,authenticated;

create function private.assert_receipt_photo_ready(p_batch uuid)
returns void language plpgsql stable set search_path='' as $$
begin
  if exists (select 1 from private.receipt_photo_requests where batch_id=p_batch and completed_at is null) then
    raise exception 'PHOTO_RETAKE_REQUIRED';
  end if;
  if exists (select 1 from private.receipt_photo_requests where batch_id=p_batch)
    and exists (select 1 from public.receipt_ocr_jobs where batch_id=p_batch and status in ('QUEUED','RUNNING'))
  then
    raise exception 'PHOTO_PROCESSING_BUSY';
  end if;
end $$;
revoke all on function private.assert_receipt_photo_ready(uuid) from public,anon,authenticated;

do $patch$
declare
  definition text;
  anchor text;
begin
  definition:=pg_get_functiondef('private.baihuayuan_receipt_photo(text,uuid,jsonb)'::regprocedure);
  anchor:='v_id uuid; v_hash text; v_path text; v_job uuid;';
  if strpos(definition,anchor)=0 then raise exception 'RETAKE_DECLARATION_ANCHOR_MISSING'; end if;
  definition:=replace(definition,anchor,anchor||' v_note text; v_preserved boolean:=false;');

  anchor:='''page'',ld.page_order,''reason'',x.reason,';
  if strpos(definition,anchor)=0 then raise exception 'RETAKE_LIST_ANCHOR_MISSING'; end if;
  definition:=replace(definition,anchor,anchor||'''note'',x.note,');

  anchor:='where lb.store_id=p_store and x.completed_at is null';
  if strpos(definition,anchor)=0 then raise exception 'RETAKE_BATCH_FILTER_ANCHOR_MISSING'; end if;
  definition:=replace(definition,anchor,anchor||$code$
    and (p_data->>'batch_id' is null or lb.id=(p_data->>'batch_id')::uuid)
  $code$);

  anchor:='perform pg_advisory_xact_lock(hashtextextended(b.id::text,0));';
  if strpos(definition,anchor)=0 then raise exception 'RETAKE_LOCK_ANCHOR_MISSING'; end if;
  definition:=replace(definition,anchor,$code$
  if p_action='request' then
    perform pg_advisory_xact_lock(hashtextextended('receipt-ocr-dispatch',0));
  end if;
  $code$||anchor||$code$
  -- Store correction and reconciliation also lock the batch row. Fail fast
  -- if either holds it rather than waiting while holding the advisory lock.
  begin
    select * into strict b from public.receipt_upload_batches where id=b.id for update nowait;
  exception when lock_not_available then
    raise exception 'PHOTO_PROCESSING_BUSY' using errcode='PT409';
  end;
  if b.store_id is distinct from p_store or not private.can_read_receipt(b.id) then
    raise exception 'RECEIPT_ACCESS_DENIED' using errcode='42501';
  end if;
  if exists (
    select 1 from private.baihuayuan_record_flags f where f.organization_id=b.organization_id
      and f.entity_type='RECEIPT_BATCH' and f.entity_id=b.id and f.state<>'LIVE'
  ) then
    raise exception 'RECEIPT_ACCOUNT_NOT_LIVE' using errcode='42501';
  end if;
  $code$);

  anchor:='exists(select 1 from public.goods_receipts where source_batch_id=b.id) or b.status=''COMPLETED''';
  if strpos(definition,anchor)=0 then raise exception 'RETAKE_POSTED_ANCHOR_MISSING'; end if;
  definition:=replace(definition,anchor,'private.receipt_duplicate_posted(b.id)');

  anchor:=$old$  if p_data->>'reason' is null or p_data->>'reason' not in ('BLUR','GLARE','CROPPED') then raise exception 'INVALID_PHOTO_REASON'; end if;
  insert into private.receipt_photo_requests(batch_id,document_id,reason,requested_by)
  values(b.id,d.id,p_data->>'reason',auth.uid()) on conflict(document_id) where completed_at is null do nothing;
  return jsonb_build_object('requested',true);$old$;
  if strpos(definition,anchor)=0 then raise exception 'RETAKE_REQUEST_ANCHOR_MISSING'; end if;
  definition:=replace(definition,anchor,$code$
  if p_data->>'reason' is null or p_data->>'reason' not in ('BLUR','GLARE','CROPPED','INCOMPLETE') then
    raise exception 'INVALID_PHOTO_REASON';
  end if;
  if p_data ? 'note' and jsonb_typeof(p_data->'note') not in ('string','null') then
    raise exception 'INVALID_PHOTO_NOTE' using errcode='22023';
  end if;
  v_note:=nullif(regexp_replace(p_data->>'note','^[[:space:]]+|[[:space:]]+$','','g'),'');
  if char_length(v_note)>500 then
    raise exception 'INVALID_PHOTO_NOTE' using errcode='22023';
  end if;
  -- An existing task keeps its original reason and upload preparation.
  if exists (select 1 from private.receipt_photo_requests where document_id=d.id and completed_at is null) then
    return jsonb_build_object('requested',true,'already_requested',true);
  end if;
  -- A queued job (including a provider pause) must not block the store from
  -- replacing a photo. A leased worker may be finishing, so retry that case.
  begin
    perform 1 from public.receipt_ocr_jobs
      where batch_id=b.id and status in ('QUEUED','RUNNING') order by id for update nowait;
  exception when lock_not_available then
    raise exception 'PHOTO_PROCESSING_BUSY' using errcode='PT409';
  end;
  if exists (select 1 from public.receipt_ocr_jobs where batch_id=b.id and status='RUNNING'
      and locked_at>=now()-interval '5 minutes') then
    raise exception 'PHOTO_PROCESSING_BUSY' using errcode='PT409';
  end if;
  update public.receipt_ocr_jobs set status='FAILED',last_error='PHOTO_RETAKE_REQUIRED',
    completed_at=now(),locked_at=null,lease_token=null where batch_id=b.id and status in ('QUEUED','RUNNING');
  if found then
    update public.receipt_ocr_runs set status='FAILED',error_code='PHOTO_RETAKE_REQUIRED',
      error_message='Photo replacement requested',completed_at=now()
      where batch_id=b.id and status='PROCESSING';
    update public.receipt_upload_batches set status='READY_FOR_REVIEW' where id=b.id;
  end if;
  insert into private.receipt_photo_requests(batch_id,document_id,reason,requested_by,note)
    values(b.id,d.id,p_data->>'reason',auth.uid(),v_note) on conflict(document_id) where completed_at is null do nothing;
  return jsonb_build_object('requested',true);
  $code$);

  anchor:=$old$  if not exists(select 1 from private.receipt_photo_requests where batch_id=b.id and completed_at is null) then
   -- OCR row identities may move after a clearer photo;$old$;
  if strpos(definition,anchor)=0 then raise exception 'RETAKE_PRESERVE_ANCHOR_MISSING'; end if;
  definition:=replace(definition,anchor,$code$
  if not exists(select 1 from private.receipt_photo_requests where batch_id=b.id and completed_at is null) then
    v_preserved:=private.receipt_retake_has_draft(b.id);
    if v_preserved then
      -- Preserve the current run and its row identities. The replacement
      -- photo becomes current evidence without changing saved receipt data.
      update public.receipt_upload_batches set status='READY_FOR_REVIEW' where id=b.id;
    else
   -- OCR row identities may move after a clearer photo;$code$);

  anchor:=$old$   update public.receipt_upload_batches set status='PROCESSING' where id=b.id;
  end if;
  return jsonb_build_object('completed',true,'batch_id',b.id,'queued',v_job is not null);$old$;
  if strpos(definition,anchor)=0 then raise exception 'RETAKE_COMPLETION_ANCHOR_MISSING'; end if;
  definition:=replace(definition,anchor,$code$
   update public.receipt_upload_batches set status='PROCESSING' where id=b.id;
    end if;
  end if;
  return jsonb_build_object('completed',true,'batch_id',b.id,'queued',v_job is not null,'preserved_draft',v_preserved);
  $code$);
  execute definition;

  -- Checked/completed saves and direct finance submission must not race
  -- a pending replacement. Draft-only saves can still be retained.
  definition:=pg_get_functiondef('public.save_baihuayuan_receipt_review(uuid,uuid,jsonb,uuid)'::regprocedure);
  anchor:='header:=p_data->''header'';lines:=p_data->''lines'';checked:=(p_data->>''checked'')::boolean;';
  if strpos(definition,anchor)=0 then raise exception 'RETAKE_REVIEW_GUARD_ANCHOR_MISSING'; end if;
  execute replace(definition,anchor,anchor||$code$
  if checked or coalesce((p_data->>'reviewed')::boolean,false)
    or coalesce((p_data->>'review_completed')::boolean,false)
    or coalesce((p_data->>'entry_completed')::boolean,false)
    or coalesce((current_row->>'review_completed')::boolean,false)
    or coalesce((current_row->>'entry_completed')::boolean,false)
  then
    perform private.assert_receipt_photo_ready(p_batch_id);
  end if;
  $code$);

  definition:=pg_get_functiondef('public.submit_baihuayuan_receipt_finance(uuid,uuid,integer,text,uuid)'::regprocedure);
  anchor:='perform 1 from public.receipt_upload_batches where id=p_batch_id for update;';
  if strpos(definition,anchor)=0 then raise exception 'RETAKE_FINANCE_GUARD_ANCHOR_MISSING'; end if;
  execute replace(definition,anchor,anchor||$code$
  perform private.assert_receipt_photo_ready(p_batch_id);
  $code$);

  definition:=pg_get_functiondef('public.save_baihuayuan_receipt_reconciliation(uuid,uuid,jsonb,uuid)'::regprocedure);
  anchor:='perform 1 from public.receipt_upload_batches where id=p_batch_id for update;';
  if strpos(definition,anchor)=0 then raise exception 'RETAKE_ACCOUNT_GUARD_ANCHOR_MISSING'; end if;
  execute replace(definition,anchor,anchor||$code$
  if (p_data->>'checked')::boolean then
    perform private.assert_receipt_photo_ready(p_batch_id);
  end if;
  $code$);

  -- Enqueue already rejects open requests. Explicit retry also checks before
  -- returning any older active job or touching a manual-review marker.
  definition:=pg_get_functiondef('public.retry_baihuayuan_receipt_ocr(uuid,uuid)'::regprocedure);
  anchor:='perform pg_advisory_xact_lock(hashtextextended(p_batch_id::text,0));';
  if strpos(definition,anchor)=0 then raise exception 'RETAKE_RETRY_GUARD_ANCHOR_MISSING'; end if;
  execute replace(definition,anchor,anchor||$code$
  if exists (select 1 from private.receipt_photo_requests where batch_id=p_batch_id and completed_at is null) then
    raise exception 'PHOTO_RETAKE_REQUIRED';
  end if;
  $code$);

  definition:=pg_get_functiondef('private.correct_receipt_store(uuid,uuid,uuid,jsonb,uuid)'::regprocedure);
  anchor:='-- Do not move a physical stock/custody event by relabelling its receipt.';
  if strpos(definition,anchor)=0 then raise exception 'RETAKE_MOVE_GUARD_ANCHOR_MISSING'; end if;
  execute replace(definition,anchor,$code$
  if exists (select 1 from private.receipt_photo_requests where batch_id=p_batch and completed_at is null) then
    raise exception 'PHOTO_RETAKE_REQUIRED';
  end if;
  $code$||anchor);
end $patch$;

notify pgrst,'reload schema';
