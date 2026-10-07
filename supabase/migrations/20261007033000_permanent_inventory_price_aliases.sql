-- Permanent inventory-price resolution.
-- Priority: confirmed product alias -> exact product-id purchase unit -> confirmed historical receiving.
-- Ambiguous unit changes remain pending.

create or replace function private.ingredient_price_quote(
  p_store uuid,
  p_product uuid,
  p_unit text
)
returns numeric
language plpgsql
stable security definer
set search_path=''
as $$
declare
  v_price numeric;
  v_name text;
begin
  if p_store is null or p_product is null or nullif(btrim(coalesce(p_unit,'')),'') is null then
    return null;
  end if;

  select m.cost_price*private.recipe_factor(p_unit)
  into v_price
  from private.ingredient_aliases a
  join private.ingredient_masters m on m.id=a.ingredient_id and m.store_id=a.store_id
  left join private.recipe_price_entries r on r.id=m.selected_reference and r.store_id=m.store_id
  where a.store_id=p_store
    and a.source_key='p:'||p_product::text
    and a.source_unit=private.recipe_unit(p_unit)
    and m.review_status='confirmed'
    and m.cost_price is not null
  order by a.corrected desc,
    case when r.source_kind='purchase' then 0 when r.source_kind='manual' then 1 else 2 end,
    r.effective_date desc nulls last,r.created_at desc nulls last,m.updated_at desc,m.id
  limit 1;

  if v_price is not null then return v_price; end if;

  select nullif(p.purchase->>'amount','')::numeric/nullif(p.purchase->>'quantity','')::numeric
  into v_price
  from private.recipe_price_entries p
  where p.store_id=p_store
    and p.review_status='confirmed'
    and p.price is not null
    and p.source_ref->>'product_id'=p_product::text
    and nullif(p.purchase->>'amount','') is not null
    and nullif(p.purchase->>'quantity','')::numeric>0
    and private.recipe_unit(p.purchase->>'unit')=private.recipe_unit(p_unit)
  order by case when p.source_kind='purchase' then 0 else 1 end,
    p.effective_date desc nulls last,p.created_at desc,p.id desc
  limit 1;

  if v_price is not null then return v_price; end if;

  select name into v_name
  from public.products
  where id=p_product
    and organization_id=(select organization_id from public.stores where id=p_store);

  if v_name is null then return null; end if;

  select
    (nullif(h.data->>'price','')::numeric/private.recipe_factor(h.data->>'unit'))
    *private.recipe_factor(p_unit)
  into v_price
  from private.historical_source_records h
  join private.historical_imports i on i.id=h.import_id
  where i.store_id=p_store
    and h.kind='RECEIVING'
    and not h.needs_confirmation
    and nullif(h.data->>'price','') is not null
    and nullif(h.data->>'price','')::numeric>=0
    and private.recipe_unit(h.data->>'unit')=private.recipe_unit(p_unit)
    and regexp_replace(lower(btrim(h.data->>'name')),'[[:space:][:punct:]]','','g')
        =regexp_replace(lower(btrim(v_name)),'[[:space:][:punct:]]','','g')
  order by nullif(h.data->>'date','')::date desc nulls last,h.ordinal desc
  limit 1;

  return v_price;
end;
$$;

revoke all on function private.ingredient_price_quote(uuid,uuid,text)
from public,anon,authenticated;

-- Known confirmed aliases in BeApe.
do $aliases$
declare
  v_store uuid;
  v_product uuid;
  v_master uuid;
  v_ref uuid;
