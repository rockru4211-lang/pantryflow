
create or replace function private.create_store_transfer(p_store uuid, p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_role text := private.app_role(p_store);
  v_org uuid;
  v_mode text;
  v_store_name text;
  v_other uuid;
  v_product uuid;
  v_name text;
  v_unit text;
  v_qty numeric;
  v_available numeric;
  v_move private.store_movements;
  v_result jsonb;
begin
  select s.organization_id,o.store_mode,s.name into v_org,v_mode,v_store_name
  from public.stores s join public.organizations o on o.id=s.organization_id
  where s.id=p_store and s.is_active;

  if v_store_name is null or v_store_name not in ('BeApe','Gras') then
    raise exception 'BAIHUAYUAN_STORE_REQUIRED' using errcode='42501';
  end if;
  if v_role is null or v_role not in ('STAFF','SUPERVISOR','LOGISTICS','OWNER') then
    raise exception 'FIELD_ROLE_REQUIRED' using errcode='42501';
  end if;
  if v_mode <> 'MULTI' then
    raise exception 'MULTI_STORE_REQUIRED' using errcode='42501';
  end if;

  v_other := nullif(p_data->>'to_store_id','')::uuid;
  v_product := nullif(p_data->>'product_id','')::uuid;
  v_qty := nullif(p_data->>'quantity','')::numeric;

  if v_other is null or v_other=p_store
     or not exists(
       select 1 from public.stores
       where id=v_other and organization_id=v_org and is_active and name in ('BeApe','Gras')
     ) then
    raise exception 'INVALID_DESTINATION_STORE' using errcode='22023';
  end if;
  if v_qty is null or v_qty<=0 or v_qty>=1000000000 then
    raise exception 'INVALID_QUANTITY' using errcode='22023';
  end if;

  if v_product is null then
    if not coalesce((p_data->>'manual')::boolean,false) then raise exception 'INVALID_PRODUCT' using errcode='22023'; end if;
    v_name:=btrim(coalesce(p_data->>'name',''));
    v_unit:=btrim(coalesce(p_data->>'unit',''));
    if length(v_name) not between 1 and 160 or length(v_unit) not between 1 and 30 then raise exception 'INVALID_PRODUCT' using errcode='22023'; end if;
  else
  select p.name,coalesce(nullif(p.count_unit,''),p.base_unit)
  into v_name,v_unit
  from public.products p
  where p.id=v_product and p.organization_id=v_org and p.is_active
    and private.count_product_not_removed(p_store,p.id)
    and not exists(select 1 from private.count_field_removed fr where fr.store_id=p_store and fr.product_id=p.id)
    and exists(select 1 from public.count_zones z join public.zone_products zp on zp.zone_id=z.id where z.store_id=p_store and z.is_active and zp.product_id=p.id);

  if v_name is null then raise exception 'INVALID_PRODUCT' using errcode='22023'; end if;
  end if;

  select coalesce(sum(sp.quantity),0)
  into v_available
  from private.stock_positions sp
  where sp.store_id=p_store and sp.product_id=v_product and sp.unit=v_unit and sp.state='READY';

  insert into private.store_movements(
    organization_id,from_store_id,to_store_id,kind,product_id,name,quantity,unit,
    returned_quantity,expected_return_on,status,created_by,closed_at,
    supplier_id,unit_price_snapshot,amount_snapshot,note,
    review_status,available_snapshot,stock_warning
  )
  values(
    v_org,p_store,v_other,'TRANSFER',v_product,v_name,v_qty,v_unit,
    0,null,'COMPLETE',auth.uid(),null,
    null,null,null,btrim(coalesce(p_data->>'note','')),
    'PENDING',case when v_product is null then null else v_available end,v_product is not null and v_available<v_qty
  )
  returning * into v_move;

  insert into private.store_units(store_id,unit) values(p_store,v_unit) on conflict do nothing;
  insert into private.store_units(store_id,unit) values(v_other,v_unit) on conflict do nothing;

  insert into private.store_movement_events(movement_id,store_id,action,name,quantity,unit,actor_id)
  values(v_move.id,p_store,'CREATE',v_name,v_qty,v_unit,auth.uid());

  select to_jsonb(v_move)||jsonb_build_object(
    'from_name',fs.name,
    'to_name',ts.name,
    'actor_name',pr.display_name,
    'supplier_name',null,
    'reference_price',null,
    'transfer_amount',null
  )
  into v_result
  from public.stores fs
  join public.stores ts on ts.id=v_move.to_store_id
  left join public.profiles pr on pr.id=v_move.created_by
  where fs.id=v_move.from_store_id;

  return v_result;
end;
$$;


revoke all on function private.create_store_transfer(uuid,jsonb) from public,anon,authenticated;
-- Keep the full catalog for administrative review; explicitly mark field-selectable products.
do $patch$
declare src text; needle text:=$needle$'name',p.name,$needle$;
begin
 select pg_get_functiondef('private.transfers_workspace_v2(uuid,jsonb)'::regprocedure) into src;
 if strpos(src,needle)=0 then raise exception 'transfer catalog patch target missing'; end if;
 execute replace(src,needle,needle||$replacement$ 'available_for_transfer',private.count_product_not_removed(p_store,p.id) and not exists(select 1 from private.count_field_removed fr where fr.store_id=p_store and fr.product_id=p.id),$replacement$);
end;
$patch$;
