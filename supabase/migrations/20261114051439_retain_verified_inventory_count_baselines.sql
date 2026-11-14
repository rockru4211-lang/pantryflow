-- A confirmed baseline is bound to an exact store, product and count unit.
-- Its supplier may be recorded on the original reference instead of the quote.
create function private.inventory_count_baseline(s uuid, product uuid, u text, cutoff date, supplier text)
returns jsonb language sql stable set search_path='' set jit=off as $$
 select b.quote||jsonb_build_object('unit',u,'source','食材價格表 · 已確認基準')
 from private.ingredient_standard_baselines b
 join public.products p on p.id=b.product_id
 join public.stores shop on shop.id=b.store_id and shop.organization_id=p.organization_id
 left join private.recipe_price_entries ref on ref.store_id=b.store_id and ref.id=(b.quote->>'reference_id')::uuid
 left join public.suppliers ref_supplier on ref_supplier.organization_id=shop.organization_id and ref_supplier.id::text=ref.source_ref->>'supplier_id'
 left join public.suppliers product_supplier on product_supplier.organization_id=shop.organization_id
  and product_supplier.id=p.current_supplier_id
 cross join lateral (select private.inventory_supplier_key(shop.organization_id,coalesce(
  nullif(b.quote->>'supplier_name',''),ref_supplier.name,ref.source_ref->>'supplier_name')) source_key,
  private.inventory_supplier_key(shop.organization_id,supplier) count_key
 ) keys
 where b.store_id=s and b.product_id=product and b.quote->>'basis'='confirmed_baseline'
  and private.inventory_rate_unit(b.unit)=private.inventory_rate_unit(u)
  and (b.quote->>'price')::numeric>=0 and (b.quote->>'price')::numeric<1000000000
  and coalesce(nullif(b.quote->>'date','')::date,(b.captured_at at time zone 'Asia/Taipei')::date)<=cutoff
  and (keys.count_key is null or keys.source_key=keys.count_key or (
   keys.source_key is null and private.inventory_supplier_key(shop.organization_id,product_supplier.name)=keys.count_key))
  and not exists(select 1 from private.ingredient_aliases a
   join private.ingredient_masters m on m.store_id=s and m.id=a.ingredient_id
   join private.ingredient_supply_state stop on stop.store_id=s and stop.ingredient_id=coalesce(m.canonical_ingredient_id,m.id)
   where a.store_id=s and a.source_key='p:'||product::text and stop.stopped
    and (stop.supplier_key='*' or stop.supplier_key=keys.count_key
     or private.inventory_supplier_key(shop.organization_id,stop.supplier_name)=keys.count_key))
 order by (b.unit=u) desc,b.captured_at desc,b.unit
 limit 1
$$;
revoke all on function private.inventory_count_baseline(uuid,uuid,text,date,text) from public,anon,authenticated;

create or replace function private.inventory_count_quote(s uuid, product uuid, nm text, u text, cutoff date, supplier text)
returns jsonb language plpgsql stable set search_path='' set jit=off as $$
declare q jsonb; known jsonb; org uuid;
begin
 q:=private.inventory_scoped_cost_quote(s,product,nm,u,cutoff,null,supplier);
 if q->>'basis' in ('receipt','locked') or q->>'price' is not null then
  return private.inventory_apply_conversion(s,product,u,cutoff,q);
 end if;
 if product is null or q->>'reason' not in ('缺少已確認進價或單位換算','同名有不同品項或規格，待確認對應','盤點單位待確認') then
  return q;
 end if;
 known:=private.inventory_count_baseline(s,product,u,cutoff,supplier);
 if known is not null then return known;end if;
 known:=private.inventory_scoped_purchase_quote(s,product,u,cutoff,supplier);
 if known->>'price' is not null then return known;end if;
 if jsonb_typeof(q->'purchase')='object' then return q;end if;
 select organization_id into org from public.stores where id=s;
 if private.inventory_supplier_key(org,supplier) is null then
  return coalesce(known,private.inventory_known_standard(s,product,u,cutoff),q);
 end if;
 return coalesce(known,q);
end
$$;