begin
  select s.id into v_store
  from public.stores s
  where s.name='BeApe' and s.is_active
  order by (private.inventory_month_state(s.id,'2026-09-01'::date,null)#>>'{summary,items}')::int desc nulls last
  limit 1;
  if v_store is null then return; end if;

  -- 2GR M8-M9 -> 2GR...翼板肉MB8-9, 1900/kg.
  select p.id into v_product from public.products p
  join public.stores s on s.organization_id=p.organization_id
  where s.id=v_store and p.name='2GR穀飼澳洲純種和牛翼板肉 M8-M9' limit 1;
  select m.id into v_master from private.ingredient_masters m
  where m.store_id=v_store and m.name='2GR穀飼澳洲純種和牛-翼板肉MB8-9'
    and m.cost_price=1.9 and m.review_status='confirmed'
  order by m.updated_at desc limit 1;
  if v_product is not null and v_master is not null then
    insert into private.ingredient_aliases(store_id,ingredient_id,name,source_key,source_unit,specification,reference_ids,corrected)
    select v_store,v_master,'2GR穀飼澳洲純種和牛翼板肉 M8-M9','p:'||v_product::text,'g','',
           array_remove(array[m.selected_reference],null),true
    from private.ingredient_masters m where m.id=v_master
    on conflict(store_id,source_key,source_unit,specification)
    do update set ingredient_id=excluded.ingredient_id,name=excluded.name,reference_ids=excluded.reference_ids,corrected=true;
  end if;

  -- Giffard / 吉法哈密瓜香甜酒 -> 450/bottle.
  select p.id into v_product from public.products p
  join public.stores s on s.organization_id=p.organization_id
  where s.id=v_store and p.name='Giffard (代替哈密瓜酒)' limit 1;
  select m.id into v_master from private.ingredient_masters m
  where m.store_id=v_store and m.name='吉法 哈密瓜香甜酒'
    and m.unit='瓶' and m.cost_price=450 and m.review_status='confirmed'
  order by m.updated_at desc limit 1;
  if v_product is not null and v_master is not null then
    insert into private.ingredient_aliases(store_id,ingredient_id,name,source_key,source_unit,specification,reference_ids,corrected)
    select v_store,v_master,'Giffard (代替哈密瓜酒)','p:'||v_product::text,'瓶','',
           array_remove(array[m.selected_reference],null),true
    from private.ingredient_masters m where m.id=v_master
    on conflict(store_id,source_key,source_unit,specification)
    do update set ingredient_id=excluded.ingredient_id,name=excluded.name,reference_ids=excluded.reference_ids,corrected=true;
  end if;

  -- 7cm tower shell: 1140/box, 60 pieces per box = 19/piece.
  select p.id into v_product from public.products p
  join public.stores s on s.organization_id=p.organization_id
  where s.id=v_store and p.name='7cm直角塔殼 60pcs' limit 1;

  select p.id into v_ref
  from private.recipe_price_entries p
  where p.store_id=v_store and p.name='7cm直角塔殼 60pcs'
    and p.unit='箱' and p.price=1140 and p.review_status='confirmed'
  order by p.effective_date desc nulls last,p.created_at desc limit 1;

  if v_product is not null and v_ref is not null then
    insert into private.ingredient_masters(
      store_id,name,unit,cost_price,selected_reference,review_status,manual,purchase
    )
    values(
      v_store,'7cm直角塔殼 60pcs · 60顆/箱','顆',19,v_ref,'confirmed',false,
      jsonb_build_object('amount',1140,'quantity',1,'unit','箱',
        'content_quantity',60,'content_unit','顆','conversion_basis','package')
    )
    on conflict(store_id,lower(btrim(name)),unit) do update set
      cost_price=excluded.cost_price,selected_reference=excluded.selected_reference,
      review_status='confirmed',purchase=excluded.purchase,
      revision=private.ingredient_masters.revision+1,updated_at=now();

    select m.id into v_master
    from private.ingredient_masters m
    where m.store_id=v_store
      and lower(btrim(m.name))=lower(btrim('7cm直角塔殼 60pcs · 60顆/箱'))
      and m.unit='顆' limit 1;

    insert into private.ingredient_aliases(store_id,ingredient_id,name,source_key,source_unit,specification,reference_ids,corrected)
    values(v_store,v_master,'7cm直角塔殼 60pcs','p:'||v_product::text,'顆','',array[v_ref],true)
    on conflict(store_id,source_key,source_unit,specification)
    do update set ingredient_id=excluded.ingredient_id,name=excluded.name,reference_ids=excluded.reference_ids,corrected=true;
  end if;
end
$aliases$;

notify pgrst,'reload schema';
