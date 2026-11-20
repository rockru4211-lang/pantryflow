CREATE OR REPLACE FUNCTION public.get_pilot_inventory_catalog(p_store_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb;
begin
  if not private.can_read_count_management(p_store_id) then raise exception 'STORE_MANAGER_REQUIRED' using errcode='42501'; end if;
  with candidates as (
    select zp.product_id from public.zone_products zp join public.count_zones z on z.id=zp.zone_id where z.store_id=p_store_id and z.is_active
    union select product_id from private.count_catalog_removed where store_id=p_store_id
    union select product_id from public.inventory_import_rows where store_id=p_store_id and product_id is not null
  ), counted_rows as (
    select distinct on (s.id, e.zone_id, e.product_id)
      s.id as session_id, s.completed_at, e.zone_id, e.product_id, e.unit, e.quantity
    from public.inventory_count_sessions s
    join private.current_count_entries e on e.session_id=s.id
    where s.store_id=p_store_id and s.completed_at is not null
      and s.status in ('REVIEWING','CLOSED') and e.observation_state='COUNTED' and e.quantity is not null
    order by s.id,e.zone_id,e.product_id,(e.entry_type <> 'INITIAL_COUNT') desc,e.created_at desc,e.id desc
  ), last_counts as (
    select distinct on (product_id) product_id,
      case when min(unit)=max(unit) then sum(quantity) end as quantity, min(unit) as unit
    from counted_rows
    group by product_id,session_id,completed_at
    order by product_id,completed_at desc,session_id desc
  ), items as (
    select p.*,z.zone_id,z.zone_name,z.unit,z.sort_order,z.zone_order,
      (z.zone_id is not null) configured,
      exists(select 1 from private.count_catalog_removed cr where cr.store_id=p_store_id and cr.product_id=p.id) removed
    from candidates c join public.products p on p.id=c.product_id
    join public.stores st on st.id=p_store_id and st.organization_id=p.organization_id
    left join lateral(select cz.id zone_id,cz.name zone_name,zp.count_unit unit,zp.sort_order,cz.sort_order zone_order
      from public.zone_products zp join public.count_zones cz on cz.id=zp.zone_id where cz.store_id=p_store_id and cz.is_active and zp.product_id=p.id) z on true
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'product_id',p.id,'name',p.name,'unit',coalesce(p.unit,p.count_unit,p.base_unit),'zone',coalesce(p.zone_name,'未配置'),'quantity',b.quantity,
    'count_opening',jsonb_build_object('quantity',case when lc.product_id is null then b.quantity else lc.quantity end,'unit',coalesce(lc.unit,b.unit,p.unit,p.count_unit,p.base_unit)),
    'imported_at',r.created_at,'supplier',r.normalized_values->>'supplier','sheet',r.sheet_name,'source_row',r.source_row,
    'specification',p.specification,'updated_at',p.updated_at,'unit_price',private.count_price(p_store_id,p.id,coalesce(p.unit,p.count_unit,p.base_unit)),
    'is_active',p.is_active and not p.removed and p.configured,'product_is_active',p.is_active,'is_removed',p.removed,'is_configured',p.configured,
    'catalog_state',case when p.removed then 'REMOVED' when not p.is_active then 'DISABLED' else 'ACTIVE' end
  ) order by p.removed,p.is_active desc,p.zone_order,p.sort_order,p.id),'[]'::jsonb) into result
  from items p left join last_counts lc on lc.product_id=p.id
  left join public.store_product_opening_balances b on b.store_id=p_store_id and b.product_id=p.id
  left join lateral(select ir.* from public.inventory_import_rows ir join public.inventory_import_files f on f.id=ir.import_file_id
    where ir.store_id=p_store_id and ir.product_id=p.id order by (f.removed_at is null and ir.status in ('ADDED','EXISTING','PENDING')) desc,ir.created_at,ir.id limit 1) r on true;
  return result;
end $function$
;
