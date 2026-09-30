-- Administrative onsite counting: show saved baseline and close with onsite notes.
-- Legacy review APIs remain available; existing completed evidence is preserved.
do $$
declare src text; anchor text;
begin
 src:=pg_get_functiondef('private.spot_check_detail(uuid)'::regprocedure);
 anchor:=$q$(to_jsonb(i)-'original_quantity')||case when c.submitted_at is not null then
     jsonb_build_object('original_quantity',i.original_quantity) else '{}'::jsonb end$q$;
 if strpos(src,anchor)=0 then raise exception 'SPOT_BASELINE_ANCHOR_MISSING';end if;
 execute replace(src,anchor,'to_jsonb(i)');
 src:=pg_get_functiondef('private.spot_check_command(uuid,text,jsonb)'::regprocedure);
 anchor:=$q$p_action not in ('create','plan','add_items','save_entries','submit','review','close','return')$q$;
 if strpos(src,anchor)=0 then raise exception 'SPOT_SIMPLE_ACTION_ANCHOR_MISSING';end if;
 src:=replace(src,anchor,$q$p_action not in ('create','plan','add_items','save_entries','save_reasons','finish','submit','review','close','return')$q$);
 src:=replace(src,$q$p_action in ('close','return')$q$,$q$p_action in ('close','return','save_reasons','finish')$q$);
 src:=replace(src,$q$if p_action in ('save_entries','submit') and c.assignee_id<>auth.uid()$q$,$q$if (p_action in ('save_entries','submit') or p_action='finish' and c.status='OPEN') and c.assignee_id<>auth.uid()$q$);
 src:=replace(src,$q$assignee:=(p_data->>'assignee_id')::uuid;$q$,$q$assignee:=coalesce(nullif(p_data->>'assignee_id','')::uuid,auth.uid());$q$);
 anchor:=$q$update private.spot_check_items set quantity=qty where spot_check_items.check_id=c.id and entry_id=(row_data->>'entry_id')::uuid;$q$;
 if strpos(src,anchor)=0 then raise exception 'SPOT_SIMPLE_SAVE_ANCHOR_MISSING';end if;
 src:=replace(src,anchor,$q$if row_data?'note' and (jsonb_typeof(row_data->'note') is distinct from 'string' or length(row_data->>'note')>1000) then raise exception 'SPOT_INVALID_INPUT' using errcode='22023';end if;
   update private.spot_check_items set quantity=qty,note=case when row_data?'note' then row_data->>'note' else note end where spot_check_items.check_id=c.id and entry_id=(row_data->>'entry_id')::uuid;$q$);
 anchor:=$q$elsif p_action='submit' then$q$;
 if strpos(src,anchor)=0 then raise exception 'SPOT_SIMPLE_FINISH_ANCHOR_MISSING';end if;
 src:=replace(src,anchor,$patch$elsif p_action='save_reasons' then
  if c.status<>'REVIEWING' then raise exception 'SPOT_LOCKED' using errcode='22023';end if;
  selected:=p_data->'entries';
  if selected is null or jsonb_typeof(selected)<>'array' or jsonb_array_length(selected) not between 1 and 3000
   or (select count(*) from jsonb_array_elements(selected))<>(select count(distinct value->>'entry_id') from jsonb_array_elements(selected)) then raise exception 'SPOT_INVALID_INPUT' using errcode='22023';end if;
  for row_data in select value from jsonb_array_elements(selected) loop
   if row_data?'quantity' or jsonb_typeof(row_data->'note') is distinct from 'string' or length(row_data->>'note')>1000 then raise exception 'SPOT_INVALID_INPUT' using errcode='22023';end if;
   select * into item from private.spot_check_items where spot_check_items.check_id=c.id and entry_id=(row_data->>'entry_id')::uuid and review_status in ('PENDING','REVIEWED') for update;
   if not found then raise exception 'SPOT_ITEM_OUT_OF_SCOPE' using errcode='42501';end if;
   update private.spot_check_items set note=row_data->>'note' where spot_check_items.check_id=c.id and entry_id=item.entry_id;
   insert into private.spot_check_events(check_id,entry_id,action,actor_id,actor_name,payload)
   select c.id,item.entry_id,'save_reasons',auth.uid(),actor_name,jsonb_build_object('before',to_jsonb(item),'after',to_jsonb(i)) from private.spot_check_items i where i.check_id=c.id and i.entry_id=item.entry_id;
  end loop;
 elsif p_action='finish' then
  if c.status not in ('OPEN','REVIEWING') then raise exception 'SPOT_LOCKED' using errcode='22023';end if;
  if not exists(select 1 from private.spot_check_items where spot_check_items.check_id=c.id)
   or exists(select 1 from private.spot_check_items where spot_check_items.check_id=c.id and quantity is null) then raise exception 'SPOT_INCOMPLETE' using errcode='22023';end if;
  if exists(select 1 from private.spot_check_items where spot_check_items.check_id=c.id and review_status not in ('SAME','CLOSED') and quantity<>original_quantity and btrim(note)='') then raise exception 'SPOT_ONSITE_REASON_REQUIRED' using errcode='22023';end if;
  for item in select * from private.spot_check_items where spot_check_items.check_id=c.id and review_status not in ('SAME','CLOSED') for update loop
   update private.spot_check_items set review_status=case when quantity=original_quantity then 'SAME' else 'CLOSED' end,
    reason=case when btrim(note)<>'' then case when reason is null or reason='UNKNOWN' then 'OTHER' else reason end else reason end,
    final_quantity=case when c.status='REVIEWING' and item.review_status='REVIEWED' then coalesce(recheck_quantity,quantity) else quantity end,
    confirmed_by=auth.uid(),confirmed_name=actor_name,confirmed_at=now()
   where spot_check_items.check_id=c.id and entry_id=item.entry_id;
   insert into private.spot_check_events(check_id,entry_id,action,actor_id,actor_name,payload)
   select c.id,item.entry_id,'finish',auth.uid(),actor_name,jsonb_build_object('before',to_jsonb(item),'after',to_jsonb(i)) from private.spot_check_items i where i.check_id=c.id and i.entry_id=item.entry_id;
  end loop;
  update private.spot_checks set status='CLOSED',closed_at=now(),submitted_at=coalesce(submitted_at,now()),submitted_by=coalesce(submitted_by,auth.uid()),submitted_name=coalesce(submitted_name,actor_name) where id=c.id;
 elsif p_action='submit' then$patch$);
 -- Per-item reason/finish events above include exact before/after evidence.
 src:=replace(src,$q$if p_action<>'save_entries' then$q$,$q$if p_action not in ('save_entries','save_reasons','finish') then$q$);
 execute src;
end $$;
notify pgrst,'reload schema';
