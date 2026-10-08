-- Aggregate price references once instead of rescanning them for every ingredient.
-- Preserve the catalog order, all source/history fields and the existing access gate.
-- Without materialization, a nested-loop plan can rebuild every alias JSON array
-- for each master (1,801 aggregate loops in the isolated scale fixture).
CREATE OR REPLACE FUNCTION private.ingredient_catalog(s uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare rows jsonb;
begin
 if not private.recipe_allowed(s) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 with aliases as materialized (
 select ingredient_id,jsonb_agg(jsonb_build_object('id',id,'name',name,'unit',source_unit,'specification',specification,'corrected',corrected) order by name,id) items
 from private.ingredient_aliases where store_id=s group by ingredient_id
 ) select coalesce(jsonb_agg(to_jsonb(m)||jsonb_build_object('aliases',coalesce(a.items,'[]'::jsonb),'source',r.source,'source_kind',r.source_kind,'effective_date',r.effective_date,'purchase',coalesce(m.purchase,case when m.cost_price=coalesce(r.cost_price,r.price)/private.recipe_factor(r.unit) then r.purchase end)) order by m.name,m.unit),'[]'::jsonb) into rows
 from private.ingredient_masters m left join aliases a on a.ingredient_id=m.id
 left join private.recipe_price_entries r on r.id=m.selected_reference and exists(select 1 from public.stores rs join public.stores ts on rs.organization_id=ts.organization_id where rs.id=r.store_id and ts.id=s)
 where m.store_id=s and (a.ingredient_id is not null or m.manual);
 return jsonb_build_object('ingredients',rows,'can_price',private.recipe_allowed(s,true) and private.store_access_mode(s)='EDIT');
end $function$;

CREATE OR REPLACE FUNCTION private.ingredient_supply_read(s uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare base jsonb; result jsonb;
begin
 if auth.uid() is null or not private.recipe_allowed(s) then raise exception 'APP_FORBIDDEN' using errcode='42501';end if;
 base:=private.ingredient_catalog(s);
 with refs as materialized (
 select distinct a.ingredient_id,r.id,r.name,private.recipe_unit(r.unit) unit,
 case when r.source_ref->>'missing_price'='true' then null else coalesce(r.cost_price,r.price)/private.recipe_factor(r.unit) end price,
 (r.store_id=s) can_apply,r.purchase,r.source,r.source_kind,r.review_status,r.effective_date,r.created_at,r.source_ref,
 private.ingredient_supplier_key_for_store(s,r.source_ref) supplier_key,coalesce(r.source_ref->>'supplier_name','') supplier_name
 from private.ingredient_aliases a join private.recipe_price_entries r on r.id=any(a.reference_ids)
 join public.stores rs on rs.id=r.store_id join public.stores ts on ts.id=a.store_id and ts.organization_id=rs.organization_id
 where a.store_id=s
 ), grouped_refs as (
 select r.ingredient_id,jsonb_agg(to_jsonb(r) order by r.effective_date desc nulls last,r.created_at desc) sources
 from refs r group by r.ingredient_id
 ), enriched as (
 select x.value||jsonb_build_object(
 'supplier_id',c.supplier_id,'supplier_name',coalesce(sp.name,selected.source_ref->>'supplier_name',''),
 'supplier_key',coalesce('id:'||c.supplier_id,private.ingredient_supplier_key_for_store(s,selected.source_ref),''),
 'sources',coalesce(gr.sources,'[]'::jsonb),
 'dismissed_reference',c.dismissed_reference,'dismissed_value',c.dismissed_value
 ) value,x.ord
 from jsonb_array_elements(base->'ingredients') with ordinality x(value,ord)
 left join grouped_refs gr on gr.ingredient_id=(x.value->>'id')::uuid
 left join private.ingredient_price_choices c on c.store_id=s and c.ingredient_id=(x.value->>'id')::uuid
 left join public.suppliers sp on sp.id=c.supplier_id
 left join private.recipe_price_entries selected on selected.id=nullif(x.value->>'selected_reference','')::uuid
 ) select coalesce(jsonb_agg(value order by ord),'[]') into result from enriched;
 return base||jsonb_build_object('ingredients',result,
 'price_history',(select coalesce(jsonb_agg(to_jsonb(v)||jsonb_build_object('actor_name',coalesce((select display_name from public.profiles where id=v.actor_id),'系統')) order by v.created_at desc),'[]') from private.ingredient_standard_versions v where v.store_id=s and v.actor_id is not null),'supply_states',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from private.ingredient_supply_state t where store_id=s),
 'supply_events',(select coalesce(jsonb_agg(to_jsonb(t)||jsonb_build_object('actor_name',coalesce((select display_name from public.profiles where id=t.actor_id),'使用者')) order by created_at desc),'[]') from private.ingredient_supply_events t where store_id=s),
 'suppliers',(select coalesce(jsonb_agg(jsonb_build_object('id',sp.id,'name',sp.name,'active',sp.is_active) order by sp.name),'[]') from public.suppliers sp join public.stores st on st.organization_id=sp.organization_id where st.id=s));
end $function$;
