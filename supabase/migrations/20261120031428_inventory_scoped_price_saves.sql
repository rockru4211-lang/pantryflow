-- Saving one inventory valuation must not price every other item in the month.
-- Keep month/source selection, raw signatures, closure checks and revision guards.
do $migration$
declare definition text; anchor text; replacement text;
begin
 definition:=pg_get_functiondef('private.inventory_month_state(uuid,date,uuid)'::regprocedure);
 anchor:='case when not historical and c->>''quantity'' is not null';
 if strpos(definition,anchor)=0 then raise exception 'INVENTORY_SCOPED_QUOTE_ANCHOR';end if;
 definition:=replace(definition,anchor,anchor||' and not coalesce(quote_review.price_set,false)');
 execute definition;

 anchor:='private.inventory_month_state(p_store uuid, p_month date, p_session uuid DEFAULT NULL::uuid)';
 if strpos(definition,anchor)=0 then raise exception 'INVENTORY_SCOPED_SIGNATURE_ANCHOR';end if;
 definition:=replace(definition,anchor,'private.inventory_month_row_state(p_store uuid, p_month date, p_session uuid, p_row_key text)');
 anchor:=$old$from jsonb_array_elements(current_rows) c full join jsonb_array_elements(previous_rows) p on c->>'row_key'=p->>'row_key'$old$;
 if strpos(definition,anchor)=0 then raise exception 'INVENTORY_SCOPED_ROWS_ANCHOR';end if;
 definition:=replace(definition,anchor,anchor||$new$
   where coalesce(c->>'row_key',p->>'row_key')=p_row_key$new$);
 execute definition;

 definition:=pg_get_functiondef('public.save_baihuayuan_inventory_inline_v3(uuid,date,uuid,text,jsonb,text,text,numeric,numeric,text)'::regprocedure);
 anchor:=$old$state:=private.baihuayuan_inventory_month(p_store_id,p_month,'read',jsonb_build_object('session_id',p_session_id));$old$;
 if strpos(definition,anchor)=0 then raise exception 'INVENTORY_SCOPED_INLINE_READ_ANCHOR';end if;
 replacement:=$new$-- Retain the outer read API's store and month validation.
 if not exists(select 1 from public.stores where id=p_store_id and is_active and name in ('BeApe','Gras') and organization_id is not null)
 then raise exception 'INVENTORY_ADMIN_REQUIRED' using errcode='42501';end if;
 if p_month is null or p_month<>date_trunc('month',p_month)::date or p_month<'2000-01-01' or p_month>'2100-12-01'
 then raise exception 'INVALID_INVENTORY_MONTH' using errcode='22023';end if;
 state:=private.inventory_month_row_state(p_store_id,p_month,p_session_id,p_row_key);$new$;
 definition:=replace(definition,anchor,replacement);
 anchor:='private.inventory_month_state(p_store_id,p_month,p_session_id)';
 if strpos(definition,anchor)=0 then raise exception 'INVENTORY_SCOPED_INLINE_AFTER_ANCHOR';end if;
 execute replace(definition,anchor,'private.inventory_month_row_state(p_store_id,p_month,p_session_id,p_row_key)');

 definition:=pg_get_functiondef('public.save_baihuayuan_inventory_valuation(uuid,date,uuid,text,jsonb,jsonb,jsonb)'::regprocedure);
 anchor:='private.inventory_month_state(p_store_id,p_month,p_session_id)';
 if strpos(definition,anchor)=0 then raise exception 'INVENTORY_SCOPED_VALUATION_ANCHOR';end if;
 definition:=replace(definition,anchor,'private.inventory_month_row_state(p_store_id,p_month,p_session_id,p_row_key)');
 anchor:=$old$return jsonb_build_object('saved',true,'replayed',true);$old$;
 if strpos(definition,anchor)=0 then raise exception 'INVENTORY_SCOPED_REPLAY_ANCHOR';end if;
 definition:=replace(definition,anchor,$new$return jsonb_build_object('saved',true,'replayed',true,'row',
   private.inventory_category_rows(jsonb_build_object('rows',jsonb_build_array(r)),p_store_id)#>'{rows,0}');$new$);
 anchor:=$old$result:=jsonb_build_object('saved',true);$old$;
 if strpos(definition,anchor)=0 then raise exception 'INVENTORY_SCOPED_RESULT_ANCHOR';end if;
 -- Return the committed row, including its new source signature and evidence.
 -- The client can finish the save without refetching the entire workspace.
 execute replace(definition,anchor,$new$state:=private.inventory_category_rows(private.inventory_month_row_state(p_store_id,p_month,p_session_id,p_row_key),p_store_id);
 select x into r from jsonb_array_elements(state->'rows')x where x->>'row_key'=p_row_key;
 result:=jsonb_build_object('saved',true,'row',r);$new$);
end $migration$;

revoke all on function private.inventory_month_row_state(uuid,date,uuid,text) from public,anon,authenticated;
notify pgrst,'reload schema';
