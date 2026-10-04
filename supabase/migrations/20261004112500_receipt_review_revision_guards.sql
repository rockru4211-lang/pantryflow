-- Corrections belong to the OCR version reviewed, not a reused row number.
do $$declare src text;begin
 src:=pg_get_functiondef('private.receipt_account_rows(uuid,date,date,text,uuid)'::regprocedure);
 if strpos(src,'s.name goods_supplier,e.header edit_header,e.line_values,e.adjustment,e.adjustment_note,e.revision edit_revision,')=0 then raise exception 'ACCOUNT_REVISION_ANCHOR_MISSING';end if;
 src:=replace(src,'s.name goods_supplier,e.header edit_header,e.line_values,e.adjustment,e.adjustment_note,e.revision edit_revision,',
 's.name goods_supplier,case when e.run_id is not distinct from r.id then e.header end edit_header,case when e.run_id is not distinct from r.id then e.line_values end line_values,case when e.run_id is not distinct from r.id then e.adjustment end adjustment,case when e.run_id is not distinct from r.id then e.adjustment_note end adjustment_note,e.revision edit_revision,');
 src:=replace(src,'case when edit_revision is not null then line_net+adjustment','case when edit_revision is not null and edited_run is not distinct from run_id then line_net+adjustment');
 execute src;
 src:=pg_get_functiondef('private.receipt_apply_account_edits(uuid,jsonb)'::regprocedure);
 if strpos(src,'e.store_id=p_store')=0 then raise exception 'EFFECTIVE_REVISION_ANCHOR_MISSING';end if;
 src:=replace(src,'e.store_id=p_store','e.store_id=p_store and e.run_id is not distinct from nullif(r->>''run_id'','''')::uuid');
 execute src;
 -- Live state is checked before a cached retry as well as before a fresh write.
 src:=pg_get_functiondef('public.save_baihuayuan_receipt_review(uuid,uuid,jsonb,uuid)'::regprocedure);
 if strpos(src,'payload:=p_data')=0 then raise exception 'REVIEW_REPLAY_ANCHOR_MISSING';end if;
 src:=replace(src,'payload:=p_data',
 'if exists(select 1 from private.receipt_duplicate_links where batch_id=p_batch_id) or exists(select 1 from private.baihuayuan_record_flags where organization_id=b.organization_id and entity_type=''RECEIPT_BATCH'' and entity_id=p_batch_id and state<>''LIVE'') then raise exception ''RECEIPT_ACCOUNT_NOT_LIVE'' using errcode=''42501'';end if; payload:=p_data');
 execute src;
end $$;
