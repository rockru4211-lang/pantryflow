-- Dated standards can use the shared quote rules without scanning an empty
-- set of receipt candidates. Receipts still take the existing validation path.
CREATE OR REPLACE FUNCTION private.automatic_cost_quote_cached(s uuid, product uuid, nm text, u text, cutoff date, ingredient uuid, cache jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
 SET jit TO 'off'
AS $function$
declare org uuid; specs text; ids uuid[]; root uuid;
 target_package jsonb; target_unit text:=private.recipe_unit(u); selected record; version record; quote numeric; baseline jsonb; count_baseline jsonb; baseline_package jsonb; live_rows jsonb;
begin
 if cache->>'store_id' is distinct from s::text or cache->>'cutoff' is distinct from cutoff::text then raise exception 'INVALID_PRICE_CONTEXT';end if;
 if cutoff is null or nullif(btrim(u),'') is null then return jsonb_build_object('price',null,'reason','待確認日期或計價單位');end if;
 org:=(cache->>'organization_id')::uuid;
 if org is null then return jsonb_build_object('price',null,'reason','尚未找到此門市');end if;
 if product is not null then
  nm:=cache#>>array['products',product::text,'name'];specs:=cache#>>array['products',product::text,'specification'];
  if nm is null then return jsonb_build_object('price',null,'reason','品項不屬於此門市');end if;
 end if;
 if ingredient is not null then
  root:=(cache#>>array['roots',ingredient::text])::uuid;
  if root is null then return jsonb_build_object('price',null,'reason','食材不屬於此門市');end if;
 else
  select array_agg(value::uuid) into ids from jsonb_array_elements_text(coalesce(
   case when product is null then cache#>array['names',private.cost_name_key(nm)] else cache#>array['product_roots',product::text] end,'[]'::jsonb));

  if product is not null and cardinality(ids)>1 and jsonb_array_length(cache#>array['corrected_product_roots',product::text])=1 then
   root:=(cache#>>array['corrected_product_roots',product::text,'0'])::uuid;
   if cache#>>array['versions',root::text,'reason']='鎖定進價' then ids:=array[root];end if;
  end if;
  if cardinality(ids)>1 then return jsonb_build_object('price',null,'reason','同名有不同品項或規格，待確認對應');end if;
  root:=ids[1];
 end if;
 if coalesce((cache#>>array['stops',root::text,'*'])::boolean,false) then
  return jsonb_build_object('price',null,'reason','此品項已停止供貨');end if;
 select v->'snapshot' snapshot,(v->>'effective_date')::date effective_date,v->>'reason' reason,v->>'supplier_name' supplier_name into version
 from (select cache#>array['versions',root::text] v) cached;
 count_baseline:=case when not coalesce((cache#>>array['manual_versions',root::text])::boolean,false)
  then cache#>array['baselines',product::text,u] end;

 if version.reason='鎖定進價' and version.snapshot->>'review_status'='confirmed' and version.snapshot->>'cost_price' is not null then
  return private.locked_ingredient_quote(version.snapshot,version.effective_date,version.supplier_name,u,
   private.cost_package_measure(u,specs));
 end if;
 baseline_package:=private.inventory_package_measure(count_baseline->'purchase',u,null);
 target_package:=coalesce(baseline_package,private.cost_package_measure(u,specs),private.inventory_package_measure(case when version.snapshot->>'review_status'='confirmed' then version.snapshot->'purchase' end,u,null));
 live_rows:=coalesce(
  case when product is not null then cache#>array['product_receipts',product::text]
   else cache#>array['ingredient_receipts',root::text] end,
  '[]'::jsonb
 );
 if live_rows<>'[]'::jsonb then
  with candidates as materialized (
   select r.* from jsonb_to_recordset(live_rows)
    r(id uuid,store_id uuid,product_id uuid,effective_date date,created_at timestamptz,unit text,price numeric,batch_id uuid,row_key text,supplier text,specification text,purchase jsonb)
   where not coalesce((cache#>>array['stops',root::text,coalesce(cache#>>array['supplier_keys',lower(btrim(normalize(r.supplier,NFKC)))],private.ingredient_supplier_key(jsonb_build_object('supplier_name',r.supplier)))])::boolean,false)
    and not coalesce((cache#>>array['stops',root::text,private.ingredient_supplier_key(jsonb_build_object('supplier_name',r.supplier))])::boolean,false)
  ), latest as (
   select * from candidates where effective_date=(select max(effective_date) from candidates)
  ), converted as (
   select r.*,case
    when r.price is null then null
    when count_baseline is not null and baseline_package is null and target_unit in ('包','瓶','罐','盒','袋','桶','箱','打','組','塊','條') then null
    when target_unit in ('包','瓶','罐','盒','袋','桶','箱','打','組','塊','條')
     and (target_package is null or private.inventory_package_measure(r.purchase,r.unit,null) is null) then null
    when target_package is not null then private.cost_purchase_price(r.purchase,target_package->>'unit')*(target_package->>'quantity')::numeric
    else private.cost_purchase_price(r.purchase,u) end value from latest r
  ) select count(*) n,count(*) filter(where value is null or value<0 or value>=1000000000) invalid,
   count(distinct value) distinct_prices,(array_agg(to_jsonb(c) order by created_at desc,id))[1] latest into selected from converted c;
  if selected.n>0 then
   if selected.invalid>0 then return jsonb_build_object('price',null,'reason','最新進貨缺少已確認的規格或單位換算','basis','receipt','date',selected.latest->'effective_date')||
    case when selected.n=1 then jsonb_build_object('unit',u,'purchase',selected.latest->'purchase','specification',selected.latest->'specification',
     'source',concat_ws(' · ','本店進貨',nullif(selected.latest->>'supplier','')),'supplier_name',selected.latest->'supplier',
     'reference_id',selected.latest->'id','batch_id',selected.latest->'batch_id','store_id',s) else '{}'::jsonb end;end if;
   if selected.distinct_prices<>1 then return jsonb_build_object('price',null,'reason','同日有不同的已確認進價，待核對','basis','receipt','date',selected.latest->'effective_date');end if;
   return jsonb_build_object('price',round((selected.latest->>'value')::numeric,6),'unit',u,'source',concat_ws(' · ','本店進貨',nullif(selected.latest->>'supplier','')),
    'date',selected.latest->'effective_date','basis','receipt','reference_id',selected.latest->'id','batch_id',selected.latest->'batch_id','store_id',s,
    'purchase',selected.latest->'purchase','specification',selected.latest->'specification','supplier_name',selected.latest->'supplier');
  end if;
 end if;
 if product is not null and count_baseline is not null and (count_baseline->>'price')::numeric>=0 and (count_baseline->>'price')::numeric<1000000000 then
  return count_baseline||jsonb_build_object('unit',u,'source','食材價格表 · 已確認基準');
 end if;
 -- Only absent receipt evidence can use an existing dated confirmed standard.
 if version.snapshot->>'review_status'='confirmed' and version.snapshot->>'cost_price' is not null then
  quote:=case when target_package is not null then coalesce(private.cost_purchase_price(version.snapshot->'purchase',target_package->>'unit'),
   case when version.snapshot->>'unit'=target_package->>'unit' then (version.snapshot->>'cost_price')::numeric end)*(target_package->>'quantity')::numeric
   when version.snapshot->>'unit'=target_unit then (version.snapshot->>'cost_price')::numeric*private.recipe_factor(u)
   else private.cost_purchase_price(version.snapshot->'purchase',u) end;
  if quote>=0 and quote<1000000000 then return jsonb_build_object('price',round(quote,6),'unit',u,'source','食材價格表 · 標準價','basis','standard',
   'date',case when version.effective_date>'0001-01-01'::date then version.effective_date end,'purchase',version.snapshot->'purchase');end if;
 end if;
 return jsonb_build_object('price',null,'unit',u,'reason','缺少已確認進價或單位換算');
end $function$;

-- Canonicalize each historical supplier name once and assemble the sheet in
-- one pass, including the existing edit permission flag.
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
 ), history_supplier_keys as (
 select v.supplier_name from private.ingredient_standard_versions v where v.store_id=s and v.actor_id is not null
 union
 select t.supplier_name from private.ingredient_supply_state t where t.store_id=s
 union
 select t.supplier_name from private.ingredient_supply_events t where t.store_id=s
 ), history_supplier_names as materialized (
 select k.supplier_name,private.supplier_display_name(org,k.supplier_name) display_name
 from history_supplier_keys k
 )
 select jsonb_build_object(
  'can_price',base->'can_price',
  'ingredients',(select coalesce(jsonb_agg(value order by ord),'[]') from enriched),
  'price_history',(
   select coalesce(jsonb_agg(to_jsonb(v)||jsonb_build_object(
    'supplier_name',h.display_name,'actor_name',coalesce(p.display_name,'系統')
   ) order by v.created_at desc),'[]')
   from private.ingredient_standard_versions v
   left join history_supplier_names h on h.supplier_name is not distinct from v.supplier_name
   left join public.profiles p on p.id=v.actor_id
   where v.store_id=s and v.actor_id is not null
  ),
  'supply_states',(
   select coalesce(jsonb_agg(to_jsonb(t)||jsonb_build_object('supplier_name',h.display_name)),'[]')
   from private.ingredient_supply_state t
   left join history_supplier_names h on h.supplier_name is not distinct from t.supplier_name
   where t.store_id=s
  ),
  'supply_events',(
   select coalesce(jsonb_agg(to_jsonb(t)||jsonb_build_object(
    'supplier_name',h.display_name,'actor_name',coalesce(p.display_name,'使用者')
   ) order by t.created_at desc),'[]')
   from private.ingredient_supply_events t
   left join history_supplier_names h on h.supplier_name is not distinct from t.supplier_name
   left join public.profiles p on p.id=t.actor_id
   where t.store_id=s
  ),
  'suppliers',(
   select coalesce(jsonb_agg(jsonb_build_object('id',sp.id,'name',sp.name,'active',sp.is_active) order by sp.name),'[]')
   from public.suppliers sp
   where sp.organization_id=org and not exists (
    select 1 from private.supplier_name_links l
    where l.organization_id=org and l.name_key=private.history_key(sp.name) and l.supplier_id<>sp.id
   )
  )
 ) into result;

 return result;
end;
$function$;

notify pgrst,'reload schema';
