
alter table private.store_movements
  add column if not exists review_status text not null default 'CONFIRMED',
  add column if not exists reviewed_by uuid references auth.users(id),
  add column if not exists reviewed_at timestamptz,
  add column if not exists available_snapshot numeric,
  add column if not exists stock_warning boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='private.store_movements'::regclass
      and conname='store_movements_review_status_check'
  ) then
    alter table private.store_movements
      add constraint store_movements_review_status_check
      check (review_status in ('PENDING','CONFIRMED'));
  end if;
end $$;

alter table private.store_movement_events
  drop constraint if exists store_movement_events_action_check;

alter table private.store_movement_events
  add constraint store_movement_events_action_check
  check (action in ('CREATE','RETURN','EXCHANGE','CONFIRM'));

create or replace function private.stock_cost_prepare_movement()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare v_cost numeric;
begin
  if new.product_id is null then return new; end if;
  if new.kind='TRANSFER' and coalesce(new.review_status,'CONFIRMED')='PENDING' then
    new.unit_price_snapshot:=null;
    new.amount_snapshot:=null;
    return new;
  end if;
  v_cost:=private.stock_cost_quote(new.from_store_id,new.product_id,new.unit);
  if v_cost is not null then
    new.unit_price_snapshot:=v_cost;
    new.amount_snapshot:=v_cost*new.quantity;
  end if;
  return new;
end;
$$;

create or replace function private.stock_cost_receive_movement()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if new.kind='TRANSFER' and coalesce(new.review_status,'CONFIRMED')='PENDING' then
    return new;
  end if;
  if new.product_id is not null and new.unit_price_snapshot is not null then
    perform private.stock_cost_blend(new.to_store_id,new.product_id,new.unit,new.quantity,new.unit_price_snapshot,false);
  end if;
  return new;
end;
$$;

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

  select p.name,coalesce(nullif(p.count_unit,''),p.base_unit)
  into v_name,v_unit
  from public.products p
  where p.id=v_product and p.organization_id=v_org and p.is_active
    and private.count_product_not_removed(p_store,p.id);

  if v_name is null then raise exception 'INVALID_PRODUCT' using errcode='22023'; end if;

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
    'PENDING',v_available,v_available<v_qty
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

create or replace function private.confirm_store_transfer(p_store uuid,p_data jsonb)
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
  v_supplier uuid;
  v_result jsonb;
begin
  select organization_id into v_org
  from public.stores
  where id=p_store and is_active and name in ('BeApe','Gras');

  if v_org is null then raise exception 'BAIHUAYUAN_STORE_REQUIRED' using errcode='42501'; end if;
  if not (
    private.app_role(p_store) in ('LOGISTICS','OWNER')
    or private.can_manage_business(p_store)
  ) then raise exception 'TRANSFER_REVIEW_REQUIRED' using errcode='42501'; end if;

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
  if v_move.review_status='CONFIRMED' then
    return to_jsonb(v_move);
  end if;
  if (p_data->>'revision')::int is distinct from v_move.revision then
    raise exception 'REVISION_CONFLICT' using errcode='40001';
  end if;

  v_qty:=coalesce(nullif(p_data->>'quantity','')::numeric,v_move.quantity);
  v_price:=nullif(p_data->>'unit_price','')::numeric;
  v_supplier:=nullif(p_data->>'supplier_id','')::uuid;

  if v_qty is null or v_qty<=0 or v_qty>=1000000000 then
    raise exception 'INVALID_QUANTITY' using errcode='22023';
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

  if v_move.product_id is not null then
    perform private.stock_cost_blend(
      v_move.to_store_id,
      v_move.product_id,
      v_move.unit,
      v_move.quantity,
      v_move.unit_price_snapshot,
      false
    );
  end if;

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
      'actor_name',creator.display_name,
      'reviewer_name',reviewer.display_name,
      'supplier_name',coalesce(sp.name,legacy.supplier_name),
      'reference_price',coalesce(m.unit_price_snapshot,legacy.unit_price),
      'transfer_amount',case
        when m.review_status='CONFIRMED' then m.amount_snapshot
        else coalesce(m.unit_price_snapshot,legacy.unit_price)*m.quantity
      end,
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
  left join public.profiles creator on creator.id=m.created_by
  left join public.profiles reviewer on reviewer.id=m.reviewed_by
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
    and (
      m.review_status='PENDING'
      or m.status='OPEN'
      or (m.created_at>=v_start and m.created_at<v_end)
    );

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

do $patch$
declare
  src text;
  original text;
begin
  select pg_get_functiondef('private.app_operation(uuid,text,jsonb,uuid)'::regprocedure) into src;
  if position('movement.transfer-confirm' in src)=0 then
    original:=src;
    src:=replace(
      src,
      'elsif p_action=''movement.transfer-create'' then v_result:=private.create_store_transfer(p_store,p_data);v_id:=nullif(v_result->>''id'','''')::uuid;',
      'elsif p_action=''movement.transfer-create'' then v_result:=private.create_store_transfer(p_store,p_data);v_id:=nullif(v_result->>''id'','''')::uuid;'||
      chr(10)||
      ' elsif p_action=''movement.transfer-confirm'' then v_result:=private.confirm_store_transfer(p_store,p_data);v_id:=nullif(v_result->>''id'','''')::uuid;'
    );
    if src=original then raise exception 'TRANSFER_CONFIRM_PATCH_MISSING'; end if;
    execute src;
  end if;
end
$patch$;

revoke all on function private.create_store_transfer(uuid,jsonb) from public,anon,authenticated;
revoke all on function private.confirm_store_transfer(uuid,jsonb) from public,anon,authenticated;
revoke all on function private.transfers_workspace_v2(uuid,jsonb) from public,anon,authenticated;
