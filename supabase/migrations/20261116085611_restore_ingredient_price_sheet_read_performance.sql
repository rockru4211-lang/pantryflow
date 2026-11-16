-- Resolve catalog codes and field-entry markers in bulk so the whole table can
-- use the same code precedence as an individual ingredient lookup.
create or replace function private.ingredient_catalog_before_usage_names(s uuid)
returns jsonb
language plpgsql
stable security definer
set search_path = ''
as $function$
declare
  rows jsonb;
begin
  if not private.recipe_allowed(s) then
    raise exception 'APP_FORBIDDEN' using errcode = '42501';
  end if;

  with aliases as materialized (
    select ingredient_id, jsonb_agg(jsonb_build_object(
      'id',id,'name',name,'unit',source_unit,'specification',specification,'corrected',corrected
    ) order by name,id) items
    from private.ingredient_aliases
    where store_id=s
    group by ingredient_id
  ), field_ingredients as (
    select distinct f.ingredient_id
    from private.field_product_entries f
    join private.ingredient_masters m on m.id=f.ingredient_id
    where m.store_id=s and m.review_status='pending' and m.revision=1
  )
  select coalesce(jsonb_agg(to_jsonb(m)||jsonb_build_object(
    'canonical_code',coalesce(display.code,linked.ingredient_code,canonical.ingredient_code,m.ingredient_code),
    'aliases',coalesce(a.items,'[]'::jsonb),
    'source',coalesce(r.source,case when f.ingredient_id is not null then '現場填寫・待後勤確認' end),
    'source_kind',r.source_kind,
    'effective_date',r.effective_date,
    'purchase',coalesce(m.purchase,case when m.cost_price=coalesce(r.cost_price,r.price)/private.recipe_factor(r.unit) then r.purchase end)
  ) order by m.name,m.unit),'[]'::jsonb)
  into rows
  from private.ingredient_masters m
  left join aliases a on a.ingredient_id=m.id
  left join field_ingredients f on f.ingredient_id=m.id
  left join private.ingredient_masters canonical on canonical.id=m.canonical_ingredient_id
  left join private.ingredient_code_links code_link on code_link.ingredient_id=coalesce(canonical.id,m.id)
  left join private.ingredient_masters linked on linked.id=code_link.target_id
  left join private.ingredient_display_codes display on display.ingredient_id=coalesce(linked.id,canonical.id,m.id)
  left join private.recipe_price_entries r on r.id=m.selected_reference and exists (
    select 1 from public.stores rs join public.stores ts on rs.organization_id=ts.organization_id
    where rs.id=r.store_id and ts.id=s
  )
  where m.store_id=s and (a.ingredient_id is not null or m.manual);

  return jsonb_build_object('ingredients',rows,'can_price',private.recipe_allowed(s,true) and private.store_access_mode(s)='EDIT');
end;
$function$;

