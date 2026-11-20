-- The completed-count opening update also changes row source signatures.
-- Derive single-row saves from that same current report definition so reads
-- and writes agree on the preceding month's counts and existing reviews.
do $migration$
declare definition text; anchor text;
begin
 definition:=pg_get_functiondef('private.inventory_month_state(uuid,date,uuid)'::regprocedure);
 if strpos(definition,'private.inventory_month_carry_source')=0 then
  raise exception 'INVENTORY_SCOPED_OPENING_REQUIRED';
 end if;
 anchor:='private.inventory_month_state(p_store uuid, p_month date, p_session uuid DEFAULT NULL::uuid)';
 if strpos(definition,anchor)=0 then raise exception 'INVENTORY_SCOPED_OPENING_SIGNATURE';end if;
 definition:=replace(definition,anchor,'private.inventory_month_row_state(p_store uuid, p_month date, p_session uuid, p_row_key text)');
 anchor:=$old$from jsonb_array_elements(current_rows) c full join jsonb_array_elements(previous_rows) p on c->>'row_key'=p->>'row_key'$old$;
 if strpos(definition,anchor)=0 then raise exception 'INVENTORY_SCOPED_OPENING_ROWS';end if;
 execute replace(definition,anchor,anchor||$new$
   where coalesce(c->>'row_key',p->>'row_key')=p_row_key$new$);
end $migration$;
revoke all on function private.inventory_month_row_state(uuid,date,uuid,text) from public,anon,authenticated;
notify pgrst,'reload schema';
