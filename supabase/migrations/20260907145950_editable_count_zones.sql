-- A single store-scoped transaction saves names, assignments and item order.
-- Completed count entries and their original snapshots are never rewritten.
create or replace function public.save_pilot_zone_configuration(
  p_zone_id uuid, p_name text, p_product_ids uuid[], p_expected_config jsonb
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

  -- The UI calls this "移入": a product is moved from its previous store zone.
  delete from public.zone_products zp using public.count_zones z
    where z.id=zp.zone_id and z.store_id=v_store and z.is_active
      and (zp.zone_id=p_zone_id or zp.product_id=any(p_product_ids));
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
      jsonb_build_object('store_id',v_store,'name',btrim(p_name),'product_ids',p_product_ids,'returned_to_unclassified',v_removed),(select auth.uid()));
end;
$$;
revoke all on function public.save_pilot_zone_configuration(uuid,text,uuid[],jsonb) from public,anon;
grant execute on function public.save_pilot_zone_configuration(uuid,text,uuid[],jsonb) to authenticated;

-- Empty storage areas are excluded from this count, not a setup error.
CREATE OR REPLACE FUNCTION public.create_pilot_count_session(p_store_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_user uuid := (select auth.uid()); v_org uuid; v_session uuid; v_snapshot jsonb;
begin
  select organization_id into v_org from public.stores where id=p_store_id and is_active for update;
  if v_org is null or not private.has_active_store_role(p_store_id,array['ADMIN','SUPERVISOR']::public.app_role[]) then
    raise exception using errcode='42501',message='STORE_MANAGER_REQUIRED';
  end if;
  if not exists(select 1 from public.count_zones where store_id=p_store_id and is_active) then
    raise exception using errcode='22023',message='COUNT_ZONE_REQUIRED';
  end if;
  if not exists(select 1 from public.count_zones z join public.zone_products zp on zp.zone_id=z.id
    where z.store_id=p_store_id and z.is_active) then
    raise exception using errcode='22023',message='ZONE_PRODUCTS_REQUIRED';
  end if;
  if exists(select 1 from public.inventory_count_sessions where store_id=p_store_id and status in('DRAFT','IN_PROGRESS','REVIEWING')) then
    raise exception using errcode='22023',message='ACTIVE_COUNT_SESSION_EXISTS';
  end if;
  select jsonb_build_object('created_at',now(),'opening_captured',true,'zones',coalesce(jsonb_agg(jsonb_build_object(
    'zone_id',z.id,'zone_name',z.name,'product_id',p.id,'product_code',p.product_code,
    'product_name',p.name,'unit',zp.count_unit) order by z.sort_order,zp.sort_order),'[]'::jsonb))
  into v_snapshot
  from public.count_zones z join public.zone_products zp on zp.zone_id=z.id
  join public.products p on p.id=zp.product_id where z.store_id=p_store_id and z.is_active and p.is_active;
  insert into public.inventory_count_sessions(organization_id,store_id,started_by,status,snapshot)
  values(v_org,p_store_id,v_user,'IN_PROGRESS',v_snapshot) returning id into v_session;
  insert into private.count_opening_snapshots(session_id,product_id,quantity,confirmed_at)
  select v_session,zp.product_id,b.quantity,b.created_at
  from public.count_zones z join public.zone_products zp on zp.zone_id=z.id
  left join public.store_product_opening_balances b on b.store_id=p_store_id and b.product_id=zp.product_id
  where z.store_id=p_store_id and z.is_active
  group by zp.product_id,b.quantity,b.created_at;
  insert into public.count_zone_progress(organization_id,session_id,zone_id,status)
  select v_org,v_session,z.id,'NOT_STARTED' from public.count_zones z where z.store_id=p_store_id and z.is_active
    and exists(select 1 from public.zone_products zp where zp.zone_id=z.id);
  insert into public.audit_logs(organization_id,entity_type,entity_id,action,new_value,user_id)
  values(v_org,'inventory_count_session',v_session,'COUNT_SESSION_CREATED',jsonb_build_object('store_id',p_store_id),v_user);
  return v_session;
end;
$function$
;

notify pgrst, 'reload schema';
