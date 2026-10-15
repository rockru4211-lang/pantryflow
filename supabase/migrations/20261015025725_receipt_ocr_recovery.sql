-- The OCR worker is an invoker: it must read the manual-handoff guard.
-- Only SELECT is needed; client roles retain no access to this private table.
grant select on private.receipt_manual_handoffs to service_role;

-- Retry only receipts without persisted human edits or successful machine evidence.
-- Existing jobs are returned, never duplicated. Manual history/runs are retained.
create function public.retry_baihuayuan_receipt_ocr(p_store_id uuid,p_batch_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.receipt_upload_batches; j public.receipt_ocr_jobs; r public.receipt_ocr_runs;
begin
 if auth.uid() is null or not private.can_review_receipt(p_batch_id) then raise exception 'RECEIPT_REVIEWER_REQUIRED' using errcode='42501';end if;
 perform private.assert_store_editable(p_store_id);
 select * into b from public.receipt_upload_batches where id=p_batch_id and store_id=p_store_id and store_name in ('BeApe','Gras');
 if not found then raise exception 'RECEIPT_ACCESS_DENIED' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('receipt-ocr-dispatch',0));
 perform pg_advisory_xact_lock(hashtextextended(p_batch_id::text,0));
 select * into b from public.receipt_upload_batches where id=p_batch_id;
 if exists(select 1 from private.baihuayuan_record_flags where organization_id=b.organization_id and entity_type='RECEIPT_BATCH' and entity_id=b.id and state<>'LIVE') then raise exception 'RECEIPT_ACCOUNT_NOT_LIVE' using errcode='42501';end if;
 if b.status='COMPLETED' or b.group_mode='ADMIN_DIRECT'
 or exists(select 1 from public.goods_receipts where source_batch_id=b.id)
 or exists(select 1 from private.receipt_account_edits where batch_id=b.id)
 or exists(select 1 from public.receipt_review_corrections where batch_id=b.id)
 or exists(select 1 from private.receipt_manual_rows where batch_id=b.id)
 or exists(select 1 from public.receipt_product_mappings where batch_id=b.id)
 then raise exception 'RECEIPT_RETRY_HAS_EDITS';end if;
 select * into r from public.receipt_ocr_runs where batch_id=b.id order by version desc limit 1;
 if exists(select 1 from public.receipt_ocr_runs where batch_id=b.id and status='SUCCEEDED' and provider<>'manual')
 or exists(select 1 from public.receipt_ocr_fields where batch_id=b.id and row_key<>'document')
 then raise exception 'RECEIPT_RETRY_HAS_RESULTS';end if;
 select * into j from public.receipt_ocr_jobs where batch_id=b.id and status in ('QUEUED','RUNNING') order by created_at desc limit 1;
 if found then return jsonb_build_object('queued',true,'status',j.status);end if;
 -- This is only a handoff marker for an empty form; audit evidence is retained.
 delete from private.receipt_manual_handoffs where batch_id=b.id;
 j:=public.enqueue_receipt_ocr(b.id);
 insert into public.audit_logs(organization_id,entity_type,entity_id,action,new_value,user_id)
 values(b.organization_id,'receipt_upload_batch',b.id::text,'RECEIPT_OCR_RETRY',jsonb_build_object('previous_run_id',r.id,'job_id',j.id),auth.uid());
 return jsonb_build_object('queued',true,'status',j.status);
end $$;
revoke all on function public.retry_baihuayuan_receipt_ocr(uuid,uuid) from public,anon;
grant execute on function public.retry_baihuayuan_receipt_ocr(uuid,uuid) to authenticated;

-- Named partial rows are usable even when quantity and price are unreadable.
do $patch$
declare src text; needle text:=$code$coalesce(d.decision='INCLUDE',coalesce(private.receipt_account_number(f.vals->>'quantity')>0,false) or coalesce(private.receipt_account_number(f.vals->>'subtotal_ex_tax')>0,false))$code$;
begin
 src:=pg_get_functiondef('private.receipt_account_rows(uuid,date,date,text,uuid)'::regprocedure);
 if strpos(src,needle)=0 then raise exception 'PARTIAL_RECEIPT_ANCHOR_MISSING';end if;
 src:=replace(src,needle,$code$coalesce(d.decision='INCLUDE',nullif(btrim(f.vals->>'product'),'') is not null or coalesce(private.receipt_account_number(f.vals->>'quantity')>0,false) or coalesce(private.receipt_account_number(f.vals->>'subtotal_ex_tax')>0,false))$code$);
 execute src;
end $patch$;
notify pgrst,'reload schema';
