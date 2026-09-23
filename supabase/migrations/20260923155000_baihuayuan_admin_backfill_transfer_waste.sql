
alter table private.store_movements
  add column if not exists occurred_at timestamptz,
  add column if not exists source text not null default 'FIELD',
  add column if not exists backfill_reason text,
  add column if not exists original_actor_name text;

alter table private.waste_records
  add column if not exists occurred_at timestamptz,
  add column if not exists backfill_reason text,
  add column if not exists original_actor_name text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname='store_movements_source_check'
      and conrelid='private.store_movements'::regclass
  ) then
    alter table private.store_movements
      add constraint store_movements_source_check
      check (source in ('FIELD','ADMIN_BACKFILL'));
  end if;
end $$;

create or replace function public.create_baihuayuan_transfer_backfill(
  p_store_id uuid,
  p_from_store_id uuid,
  p_to_store_id uuid,
  p_product_id uuid,
  p_quantity numeric,
  p_unit text,
  p_unit_price numeric,
  p_occurred_at timestamptz,
  p_original_actor_name text,
  p_backfill_reason text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_org uuid;
  v_product public.products;
  v_move private.store_movements;
  v_result jsonb;
begin
  if auth.uid() is null or not private.baihuayuan_can_confirm_backoffice(p_store_id) then
    raise exception 'TRANSFER_REVIEW_REQUIRED' using errcode='42501';
  end if;

  select organization_id into v_org
  from public.stores
  where id=p_store_id and is_active and name in ('BeApe','Gras');

  if v_org is null then raise exception 'BAIHUAYUAN_STORE_REQUIRED' using errcode='42501'; end if;
  if p_from_store_id is null or p_to_store_id is null or p_from_store_id=p_to_store_id then
    raise exception 'INVALID_TRANSFER_DIRECTION' using errcode='22023';
  end if;
  if not exists(
    select 1 from public.stores s
    where s.organization_id=v_org and s.is_active and s.name in ('BeApe','Gras')
      and s.id=p_from_store_id
  ) or not exists(
    select 1 from public.stores s
    where s.organization_id=v_org and s.is_active and s.name in ('BeApe','Gras')
      and s.id=p_to_store_id
  ) then
    raise exception 'INVALID_TRANSFER_DIRECTION' using errcode='22023';
  end if;

  select * into v_product
  from public.products
  where id=p_product_id and organization_id=v_org and is_active;
  if not found then raise exception 'INVALID_PRODUCT' using errcode='22023'; end if;

  if p_quantity is null or p_quantity<=0 or p_quantity>=1000000000 then
    raise exception 'INVALID_QUANTITY' using errcode='22023';
  end if;
  if btrim(coalesce(p_unit,''))='' or length(btrim(p_unit))>30 then
    raise exception 'INVALID_UNIT' using errcode='22023';
  end if;
  if p_unit_price is null or p_unit_price<0 then
    raise exception 'TRANSFER_PRICE_REQUIRED' using errcode='22023';
  end if;
  if p_occurred_at is null or p_occurred_at>now()+interval '5 minutes' then
    raise exception 'INVALID_OCCURRED_AT' using errcode='22023';
  end if;
  if btrim(coalesce(p_backfill_reason,''))='' then
    raise exception 'BACKFILL_REASON_REQUIRED' using errcode='22023';
  end if;

  insert into private.store_movements(
    organization_id,from_store_id,to_store_id,kind,product_id,name,quantity,unit,
    returned_quantity,expected_return_on,status,created_by,closed_at,
    supplier_id,unit_price_snapshot,amount_snapshot,note,
    review_status,reviewed_by,reviewed_at,available_snapshot,stock_warning,
    occurred_at,source,backfill_reason,original_actor_name
  )
  values(
    v_org,p_from_store_id,p_to_store_id,'TRANSFER',v_product.id,v_product.name,p_quantity,btrim(p_unit),
    0,null,'COMPLETE',auth.uid(),now(),
    null,p_unit_price,p_unit_price*p_quantity,btrim(coalesce(p_note,'')),
    'CONFIRMED',auth.uid(),now(),null,false,
    p_occurred_at,'ADMIN_BACKFILL',btrim(p_backfill_reason),nullif(btrim(coalesce(p_original_actor_name,'')),'')
  )
  returning * into v_move;

  insert into private.store_units(store_id,unit) values(p_from_store_id,btrim(p_unit)) on conflict do nothing;
  insert into private.store_units(store_id,unit) values(p_to_store_id,btrim(p_unit)) on conflict do nothing;

  insert into private.store_movement_events(movement_id,store_id,action,name,quantity,unit,actor_id)
  values(v_move.id,p_store_id,'CREATE',v_move.name,v_move.quantity,v_move.unit,auth.uid());

  insert into public.audit_logs(
    organization_id,entity_type,entity_id,action,new_value,user_id,store_id
  )
  values(
    v_org,'store_movement',v_move.id::text,'TRANSFER_ADMIN_BACKFILL',
    jsonb_build_object(
      'from_store_id',p_from_store_id,'to_store_id',p_to_store_id,
      'product_id',p_product_id,'quantity',p_quantity,'unit',btrim(p_unit),
      'unit_price',p_unit_price,'occurred_at',p_occurred_at,
      'original_actor_name',nullif(btrim(coalesce(p_original_actor_name,'')),''),
      'backfill_reason',btrim(p_backfill_reason)
    ),
    auth.uid(),p_store_id
  );

  select to_jsonb(v_move)||jsonb_build_object(
    'from_name',fs.name,
    'to_name',ts.name,
    'actor_name',coalesce(nullif(v_move.original_actor_name,''),creator.display_name,'行政補登'),
    'reviewer_name',reviewer.display_name,
    'reference_price',v_move.unit_price_snapshot,
    'transfer_amount',v_move.amount_snapshot,
    'events','[]'::jsonb
  )
  into v_result
  from public.stores fs
  join public.stores ts on ts.id=v_move.to_store_id
  left join public.profiles creator on creator.id=v_move.created_by
  left join public.profiles reviewer on reviewer.id=v_move.reviewed_by
  where fs.id=v_move.from_store_id;

  return v_result;
end;
$$;

revoke all on function public.create_baihuayuan_transfer_backfill(uuid,uuid,uuid,uuid,numeric,text,numeric,timestamptz,text,text,text) from public;
grant execute on function public.create_baihuayuan_transfer_backfill(uuid,uuid,uuid,uuid,numeric,text,numeric,timestamptz,text,text,text) to authenticated;

create or replace function public.create_baihuayuan_waste_backfill(
  p_store_id uuid,
  p_product_id uuid,
  p_quantity numeric,
  p_unit text,
  p_reason text,
  p_unit_price numeric,
  p_occurred_at timestamptz,
  p_original_actor_name text,
  p_backfill_reason text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_store public.stores;
  v_product public.products;
  v_actor text;
  v_waste private.waste_records;
  v_result jsonb;
begin
  if auth.uid() is null or not private.baihuayuan_can_confirm_backoffice(p_store_id) then
    raise exception 'WASTE_REVIEW_REQUIRED' using errcode='42501';
  end if;

  select * into v_store
  from public.stores
  where id=p_store_id and is_active and name in ('BeApe','Gras');
  if not found then raise exception 'BAIHUAYUAN_STORE_REQUIRED' using errcode='42501'; end if;

  select * into v_product
  from public.products
  where id=p_product_id and organization_id=v_store.organization_id and is_active;
  if not found then raise exception 'INVALID_PRODUCT' using errcode='22023'; end if;

  if p_quantity is null or p_quantity<=0 or p_quantity>=1000000000 then
    raise exception 'INVALID_QUANTITY' using errcode='22023';
  end if;
  if btrim(coalesce(p_unit,''))='' or length(btrim(p_unit))>30 then
    raise exception 'INVALID_UNIT' using errcode='22023';
  end if;
  if p_reason not in ('效期到期','品質異常','製作或操作損耗','保存或設備異常','供應商問題','其他') then
    raise exception 'WASTE_FIELDS_REQUIRED' using errcode='22023';
  end if;
  if p_unit_price is not null and p_unit_price<0 then
    raise exception 'INVALID_PRICE' using errcode='22023';
  end if;
  if p_occurred_at is null or p_occurred_at>now()+interval '5 minutes' then
    raise exception 'INVALID_OCCURRED_AT' using errcode='22023';
  end if;
  if btrim(coalesce(p_backfill_reason,''))='' then
    raise exception 'BACKFILL_REASON_REQUIRED' using errcode='22023';
  end if;

  select coalesce(nullif(btrim(p_original_actor_name),''),
                  (select nullif(btrim(display_name),'') from public.profiles where id=auth.uid()),
                  '行政補登')
  into v_actor;

  insert into private.waste_records(
    organization_id,store_id,store_name,name,quantity,unit,reason,note,delay_reason,
    source,expiry_id,lot_id,product_id,expires_on,zone_name,reference_price,
    price_receipt_line_id,erp_required,created_by,actor_name,work_date,requires_review,
    occurred_at,backfill_reason,original_actor_name
  )
  values(
    v_store.organization_id,p_store_id,v_store.name,v_product.name,p_quantity,btrim(p_unit),p_reason,
    nullif(btrim(coalesce(p_note,'')),''),null,
    'ADMIN_BACKFILL',null,null,v_product.id,null,null,null,
    null,false,auth.uid(),v_actor,(p_occurred_at at time zone 'Asia/Taipei')::date,true,
    p_occurred_at,btrim(p_backfill_reason),nullif(btrim(coalesce(p_original_actor_name,'')),'')
  )
  returning * into v_waste;

  v_result:=public.confirm_baihuayuan_waste(
    p_store_id,v_waste.id,p_quantity,p_unit_price
  );

  insert into public.audit_logs(
    organization_id,entity_type,entity_id,action,new_value,user_id,store_id
  )
  values(
    v_store.organization_id,'waste_record',v_waste.id::text,'WASTE_ADMIN_BACKFILL',
    jsonb_build_object(
      'product_id',p_product_id,'quantity',p_quantity,'unit',btrim(p_unit),
      'reason',p_reason,'unit_price',p_unit_price,'occurred_at',p_occurred_at,
      'original_actor_name',nullif(btrim(coalesce(p_original_actor_name,'')),''),
      'backfill_reason',btrim(p_backfill_reason)
    ),
    auth.uid(),p_store_id
  );

  return v_result||jsonb_build_object(
    'source','ADMIN_BACKFILL',
    'occurred_at',p_occurred_at,
    'backfill_reason',btrim(p_backfill_reason),
    'original_actor_name',nullif(btrim(coalesce(p_original_actor_name,'')),'')
  );
end;
$$;

revoke all on function public.create_baihuayuan_waste_backfill(uuid,uuid,numeric,text,text,numeric,timestamptz,text,text,text) from public;
grant execute on function public.create_baihuayuan_waste_backfill(uuid,uuid,numeric,text,text,numeric,timestamptz,text,text,text) to authenticated;

do $patch$
declare
  src text;
  original text;
begin
  select pg_get_functiondef('private.transfers_workspace_v2(uuid,jsonb)'::regprocedure) into src;
  original:=src;
  src:=replace(src,'order by m.created_at desc','order by coalesce(m.occurred_at,m.created_at) desc');
  src:=replace(src,'(m.created_at>=v_start and m.created_at<v_end)','(coalesce(m.occurred_at,m.created_at)>=v_start and coalesce(m.occurred_at,m.created_at)<v_end)');
  src:=replace(src,'''actor_name'',creator.display_name,',
    '''actor_name'',coalesce(nullif(m.original_actor_name,''''),creator.display_name),');
  if src=original then raise exception 'TRANSFER_WORKSPACE_BACKFILL_PATCH_MISSING'; end if;
  execute src;
end
$patch$;
