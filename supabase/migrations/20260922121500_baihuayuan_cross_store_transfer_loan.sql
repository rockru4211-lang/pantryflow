
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
  v_supplier uuid;
  v_latest_supplier uuid;
  v_price numeric;
  v_move private.store_movements;
  v_result jsonb;
begin
  select s.organization_id,o.store_mode,s.name into v_org,v_mode,v_store_name
  from public.stores s join public.organizations o on o.id=s.organization_id
  where s.id=p_store and s.is_active;

  if v_store_name not in ('BeApe','Gras') then
    raise exception 'BAIHUAYUAN_STORE_REQUIRED' using errcode='42501';
  end if;
  if v_role not in ('SUPERVISOR','LOGISTICS','OWNER') then
    raise exception 'FIELD_ROLE_REQUIRED' using errcode='42501';
  end if;
  if v_mode <> 'MULTI' then
    raise exception 'MULTI_STORE_REQUIRED' using errcode='42501';
  end if;

  v_other := nullif(p_data->>'to_store_id','')::uuid;
  v_product := nullif(p_data->>'product_id','')::uuid;
  v_qty := nullif(p_data->>'quantity','')::numeric;
  v_supplier := nullif(p_data->>'supplier_id','')::uuid;

  if v_other is null or v_other=p_store
     or not exists(
       select 1 from public.stores
       where id=v_other and organization_id=v_org and is_active and name in ('BeApe','Gras')
     ) then
    raise exception 'INVALID_DESTINATION_STORE' using errcode='22023';
  end if;
  if v_product is null then raise exception 'INVALID_PRODUCT' using errcode='22023'; end if;
  if v_qty is null or v_qty<=0 or v_qty>=1000000000 then
    raise exception 'INVALID_QUANTITY' using errcode='22023';
  end if;

  select p.name,coalesce(nullif(p.count_unit,''),p.base_unit),coalesce(v_supplier,p.current_supplier_id)
  into v_name,v_unit,v_supplier
  from public.products p
  where p.id=v_product and p.organization_id=v_org and p.is_active
    and private.count_product_not_removed(p_store,p.id);

  if v_name is null then raise exception 'INVALID_PRODUCT' using errcode='22023'; end if;

  if v_supplier is not null and not exists(
    select 1 from public.suppliers s where s.id=v_supplier and s.organization_id=v_org and s.is_active
  ) then raise exception 'INVALID_SUPPLIER' using errcode='22023'; end if;

  select g.supplier_id,rl.unit_price_ex_tax
  into v_latest_supplier,v_price
  from public.receipt_lines rl
  join public.goods_receipts g on g.id=rl.receipt_id
  join public.receipt_upload_batches b on b.id=g.source_batch_id
  where g.store_id=p_store
    and b.status::text='COMPLETED'
    and rl.product_id=v_product
    and rl.unit=v_unit
    and (v_supplier is null or g.supplier_id=v_supplier)
  order by g.receipt_date desc nulls last,g.reviewed_at desc nulls last,rl.created_at desc
  limit 1;

  if v_supplier is null then v_supplier:=v_latest_supplier; end if;

  insert into private.store_movements(
    organization_id,from_store_id,to_store_id,kind,product_id,name,quantity,unit,
    returned_quantity,expected_return_on,status,created_by,closed_at,
    supplier_id,unit_price_snapshot,amount_snapshot,note
  )
  values(
    v_org,p_store,v_other,'TRANSFER',v_product,v_name,v_qty,v_unit,
    0,null,'COMPLETE',auth.uid(),now(),
    v_supplier,v_price,case when v_price is null then null else v_price*v_qty end,
    btrim(coalesce(p_data->>'note',''))
  )
  returning * into v_move;

  perform private.stock_post(p_store,v_product,v_unit,-v_qty,'MOVEMENT',v_move.id,true);
  perform private.stock_post(v_other,v_product,v_unit,v_qty,'MOVEMENT',v_move.id,false);

  insert into private.store_units(store_id,unit) values(p_store,v_unit) on conflict do nothing;
  insert into private.store_units(store_id,unit) values(v_other,v_unit) on conflict do nothing;

  insert into private.store_movement_events(movement_id,store_id,action,name,quantity,unit,actor_id)
  values(v_move.id,p_store,'CREATE',v_name,v_qty,v_unit,auth.uid());

  select to_jsonb(v_move)||jsonb_build_object(
    'from_name',fs.name,
    'to_name',ts.name,
    'actor_name',pr.display_name,
    'supplier_name',sp.name,
    'reference_price',v_move.unit_price_snapshot,
    'transfer_amount',v_move.amount_snapshot
  )
  into v_result
  from public.stores fs
  join public.stores ts on ts.id=v_move.to_store_id
  left join public.profiles pr on pr.id=v_move.created_by
  left join public.suppliers sp on sp.id=v_move.supplier_id
  where fs.id=v_move.from_store_id;

  return v_result;
