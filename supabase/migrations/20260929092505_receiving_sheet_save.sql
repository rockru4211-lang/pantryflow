-- One idempotent transaction for all edits in the purchasing sheet.
create function private.receipt_sheet_access(s uuid,d jsonb) returns void
language plpgsql security invoker set search_path='' as $$
begin
 perform private.assert_store_editable(s);
 if auth.uid() is null then raise exception 'RECEIPT_REVIEWER_REQUIRED' using errcode='42501';end if;
 if jsonb_typeof(d->'rows') is distinct from 'array' or jsonb_array_length(d->'rows') not between 1 and 200 then raise exception 'INVALID_APP_INPUT';end if;
 if exists(select 1 from jsonb_array_elements(d->'rows') x where not exists(select 1 from public.receipt_upload_batches b where b.id=(x->>'batch_id')::uuid and b.store_id=s) or not private.can_review_receipt((x->>'batch_id')::uuid)) then raise exception 'RECEIPT_REVIEWER_REQUIRED' using errcode='42501';end if;
end $$;
revoke all on function private.receipt_sheet_access(uuid,jsonb) from public,anon,authenticated;
create function private.receipt_edit_sheet(s uuid,d jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare item jsonb; state jsonb; batch uuid; result jsonb:='[]';
begin
 perform private.receipt_sheet_access(s,d);
 if exists(select 1 from jsonb_array_elements(d->'rows') x group by x->>'batch_id',x->>'row_key' having count(*)>1) then raise exception 'INVALID_APP_INPUT';end if;
 -- Stable lock order prevents deadlocks. Validate every original snapshot BEFORE writes.
 for batch in select distinct (x->>'batch_id')::uuid from jsonb_array_elements(d->'rows') x order by 1 loop
  perform pg_advisory_xact_lock(hashtextextended(batch::text,0));
 end loop;
 for item in select x from jsonb_array_elements(d->'rows') x loop
  state:=private.baihuayuan_receipt_review_state((item->>'batch_id')::uuid);
  if item->>'run_id' is distinct from state->>'run_id' then raise exception 'OCR_VERSION_CHANGED';end if;
  if item->>'review_revision' is distinct from state->>'revision' then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
 end loop;
 for item in select x from jsonb_array_elements(d->'rows') x loop
  state:=private.baihuayuan_receipt_review_state((item->>'batch_id')::uuid);
  result:=result||jsonb_build_array(private.receipt_edit_ledger(s,item||jsonb_build_object('review_revision',state->>'revision')));
 end loop;
 return jsonb_build_object('saved',true,'count',jsonb_array_length(result),'rows',result);
end $$;
revoke all on function private.receipt_edit_sheet(uuid,jsonb) from public,anon,authenticated;
do $$
declare src text; anchor text;
begin
 select pg_get_functiondef('private.app_operation(uuid,text,jsonb,uuid)'::regprocedure) into src;
 anchor:='if p_action in (''receipt.edit-card'',''receipt.edit-ledger'') and';
 if strpos(src,anchor)=0 then raise exception 'SHEET_GUARD_ANCHOR_MISSING';end if;
 src:=replace(src,anchor,'if p_action=''receipt.edit-sheet'' then perform private.receipt_sheet_access(p_store,p_data);end if; '||anchor);
 anchor:='elsif p_action=''receipt.edit-ledger'' then';
 if strpos(src,anchor)=0 then raise exception 'SHEET_OPERATION_ANCHOR_MISSING';end if;
 src:=replace(src,anchor,'elsif p_action=''receipt.edit-sheet'' then v_result:=private.receipt_edit_sheet(p_store,p_data); '||anchor);
 execute src;
end $$;
notify pgrst,'reload schema';
