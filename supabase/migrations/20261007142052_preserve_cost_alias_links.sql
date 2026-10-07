create or replace function private.cost_quote(s uuid,product uuid,nm text,u text,at_date date) returns jsonb
language plpgsql stable security definer set search_path='' set jit=off set plan_cache_mode=force_custom_plan as $$
declare name_key text; master_ids uuid[]; reference_ids uuid[]; chosen record; product_name text; specs text; result jsonb; target_date date:=coalesce(at_date,(now() at time zone 'Asia/Taipei')::date);
begin
 if s is null or nullif(btrim(u),'') is null then return jsonb_build_object('price',null,'reason','待補計價單位');end if;
 if product is not null then
  select p.name,coalesce(p.specification,'') into product_name,specs from public.products p
  join public.stores st on st.organization_id=p.organization_id where st.id=s and p.id=product;
  if product_name is null then return jsonb_build_object('price',null,'reason','品項不屬於此門市');end if;
 else product_name:=nm;specs:='';end if;
 if nullif(btrim(product_name),'') is null then return jsonb_build_object('price',null,'reason','待補品名');end if;
 name_key:=private.cost_name_key(product_name);
 select array_agg(distinct a.ingredient_id),array_agg(distinct rid) into master_ids,reference_ids from private.ingredient_aliases a left join lateral unnest(a.reference_ids) rid on true where a.store_id=s and (a.source_key='p:'||product::text or private.cost_name_key(a.name)=name_key);
 select array_agg(distinct rid) into reference_ids from (
  select unnest(reference_ids) rid
  union select selected_reference from private.ingredient_masters where store_id=s and id=any(master_ids)
  union select unnest(a.reference_ids) from private.ingredient_aliases a where a.store_id=s and a.ingredient_id=any(master_ids)
 ) refs where rid is not null;
 -- Explicitly saved prices and corrected identity links win; do not overwrite human work.
 select m.*,case when m.unit=private.recipe_unit(u) then m.cost_price*private.recipe_factor(u)
  else private.cost_purchase_price(m.purchase,u) end value into chosen
 from private.ingredient_masters m
 where m.store_id=s and m.manual and m.review_status='confirmed' and m.cost_price is not null
 and m.id in (select id from private.ingredient_masters where store_id=s and private.cost_name_key(name)=name_key union select unnest(master_ids))
 and (m.unit=private.recipe_unit(u) or private.cost_purchase_price(m.purchase,u) is not null)
 order by m.updated_at desc,m.id limit 1;
 if found then return jsonb_build_object('price',chosen.value,'source','人工確認','date',null,'reference_id',chosen.selected_reference,'basis','manual');end if;
 with linked as materialized (
  select a.ingredient_id,a.reference_ids,a.corrected
  from private.ingredient_aliases a
  where a.store_id=s and (a.source_key='p:'||product::text or private.cost_name_key(a.name)=name_key)
 ), eligible as materialized (
 select id from private.recipe_price_entries where store_id=s and product_id=product
 union select id from private.recipe_price_entries where store_id=s and private.cost_name_key(name)=name_key
 union select unnest(reference_ids)
 ), candidates as materialized (
  select r.*,case when r.purchase is not null then private.cost_purchase_price(r.purchase,u)
   when private.recipe_unit(r.unit)=private.recipe_unit(u) then r.price/private.recipe_factor(r.unit)*private.recipe_factor(u) end value,
   exists(select 1 from linked a where a.corrected and r.id=any(a.reference_ids)) corrected,
   case when r.source_kind='purchase' then 0 when r.source_kind='manual' then 1 else 2 end priority
  from private.recipe_price_entries r join eligible e on e.id=r.id
  where r.store_id=s and r.review_status='confirmed' and r.price is not null
  and coalesce(r.source_ref->>'missing_price','false')<>'true'
  and (r.source_kind='history' or r.effective_date is null or r.effective_date<=target_date)
  and (coalesce(r.source_ref->>'specification','')='' or r.source_ref->>'specification' like '原表計價基準:%'
   or r.source_ref->>'specification'=specs or r.product_id=product
   or exists(select 1 from linked a where a.corrected and r.id=any(a.reference_ids)))
 ), ranked as (
  select * from candidates where value is not null and value>=0
  order by priority,effective_date desc nulls last,
   (source like '請購表%') desc,created_at desc,id desc limit 1
 ) select jsonb_build_object('price',value,'source',case when source_kind='history' then '食譜參考價 · '||source else source end,
  'date',case when source_kind='history' then null else effective_date end,'reference_id',id,
  'basis',case when source_kind='history' then 'recipe_reference' else 'purchase' end) into result from ranked;
 -- Legacy catalog prices and explicit package corrections have preserved purchase evidence.
 if result is null or result->>'basis'='recipe_reference' then
  select m.*,private.cost_purchase_price(m.purchase,u) value into chosen
  from private.ingredient_masters m where m.store_id=s and not m.manual and m.review_status='confirmed'
  and m.cost_price is not null and private.cost_purchase_price(m.purchase,u) is not null
  and (m.selected_reference is null and m.purchase->>'source'='歷史進貨' or exists(
   select 1 from private.ingredient_aliases a where a.store_id=s and a.ingredient_id=m.id and a.corrected and a.source_key='p:'||product::text))
  and m.id in (select id from private.ingredient_masters where store_id=s and private.cost_name_key(name)=name_key union select unnest(master_ids))
  and (nullif(m.purchase->>'effective_date','') is null or (m.purchase->>'effective_date')::date<=target_date)
  order by m.purchase->>'effective_date' desc nulls last,m.updated_at desc,m.id limit 1;
  if found then result:=jsonb_build_object('price',chosen.value,'source',coalesce(chosen.purchase->>'source','已確認規格換算'),
    'date',chosen.purchase->>'effective_date','reference_id',chosen.selected_reference,'basis','purchase');end if;
 end if;
 return coalesce(result,jsonb_build_object('price',null,'reason','缺少相符規格的價格或單位換算'));
end $$;