end;
$$;

create or replace function private.transfers_workspace_v2(p_store uuid,p_filter jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable security definer
set search_path=''
as $$
declare
  v_role text:=private.app_role(p_store);
  v_org uuid;
  v_mode text;
  v_erp boolean;
  v_store_name text;
  v_start timestamptz:=coalesce(nullif(p_filter->>'from','')::timestamptz,date_trunc('month',now()));
  v_end timestamptz:=coalesce(nullif(p_filter->>'to','')::timestamptz,now()+interval '1 day');
  v_records jsonb;
begin
  if v_role is null then raise exception 'APP_FORBIDDEN' using errcode='42501'; end if;
  select s.organization_id,o.store_mode,o.has_erp,s.name into v_org,v_mode,v_erp,v_store_name
  from public.stores s join public.organizations o on o.id=s.organization_id
  where s.id=p_store and s.is_active;

  if v_store_name not in ('BeApe','Gras') then
    raise exception 'BAIHUAYUAN_STORE_REQUIRED' using errcode='42501';
  end if;
  if v_mode<>'MULTI' then raise exception 'MULTI_STORE_REQUIRED' using errcode='42501'; end if;

  select coalesce(jsonb_agg(
    to_jsonb(m)||jsonb_build_object(
      'from_name',fs.name,
      'to_name',ts.name,
      'actor_name',pr.display_name,
      'supplier_name',coalesce(sp.name,legacy.supplier_name),
      'reference_price',coalesce(m.unit_price_snapshot,legacy.unit_price),
      'transfer_amount',coalesce(m.amount_snapshot,coalesce(m.unit_price_snapshot,legacy.unit_price)*m.quantity),
      'events',(select coalesce(jsonb_agg(to_jsonb(e)||jsonb_build_object('actor_name',ep.display_name) order by e.created_at),'[]'::jsonb)
                from private.store_movement_events e
                left join public.profiles ep on ep.id=e.actor_id
                where e.movement_id=m.id)
    )
    order by m.created_at desc
  ),'[]'::jsonb)
  into v_records
  from private.store_movements m
  join public.stores fs on fs.id=m.from_store_id
  join public.stores ts on ts.id=m.to_store_id
  left join public.profiles pr on pr.id=m.created_by
  left join public.suppliers sp on sp.id=m.supplier_id
  left join lateral (
    select s.name supplier_name,rl.unit_price_ex_tax unit_price
    from public.receipt_lines rl
    join public.goods_receipts g on g.id=rl.receipt_id
    join public.receipt_upload_batches b on b.id=g.source_batch_id
    left join public.suppliers s on s.id=g.supplier_id
    where g.store_id=m.from_store_id
      and b.status::text='COMPLETED'
      and rl.product_id=m.product_id
      and rl.unit=m.unit
    order by g.receipt_date desc nulls last,g.reviewed_at desc nulls last,rl.created_at desc
    limit 1
  ) legacy on true
  where m.organization_id=v_org
    and fs.name in ('BeApe','Gras')
    and ts.name in ('BeApe','Gras')
    and (m.from_store_id=p_store or m.to_store_id=p_store)
    and (m.status='OPEN' or (m.created_at>=v_start and m.created_at<v_end));

  return jsonb_build_object(
    'records',v_records,
    'role',v_role,
    'has_erp',v_erp,
    'stores',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.name) order by s.name),'[]'::jsonb)
              from public.stores s
              where s.organization_id=v_org and s.is_active and s.id<>p_store and s.name in ('BeApe','Gras')),
    'units',(select coalesce(jsonb_agg(unit order by unit),'[]') from private.store_units where store_id=p_store),
    'products',(
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'id',p.id,
          'name',p.name,
          'unit',coalesce(nullif(p.count_unit,''),p.base_unit),
          'current_supplier_id',p.current_supplier_id,
          'current_supplier_name',cs.name,
          'suppliers',(
            select coalesce(jsonb_agg(jsonb_build_object(
              'id',q.supplier_id,'name',q.supplier_name,'unit_price',q.unit_price,'receipt_date',q.receipt_date
            ) order by q.receipt_date desc nulls last),'[]'::jsonb)
            from (
              select distinct on(g.supplier_id)
                g.supplier_id,s2.name supplier_name,rl.unit_price_ex_tax unit_price,g.receipt_date
              from public.receipt_lines rl
              join public.goods_receipts g on g.id=rl.receipt_id
              join public.receipt_upload_batches b on b.id=g.source_batch_id
              left join public.suppliers s2 on s2.id=g.supplier_id
              where g.store_id=p_store
                and b.status::text='COMPLETED'
                and rl.product_id=p.id
                and rl.unit=coalesce(nullif(p.count_unit,''),p.base_unit)
                and g.supplier_id is not null
              order by g.supplier_id,g.receipt_date desc nulls last,g.reviewed_at desc nulls last,rl.created_at desc
            ) q
          )
        ) order by p.name
      ),'[]'::jsonb)
      from public.products p
      left join public.suppliers cs on cs.id=p.current_supplier_id
      where p.organization_id=v_org and p.is_active
        and exists(
          select 1 from public.count_zones z
          join public.zone_products zp on zp.zone_id=z.id
          where z.store_id=p_store and z.is_active and zp.product_id=p.id
        )
    )
  );