-- Compute the quote once per catalog row and use the resolved supplier label
-- when composing the existing response.
CREATE OR REPLACE FUNCTION private.ingredient_supply_read(s uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET work_mem TO '24MB'
AS $function$
declare
 base jsonb;
 result jsonb;
 price_context jsonb;
 context_organization jsonb;
 context_supplier_keys jsonb;
 cutoff date:=(now() at time zone 'Asia/Taipei')::date;
 org uuid;
begin
 if auth.uid() is null or not private.recipe_allowed(s) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 select organization_id into org from public.stores where id=s;
 base:=private.ingredient_catalog(s);
 price_context:=private.automatic_cost_context(s,cutoff);
 context_organization:=price_context->'organization_id';
 context_supplier_keys:=price_context->'supplier_keys';
 with supplier_names as materialized (
 select keys.name_key,identity.supplier_id,canonical.name display_name
 from (
  select private.history_key(sp.name) name_key from public.suppliers sp where sp.organization_id=org
  union
  select private.history_key(alias.name) from public.suppliers sp
  join private.supplier_details d on d.supplier_id=sp.id cross join unnest(d.aliases) alias(name)
  where sp.organization_id=org
  union
  select l.name_key from private.supplier_name_links l where l.organization_id=org
 ) keys
 cross join lateral (select private.supplier_identity(org,keys.name_key) supplier_id offset 0) identity
 left join private.supplier_name_links link on link.organization_id=org and link.name_key=keys.name_key
 left join public.suppliers canonical on canonical.organization_id=org and canonical.id=coalesce(link.supplier_id,identity.supplier_id)
 ), local_receipt_prices as materialized (select * from private.live_ingredient_receipt_prices where store_id=s), refs as materialized (
 select a.ingredient_id,r.id,r.name,private.recipe_unit(r.unit) unit,
 case when r.source_ref->>'missing_price'='true' then null else coalesce(r.cost_price,r.price)/private.recipe_factor(r.unit) end price,
 (r.store_id=s) can_apply,r.purchase,r.source,r.source_kind,r.review_status,r.effective_date,r.created_at,r.source_ref,live.price as receipt_price,live.unit as receipt_unit,live.purchase as receipt_purchase,coalesce(receipt_name.display_name,live.supplier) as receipt_supplier,
 coalesce('id:'||coalesce(receipt_name.supplier_id,rn.supplier_id),private.ingredient_supplier_key(r.source_ref)) supplier_key,
 coalesce(rn.display_name,rsupplier.name,r.source_ref->>'supplier_name','') supplier_name
 from private.ingredient_aliases a cross join lateral unnest(a.reference_ids) as ref(id) join private.recipe_price_entries r on r.id=ref.id
 join public.stores rs on rs.id=r.store_id join public.stores ts on ts.id=a.store_id and ts.organization_id=rs.organization_id
 left join public.suppliers rsupplier on rsupplier.organization_id=org and rsupplier.id=
  case when pg_input_is_valid(r.source_ref->>'supplier_id','uuid') then (r.source_ref->>'supplier_id')::uuid end
 left join supplier_names rn on rn.name_key=private.history_key(coalesce(rsupplier.name,r.source_ref->>'supplier_name'))
 left join local_receipt_prices live on live.id=r.id
 left join supplier_names receipt_name on receipt_name.name_key=private.history_key(live.supplier)
 where a.store_id=s
 union
 select a.ingredient_id,l.id,p.name,private.recipe_unit(l.unit),null::numeric,
  false,l.purchase,'已核對進貨明細','purchase','confirmed',l.effective_date,l.created_at,
  jsonb_build_object('batch_id',l.batch_id,'row_key',l.row_key,'specification',l.specification),
  l.price,l.unit,l.purchase,coalesce(receipt_name.display_name,l.supplier),
  coalesce('id:'||receipt_name.supplier_id,''),coalesce(receipt_name.display_name,l.supplier)
 from local_receipt_prices l
 left join supplier_names receipt_name on receipt_name.name_key=private.history_key(l.supplier)
 join public.products p on p.id=l.product_id
 join private.ingredient_aliases a on a.store_id=l.store_id and a.source_key='p:'||l.product_id
  and a.source_unit=private.recipe_unit(l.unit) and a.specification=l.specification
 where l.store_id=s and not exists(select 1 from private.recipe_price_entries r where r.id=l.id)
 ), grouped_refs as (
 select r.ingredient_id,jsonb_agg(to_jsonb(r) order by r.effective_date desc nulls last,r.created_at desc) sources
 from refs r group by r.ingredient_id
 ), latest_manual as (
 select distinct on (v.ingredient_id) v.ingredient_id,v.effective_date
 from private.ingredient_standard_versions v
 where v.store_id=s and v.actor_id is not null
 order by v.ingredient_id,v.created_at desc,v.revision desc nulls last,v.id desc
 ), price_roots as materialized (
 select key::uuid ingredient_id,value::uuid root_id from jsonb_each_text(price_context->'roots')
 ), price_versions as materialized (
 select key::uuid root_id,jsonb_build_object(key,value) cached from jsonb_each(price_context->'versions')
 ), price_stops as materialized (
 select key::uuid root_id,jsonb_build_object(key,value) cached from jsonb_each(price_context->'stops')
 ), price_receipts as materialized (
 select key::uuid root_id,jsonb_build_object(key,value) cached from jsonb_each(price_context->'ingredient_receipts')
 ), quotes as materialized (
 -- The sheet asks for ingredient quotes. Give each one only its own root,
 -- standard version and receipt evidence while keeping the shared quote rules.
 select x.value,x.ord,(x.value->>'id')::uuid ingredient_id,
  private.automatic_cost_quote_cached(s,null,x.value->>'name',x.value->>'unit',cutoff,(x.value->>'id')::uuid,
   jsonb_build_object(
    'store_id',s,'cutoff',cutoff,'organization_id',context_organization,
    'roots',jsonb_build_object(x.value->>'id',pr.root_id),
    'versions',pv.cached,'stops',ps.cached,'ingredient_receipts',pc.cached,
    'supplier_keys',case when pc.cached is not null then context_supplier_keys end
   )
  ) quote
 from jsonb_array_elements(base->'ingredients') with ordinality x(value,ord)
 left join price_roots pr on pr.ingredient_id=(x.value->>'id')::uuid
 left join price_versions pv on pv.root_id=pr.root_id
 left join price_stops ps on ps.root_id=pr.root_id
 left join price_receipts pc on pc.root_id=pr.root_id
 ), enriched as (
 select x.value||jsonb_build_object(
 'category',coalesce(x.value->>'category',private.classify_product(x.value->>'name')),
 'price_date',case when coalesce((x.value->>'manual')::boolean,false) then latest.effective_date else nullif(x.value->>'effective_date','')::date end,
 'current_quote',case when quote_name.display_name is not null then
  x.quote||jsonb_build_object('supplier_name',quote_name.display_name,'source',
   case when x.quote->>'basis'='receipt' then '本店進貨' else x.quote->>'source' end)
  else x.quote end,
 'supplier_id',coalesce(sn.supplier_id,c.supplier_id),
 'supplier_name',coalesce(sn.display_name,sp.name,selected_supplier.name,selected.source_ref->>'supplier_name',''),
 'supplier_key',coalesce('id:'||coalesce(sn.supplier_id,c.supplier_id),private.ingredient_supplier_key(selected.source_ref),''),
 'sources',coalesce(gr.sources,'[]'::jsonb),
 'dismissed_reference',c.dismissed_reference,'dismissed_value',c.dismissed_value
 ) value,x.ord
 from quotes x
 left join latest_manual latest on latest.ingredient_id=x.ingredient_id
 left join grouped_refs gr on gr.ingredient_id=x.ingredient_id
 left join private.ingredient_price_choices c on c.store_id=s and c.ingredient_id=x.ingredient_id
 left join public.suppliers sp on sp.id=c.supplier_id
 left join private.recipe_price_entries selected on selected.id=nullif(x.value->>'selected_reference','')::uuid
 left join public.suppliers selected_supplier on selected_supplier.organization_id=org and selected_supplier.id=
  case when pg_input_is_valid(selected.source_ref->>'supplier_id','uuid') then (selected.source_ref->>'supplier_id')::uuid end
 left join supplier_names sn on sn.name_key=private.history_key(coalesce(sp.name,selected_supplier.name,selected.source_ref->>'supplier_name'))
 left join supplier_names quote_name on quote_name.name_key=private.history_key(x.quote->>'supplier_name')
 ) select coalesce(jsonb_agg(value order by ord),'[]') into result from enriched;
 return (base-'ingredients')||jsonb_build_object('ingredients',result,
 'price_history',(select coalesce(jsonb_agg(to_jsonb(v)||jsonb_build_object('supplier_name',private.supplier_display_name(org,v.supplier_name),
  'actor_name',coalesce((select display_name from public.profiles where id=v.actor_id),'系統')) order by v.created_at desc),'[]') from private.ingredient_standard_versions v where v.store_id=s and v.actor_id is not null),'supply_states',(select coalesce(jsonb_agg(to_jsonb(t)||jsonb_build_object('supplier_name',private.supplier_display_name(org,t.supplier_name))),'[]') from private.ingredient_supply_state t where store_id=s),
 'supply_events',(select coalesce(jsonb_agg(to_jsonb(t)||jsonb_build_object('supplier_name',private.supplier_display_name(org,t.supplier_name),
  'actor_name',coalesce((select display_name from public.profiles where id=t.actor_id),'使用者')) order by created_at desc),'[]') from private.ingredient_supply_events t where store_id=s),
 'suppliers',(select coalesce(jsonb_agg(jsonb_build_object('id',sp.id,'name',sp.name,'active',sp.is_active) order by sp.name),'[]') from public.suppliers sp join public.stores st on st.organization_id=sp.organization_id where st.id=s and not exists(
  select 1 from private.supplier_name_links l where l.organization_id=org
  and l.name_key=private.history_key(sp.name) and l.supplier_id<>sp.id)));
end $function$;

notify pgrst,'reload schema';
