-- A prepaid release can use the same supplier balance shown in the inventory workspace.
-- Keep the printed names in the receipt and use canonical supplier identity for authorization.
create function private.sync_receipt_entry_custody(s uuid,b uuid,supplier_name text,l jsonb,previous_line jsonb,completed boolean) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
 reminder private.custody_reminders;
 reminder_id uuid;
 org uuid;
 supplier_id uuid;
 quantity numeric;
begin
 if coalesce(l->>'handling','NORMAL')<>'CUSTODY_RELEASE' then
  return private.sync_receipt_reminder(s,b,supplier_name,l,previous_line);
 end if;
 if not (l ? 'custody_reminder_id') then
  l:=l||jsonb_build_object('custody_reminder_id',coalesce(previous_line->>'custody_reminder_id',''));
 end if;
 reminder_id:=nullif(l->>'custody_reminder_id','')::uuid;
 if reminder_id is null then
  return private.sync_receipt_reminder(s,b,supplier_name,l,previous_line);
 end if;
 if nullif(l->>'custody_lot_id','') is not null or nullif(l->>'custody_event_id','') is not null then
  raise exception 'REMINDER_MISMATCH' using errcode='22023';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('reminder:'||s::text,0));
 select * into reminder from private.custody_reminders where id=reminder_id and store_id=s;
 select organization_id into org from public.stores where id=s;
 supplier_id:=private.supplier_identity(org,supplier_name);
 if reminder.id is null or reminder.kind<>'supplier'
  or private.ingredient_match_text(reminder.unit) is distinct from private.ingredient_match_text(l->>'unit')
  or (private.ingredient_match_text(reminder.supplier) is distinct from private.ingredient_match_text(supplier_name)
    and (supplier_id is null or supplier_id is distinct from private.supplier_identity(org,reminder.supplier))) then
  raise exception 'REMINDER_MISMATCH' using errcode='22023';
 end if;
 quantity:=private.receipt_account_number(l->>'quantity');
 if quantity is null or quantity<=0 or quantity>=1e9 then raise exception 'REMINDER_INVALID' using errcode='22023';end if;
 if completed or exists(select 1 from private.custody_reminder_receipts where batch_id=b and row_key=l->>'row_key' and active) then
  perform private.sync_receipt_reminder(s,b,reminder.supplier,
   l||jsonb_build_object('handling','NORMAL','product_name',reminder.name),previous_line);
 end if;
 return l||jsonb_build_object('custody_reminder_kind',reminder.kind);
end $$;
revoke all on function private.sync_receipt_entry_custody(uuid,uuid,text,jsonb,jsonb,boolean) from public,anon,authenticated;

do $patch$
declare src text;anchor text;completion text:='checked or coalesce((p_data->>''reviewed'')::boolean,false)';
begin
 src:=pg_get_functiondef('private.receipt_link_custody(uuid,uuid,uuid,jsonb,jsonb,boolean)'::regprocedure);
 anchor:='if coalesce(l->>''handling'',''NORMAL'')<>''CUSTODY_RELEASE'' then continue;end if;';
 if strpos(src,anchor)=0 then raise exception 'CUSTODY_ENTRY_LOT_ANCHOR_MISSING';end if;
 -- Preserve the existing posted-lot immutability check, but never post a reminder as a lot.
 src:=replace(src,anchor,anchor||chr(10)||'  if nullif(l->>''custody_reminder_id'','''') is not null then continue;end if;');
 execute src;
 src:=pg_get_functiondef('public.save_baihuayuan_receipt_review(uuid,uuid,jsonb,uuid)'::regprocedure);
 anchor:='l:=private.sync_receipt_reminder(p_store_id,p_batch_id,header->>''supplier_name'',l,(select x from jsonb_array_elements(current_row->''lines'') x where x->>''row_key''=l->>''row_key''));';
 if strpos(src,anchor)=0 then raise exception 'CUSTODY_ENTRY_SAVE_ANCHOR_MISSING';end if;
 src:=replace(src,anchor,'l:=private.sync_receipt_entry_custody(p_store_id,p_batch_id,header->>''supplier_name'',l,(select x from jsonb_array_elements(current_row->''lines'') x where x->>''row_key''=l->>''row_key''),'||completion||' or coalesce((p_data->>''review_completed'')::boolean,false));');
 anchor:=completion||');';
 if strpos(src,anchor)=0 then raise exception 'CUSTODY_ENTRY_POST_ANCHOR_MISSING';end if;
 src:=replace(src,anchor,completion||' or coalesce((p_data->>''review_completed'')::boolean,false));');
 execute src;
end $patch$;
notify pgrst,'reload schema';
