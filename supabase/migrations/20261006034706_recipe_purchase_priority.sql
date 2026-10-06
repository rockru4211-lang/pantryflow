-- Read-only priority correction; preserve saved recipes and ingredient records.
CREATE OR REPLACE FUNCTION private.recipe_prices(s uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET jit TO 'off'
AS $function$
declare original jsonb; result jsonb;
begin
 if not private.recipe_allowed(s) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 original:=private.recipe_prices_before_master(s);
 with maps as materialized (
   select 'i:'||id key,unit,id ingredient_id
   from private.ingredient_masters where store_id=s
   union
   select 'n:'||lower(btrim(m.name)),m.unit,m.id
   from private.ingredient_masters m
   where m.store_id=s
     and not exists(
       select 1 from private.ingredient_aliases a
       where a.store_id=s
         and a.source_key='n:'||lower(btrim(m.name))
         and a.source_unit=m.unit
         and a.ingredient_id<>m.id
     )
   union
   select source_key,source_unit,ingredient_id
   from private.ingredient_aliases where store_id=s
 ), unique_maps as (
   select key,unit,min(ingredient_id::text)::uuid ingredient_id
   from maps
   group by key,unit
   having count(distinct ingredient_id)=1
 ), resolved as materialized (
   select distinct u.key,m.*
   from unique_maps u
   join private.ingredient_masters m on m.id=u.ingredient_id
   where m.cost_price is not null and m.review_status='confirmed'
 ), purchase_quotes as materialized (
   select x.value,u.ingredient_id
   from jsonb_array_elements(original) x
   join unique_maps u on u.key=x.value->>'key' and u.unit=x.value->>'unit'
   join private.ingredient_masters m on m.id=u.ingredient_id and m.unit=x.value->>'unit'
   where x.value->>'source_kind'='purchase'
     and coalesce(x.value->>'conversion_pending','false')<>'true'
     and coalesce(x.value#>>'{source_ref,missing_price}','false')<>'true'
 ), preferred_prices as (
   select distinct on(ingredient_id) ingredient_id,value from purchase_quotes
   order by ingredient_id,private.ingredient_source_priority(value->>'source',value->>'source_kind'),
     value->>'effective_date' desc nulls last,value->>'recorded_at' desc nulls last,value->>'source_id' desc
 ), quotes as (
   select coalesce(preferred.value||jsonb_build_object('key',m.key,'name',m.name,'source_ref',coalesce(preferred.value->'source_ref','{}'::jsonb)||jsonb_build_object('ingredient_id',m.id)),jsonb_build_object(
     'key',m.key,
     'name',m.name,
     'product_id',case when m.key like 'p:%' then substring(m.key from 3) end,
     'unit',m.unit,
     'price',m.cost_price,
     'cost_price',m.cost_price,
     'source',coalesce(r.source,'人工設定'),
     'source_kind',coalesce(r.source_kind,'manual'),
     'effective_date',coalesce(r.effective_date,m.updated_at::date),
     'recorded_at',m.updated_at,
     'reference_id',m.selected_reference,
     'source_ref',coalesce(r.source_ref,'{}'::jsonb)||jsonb_build_object('ingredient_id',m.id),
     'purchase',coalesce(coalesce(m.purchase,case when m.cost_price=coalesce(r.cost_price,r.price)/private.recipe_factor(r.unit) then r.purchase end),jsonb_build_object('amount',m.cost_price,'quantity',1,'unit',m.unit))
   )) value
   from resolved m
   left join private.recipe_price_entries r on r.id=m.selected_reference
   left join preferred_prices preferred on preferred.ingredient_id=m.id and (not m.manual or m.selected_reference is not null)
   union all
   select x.value
   from jsonb_array_elements(original) x
   where not exists(
     select 1 from resolved m
     where m.key=x.value->>'key'
   )
 )
 select coalesce(jsonb_agg(value),'[]') into result from quotes;
 return result;
end $function$;

