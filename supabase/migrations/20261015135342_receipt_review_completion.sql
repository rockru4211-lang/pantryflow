-- Explicit human review is separate from saving, receiving and finance handoff.
-- Existing saved entries are not retrospectively marked as checked by a human.
alter table private.receipt_account_edits add column review_completed_source text;
do $patch$
declare src text; anchor text;
begin
 src:=pg_get_functiondef('private.receipt_account_rows(uuid,date,date,text,uuid)'::regprocedure);
 anchor:='''entry_completed'',exists';
 if strpos(src,anchor)=0 then raise exception 'REVIEW_COMPLETE_READ_ANCHOR';end if;
 src:=replace(src,anchor,$code$'review_completed',exists(select 1 from private.receipt_account_edits completed where completed.batch_id=a.id and completed.review_completed_source=md5(jsonb_build_array(fingerprint,net,tax,total,coalesce(note,''))::text)),
 'entry_completed',exists$code$);execute src;
 src:=pg_get_functiondef('public.save_baihuayuan_receipt_review(uuid,uuid,jsonb,uuid)'::regprocedure);
 anchor:='if incomplete then net:=null;else net:=net+adjustment;end if;';
 if strpos(src,anchor)=0 then raise exception 'REVIEW_COMPLETE_VALIDATE_ANCHOR';end if;
 src:=replace(src,anchor,anchor||$code$
 if coalesce((p_data->>'review_completed')::boolean,false) and (incomplete or jsonb_array_length(lines)=0 or nullif(header->>'supplier_name','') is null or header->>'receipt_date' is null) then raise exception 'RECEIPT_REVIEW_DATA_REQUIRED' using errcode='22023';end if;
 $code$);
 anchor:='entry_completed_source=case when';
 if strpos(src,anchor)=0 then raise exception 'REVIEW_COMPLETE_SAVE_ANCHOR';end if;
 src:=replace(src,anchor,$code$review_completed_source=case when coalesce((p_data->>'review_completed')::boolean,false) then md5(jsonb_build_array(fresh->>'source_fingerprint',fresh->'net',fresh->'tax',fresh->'total',coalesce(fresh->>'note',''))::text) else review_completed_source end,
 entry_completed_source=case when$code$);execute src;
 src:=pg_get_functiondef('public.submit_baihuayuan_receipt_finance(uuid,uuid,integer,text,uuid)'::regprocedure);
 anchor:='update private.receipt_account_edits set finance_sent_at=now()';
 if strpos(src,anchor)=0 then raise exception 'REVIEW_COMPLETE_HANDOFF_ANCHOR';end if;
 src:=replace(src,anchor,$code$if not coalesce((r->>'review_completed')::boolean,false) then raise exception 'RECEIPT_REVIEW_REQUIRED' using errcode='22023';end if;
  update private.receipt_account_edits set finance_sent_at=now()$code$);execute src;
end $patch$;
notify pgrst,'reload schema';
