-- Record the quantity printed on the receipt line. New releases do not require
-- an account or a lot, and saved links from the previous workflow remain valid.
do $patch$
declare
 src text;
 anchor text;
begin
 src:=pg_get_functiondef('private.sync_receipt_entry_custody(uuid,uuid,text,jsonb,jsonb,boolean)'::regprocedure);
 anchor:=$old$
 if coalesce(l->>'handling','NORMAL')<>'CUSTODY_RELEASE' then
  return private.sync_receipt_reminder(s,b,supplier_name,l,previous_line);
 end if;
$old$;
 if strpos(src,anchor)=0 then raise exception 'RECEIPT_CUSTODY_REMAINING_SYNC_ANCHOR';end if;
 src:=replace(src,anchor,$new$
 if coalesce(l->>'handling','NORMAL')<>'CUSTODY_RELEASE' then
  return private.sync_receipt_reminder(s,b,supplier_name,l-'custody_remaining',previous_line);
 end if;
 if not (l ? 'custody_remaining') and previous_line ? 'custody_remaining' then
  l:=l||jsonb_build_object('custody_remaining',previous_line->'custody_remaining');
 end if;
 if l ? 'custody_remaining' then
  if jsonb_typeof(l->'custody_remaining') not in ('null','number') then
   raise exception 'INVALID_RECEIPT_CUSTODY_REMAINING' using errcode='22023';
  end if;
  if jsonb_typeof(l->'custody_remaining')='number' then
   quantity:=(l->>'custody_remaining')::numeric;
   if quantity<0 or quantity>=1e9 or scale(quantity)>4 then
    raise exception 'INVALID_RECEIPT_CUSTODY_REMAINING' using errcode='22023';
   end if;
  end if;
  if coalesce(nullif(l->>'custody_reminder_id',''),case when not (l ? 'custody_reminder_id') then nullif(previous_line->>'custody_reminder_id','') end) is null
   and nullif(l->>'custody_lot_id','') is null and nullif(l->>'custody_event_id','') is null then
   if exists(select 1 from private.custody_reminder_receipts where batch_id=b and row_key=l->>'row_key') then
    raise exception 'RECEIPT_CUSTODY_LOCKED' using errcode='22023';
   end if;
   return l-'custody_reminder_kind';
  end if;
 end if;
$new$);
 execute src;

 src:=pg_get_functiondef('private.receipt_link_custody(uuid,uuid,uuid,jsonb,jsonb,boolean)'::regprocedure);
 anchor:='if nullif(l->>''custody_lot_id'','''') is null then';
 if strpos(src,anchor)=0 then raise exception 'RECEIPT_CUSTODY_REMAINING_LOT_ANCHOR';end if;
 src:=replace(src,anchor,anchor||chr(10)||'   if l ? ''custody_remaining'' then continue;end if;');
 execute src;

 src:=pg_get_functiondef('public.save_baihuayuan_receipt_review(uuid,uuid,jsonb,uuid)'::regprocedure);
 anchor:='where key in (''discount'',''custody_reminder_id'',';
 if strpos(src,anchor)=0 then raise exception 'RECEIPT_CUSTODY_REMAINING_SAVE_ANCHOR';end if;
 src:=replace(src,anchor,'where key in (''discount'',''custody_remaining'',''custody_reminder_id'',');
 execute src;
end $patch$;
