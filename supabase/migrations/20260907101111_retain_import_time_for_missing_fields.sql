create or replace function public.get_pilot_inventory_catalog(p_store_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_result jsonb;
begin
  if not private.has_active_store_role(p_store_id,array['ADMIN','SUPERVISOR']::public.app_role[]) then
    raise exception using errcode='42501',message='STORE_MANAGER_REQUIRED';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'product_id',p.id,'name',p.name,'unit',zp.count_unit,'zone',z.name,'quantity',b.quantity,
    'imported_at',r.created_at,'supplier',r.normalized_values->>'supplier','sheet',r.sheet_name,'source_row',r.source_row
  ) order by z.sort_order,zp.sort_order,p.id),'[]'::jsonb) into v_result
  from public.count_zones z join public.zone_products zp on zp.zone_id=z.id
  join public.products p on p.id=zp.product_id
  left join public.store_product_opening_balances b on b.store_id=p_store_id and b.product_id=p.id
  left join lateral(select ir.* from public.inventory_import_rows ir where ir.store_id=p_store_id and ir.product_id=p.id and ir.status <> 'FAILED' order by ir.created_at,ir.id limit 1) r on true
  where z.store_id=p_store_id and z.is_active;
  return v_result;
end;
$$;
revoke all on function public.get_pilot_inventory_catalog(uuid) from public,anon;
grant execute on function public.get_pilot_inventory_catalog(uuid) to authenticated;
