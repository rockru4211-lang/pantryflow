-- Build the sheet in one SQL plan with a single materialized store context.
create function private.ingredient_supply_payload(s uuid)
returns jsonb language sql stable security invoker set search_path='' set jit=off set work_mem='4MB' as $function$
 with profile_input as materialized (
  select st.id s,st.organization_id org,
   case when st.is_active and st.name in ('BeApe','Gras') then st.organization_id end context_organization,
   (now() at time zone 'Asia/Taipei')::date cutoff,
   private.ingredient_catalog(st.id) base,
   (select coalesce(jsonb_object_agg(k.name_key,k.supplier_key),'{}') from (
    select lower(btrim(normalize(sp.name,NFKC))) name_key,'id:'||min(sp.id::text) supplier_key
    from public.suppliers sp where sp.organization_id=case when st.is_active and st.name in ('BeApe','Gras') then st.organization_id end
    group by 1 having count(*)=1
   ) k) context_supplier_keys
  from public.stores st where st.id=$1
 ),organization_suppliers as materialized (
   select sp.id,sp.name,sp.is_active,sp.is_removed,private.history_key(sp.name) name_key
   from public.suppliers sp where sp.organization_id=(select org from profile_input)
 ), supplier_links as materialized (
   select l.name_key,l.supplier_id from private.supplier_name_links l where l.organization_id=(select org from profile_input)
 ), supplier_aliases as materialized (
   select sp.id,sp.name_key from organization_suppliers sp
   union
   select sp.id,private.history_key(a.name)
   from organization_suppliers sp
   join private.supplier_details d on d.supplier_id=sp.id
   cross join unnest(d.aliases) a(name)
 ), unique_supplier_matches as (
   select a.name_key,min(a.id::text)::uuid supplier_id
   from supplier_aliases a
   join organization_suppliers sp on sp.id=a.id
   left join supplier_links l on l.name_key=sp.name_key
   where sp.is_active and not sp.is_removed and (l.name_key is null or l.supplier_id=sp.id)
   group by a.name_key
   having count(*)=1
 ), resolved_supplier_keys as materialized (
   select k.name_key,l.supplier_id linked_id,
    case
     when k.name_key in ('','未提供') then null
     when l.name_key is null then m.supplier_id
     when target.is_active and not target.is_removed then target.id
    end identity_id
   from (
    select a.name_key from supplier_aliases a
    union
    select l.name_key from supplier_links l
   ) k
   left join supplier_links l on l.name_key=k.name_key
   left join organization_suppliers target on target.id=l.supplier_id
   left join unique_supplier_matches m on m.name_key=k.name_key
 ), supplier_names as materialized (
   select k.name_key,identity.identity_id supplier_id,display.name display_name,history.name history_display_name
   from resolved_supplier_keys k
   -- The sheet previously passed its normalized names into supplier_identity;
   -- history resolved the original name. Keep both lookup paths equivalent.
   left join resolved_supplier_keys identity on identity.name_key=private.history_key(k.name_key)
   left join organization_suppliers display on display.id=coalesce(k.linked_id,identity.identity_id)
   left join organization_suppliers history on history.id=coalesce(k.linked_id,k.identity_id)
 ), local_receipt_prices as materialized (select * from private.ingredient_receipt_price_evidence((select s from profile_input))), refs as materialized (
 select a.ingredient_id,r.id,r.name,private.recipe_unit(r.unit) unit,
 case when r.source_ref->>'missing_price'='true' then null else coalesce(r.cost_price,r.price)/private.recipe_factor(r.unit) end price,
 (r.store_id=(select s from profile_input)) can_apply,r.purchase,r.source,r.source_kind,r.review_status,r.effective_date,r.created_at,r.source_ref,live.price as receipt_price,live.unit as receipt_unit,live.purchase as receipt_purchase,coalesce(receipt_name.display_name,live.supplier) as receipt_supplier,
 coalesce('id:'||coalesce(receipt_name.supplier_id,rn.supplier_id),private.ingredient_supplier_key(r.source_ref)) supplier_key,
 coalesce(rn.display_name,rsupplier.name,r.source_ref->>'supplier_name','') supplier_name
 from private.ingredient_aliases a cross join lateral unnest(a.reference_ids) as ref(id) join private.recipe_price_entries r on r.id=ref.id
 join public.stores rs on rs.id=r.store_id join public.stores ts on ts.id=a.store_id and ts.organization_id=rs.organization_id
 left join public.suppliers rsupplier on rsupplier.organization_id=(select org from profile_input) and rsupplier.id=
  case when pg_input_is_valid(r.source_ref->>'supplier_id','uuid') then (r.source_ref->>'supplier_id')::uuid end
 left join supplier_names rn on rn.name_key=private.history_key(coalesce(rsupplier.name,r.source_ref->>'supplier_name'))
 left join local_receipt_prices live on live.id=r.id
 left join supplier_names receipt_name on receipt_name.name_key=private.history_key(live.supplier)
 where a.store_id=(select s from profile_input)
 union
 select a.ingredient_id,l.id,l.product_name,private.recipe_unit(l.unit),null::numeric,
  false,l.purchase,'已核對進貨明細','purchase','confirmed',l.effective_date,l.created_at,
  jsonb_build_object('batch_id',l.batch_id,'row_key',l.row_key,'specification',l.specification),
  l.price,l.unit,l.purchase,coalesce(receipt_name.display_name,l.supplier),
  coalesce('id:'||receipt_name.supplier_id,''),coalesce(receipt_name.display_name,l.supplier)
 from local_receipt_prices l
 left join supplier_names receipt_name on receipt_name.name_key=private.history_key(l.supplier)
 join lateral (
  select l.ingredient_id where l.ingredient_id is not null
  union
  select a.ingredient_id from private.ingredient_aliases a
   where l.ingredient_id is null and a.store_id=l.store_id and a.source_key='p:'||l.product_id
    and a.source_unit=private.recipe_unit(l.unit) and a.specification=l.specification
 ) a on true
 where l.store_id=(select s from profile_input) and not exists(select 1 from private.recipe_price_entries r where r.id=l.id)
 ), grouped_refs as (
 select r.ingredient_id,jsonb_agg(to_jsonb(r) order by r.effective_date desc nulls last,r.created_at desc) sources
 from refs r group by r.ingredient_id
 ), latest_manual as (
 select distinct on (v.ingredient_id) v.ingredient_id,v.effective_date
 from private.ingredient_standard_versions v
 where v.store_id=(select s from profile_input) and v.actor_id is not null
 order by v.ingredient_id,v.created_at desc,v.revision desc nulls last,v.id desc
 ), price_roots as materialized (
   select m.id ingredient_id,coalesce(m.canonical_ingredient_id,m.id) root_id
   from private.ingredient_masters m where m.store_id=(select s from profile_input)
 ), price_versions as (
   select distinct on (v.ingredient_id) v.ingredient_id root_id,
    jsonb_build_object(v.ingredient_id,jsonb_build_object(
      'snapshot',v.snapshot,'effective_date',v.effective_date,'reason',v.reason,'supplier_name',v.supplier_name
    )) cached
   from private.ingredient_standard_versions v
   where v.store_id=(select s from profile_input) and v.effective_date<=(select cutoff from profile_input)
   order by v.ingredient_id,v.effective_date desc,v.created_at desc,v.id desc
 ), price_stops as (
   select t.ingredient_id root_id,jsonb_build_object(t.ingredient_id,jsonb_object_agg(t.supplier_key,true)) cached
   from private.ingredient_supply_state t where t.store_id=(select s from profile_input) and t.stopped
   group by t.ingredient_id
 ), dated_receipts as materialized (
   select row_number() over () rid, l.*
   from local_receipt_prices l where l.effective_date<=(select cutoff from profile_input)
 ), mapped_aliases as materialized (
   select a.ingredient_id,r.root_id,a.source_key,a.reference_ids
   from private.ingredient_aliases a
   join price_roots r on r.ingredient_id=a.ingredient_id
   where a.store_id=(select s from profile_input)
 ), alias_scopes as (
   select ingredient_id root_id,source_key,reference_ids from mapped_aliases
   union
   select root_id,source_key,reference_ids from mapped_aliases
 ), receipt_links as (
   select a.root_id,r.rid
   from alias_scopes a cross join lateral unnest(a.reference_ids) ref(id)
   join dated_receipts r on r.id=ref.id
   union
   select a.root_id,r.rid
   from alias_scopes a join dated_receipts r on a.source_key='p:'||r.product_id
   union
   select r.ingredient_id,r.rid from dated_receipts r where r.ingredient_id is not null
 ), price_receipts as (
   select l.root_id,jsonb_build_object(l.root_id,jsonb_agg(to_jsonb(r)-'rid')) cached
   from receipt_links l join dated_receipts r using(rid)
   group by l.root_id
 ), quotes as materialized (
 -- The sheet asks for ingredient quotes. Give each one only its own root,
 -- standard version and receipt evidence while keeping the shared quote rules.
 select x.value,x.ord,(x.value->>'id')::uuid ingredient_id,
  private.automatic_cost_quote_cached((select s from profile_input),null,x.value->>'name',x.value->>'unit',(select cutoff from profile_input),(x.value->>'id')::uuid,
   jsonb_build_object(
    'store_id',(select s from profile_input),'cutoff',(select cutoff from profile_input),'organization_id',(select context_organization from profile_input),
    'roots',jsonb_build_object(x.value->>'id',pr.root_id),
    'versions',pv.cached,'stops',ps.cached,'ingredient_receipts',pc.cached,
    'supplier_keys',case when pc.cached is not null then (select context_supplier_keys from profile_input) end
   )
  ) quote
 from jsonb_array_elements((select base from profile_input)->'ingredients') with ordinality x(value,ord)
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
 left join private.ingredient_price_choices c on c.store_id=(select s from profile_input) and c.ingredient_id=x.ingredient_id
 left join public.suppliers sp on sp.id=c.supplier_id
 left join private.recipe_price_entries selected on selected.id=nullif(x.value->>'selected_reference','')::uuid
 left join public.suppliers selected_supplier on selected_supplier.organization_id=(select org from profile_input) and selected_supplier.id=
  case when pg_input_is_valid(selected.source_ref->>'supplier_id','uuid') then (selected.source_ref->>'supplier_id')::uuid end
 left join supplier_names sn on sn.name_key=private.history_key(coalesce(sp.name,selected_supplier.name,selected.source_ref->>'supplier_name'))
 left join supplier_names quote_name on quote_name.name_key=private.history_key(x.quote->>'supplier_name')
 )
 select jsonb_build_object(
  'can_price',(select base from profile_input)->'can_price',
  'ingredients',(select coalesce(jsonb_agg(value order by ord),'[]') from enriched),
  'price_history',(
   select coalesce(jsonb_agg(to_jsonb(v)||jsonb_build_object(
    'supplier_name',coalesce(h.history_display_name,v.supplier_name),'actor_name',coalesce(p.display_name,'系統')
   ) order by v.created_at desc),'[]')
   from private.ingredient_standard_versions v
   left join supplier_names h on h.name_key=private.history_key(v.supplier_name)
   left join public.profiles p on p.id=v.actor_id
   where v.store_id=(select s from profile_input) and v.actor_id is not null
  ),
  'supply_states',(
   select coalesce(jsonb_agg(to_jsonb(t)||jsonb_build_object('supplier_name',coalesce(h.history_display_name,t.supplier_name))),'[]')
   from private.ingredient_supply_state t
   left join supplier_names h on h.name_key=private.history_key(t.supplier_name)
   where t.store_id=(select s from profile_input)
  ),
  'supply_events',(
   select coalesce(jsonb_agg(to_jsonb(t)||jsonb_build_object(
    'supplier_name',coalesce(h.history_display_name,t.supplier_name),'actor_name',coalesce(p.display_name,'使用者')
   ) order by t.created_at desc),'[]')
   from private.ingredient_supply_events t
   left join supplier_names h on h.name_key=private.history_key(t.supplier_name)
   left join public.profiles p on p.id=t.actor_id
   where t.store_id=(select s from profile_input)
  ),
  'suppliers',(
   select coalesce(jsonb_agg(jsonb_build_object('id',sp.id,'name',sp.name,'active',sp.is_active) order by sp.name),'[]')
   from organization_suppliers sp
   where not exists (
    select 1 from supplier_links l where l.name_key=sp.name_key and l.supplier_id<>sp.id
   )
  )
 )
$function$;
revoke all on function private.ingredient_supply_payload(uuid) from public,anon,authenticated;

create or replace function private.ingredient_supply_read(s uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
begin
 if auth.uid() is null or not private.recipe_allowed(s) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 return private.ingredient_supply_payload(s);
end $function$;
notify pgrst,'reload schema';
