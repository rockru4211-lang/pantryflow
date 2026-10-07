-- Reviewed aliases reuse original source quotations; no duplicate quotations are created.
alter table private.ingredient_aliases add column if not exists cost_mapping jsonb;
alter table private.ingredient_aliases add constraint ingredient_alias_cost_mapping_valid check (
 cost_mapping is null or (jsonb_typeof(cost_mapping)='object' and jsonb_typeof(cost_mapping->'unit')='string' and jsonb_typeof(cost_mapping->'quantity')='number' and (cost_mapping->>'quantity')::numeric>0 and length(cost_mapping->>'reason')>0)
);
create or replace function private.cost_quote(s uuid,product uuid,nm text,u text,at_date date) returns jsonb
language plpgsql stable security definer set search_path='' set jit=off set plan_cache_mode=force_custom_plan as $$
declare package_measure jsonb; name_key text; master_ids uuid[]; reference_ids uuid[]; chosen record; product_name text; specs text; result jsonb; target_date date:=coalesce(at_date,(now() at time zone 'Asia/Taipei')::date);
begin
 if s is null or nullif(btrim(u),'') is null then return jsonb_build_object('price',null,'reason','待補計價單位');end if;
 if product is not null then
  select p.name,coalesce(p.specification,'') into product_name,specs from public.products p
  join public.stores st on st.organization_id=p.organization_id where st.id=s and p.id=product;
  if product_name is null then return jsonb_build_object('price',null,'reason','品項不屬於此門市');end if;
 else product_name:=nm;specs:='';end if;
 if nullif(btrim(product_name),'') is null then return jsonb_build_object('price',null,'reason','待補品名');end if;
 package_measure:=private.cost_package_measure(u,product_name);
 name_key:=private.cost_name_key(product_name);
 select array_agg(distinct a.ingredient_id),array_agg(distinct rid) into master_ids,reference_ids from private.ingredient_aliases a left join lateral unnest(a.reference_ids) rid on true where a.store_id=s and (a.source_key='p:'||product::text or private.cost_name_key(a.name)=name_key);
 select array_agg(distinct rid) into reference_ids from (
  select unnest(reference_ids) rid
  union select selected_reference from private.ingredient_masters where store_id=s and id=any(master_ids)
  union select unnest(a.reference_ids) from private.ingredient_aliases a where a.store_id=s and a.ingredient_id=any(master_ids)
 ) refs where rid is not null;
 -- Explicitly saved prices and corrected identity links win; do not overwrite human work.
 select m.*,case when m.unit=private.recipe_unit(u) then m.cost_price*private.recipe_factor(u)
  when m.unit=package_measure->>'unit' then m.cost_price*(package_measure->>'quantity')::numeric else private.cost_purchase_price(m.purchase,u) end value into chosen
 from private.ingredient_masters m
 where m.store_id=s and m.manual and m.review_status='confirmed' and m.cost_price is not null
 and m.id in (select id from private.ingredient_masters where store_id=s and private.cost_name_key(name)=name_key union select unnest(master_ids))
 and (m.unit=private.recipe_unit(u) or m.unit=package_measure->>'unit' or private.cost_purchase_price(m.purchase,u) is not null)
 order by m.updated_at desc,m.id limit 1;
 if found then return jsonb_build_object('price',chosen.value,'source','人工確認','date',null,'reference_id',chosen.selected_reference,'basis','manual');end if;
 with linked as materialized (
  select a.ingredient_id,a.reference_ids,a.corrected,a.cost_mapping,a.source_unit
  from private.ingredient_aliases a
  where a.store_id=s and (a.source_key='p:'||product::text or private.cost_name_key(a.name)=name_key)
 ), eligible as materialized (
 select id from private.recipe_price_entries where store_id=s and product_id=product
 union select id from private.recipe_price_entries where store_id=s and private.cost_name_key(name)=name_key
 union select unnest(reference_ids)
 ), candidates as materialized (
  select r.*,coalesce((select private.cost_purchase_price(r.purchase,a.cost_mapping->>'unit')*(a.cost_mapping->>'quantity')::numeric*private.recipe_factor(u)/private.recipe_factor(a.cost_mapping->>'target_unit') from linked a where a.corrected and r.id=any(a.reference_ids) and a.source_unit=private.recipe_unit(u) and a.cost_mapping is not null order by a.ingredient_id limit 1),case when r.purchase is not null then coalesce(private.cost_purchase_price(r.purchase,u),private.cost_purchase_price(r.purchase,package_measure->>'unit')*(package_measure->>'quantity')::numeric)
   when private.recipe_unit(r.unit)=private.recipe_unit(u) then r.price/private.recipe_factor(r.unit)*private.recipe_factor(u)
   when private.recipe_unit(r.unit)=package_measure->>'unit' then r.price/private.recipe_factor(r.unit)*(package_measure->>'quantity')::numeric end) value,
   exists(select 1 from linked a where a.corrected and r.id=any(a.reference_ids)) corrected,
   case when r.source_kind='purchase' then 0 when r.source_kind='manual' then 1 else 2 end priority
  from private.recipe_price_entries r join eligible e on e.id=r.id
  where (r.store_id=s or (r.id=any(reference_ids) and exists(select 1 from linked a where a.corrected and r.id=any(a.reference_ids)) and exists(select 1 from public.stores rs join public.stores ts on ts.organization_id=rs.organization_id where rs.id=r.store_id and ts.id=s))) and r.review_status='confirmed' and r.price is not null
  and coalesce(r.source_ref->>'missing_price','false')<>'true'
  and (r.source_kind='history' or r.effective_date is null or r.effective_date<=target_date)
  and (coalesce(r.source_ref->>'specification','')='' or normalize(r.source_ref->>'specification',NFKC) like '原表計價基準:%'
   or position(private.cost_name_key(r.source_ref->>'specification') in name_key)>0
   or r.source_ref->>'specification'=specs or r.product_id=product
   or exists(select 1 from linked a where a.corrected and r.id=any(a.reference_ids)))
 ), ranked as (
  select * from candidates where value is not null and value>=0
  order by priority,(source_key like 'receipt:%') desc nulls last,corrected desc,(store_id=s) desc,effective_date desc nulls last,
   (source like '請購表%') desc,created_at desc,id desc limit 1
 ) select jsonb_build_object('price',value,'source',case when source_kind='history' then '食譜參考價 · '||source else source end||case when store_id<>s then ' · 共用基礎參照（'||(select name from public.stores where id=store_id)||'）' else '' end,
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
 return coalesce(result,jsonb_build_object('price',null,'reason',case when coalesce(cardinality(reference_ids),0)>0 then '已找到來源，待核對計價單位／包裝' else '名稱尚未完成對應' end));
end $$;

CREATE OR REPLACE FUNCTION private.seed_ingredient_masters(s uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET jit TO 'off'
AS $function$
begin
 -- Internal migration/import helper; never callable by application roles.
 insert into private.ingredient_masters(store_id,name,unit)
 select distinct s,private.ingredient_name(r.name,r.unit)||case when btrim(coalesce(r.source_ref->>'specification',''))<>'' then ' · '||btrim(r.source_ref->>'specification') else '' end,private.recipe_unit(r.unit)
 from private.recipe_price_entries r where r.store_id=s
 on conflict do nothing;
 insert into private.ingredient_aliases(store_id,ingredient_id,name,source_key,source_unit,specification,reference_ids)
 select s,m.id,min(r.name),case when r.product_id is not null then 'p:'||r.product_id else 'n:'||lower(btrim(r.name)) end,private.recipe_unit(r.unit),btrim(coalesce(r.source_ref->>'specification','')),array_agg(r.id order by r.created_at,r.id)
 from private.recipe_price_entries r join private.ingredient_masters m on m.store_id=s and lower(btrim(m.name))=lower(btrim(private.ingredient_name(r.name,r.unit)||case when btrim(coalesce(r.source_ref->>'specification',''))<>'' then ' · '||btrim(r.source_ref->>'specification') else '' end)) and m.unit=private.recipe_unit(r.unit)
 where r.store_id=s group by m.id,case when r.product_id is not null then 'p:'||r.product_id else 'n:'||lower(btrim(r.name)) end,private.recipe_unit(r.unit),btrim(coalesce(r.source_ref->>'specification',''))
 on conflict(store_id,source_key,source_unit,specification) do update set reference_ids=case when private.ingredient_aliases.corrected then array(select distinct unnest(private.ingredient_aliases.reference_ids||excluded.reference_ids)) else excluded.reference_ids end;
 -- A saved correction or manual price is never reset by a later import.
 with ranked as (
 select distinct on(a.ingredient_id) a.ingredient_id,r.id,r.cost_price,r.price,r.unit
 from private.ingredient_aliases a join private.recipe_price_entries r on r.id=any(a.reference_ids)
 where a.store_id=s and r.review_status='confirmed' and coalesce(r.source_ref->>'missing_price','false')<>'true'
 order by a.ingredient_id,case when r.source_kind='history' then 1 else 0 end,r.effective_date desc nulls last,r.created_at desc,r.id desc
 ) update private.ingredient_masters m set selected_reference=r.id,cost_price=coalesce(r.cost_price,r.price)/private.recipe_factor(r.unit),review_status='confirmed'
 from ranked r where m.id=r.ingredient_id and m.cost_price is null and m.revision=1 and not m.manual;
end $function$

;

do $patch$
declare definition text; revised text;
begin
 definition:=pg_get_functiondef('private.ingredient_catalog(uuid)'::regprocedure);
 revised:=replace(definition,'r.id=m.selected_reference and r.store_id=s','r.id=m.selected_reference and exists(select 1 from public.stores rs join public.stores ts on rs.organization_id=ts.organization_id where rs.id=r.store_id and ts.id=s)');
 if revised=definition then raise exception 'Ingredient source hook missing';end if;execute revised;
end $patch$;
notify pgrst,'reload schema';
