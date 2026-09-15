do $$
declare src text; prior text;
begin
 select pg_get_functiondef('private.app_operation(uuid,text,jsonb,uuid)'::regprocedure) into src;prior:=src;
 src:=replace(src,'if p_action=''product.edit-basic'' and not private.can_import_inventory(p_store)', 
 'if p_action=''receipt.edit-card'' and (not exists(select 1 from public.receipt_upload_batches b where b.id=(p_data->>''batch_id'')::uuid and b.store_id=p_store) or not private.can_review_receipt((p_data->>''batch_id'')::uuid)) then raise exception ''RECEIPT_REVIEWER_REQUIRED'' using errcode=''42501'';end if;'||chr(10)||' if p_action=''product.edit-basic'' and not private.can_import_inventory(p_store)');
 if src=prior then raise exception 'RECEIPT_CARD_GUARD_PATCH_MISSING';end if;execute src;
end $$;