create or replace function public.update_imported_inventory_item(
  p_store_id uuid,
  p_import_file_id uuid,
  p_source_id text,
  p_product_id uuid,
  p_name text,
  p_unit text,
  p_specification text,
  p_zone_name text,
  p_opening_quantity numeric
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_org uuid;
  v_actor uuid := auth.uid();
  v_row public.inventory_import_rows%rowtype;
  v_old_zone text;
  v_old_zone_id uuid;
  v_new_zone_id uuid;
  v_opening_total numeric;
begin
  select organization_id into v_org from public.stores where id=p_store_id and is_active;
  if v_actor is null then raise exception using errcode='42501',message='AUTHENTICATION_REQUIRED'; end if;
  if v_org is null or not private.can_import_inventory(p_store_id) then
    raise exception using errcode='42501',message='STORE_MANAGER_REQUIRED';
  end if;

  select * into v_row
  from public.inventory_import_rows
  where store_id=p_store_id
    and import_file_id=p_import_file_id
    and source_id=p_source_id
    and product_id=p_product_id
  limit 1;

  if v_row.id is null then
    raise exception using errcode='22023',message='IMPORT_ROW_NOT_FOUND';
  end if;

  if nullif(trim(p_name),'') is null or nullif(trim(p_unit),'') is null then
    raise exception using errcode='22023',message='PRODUCT_NAME_AND_UNIT_REQUIRED';
  end if;
  if p_opening_quantity is not null and p_opening_quantity < 0 then
    raise exception using errcode='22023',message='INVALID_OPENING_QUANTITY';
  end if;

  v_old_zone := nullif(v_row.normalized_values->>'zone','');

  update public.products
  set name=trim(p_name),
      count_unit=trim(p_unit),
      specification=nullif(trim(coalesce(p_specification,'')),''),
      updated_at=now()
  where id=p_product_id and organization_id=v_org;

  update public.inventory_import_rows
  set normalized_values =
        coalesce(normalized_values,'{}'::jsonb)
        || jsonb_build_object(
          'name',trim(p_name),
          'unit',trim(p_unit),
          'specification',nullif(trim(coalesce(p_specification,'')),''),
          'zone',coalesce(nullif(trim(coalesce(p_zone_name,'')),''),'未分類'),
          'opening_quantity',p_opening_quantity
        ),
      reason='',
      updated_at=now()
  where id=v_row.id;

  if nullif(trim(coalesce(p_zone_name,'')),'') is not null and trim(p_zone_name) <> '未分類' then
    select id into v_new_zone_id
    from public.count_zones
    where store_id=p_store_id and is_active and name=trim(p_zone_name)
    order by sort_order
    limit 1;

    if v_new_zone_id is null then
      raise exception using errcode='22023',message='ZONE_NOT_FOUND';
    end if;

    insert into public.zone_products(zone_id,product_id,sort_order,count_unit)
    values(
      v_new_zone_id,
      p_product_id,
      coalesce((select max(sort_order)+1 from public.zone_products where zone_id=v_new_zone_id),0),
      trim(p_unit)
    )
    on conflict(zone_id,product_id) do update set count_unit=excluded.count_unit;

    if v_old_zone is not null and v_old_zone <> trim(p_zone_name) then
      select id into v_old_zone_id
      from public.count_zones
      where store_id=p_store_id and is_active and name=v_old_zone
      order by sort_order
      limit 1;

      if v_old_zone_id is not null and not exists(
        select 1
        from public.inventory_import_rows r
        where r.import_file_id=p_import_file_id
          and r.product_id=p_product_id
          and r.id<>v_row.id
          and coalesce(r.normalized_values->>'zone','未分類')=v_old_zone
          and r.status in ('ADDED','EXISTING')
      ) then
        delete from public.zone_products where zone_id=v_old_zone_id and product_id=p_product_id;
      end if;
    end if;
  end if;

  update public.zone_products zp
  set count_unit=trim(p_unit)
  from public.count_zones z
  where zp.zone_id=z.id and z.store_id=p_store_id and zp.product_id=p_product_id;

  select sum((r.normalized_values->>'opening_quantity')::numeric)
  into v_opening_total
  from public.inventory_import_rows r
  where r.import_file_id=p_import_file_id
    and r.product_id=p_product_id
    and r.status in ('ADDED','EXISTING')
    and coalesce(r.normalized_values->>'opening_quantity','') ~ '^-?[0-9]+(\.[0-9]+)?$';

  if v_opening_total is null then
    delete from public.store_product_opening_balances
    where store_id=p_store_id and product_id=p_product_id and source='FILE_IMPORT';
  else
    insert into public.store_product_opening_balances(
      organization_id,store_id,product_id,quantity,unit,source,created_by
    )
    values(v_org,p_store_id,p_product_id,v_opening_total,trim(p_unit),'FILE_IMPORT',v_actor)
    on conflict(store_id,product_id) do update
      set quantity=excluded.quantity,
          unit=excluded.unit,
          source='FILE_IMPORT';
  end if;

  insert into public.audit_logs(
    organization_id,store_id,entity_type,entity_id,action,new_value,user_id
  )
  values(
    v_org,p_store_id,'product',p_product_id,'IMPORTED_PRODUCT_EDITED',
    jsonb_build_object(
      'source_id',p_source_id,
      'name',trim(p_name),
      'unit',trim(p_unit),
      'specification',nullif(trim(coalesce(p_specification,'')),''),
      'zone',coalesce(nullif(trim(coalesce(p_zone_name,'')),''),'未分類'),
      'opening_quantity',p_opening_quantity
    ),
    v_actor
  );

  return jsonb_build_object(
    'product_id',p_product_id,
    'name',trim(p_name),
    'unit',trim(p_unit),
    'specification',nullif(trim(coalesce(p_specification,'')),''),
    'zone',coalesce(nullif(trim(coalesce(p_zone_name,'')),''),'未分類'),
    'opening_quantity',p_opening_quantity
  );
end;
$$;

revoke all on function public.update_imported_inventory_item(uuid,uuid,text,uuid,text,text,text,text,numeric) from public,anon;
grant execute on function public.update_imported_inventory_item(uuid,uuid,text,uuid,text,text,text,text,numeric) to authenticated;
