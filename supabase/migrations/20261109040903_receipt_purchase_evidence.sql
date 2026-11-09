-- OCR candidates remain available for manual review without entering purchase projections.
do $patch$
declare definition text; anchor text;
begin
 definition:=pg_get_functiondef('private.baihuayuan_receipt_line_included(uuid,uuid,text)'::regprocedure);
 anchor:='  select value#>>''{}'' into v_quantity';
 if strpos(definition,anchor)=0 then raise exception 'PURCHASE_EVIDENCE_INCLUSION_ANCHOR_MISSING';end if;
 execute replace(definition,anchor,'  if p_row like ''candidate-%'' then return false; end if;'||chr(10)||anchor);

 definition:=pg_get_functiondef('private.receipt_account_rows(uuid,date,date,text,uuid)'::regprocedure);
 anchor:='coalesce(d.decision=''INCLUDE'',nullif(btrim(f.vals->>''product''),'''') is not null or coalesce(private.receipt_account_number(f.vals->>''quantity'')>0,false) or coalesce(private.receipt_account_number(f.vals->>''subtotal_ex_tax'')>0,false))';
 if strpos(definition,anchor)=0 then raise exception 'PURCHASE_EVIDENCE_ACCOUNT_ANCHOR_MISSING';end if;
 execute replace(definition,anchor,'coalesce(d.decision=''INCLUDE'',f.row_key not like ''candidate-%'' and (nullif(btrim(f.vals->>''product''),'''') is not null or coalesce(private.receipt_account_number(f.vals->>''quantity'')>0,false) or coalesce(private.receipt_account_number(f.vals->>''subtotal_ex_tax'')>0,false)))');

 definition:=pg_get_functiondef('public.commit_pilot_receipt_ocr(uuid,uuid,uuid,jsonb,jsonb,text)'::regprocedure);
 anchor:='where row_key<>''document'' group by row_key loop';
 if strpos(definition,anchor)=0 then raise exception 'PURCHASE_EVIDENCE_MAPPING_ANCHOR_MISSING';end if;
 execute replace(definition,anchor,'where row_key<>''document'' and row_key not like ''candidate-%'' group by row_key loop');
 definition:=pg_get_functiondef('public.save_baihuayuan_receipt_review(uuid,uuid,jsonb,uuid)'::regprocedure);
 anchor:='if coalesce((p_data->>''review_completed'')::boolean,false) and (incomplete';
 if strpos(definition,anchor)=0 then raise exception 'PURCHASE_EVIDENCE_FINISH_ANCHOR_MISSING';end if;
 execute replace(definition,anchor,$guard$
 if coalesce((p_data->>'review_completed')::boolean,false) and exists(
  select 1 from public.receipt_ocr_fields f
  where f.ocr_run_id=nullif(current_row->>'run_id','')::uuid and f.row_key like 'candidate-%'
   and not exists(select 1 from private.receipt_line_decisions d where d.batch_id=p_batch_id and d.run_id=f.ocr_run_id and d.row_key=f.row_key)
 ) then raise exception 'RECEIPT_PURCHASE_EVIDENCE_REVIEW' using errcode='22023'; end if;
 $guard$||anchor);
end $patch$;
notify pgrst,'reload schema';
