-- Keep previously confirmed recipe prices usable until a master ingredient has a confirmed cost.
-- A master mapping must never turn an existing confirmed quote into "待補資料".
create or replace function private.recipe_prices(s uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
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
 ), quotes as (
   select jsonb_build_object(
     'key',m.key,
     'name',m.name,
     'product_id',case when m.key like 'p:%' then substring(m.key from 3) end,
     'unit',m.unit,
     'price',m.cost_price,
     'cost_price',m.cost_price,
     'source','基礎食材',
     'source_kind','manual',
     'effective_date',coalesce(r.effective_date,m.updated_at::date),
     'recorded_at',m.updated_at,
     'reference_id',m.selected_reference,
     'source_ref',coalesce(r.source_ref,'{}'::jsonb)||jsonb_build_object('ingredient_id',m.id),
     'purchase',case when not m.manual and r.purchase is not null
       then r.purchase
       else jsonb_build_object('amount',m.cost_price,'quantity',1,'unit',m.unit)
     end
   ) value
   from resolved m
   left join private.recipe_price_entries r on r.id=m.selected_reference

   union all

   -- Critical fallback: if a master exists but has not yet been confirmed,
   -- retain the already-confirmed quote that previously priced the recipe.
   select x.value
   from jsonb_array_elements(original) x
   where not exists(
     select 1 from resolved m
     where m.key=x.value->>'key'
       and m.unit=x.value->>'unit'
   )
 )
 select coalesce(jsonb_agg(value),'[]') into result from quotes;
 return result;
end $$;

alter function private.recipe_prices(uuid) set jit = off;
notify pgrst,'reload schema';