end;
$$;

create or replace function private.baihuayuan_movement_operation(
  p_store uuid,
  p_action text,
  p_data jsonb,
  p_request uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_role text:=private.app_role(p_store);
  v_org uuid;
  v_mode text;
  v_store_name text;
  v_move private.store_movements;
  v_other uuid;
  v_target uuid;
  v_qty numeric;
  v_name text;
  v_unit text;
  v_kind text;
  v_old jsonb;
  v_result jsonb;
begin
  select s.organization_id,o.store_mode,s.name into v_org,v_mode,v_store_name
  from public.stores s join public.organizations o on o.id=s.organization_id
  where s.id=p_store and s.is_active;

  if v_store_name not in ('BeApe','Gras') then raise exception 'BAIHUAYUAN_STORE_REQUIRED' using errcode='42501'; end if;
  if v_role not in ('SUPERVISOR','LOGISTICS','OWNER') then raise exception 'FIELD_ROLE_REQUIRED' using errcode='42501'; end if;
  if v_mode<>'MULTI' then raise exception 'MULTI_STORE_REQUIRED' using errcode='42501'; end if;

  v_qty:=(p_data->>'quantity')::numeric;
  if v_qty is null or v_qty<=0 or v_qty>=1000000000 then raise exception 'INVALID_QUANTITY' using errcode='22023'; end if;

  if p_action='movement.create' then
    v_kind:=p_data->>'mode';
    v_other:=(p_data->>'other_store_id')::uuid;
    if v_kind not in ('loan','loan_out')
      or v_other=p_store
      or not exists(
        select 1 from public.stores
        where id=v_other and organization_id=v_org and is_active and name in ('BeApe','Gras')
      )
    then raise exception 'INVALID_MOVEMENT' using errcode='22023'; end if;

    v_target:=nullif(p_data->>'product_id','')::uuid;
    if v_target is not null and not exists(
      select 1 from public.products
      where id=v_target and organization_id=v_org and is_active
    ) then raise exception 'INVALID_PRODUCT' using errcode='22023'; end if;

    v_name:=btrim(p_data->>'name');
    v_unit:=btrim(p_data->>'unit');
    insert into private.store_movements(
      organization_id,from_store_id,to_store_id,kind,product_id,name,quantity,unit,
      expected_return_on,status,created_by,closed_at
    )
    values(
      v_org,
      case when v_kind='loan' then v_other else p_store end,
      case when v_kind='loan' then p_store else v_other end,
      'LOAN',v_target,v_name,v_qty,v_unit,
      nullif(p_data->>'expected_return_on','')::date,'OPEN',auth.uid(),null
    )
    returning * into v_move;
  else
    select * into v_move
    from private.store_movements
    where id=(p_data->>'id')::uuid
      and organization_id=v_org
      and p_store in (from_store_id,to_store_id)
    for update;

    if not found then raise exception 'MOVEMENT_NOT_FOUND' using errcode='P0002'; end if;
    if v_move.status<>'OPEN' then raise exception 'MOVEMENT_ALREADY_CLOSED' using errcode='22023'; end if;
    if (p_data->>'revision')::int is distinct from v_move.revision then raise exception 'REVISION_CONFLICT' using errcode='40001'; end if;
    v_old:=to_jsonb(v_move);

    if p_action='movement.return' then
      if v_qty>v_move.quantity-v_move.returned_quantity then raise exception 'RETURN_EXCEEDS_REMAINING' using errcode='22023'; end if;
      v_name:=v_move.name; v_unit:=v_move.unit;
      update private.store_movements
      set returned_quantity=returned_quantity+v_qty,
          status=case when returned_quantity+v_qty=quantity then 'RETURNED' else 'OPEN' end,
          closed_at=case when returned_quantity+v_qty=quantity then now() end,
          revision=revision+1
      where id=v_move.id
      returning * into v_move;
    elsif p_action='movement.exchange' then
      v_name:=btrim(p_data->>'name'); v_unit:=btrim(p_data->>'unit');
      if length(coalesce(v_name,'')) not between 1 and 160 or length(coalesce(v_unit,'')) not between 1 and 30 then
        raise exception 'INVALID_EXCHANGE' using errcode='22023';
      end if;
      update private.store_movements
      set status='EXCHANGED',closed_at=now(),revision=revision+1
      where id=v_move.id
      returning * into v_move;
    else
      raise exception 'INVALID_MOVEMENT_ACTION' using errcode='22023';
    end if;
  end if;

  if p_action='movement.create' and v_target is not null then
    if v_kind='loan' then
      perform private.stock_post(p_store,v_target,v_unit,v_qty,'MOVEMENT',v_move.id);
    else
      perform private.stock_post(p_store,v_target,v_unit,-v_qty,'MOVEMENT',v_move.id);
    end if;
  elsif p_action='movement.return' and v_move.product_id is not null then
    perform private.stock_post(
      p_store,v_move.product_id,v_unit,
      case when p_store=v_move.to_store_id then -v_qty else v_qty end,
      'RETURN',p_request
    );
  end if;

  insert into private.store_units(store_id,unit) values(p_store,v_unit) on conflict do nothing;
  insert into private.store_movement_events(movement_id,store_id,action,name,quantity,unit,actor_id)
  values(v_move.id,p_store,case p_action when 'movement.create' then 'CREATE' when 'movement.return' then 'RETURN' else 'EXCHANGE' end,v_name,v_qty,v_unit,auth.uid());

  select to_jsonb(v_move)||jsonb_build_object(
    'from_name',fs.name,
    'to_name',ts.name,
    'actor_name',pr.display_name,
    'supplier_name',sp.name,
    'reference_price',v_move.unit_price_snapshot,
    'transfer_amount',v_move.amount_snapshot
  )
  into v_result
  from public.stores fs
  join public.stores ts on ts.id=v_move.to_store_id
  left join public.profiles pr on pr.id=v_move.created_by
  left join public.suppliers sp on sp.id=v_move.supplier_id
  where fs.id=v_move.from_store_id;

  return v_result;
end;
$$;

do $patch$
declare
  src text;
  original text;
begin
  select pg_get_functiondef('private.app_operation(uuid,text,jsonb,uuid)'::regprocedure) into src;
  original:=src;

  src:=replace(
    src,
    'elsif p_action=''movement.transfer-create'' then v_result:=private.create_store_transfer(p_store,p_data);v_id:=nullif(v_result->>''id'','''')::uuid;',
    'elsif p_action=''movement.transfer-create'' then v_result:=private.create_store_transfer(p_store,p_data);v_id:=nullif(v_result->>''id'','''')::uuid;'||
    chr(10)||
    ' elsif p_action in (''movement.create'',''movement.return'',''movement.exchange'') and exists(select 1 from public.stores where id=p_store and name in (''BeApe'',''Gras'')) then v_result:=private.baihuayuan_movement_operation(p_store,p_action,p_data,p_request);v_id:=nullif(v_result->>''id'','''')::uuid;'||
    chr(10)||
    ' elsif p_action in (''movement.create'',''movement.return'',''movement.exchange'') then'
  );

  if src=original then raise exception 'BAIHUAYUAN_MOVEMENT_PATCH_MISSING'; end if;
  execute src;
end
$patch$;

revoke all on function private.baihuayuan_movement_operation(uuid,text,jsonb,uuid) from public,anon,authenticated;
revoke all on function private.create_store_transfer(uuid,jsonb) from public,anon,authenticated;
revoke all on function private.transfers_workspace_v2(uuid,jsonb) from public,anon,authenticated;
