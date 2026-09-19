create or replace function public.reset_pilot_count_setup(p_store_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor uuid:=auth.uid();
  v_org uuid;
  v_active_sessions integer:=0;
  v_products integer:=0;
  v_zones integer:=0;
begin
  if v_actor is null then raise exception using errcode='42501',message='AUTHENTICATION_REQUIRED'; end if;
  select organization_id into v_org from public.stores where id=p_store_id and is_active for update;
  if v_org is null or not private.can_import_inventory(p_store_id) then
    raise exception using errcode='42501',message='STORE_MANAGER_REQUIRED';
  end if;

  select count(*) into v_active_sessions
  from public.inventory_count_sessions
  where store_id=p_store_id and status in ('DRAFT','IN_PROGRESS');

  create temporary table tmp_reset_sessions(id uuid primary key) on commit drop;
  insert into tmp_reset_sessions(id)
  select id from public.inventory_count_sessions
  where store_id=p_store_id and status in ('DRAFT','IN_PROGRESS');

  delete from public.inventory_count_discrepancies d using tmp_reset_sessions s where d.session_id=s.id;
  delete from public.count_drafts d using tmp_reset_sessions s where d.session_id=s.id;
  delete from public.count_zone_progress p using tmp_reset_sessions s where p.session_id=s.id;
  delete from private.count_opening_snapshots o using tmp_reset_sessions s where o.session_id=s.id;
  delete from public.inventory_count_sessions s where s.id in (select id from tmp_reset_sessions);

  select count(distinct zp.product_id) into v_products
  from public.zone_products zp join public.count_zones z on z.id=zp.zone_id
  where z.store_id=p_store_id and z.is_active;

  delete from public.zone_products zp
  using public.count_zones z
  where zp.zone_id=z.id and z.store_id=p_store_id and z.is_active;

  delete from public.store_product_opening_balances where store_id=p_store_id;
  delete from private.count_next_exclusions where store_id=p_store_id;

  select count(*) into v_zones from public.count_zones where store_id=p_store_id and is_active;
  update public.count_zones
  set is_active=false,
      name=name||' · 重建-'||substr(id::text,1,8)
  where store_id=p_store_id and is_active;

  delete from public.inventory_import_files where store_id=p_store_id;

  insert into public.audit_logs(organization_id,store_id,entity_type,entity_id,action,new_value,user_id)
  values(v_org,p_store_id,'store',p_store_id,'COUNT_SETUP_RESET',
    jsonb_build_object('products_unlinked',v_products,'zones_archived',v_zones,'active_counts_removed',v_active_sessions),v_actor);

  return jsonb_build_object(
    'products_unlinked',v_products,
    'zones_archived',v_zones,
    'active_counts_removed',v_active_sessions
  );
end;
$$;

revoke all on function public.reset_pilot_count_setup(uuid) from public,anon;
grant execute on function public.reset_pilot_count_setup(uuid) to authenticated,service_role;
