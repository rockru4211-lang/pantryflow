-- Resolve exact recipe names once per request rather than rescanning the
-- ingredient catalog for every recipe line. No table rows or saved costs change.
create or replace function private.recipe_current_prices(s uuid) returns jsonb
language plpgsql stable security invoker set search_path='' set jit=off as $$
declare result jsonb;
begin
 if auth.uid() is null or not private.recipe_allowed(s) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 with raw_identities as materialized (
  select distinct case when nullif(l->>'ingredient_id','') is not null then 'i:'||(l->>'ingredient_id')
   when nullif(l->>'product_id','') is not null then 'p:'||(l->>'product_id') else 'n:'||lower(btrim(l->>'name')) end key,
   nullif(l->>'ingredient_id','')::uuid ingredient, nullif(l->>'product_id','')::uuid product,
   l->>'name' name,requested.unit
  from private.recipe_cards r cross join lateral jsonb_array_elements(r.document->'lines') l
  cross join lateral (select private.recipe_unit(l->>'unit') unit
    union select private.recipe_unit(private.recipe_note_basis(l,coalesce(r.document->>'notes',''))->>'countUnit')) requested
  where r.store_id=s and nullif(l->>'recipe_id','') is null and nullif(requested.unit,'') is not null
 ), identities as materialized (
  -- A key/unit is priced only once. Conflicting explicit product mappings are
  -- not resolved by ordering recipe rows or choosing an arbitrary product.
  select key,unit,min(ingredient::text)::uuid ingredient,min(product::text)::uuid product,min(name) name,
   count(distinct coalesce(product::text,''))>1 identity_conflict
  from raw_identities group by key,unit
 ), requested_names as materialized (
  select distinct private.cost_name_key(name) name_key from identities where ingredient is null and product is null
 ), name_links as materialized (
  select private.cost_name_key(m.name) name_key,coalesce(m.canonical_ingredient_id,m.id) root
  from private.ingredient_masters m where m.store_id=s and exists(select 1 from requested_names)
  union
  select private.cost_name_key(a.name),coalesce(m.canonical_ingredient_id,m.id)
  from private.ingredient_aliases a join private.ingredient_masters m on m.id=a.ingredient_id and m.store_id=s
  where a.store_id=s and a.corrected and exists(select 1 from requested_names)
 ), name_map as materialized (
  select n.name_key,count(distinct l.root) root_count,min(l.root::text)::uuid root
  from requested_names n left join name_links l using(name_key) group by n.name_key
 ), resolved as materialized (
  select i.*,n.root_count,n.root from identities i left join name_map n
   on i.ingredient is null and i.product is null and n.name_key=private.cost_name_key(i.name)
 ), quoted as materialized (
  select i.*,case
   when identity_conflict or root_count>1 then jsonb_build_object('price',null,'unit',unit,'reason','同名有不同品項或規格，待確認對應')
   when ingredient is null and product is null and coalesce(root_count,0)=0
    then jsonb_build_object('price',null,'unit',unit,'reason','缺少已確認進價或單位換算')
   else private.automatic_cost_quote(s,product,name,unit,(now() at time zone 'Asia/Taipei')::date,coalesce(ingredient,root)) end q
  from resolved i
 ) select coalesce(jsonb_agg(jsonb_build_object('key',key,'name',name,'product_id',product,'unit',unit,
   'price',q->'price','cost_price',q->'price','source',q->'source','source_kind',case when q->>'basis'='receipt' then 'purchase' else 'manual' end,
   'effective_date',q->'date','reference_id',q->'reference_id','reason',q->'reason',
   'source_ref',jsonb_build_object('ingredient_id',ingredient,'supplier_name',q->'supplier_name','batch_id',q->'batch_id','receipt_purchase',q->'purchase','specification',q->'specification'),
   'purchase',jsonb_build_object('amount',q->'price','quantity',1,'unit',unit)||
    case when private.recipe_unit(q#>>'{purchase,content_unit}')=unit and (q#>>'{purchase,content_quantity}')::numeric>0
     then jsonb_build_object('conversion_basis','package','content_unit',unit,'content_quantity',q#>'{purchase,content_quantity}') else '{}'::jsonb end) order by key,unit),'[]') into result from quoted;
 return result;
end $$;
revoke all on function private.recipe_current_prices(uuid) from public,anon,authenticated;


-- Values of store/product/root vary widely. Avoid a generic plan repeatedly
-- scanning all receipts for a specific product or canonical ingredient.
alter function private.automatic_cost_quote(uuid,uuid,text,text,date,uuid) set plan_cache_mode=force_custom_plan;
notify pgrst,'reload schema';
