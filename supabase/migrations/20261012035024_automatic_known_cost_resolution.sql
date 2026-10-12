-- Read-only resolution: standards first, unambiguous names, then dated confirmed history.
-- Never creates aliases, changes standards, or rewrites saved operations.
create or replace function private.known_cost_name(n text) returns text
language sql immutable set search_path='' as $$
 select translate(private.cost_name_key(n),'’‘‐‑–—','''''----')
$$;
revoke all on function private.known_cost_name(text) from public,anon,authenticated;

create or replace function private.resolved_cost_quote(s uuid, product uuid, nm text, u text, at_date date)
returns jsonb language plpgsql stable set search_path='' set jit=off as $$
declare q jsonb; ids uuid[]; candidate uuid; canonical text; k text;
 target date:=coalesce(at_date,(now() at time zone 'Asia/Taipei')::date);
 prices numeric[]; history_date date; history_id uuid;
begin
 q:=private.cost_quote(s,product,nm,u,target);
 if q->>'price' is not null or nullif(btrim(u),'') is null then return q;end if;
 if product is not null then
  select p.name into nm from public.products p join public.stores st on st.organization_id=p.organization_id where st.id=s and p.id=product;
 end if;
 k:=private.known_cost_name(nm);
 if nullif(k,'') is null then return q;end if;
 select array_agg(distinct id) into ids from (
  select m.id from private.ingredient_masters m where m.store_id=s and private.known_cost_name(m.name)=k
  union select a.ingredient_id from private.ingredient_aliases a where a.store_id=s and (private.known_cost_name(a.name)=k or a.source_key='p:'||product::text)
 ) x;
 -- Only a unique full-name match or unique sufficiently specific short name is eligible.
 if coalesce(cardinality(ids),0)=0 and length(k)>=4 then
  select array_agg(distinct id) into ids from (
   select m.id from private.ingredient_masters m where m.store_id=s and strpos(private.known_cost_name(m.name),k)>0
   union select a.ingredient_id from private.ingredient_aliases a where a.store_id=s and strpos(private.known_cost_name(a.name),k)>0
  ) x;
 end if;
 if cardinality(ids)>1 then return jsonb_build_object('price',null,'reason','同名有多種品項或規格，尚無唯一單價');end if;
 candidate:=ids[1];
 if candidate is not null then
  if exists(select 1 from private.ingredient_supply_state where store_id=s and ingredient_id=candidate and supplier_key='*' and stopped) then
   return jsonb_build_object('price',null,'reason','此品項已停止供貨');
  end if;
  -- Explicit pending standards must not be bypassed by historical fallback.
  if exists(select 1 from private.ingredient_masters where id=candidate and manual and review_status<>'confirmed') then return q;end if;
  select name into canonical from private.ingredient_masters where id=candidate;
  q:=private.cost_quote(s,null,canonical,u,target);
  if q->>'price' is not null then return q||jsonb_build_object('matched_name',canonical);end if;
 end if;
 -- Same store, exact identity, compatible unit, latest date on/before operation.
 -- Conflicting prices on that date remain unresolved; no future-price backfill.
 with eligible as (
  select m.id,(coalesce(m.occurred_at,m.created_at) at time zone 'Asia/Taipei')::date d,
   m.unit_price_snapshot/private.recipe_factor(m.unit)*private.recipe_factor(u) price
  from private.store_movements m
  where m.from_store_id=s and m.kind='TRANSFER' and m.review_status='CONFIRMED' and m.status='COMPLETE'
   and m.unit_price_snapshot is not null and m.unit_price_snapshot>=0
   and private.recipe_unit(m.unit)=private.recipe_unit(u)
   and (coalesce(m.occurred_at,m.created_at) at time zone 'Asia/Taipei')::date<=target
   and (private.known_cost_name(m.name)=k or (product is not null and m.product_id=product))
   and not exists(select 1 from private.baihuayuan_record_flags f where f.entity_type='TRANSFER' and f.entity_id=m.id and f.state<>'LIVE')
 ), latest as (select * from eligible where d=(select max(d) from eligible))
 select array_agg(distinct price),max(d),(array_agg(id order by id))[1] into prices,history_date,history_id from latest;
 if cardinality(prices)=1 then
  return jsonb_build_object('price',prices[1],'source','已確認調撥單價','date',history_date,'reference_id',history_id,'basis','confirmed_transfer','unit',u,'purchase',jsonb_build_object('amount',prices[1],'quantity',1,'unit',u));
 elsif cardinality(prices)>1 then
  return jsonb_build_object('price',null,'reason','同日已確認單價不同，尚無唯一單價');
 end if;
 return q||jsonb_build_object('reason',case when candidate is null then '尚無可對應的已知單價' else '已有價格，缺少此單位的包裝換算' end);
end $$;
revoke all on function private.resolved_cost_quote(uuid,uuid,text,text,date) from public,anon,authenticated;

-- Preserve the public RPC's existing store and role gates.
do $$declare src text;begin
 src:=pg_get_functiondef('public.baihuayuan_cost_quotes(uuid,jsonb)'::regprocedure);
 if strpos(src,'private.resolved_cost_quote(')=0 then
  if strpos(src,'private.cost_quote(')=0 then raise exception 'COST_RPC_CONTRACT_CHANGED';end if;
  execute replace(src,'private.cost_quote(','private.resolved_cost_quote(');
 end if;
end $$;
