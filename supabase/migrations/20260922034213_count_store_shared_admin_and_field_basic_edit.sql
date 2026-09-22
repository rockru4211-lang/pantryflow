create or replace function private.can_import_inventory(p_store uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
 select coalesce(
   private.app_role(p_store) in ('OWNER','SUPERVISOR','LOGISTICS'),
   false
 )
$function$;

create or replace function public.update_pilot_count_item_basic(
  p_store_id uuid,
  p_product_id uuid,
  p_name text,
  p_unit text,
  p_specification text default null,
  p_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_product public.products%rowtype;
  v_result jsonb;
begin
  if v_actor is null or not private.can_count_inline(p_store_id) then
    raise exception using errcode='42501', message='STORE_COUNTER_REQUIRED';
  end if;

  if length(btrim(coalesce(p_name,''))) not between 1 and 160
     or length(btrim(coalesce(p_unit,''))) not between 1 and 30 then
    raise exception using errcode='22023', message='INVALID_PRODUCT_BASIC';
  end if;

  select p.* into v_product
  from public.products p
  join public.stores s on s.organization_id=p.organization_id
  where s.id=p_store_id
    and p.id=p_product_id
    and p.is_active
    and exists(
      select 1
      from public.zone_products zp
      join public.count_zones z on z.id=zp.zone_id
      where z.store_id=p_store_id
        and z.is_active
        and zp.product_id=p.id
    )
  for update of p;

  if not found then
    raise exception using errcode='P0002', message='PRODUCT_NOT_FOUND';
  end if;

  if p_updated_at is not null and p_updated_at is distinct from v_product.updated_at then
    raise exception using errcode='40001', message='REVISION_CONFLICT';
  end if;

  update public.products
  set name=btrim(p_name),
      count_unit=btrim(p_unit),
      specification=nullif(btrim(coalesce(p_specification,'')),''),
      updated_at=now()
  where id=v_product.id
  returning to_jsonb(products.*) into v_result;

  update public.zone_products zp
  set count_unit=btrim(p_unit)
  from public.count_zones z
  where z.id=zp.zone_id
    and z.store_id=p_store_id
    and zp.product_id=v_product.id;

  insert into public.audit_logs(
    organization_id,store_id,entity_type,entity_id,action,old_value,new_value,user_id
  )
  values(
    v_product.organization_id,p_store_id,'product',v_product.id::text,
    'COUNT_ITEM_BASIC_EDIT',to_jsonb(v_product),v_result,v_actor
  );

  return v_result;
end
$function$;

revoke all on function public.update_pilot_count_item_basic(uuid,uuid,text,text,text,timestamptz) from public,anon;
grant execute on function public.update_pilot_count_item_basic(uuid,uuid,text,text,text,timestamptz) to authenticated,service_role;
