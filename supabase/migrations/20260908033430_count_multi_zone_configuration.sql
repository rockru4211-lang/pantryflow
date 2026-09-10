-- A single store-scoped transaction saves names, assignments and item order.
-- Completed count entries and their original snapshots are never rewritten.
create or replace function public.save_pilot_zone_configuration_v2(
  p_zone_id uuid, p_name text, p_product_ids uuid[], p_expected_config jsonb, p_keep_existing boolean default false
) returns void language plpgsql security definer set search_path='' as $$
declare
  v_store uuid; v_org uuid; v_current jsonb; v_removed uuid[];
  v_fallback uuid; v_old_name text; v_old_ids uuid[];
begin
  select store_id,organization_id,name into v_store,v_org,v_old_name
    from public.count_zones where id=p_zone_id and is_active;
  if v_store is null or not private.has_active_store_role(v_store,array['ADMIN','SUPERVISOR']::public.app_role[]) then
    raise exception using errcode='42501',message='STORE_MANAGER_REQUIRED';
  end if;
  -- Matches the store lock used when starting a count.
  perform 1 from public.stores where id=v_store and is_active for update;
  if not found then raise exception using errcode='42501',message='STORE_MANAGER_REQUIRED'; end if;
  if exists(select 1 from public.inventory_count_sessions where store_id=v_store and status in ('DRAFT','IN_PROGRESS')) then
    raise exception using errcode='22023',message='COUNT_IN_PROGRESS';
  end if;
  if btrim(coalesce(p_name,''))='' or length(btrim(p_name))>80 then
    raise exception using errcode='22023',message='ZONE_NAME_REQUIRED';
  end if;
  if exists(select 1 from public.count_zones where store_id=v_store and id<>p_zone_id
    and regexp_replace(lower(name),'[[:space:]]+','','g')=regexp_replace(lower(p_name),'[[:space:]]+','','g')) then
    raise exception using errcode='23505',message='ZONE_NAME_EXISTS';
  end if;
  if p_product_ids is null or cardinality(p_product_ids)>5000
    or cardinality(p_product_ids)<>(select count(distinct id) from unnest(p_product_ids) t(id)) then
    raise exception using errcode='22023',message='INVALID_ZONE_PRODUCTS';
  end if;
  select coalesce(jsonb_object_agg(z.id::text,jsonb_build_object('name',z.name,'product_ids',
    coalesce((select jsonb_agg(zp.product_id order by zp.sort_order,zp.product_id) from public.zone_products zp where zp.zone_id=z.id),'[]'::jsonb))),'{}'::jsonb)
    into v_current from public.count_zones z where z.store_id=v_store and z.is_active;
  if p_expected_config is distinct from v_current then
    raise exception using errcode='40001',message='ZONE_CONFIGURATION_CHANGED';
  end if;
  if exists(select 1 from unnest(p_product_ids) desired(id) where not exists(
    select 1 from public.zone_products zp join public.count_zones z on z.id=zp.zone_id
    join public.products p on p.id=zp.product_id and p.is_active
    where z.store_id=v_store and z.is_active and zp.product_id=desired.id
  )) then raise exception using errcode='42501',message='PRODUCT_NOT_IN_STORE'; end if;

  select coalesce(array_agg(product_id order by sort_order,product_id),'{}'::uuid[]) into v_old_ids
    from public.zone_products where zone_id=p_zone_id;
  select coalesce(array_agg(id order by pos),'{}'::uuid[]) into v_removed from unnest(v_old_ids) with ordinality t(id,pos) where not(id=any(p_product_ids));
  if cardinality(v_removed)>0 and regexp_replace(p_name,'[[:space:]]+','','g')='未分類' then
    raise exception using errcode='22023',message='CHOOSE_DESTINATION_ZONE';
  end if;
  update public.count_zones set name=btrim(p_name),updated_at=now() where id=p_zone_id;

  -- Existing assignments survive reorder. Newly added products can move or stay in both zones.
  delete from public.zone_products zp using public.count_zones z
    where z.id=zp.zone_id and z.store_id=v_store and z.is_active
      and (zp.zone_id=p_zone_id or (not p_keep_existing and zp.product_id=any(p_product_ids) and not(zp.product_id=any(v_old_ids))));
  insert into public.zone_products(zone_id,product_id,sort_order,count_unit)
    select p_zone_id,d.id,(d.pos-1)::integer,p.count_unit
    from unnest(p_product_ids) with ordinality d(id,pos) join public.products p on p.id=d.id;

  if cardinality(v_removed)>0 then
    v_fallback:=public.create_pilot_zone(v_store,'未分類');
    insert into public.zone_products(zone_id,product_id,sort_order,count_unit)
      select v_fallback,p.id,
        (select coalesce(max(sort_order),-1) from public.zone_products where zone_id=v_fallback)+row_number() over(order by r.pos)::integer,p.count_unit
      from unnest(v_removed) with ordinality r(id,pos) join public.products p on p.id=r.id
      where not exists(select 1 from public.zone_products zp join public.count_zones z on z.id=zp.zone_id where z.store_id=v_store and z.is_active and zp.product_id=p.id)
      on conflict(zone_id,product_id) do nothing;
  end if;
  insert into public.audit_logs(organization_id,entity_type,entity_id,action,old_value,new_value,user_id)
    values(v_org,'count_zone',p_zone_id,'ZONE_CONFIGURATION_SAVED',
      jsonb_build_object('name',v_old_name,'product_ids',v_old_ids),
      jsonb_build_object('store_id',v_store,'name',btrim(p_name),'product_ids',p_product_ids,'returned_to_unclassified',v_removed,'keep_existing',p_keep_existing),(select auth.uid()));
end;
$$;
revoke all on function public.save_pilot_zone_configuration_v2(uuid,text,uuid[],jsonb,boolean) from public,anon;
grant execute on function public.save_pilot_zone_configuration_v2(uuid,text,uuid[],jsonb,boolean) to authenticated;

notify pgrst, 'reload schema';
