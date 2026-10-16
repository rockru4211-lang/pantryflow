-- Complete entry and finance availability in the SAME save transaction.
-- Existing authorization, revision guards, idempotency and reconciliation remain intact.
do $patch$
declare src text; anchor text:='review_completed_source=case when';
begin
 src:=pg_get_functiondef('public.save_baihuayuan_receipt_review(uuid,uuid,jsonb,uuid)'::regprocedure);
 if strpos(src,anchor)=0 then raise exception 'RECEIPT_AUTO_FINANCE_ANCHOR';end if;
 src:=replace(src,anchor,$code$finance_sent_at=case when (coalesce((p_data->>'review_completed')::boolean,false) or coalesce((current_row->>'review_completed')::boolean,false) or coalesce((current_row->>'entry_completed')::boolean,false)) then coalesce(finance_sent_at,now()) else finance_sent_at end,
 finance_sent_by=case when (coalesce((p_data->>'review_completed')::boolean,false) or coalesce((current_row->>'review_completed')::boolean,false) or coalesce((current_row->>'entry_completed')::boolean,false)) then coalesce(finance_sent_by,auth.uid()) else finance_sent_by end,
 review_completed_source=case when$code$);
 execute src;
end $patch$;
notify pgrst,'reload schema';
