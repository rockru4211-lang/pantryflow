-- Remember explicit supplier corrections in the existing audited sheet transaction.
create or replace function private.receipt_edit_sheet(s uuid,d jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare item jsonb; state jsonb; batch uuid; result jsonb:='[]'; memory jsonb; memories jsonb:='[]'; links jsonb:='[]'; raw text; field_id uuid; proposed text; org uuid;
begin
 perform private.receipt_sheet_access(s,d);
 select organization_id into org from public.stores where id=s;
 -- Match the resolver lock order; name learning and all row edits commit together.
 perform pg_advisory_xact_lock(hashtextextended(org::text||':supplier-names',0));
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
 -- Validate every alias against the actual receipt and the submitted document field.
 for item in select x from jsonb_array_elements(d->'rows') x where x->'supplier_memory' is not null and x->'supplier_memory'<>'null'::jsonb loop
  memory:=item->'supplier_memory';
  select e.id,e.value#>>'{}' into field_id,raw from private.receipt_effective_fields((item->>'run_id')::uuid)e where e.row_key='document' and e.field_name='supplier_name';
  select f->>'value' into proposed from jsonb_array_elements(item#>'{document,fields}')f where f->>'id'=field_id::text;
  if raw is distinct from memory->>'source_name' or nullif(btrim(raw),'') is null or proposed is distinct from memory->>'new_name' or not(memory?'expected_supplier_id') then raise exception 'INVALID_SUPPLIER_NAME' using errcode='22023';end if;
  if private.supplier_identity(org,raw) is distinct from nullif(memory->>'expected_supplier_id','')::uuid then raise exception 'SUPPLIER_NAME_CHANGED' using errcode='40001';end if;
  if exists(select 1 from jsonb_array_elements(memories)m where private.history_key(m->>'source_name')=private.history_key(raw) and m->>'new_name'<>proposed) then raise exception 'SUPPLIER_NAME_CHANGED' using errcode='40001';end if;
  if not exists(select 1 from jsonb_array_elements(memories)m where private.history_key(m->>'source_name')=private.history_key(raw)) then memories:=memories||jsonb_build_array(memory);end if;
 end loop;
 for memory in select m from jsonb_array_elements(memories)m order by m->>'source_name' loop
  links:=links||jsonb_build_array(private.resolve_supplier_name(s,memory));
 end loop;
 for item in select x from jsonb_array_elements(d->'rows') x loop
  state:=private.baihuayuan_receipt_review_state((item->>'batch_id')::uuid);
  result:=result||jsonb_build_array(private.receipt_edit_ledger(s,item||jsonb_build_object('review_revision',state->>'revision')));
 end loop;
 return jsonb_build_object('saved',true,'count',jsonb_array_length(result),'rows',result,'supplier_names',links);
end $$;
revoke all on function private.receipt_edit_sheet(uuid,jsonb) from public,anon,authenticated;
notify pgrst,'reload schema';
