-- Carry a completed physical count into the following month's opening without
-- requiring a financial close or re-running the preceding month's price lookup.
create function private.inventory_month_carry_source(p_store uuid,p_month date)
returns jsonb language plpgsql stable security invoker set search_path='' as $function$
declare
 closed private.inventory_month_closures%rowtype;
 counted public.inventory_count_sessions%rowtype;
 historical jsonb;
 preceding jsonb;
 carried jsonb;
begin
 select * into closed from private.inventory_month_closures
 where store_id=p_store and month=p_month;
 if found then
  select coalesce(jsonb_agg(r||jsonb_build_object('quantity',r->'current_quantity')),'[]')
  into carried from jsonb_array_elements(closed.payload->'rows') r
  where r->>'current_quantity' is not null;
  return jsonb_build_object('id',closed.session_id,'completed_at',closed.payload->'completed_at','rows',carried);
 end if;
 historical:=private.historical_inventory_source(p_store,p_month);
 if historical is not null then return historical;end if;

 select s.* into counted from public.inventory_count_sessions s
 where s.store_id=p_store and s.status in ('REVIEWING','CLOSED')
  and private.inventory_count_date(s.id)>=p_month
  and private.inventory_count_date(s.id)<(p_month+interval '1 month')::date
  and private.inventory_count_has_data(s.id)
 order by private.inventory_count_date(s.id) desc,s.started_at desc,s.id
 limit 1;
 if counted.id is null then return null;end if;

 preceding:=private.inventory_month_carry_source(p_store,(p_month-interval '1 month')::date);
 with source_rows as materialized (
  select c,p,md5(jsonb_build_array(c,p)::text) signature
  from jsonb_array_elements(private.inventory_month_source(counted.id)) c
  left join jsonb_array_elements(coalesce(preceding->'rows','[]')) p on p->>'row_key'=c->>'row_key'
 )
 select coalesce(jsonb_agg(c||jsonb_build_object(
  'quantity',coalesce(q.quantity,(c->>'quantity')::numeric),
  'unit',private.inventory_count_unit(coalesce(r.report_unit,c->>'unit')),
  'unit_price',case when r.price_set then r.unit_price else (c->>'unit_price')::numeric end
 ) order by c->>'name',c->>'unit'),'[]') into carried
 from source_rows x
 left join private.inventory_month_quantity_adjustments q
  on q.store_id=p_store and q.month=p_month and q.session_id=counted.id and q.row_key=c->>'row_key'
 left join private.inventory_month_reviews r
  on r.store_id=p_store and r.month=p_month and r.session_id=counted.id and r.row_key=c->>'row_key'
  and (r.source_signature=x.signature
   or r.source_signature=md5(jsonb_build_array(c,null::jsonb)::text));
 return jsonb_build_object('id',counted.id,'completed_at',counted.completed_at,'rows',carried);
end $function$;
revoke all on function private.inventory_month_carry_source(uuid,date) from public,anon,authenticated;

do $migration$
declare definition text;anchor text;replacement text;
begin
 definition:=pg_get_functiondef('private.inventory_month_state(uuid,date,uuid)'::regprocedure);
 anchor:=$old$else baseline_pending:=exists(select 1 from public.inventory_count_sessions s where s.store_id=p_store and s.status in ('REVIEWING','CLOSED') and private.inventory_count_date(s.id)>=previous_month and private.inventory_count_date(s.id)<p_month);end if;$old$;
 replacement:=$new$else
   prev_hist:=private.inventory_month_carry_source(p_store,previous_month);
   if prev_hist is not null then
    has_previous:=true;previous_rows:=prev_hist->'rows';
    select * into previous from public.inventory_count_sessions where id=(prev_hist->>'id')::uuid;
   end if;
  end if;$new$;
 if strpos(definition,anchor)=0 then raise exception 'INVENTORY_OPENING_SOURCE_ANCHOR';end if;
 definition:=replace(definition,anchor,replacement);

 -- Adding a missing opening must preserve reviews saved against the same
 -- unchanged count row before an opening was available.
 anchor:='quote_review.source_signature=paired.signature';
 if strpos(definition,anchor)=0 then raise exception 'INVENTORY_OPENING_QUOTE_ANCHOR';end if;
 definition:=replace(definition,anchor,$new$(quote_review.source_signature=paired.signature
    or previous.id is not null and quote_review.source_signature=md5(jsonb_build_array(paired.c,null::jsonb)::text))$new$);
 anchor:='r.source_signature=x.signature';
 if strpos(definition,anchor)=0 then raise exception 'INVENTORY_OPENING_REVIEW_ANCHOR';end if;
 definition:=replace(definition,anchor,$new$(r.source_signature=x.signature
    or previous.id is not null and r.source_signature=md5(jsonb_build_array(x.c,null::jsonb)::text))$new$);

 anchor:=$old$case when r.report_unit is not null and r.report_unit is distinct from x.p->>'unit' then null else (x.p->>'quantity')::numeric end as previous_qty,$old$;
 replacement:=$new$case when x.c is not null and x.p is not null
    and private.history_unit(private.inventory_count_unit(coalesce(r.report_unit,x.c->>'unit')))
      is distinct from private.history_unit(private.inventory_count_unit(x.p->>'unit'))
   then null else (x.p->>'quantity')::numeric end as previous_qty,$new$;
 if strpos(definition,anchor)=0 then raise exception 'INVENTORY_OPENING_UNIT_ANCHOR';end if;
 definition:=replace(definition,anchor,replacement);
 anchor:=$old$case when r.report_unit is not null and x.p is not null and r.report_unit is distinct from x.p->>'unit' then 'UNIT_CHANGED'$old$;
 replacement:=$new$case when x.c is not null and x.p is not null
    and private.history_unit(private.inventory_count_unit(coalesce(r.report_unit,x.c->>'unit')))
      is distinct from private.history_unit(private.inventory_count_unit(x.p->>'unit')) then 'UNIT_CHANGED'$new$;
 if strpos(definition,anchor)=0 then raise exception 'INVENTORY_OPENING_UNIT_STATUS_ANCHOR';end if;
 definition:=replace(definition,anchor,replacement);

 execute definition;
end $migration$;
notify pgrst,'reload schema';
