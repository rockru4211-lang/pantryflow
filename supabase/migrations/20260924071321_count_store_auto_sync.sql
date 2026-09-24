-- Read-only, store-scoped change token. No table is added to a public feed.
create function private.count_store_revision(p_store_id uuid) returns text
language plpgsql stable security definer set search_path='' as $$
declare result text;
begin
  if auth.uid() is null or not private.has_active_store_role(p_store_id,null) then
    raise exception using errcode='42501',message='ACTIVE_STORE_MEMBERSHIP_REQUIRED';
  end if;
  with zones as materialized (
    select z.* from public.count_zones z where z.store_id=p_store_id
  ), items as materialized (
    select zp.* from public.zone_products zp join zones z on z.id=zp.zone_id
  ), current_session as materialized (
    select s.* from public.inventory_count_sessions s where s.store_id=p_store_id
      and s.status in ('DRAFT','IN_PROGRESS','REVIEWING','CLOSED')
    order by (s.status in ('DRAFT','IN_PROGRESS')) desc,
      case when s.status in ('DRAFT','IN_PROGRESS') then s.started_at else s.completed_at end desc
    limit 1
  )
  select md5(jsonb_build_object(
    'zones',(select jsonb_agg(to_jsonb(z) order by z.id) from zones z),
    'items',(select jsonb_agg(to_jsonb(i) order by i.zone_id,i.product_id) from items i),
    'products',(select jsonb_agg(jsonb_build_array(p.id,p.name,p.product_code,p.count_unit,p.specification,p.is_active,p.updated_at,sp.name) order by p.id)
      from public.products p left join public.suppliers sp on sp.id=p.current_supplier_id
      where p.id in (select product_id from items)),
    'session',(select to_jsonb(s) from current_session s),
    'drafts',(select jsonb_agg(to_jsonb(d) order by d.zone_id,d.product_id) from public.count_drafts d where d.session_id in (select id from current_session)),
    'progress',(select jsonb_agg(to_jsonb(g) order by g.zone_id) from public.count_zone_progress g where g.session_id in (select id from current_session)),
    'entries',(select jsonb_agg(to_jsonb(e) order by e.id) from public.count_entries e where e.session_id in (select id from current_session)),
    'removed',(select jsonb_agg(r.product_id order by r.product_id) from private.count_catalog_removed r where r.store_id=p_store_id),
    'opening',case when private.can_import_inventory(p_store_id) then
      (select jsonb_agg(to_jsonb(b) order by b.product_id) from public.store_product_opening_balances b where b.store_id=p_store_id) end,
    'prices',case when private.can_import_inventory(p_store_id) then
      (select jsonb_agg(to_jsonb(p) order by p.product_id,p.unit) from private.count_catalog_prices p where p.store_id=p_store_id) end,
    'review',case when private.can_import_inventory(p_store_id) then
      (select jsonb_agg(to_jsonb(d) order by d.id) from public.inventory_count_discrepancies d where d.session_id in (select id from current_session)) end
  )::text) into result;
  return result;
end $$;
revoke all on function private.count_store_revision(uuid) from public,anon,authenticated;
grant execute on function private.count_store_revision(uuid) to authenticated;

create function public.get_count_store_revision(p_store_id uuid) returns text
language sql stable security invoker set search_path='' as $$
  select private.count_store_revision(p_store_id)
$$;
revoke all on function public.get_count_store_revision(uuid) from public,anon,authenticated;
grant execute on function public.get_count_store_revision(uuid) to authenticated;
