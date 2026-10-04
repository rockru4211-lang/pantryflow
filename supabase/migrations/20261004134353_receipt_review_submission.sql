-- Receipt verification is independent from supplier statement reconciliation.
-- Existing raw receipts, financial postings and checked history remain untouched.
alter table private.receipt_account_edits add column reviewed_source text;
alter table private.receipt_account_edits add column reviewed_at timestamptz;
alter table private.receipt_account_edits add column reviewed_by uuid references auth.users(id);
do $migration$
declare src text; anchor text;
begin
 src:=pg_get_functiondef('private.receipt_account_rows(uuid,date,date,text,uuid)'::regprocedure);
 anchor:='''note'',coalesce(note,''''),''revision'',revision';
 if strpos(src,anchor)=0 then raise exception 'ACCOUNT_SUBMISSION_ANCHOR_MISSING';end if;
 src:=replace(src,anchor,$code$'reviewed',exists(select 1 from private.receipt_account_edits verified where verified.batch_id=a.id and verified.reviewed_source=md5(jsonb_build_array(fingerprint,net,tax,total,coalesce(note,''))::text)),
  'note',coalesce(note,''),'revision',revision$code$);
 execute src;
 src:=pg_get_functiondef('public.save_baihuayuan_receipt_review(uuid,uuid,jsonb,uuid)'::regprocedure);
 anchor:='if checked and (incomplete';
 if strpos(src,anchor)=0 then raise exception 'SUBMISSION_VALIDATION_ANCHOR_MISSING';end if;
 src:=replace(src,anchor,'if (checked or coalesce((p_data->>''reviewed'')::boolean,false)) and (incomplete');
 anchor:='result:=jsonb_build_object(''saved'',true,''account'',private.receipt_account_rows(p_store_id,null,null,null,p_batch_id)->0);';
 if strpos(src,anchor)=0 then raise exception 'SUBMISSION_SAVE_ANCHOR_MISSING';end if;
 src:=replace(src,anchor,$code$
 fresh:=private.receipt_account_rows(p_store_id,null,null,null,p_batch_id)->0;
 update private.receipt_account_edits set
  reviewed_source=case when checked or coalesce((p_data->>'reviewed')::boolean,false) then md5(jsonb_build_array(fresh->>'source_fingerprint',fresh->'net',fresh->'tax',fresh->'total',coalesce(fresh->>'note',''))::text) end,
  reviewed_at=case when checked or coalesce((p_data->>'reviewed')::boolean,false) then now() end,
  reviewed_by=case when checked or coalesce((p_data->>'reviewed')::boolean,false) then auth.uid() end
 where batch_id=p_batch_id;
 result:=jsonb_build_object('saved',true,'account',private.receipt_account_rows(p_store_id,null,null,null,p_batch_id)->0);
 $code$);
 execute src;
end $migration$;
notify pgrst,'reload schema';
