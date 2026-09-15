-- Add a receipt-only count without changing the existing combined company total.
-- It uses the same store, authorization and completed-upload predicate as the list.
do $$ declare src text; needle text := '''erp_pending'',case when org.has_erp then'; begin
 select pg_get_functiondef('private.app_dashboard(uuid)'::regprocedure) into src;
 if position(needle in src)=0 then raise exception 'RECEIPT_ERP_DASHBOARD_PATCH_MISSING';end if;
 execute replace(src,needle,'''receipt_erp_pending'',(select count(*) from public.receipt_upload_batches b where b.store_id=p_store and b.erp_required and b.erp_completed_at is null and private.can_read_receipt(b.id) and exists(select 1 from public.receipt_ocr_jobs j where j.batch_id=b.id)),'||chr(10)||needle);
end $$;

-- A direct call must obey the same field-role restriction as the batch endpoint.
-- Keep its row lock, single audit event and original completion actor/time on retry.
do $$ declare src text; needle text := 'not private.has_active_store_role(b.store_id,array[''ADMIN'',''SUPERVISOR'',''STAFF'']::public.app_role[])'; begin
 select pg_get_functiondef('public.complete_pilot_receipt_erp(uuid)'::regprocedure) into src;
 if position(needle in src)=0 then raise exception 'RECEIPT_ERP_ROLE_PATCH_MISSING';end if;
 execute replace(src,needle,'coalesce(private.app_role(b.store_id),'''') not in (''STAFF'',''SUPERVISOR'') or not private.can_read_receipt(b.id)');
end $$;
