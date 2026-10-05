-- Receipt data can be saved before explanations are complete. Preserve amounts,
-- source evidence, authorization, revision checks and idempotent request handling.
do $migration$
declare src text; anchor text;
begin
 src:=pg_get_functiondef('public.save_baihuayuan_receipt_review(uuid,uuid,jsonb,uuid)'::regprocedure);
 if strpos(src,'-- receipt_optional_followup_notes_v1')>0 then return;end if;
 anchor:=$q$ or (adjustment<>0 and nullif(btrim(p_data->>'adjustment_note'),'') is null)$q$;
 if strpos(src,anchor)=0 then raise exception 'OPTIONAL_ADJUSTMENT_NOTE_ANCHOR_MISSING';end if;
 src:=replace(src,anchor,'');
 anchor:=$q$or (q is not null and price is not null and subtotal is not null and abs(q*price-subtotal)>1 and nullif(btrim(l->>'note'),'') is null)$q$;
 if strpos(src,anchor)=0 then raise exception 'OPTIONAL_LINE_NOTE_ANCHOR_MISSING';end if;
 src:=replace(src,anchor,'');
 anchor:=$q$adjustment:=private.receipt_account_number(p_data->>'adjustment');$q$;
 if strpos(src,anchor)=0 then raise exception 'OPTIONAL_ADJUSTMENT_AMOUNT_ANCHOR_MISSING';end if;
 src:=replace(src,anchor,$q$-- receipt_optional_followup_notes_v1
 adjustment:=private.receipt_account_number(coalesce(nullif(p_data->>'adjustment',''),'0'));$q$);
 execute src;
end $migration$;
notify pgrst,'reload schema';
