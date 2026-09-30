-- Append to an OPEN administrative spot check, preserving every existing value.
do $$
declare src text; anchor text;
begin
 src:=pg_get_functiondef('private.spot_check_command(uuid,text,jsonb)'::regprocedure);
 anchor:=$q$p_action not in ('create','plan','save_entries','submit','review','close','return')$q$;
 if strpos(src,anchor)=0 then raise exception 'SPOT_APPEND_ACTION_ANCHOR_MISSING';end if;
 src:=replace(src,anchor,$q$p_action not in ('create','plan','add_items','save_entries','submit','review','close','return')$q$);
 src:=replace(src,$q$p_action in ('create','plan') and not (caps->>'plan')::boolean$q$,$q$p_action in ('create','plan','add_items') and not (caps->>'plan')::boolean$q$);
 anchor:=$q$if p_action in ('create','plan') then$q$;
 if strpos(src,anchor)=0 then raise exception 'SPOT_APPEND_BRANCH_ANCHOR_MISSING';end if;
 src:=replace(src,anchor,$patch$if p_action='add_items' then
  if c.status<>'OPEN' or c.submitted_at is not null then raise exception 'SPOT_LOCKED' using errcode='22023';end if;
  select * into source from public.inventory_count_sessions where id=c.source_id and store_id=p_store for share;
  if not found then raise exception 'SPOT_SOURCE_NOT_FOUND' using errcode='22023';end if;
  selected:=p_data->'entries';
  if selected is null or jsonb_typeof(selected)<>'array' or jsonb_array_length(selected) not between 1 and 3000
   or (select count(*) from jsonb_array_elements_text(selected))<>(select count(distinct value) from jsonb_array_elements_text(selected)) then raise exception 'SPOT_SELECT_ITEMS' using errcode='22023';end if;
  source_rows:=private.spot_check_source(source.id);
  if exists(select 1 from jsonb_array_elements_text(selected) chosen where not exists(select 1 from jsonb_array_elements(source_rows) r where r->>'entry_id'=chosen.value)) then raise exception 'SPOT_ITEM_OUT_OF_SCOPE' using errcode='42501';end if;
  if exists(select 1 from jsonb_array_elements(source_rows) r join private.spot_check_items i on i.check_id=c.id and i.product_id=(r->>'product_id')::uuid and i.zone_id=(r->>'zone_id')::uuid where selected ? (r->>'entry_id')) then raise exception 'SPOT_CHANGED' using errcode='40001';end if;
  insert into private.spot_check_items(check_id,entry_id,product_id,zone_id,name,zone,unit,specification,original_quantity,original_entered_at,baseline_note)
  select c.id,(r->>'entry_id')::uuid,(r->>'product_id')::uuid,(r->>'zone_id')::uuid,r->>'name',r->>'zone',r->>'unit',r->>'specification',
   (r->>'original_quantity')::numeric,(r->>'original_entered_at')::timestamptz,r->>'baseline_note'
  from jsonb_array_elements(source_rows) r where selected ? (r->>'entry_id');
  event_data:=jsonb_build_object('entries',selected,'added_count',jsonb_array_length(selected));
 elsif p_action in ('create','plan') then$patch$);
 execute src;
end $$;
notify pgrst,'reload schema';
