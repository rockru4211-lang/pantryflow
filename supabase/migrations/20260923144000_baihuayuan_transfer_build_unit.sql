
create or replace function private.confirm_store_transfer(p_store uuid, p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_org uuid;
  v_move private.store_movements;
  v_qty numeric;
  v_price numeric;
  v_unit text;
  v_supplier uuid;
  v_result jsonb;
begin
  select organization_id into v_org
  from public.stores
  where id=p_store and is_active and name in ('BeApe','Gras');

  if v_org is null then raise exception 'BAIHUAYUAN_STORE_REQUIRED' using errcode='42501'; end if;
  if not private.baihuayuan_can_confirm_backoffice(p_store) then raise exception 'TRANSFER_REVIEW_REQUIRED' using errcode='42501'; end if;

  select m.* into v_move
  from private.store_movements m
  join public.stores fs on fs.id=m.from_store_id
  join public.stores ts on ts.id=m.to_store_id
  where m.id=(p_data->>'id')::uuid
    and m.organization_id=v_org
    and m.kind='TRANSFER'
    and fs.name in ('BeApe','Gras')
    and ts.name in ('BeApe','Gras')
  for update;

  if not found then raise exception 'MOVEMENT_NOT_FOUND' using errcode='P0002'; end if;
  if v_move.review_status='CONFIRMED' then return to_jsonb(v_move); end if;
  if (p_data->>'revision')::int is distinct from v_move.revision then
    raise exception 'REVISION_CONFLICT' using errcode='40001';
  end if;

  v_qty:=coalesce(nullif(p_data->>'quantity','')::numeric,v_move.quantity);
  v_unit:=coalesce(nullif(btrim(p_data->>'unit'),''),v_move.unit);
  v_price:=nullif(p_data->>'unit_price','')::numeric;
  v_supplier:=nullif(p_data->>'supplier_id','')::uuid;

  if v_qty is null or v_qty<=0 or v_qty>=1000000000 then
    raise exception 'INVALID_QUANTITY' using errcode='22023';
  end if;
  if length(coalesce(v_unit,'')) not between 1 and 30 then
    raise exception 'INVALID_UNIT' using errcode='22023';
  end if;
  if v_price is null or v_price<0 then
    raise exception 'TRANSFER_PRICE_REQUIRED' using errcode='22023';
  end if;
  if v_supplier is not null and not exists(
    select 1 from public.suppliers s
    where s.id=v_supplier and s.organization_id=v_org and s.is_active
  ) then raise exception 'INVALID_SUPPLIER' using errcode='22023'; end if;

  update private.store_movements
  set quantity=v_qty,
      unit=v_unit,
      supplier_id=v_supplier,
      unit_price_snapshot=v_price,
      amount_snapshot=v_price*v_qty,
      review_status='CONFIRMED',
      reviewed_by=auth.uid(),
      reviewed_at=now(),
      closed_at=now(),
      revision=revision+1
  where id=v_move.id
  returning * into v_move;

  insert into private.store_units(store_id,unit) values(v_move.from_store_id,v_unit) on conflict do nothing;
  insert into private.store_units(store_id,unit) values(v_move.to_store_id,v_unit) on conflict do nothing;

  insert into private.store_movement_events(movement_id,store_id,action,name,quantity,unit,actor_id)
  values(v_move.id,p_store,'CONFIRM',v_move.name,v_move.quantity,v_move.unit,auth.uid());

  select to_jsonb(v_move)||jsonb_build_object(
    'from_name',fs.name,
    'to_name',ts.name,
    'actor_name',creator.display_name,
    'reviewer_name',reviewer.display_name,
    'supplier_name',sp.name,
    'reference_price',v_move.unit_price_snapshot,
    'transfer_amount',v_move.amount_snapshot
  )
  into v_result
  from public.stores fs
  join public.stores ts on ts.id=v_move.to_store_id
  left join public.profiles creator on creator.id=v_move.created_by
  left join public.profiles reviewer on reviewer.id=v_move.reviewed_by
  left join public.suppliers sp on sp.id=v_move.supplier_id
  where fs.id=v_move.from_store_id;

  return v_result;
end;
$$;
