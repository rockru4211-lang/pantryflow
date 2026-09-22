
alter table private.waste_records
  add column if not exists requires_review boolean not null default false;

create table if not exists private.waste_reviews (
  waste_id uuid primary key references private.waste_records(id) on delete restrict,
  store_id uuid not null references public.stores(id),
  confirmed_quantity numeric not null check (confirmed_quantity > 0 and confirmed_quantity < 1000000000),
  unit_price numeric check (unit_price is null or unit_price >= 0),
  amount numeric check (amount is null or amount >= 0),
  available_before numeric,
  stock_warning boolean not null default false,
  reviewed_by uuid not null references auth.users(id),
  reviewer_name text not null,
  reviewed_at timestamptz not null default now()
);

create or replace function private.baihuayuan_stage_waste()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if new.store_name in ('BeApe','Gras') then
    new.requires_review:=true;
    new.reference_price:=null;
    new.price_receipt_line_id:=null;
  end if;
  return new;
end;
$$;

drop trigger if exists aa_baihuayuan_stage_waste on private.waste_records;
create trigger aa_baihuayuan_stage_waste
before insert on private.waste_records
for each row execute function private.baihuayuan_stage_waste();

create or replace function private.stock_cost_prepare_waste()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare v_cost numeric;
begin
  if new.store_name in ('BeApe','Gras') then
    new.reference_price:=null;
    new.price_receipt_line_id:=null;
    return new;
  end if;
  if new.erp_required or new.product_id is null then return new; end if;
  v_cost:=private.stock_cost_quote(new.store_id,new.product_id,new.unit);
  if v_cost is not null then
    new.reference_price:=v_cost;
    new.price_receipt_line_id:=null;
  end if;
  return new;
end;
$$;

create or replace function private.stock_manual_waste()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare z uuid;
begin
  if new.store_name in ('BeApe','Gras') then return new; end if;
  if new.lot_id is not null or new.product_id is null then return new; end if;
  if not exists(
    select 1 from private.stock_initialized
    where store_id=new.store_id and product_id=new.product_id and unit=new.unit
  ) then return new; end if;
  select id into z
  from public.count_zones
  where store_id=new.store_id and name=new.zone_name
  order by id limit 1;
  perform private.stock_adjust_zone(new.store_id,new.product_id,new.unit,z,-new.quantity);
  return new;
end;
$$;

create or replace function private.waste_review_quote(p_waste uuid)
returns numeric
language plpgsql
stable security definer
set search_path=''
as $$
declare
  w private.waste_records;
  v_price numeric;
begin
  select * into w from private.waste_records where id=p_waste;
  if not found or w.product_id is null then return null; end if;

  v_price:=private.stock_cost_quote(w.store_id,w.product_id,w.unit);
  if v_price is not null then return v_price; end if;

  select l.unit_price_ex_tax into v_price
  from public.receipt_lines l
  join public.goods_receipts g on g.id=l.receipt_id
  join public.receipt_upload_batches b on b.id=g.source_batch_id
  where l.product_id=w.product_id
    and l.organization_id=w.organization_id
    and coalesce(g.store_id,b.store_id)=w.store_id
    and g.reviewed_at is not null
    and b.status='COMPLETED'
    and l.unit=w.unit
    and l.unit_price_ex_tax>=0
  order by g.reviewed_at desc,l.created_at desc,l.id
  limit 1;

  return v_price;
end;
$$;

create or replace function public.confirm_baihuayuan_waste(
  p_store_id uuid,
  p_waste_id uuid,
  p_quantity numeric default null,
  p_unit_price numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  w private.waste_records;
  existing private.waste_reviews;
  qty numeric;
  price numeric;
  available numeric:=0;
  zone_id uuid;
  reviewer text;
  review private.waste_reviews;
begin
  if auth.uid() is null then
    raise exception 'APP_FORBIDDEN' using errcode='42501';
  end if;
  if not (
    private.app_role(p_store_id) in ('LOGISTICS','OWNER')
    or private.can_manage_business(p_store_id)
  ) then
    raise exception 'WASTE_REVIEW_REQUIRED' using errcode='42501';
  end if;

  select wr.* into w
  from private.waste_records wr
  join public.stores s on s.id=wr.store_id
  where wr.id=p_waste_id
    and wr.store_id=p_store_id
    and s.name in ('BeApe','Gras');

  if not found then raise exception 'WASTE_NOT_FOUND' using errcode='P0002'; end if;
  if not w.requires_review then
    raise exception 'WASTE_REVIEW_NOT_REQUIRED' using errcode='22023';
  end if;

  select * into existing from private.waste_reviews where waste_id=w.id;
  if found then
    return jsonb_build_object(
      'id',w.id,'type','WASTE_CONFIRM','already_completed',true,
      'review',to_jsonb(existing)
    );
  end if;

  qty:=coalesce(p_quantity,w.quantity);
  price:=coalesce(p_unit_price,private.waste_review_quote(w.id));

  if qty is null or qty<=0 or qty>=1000000000 then
    raise exception 'INVALID_QUANTITY' using errcode='22023';
  end if;
  if price is not null and price<0 then
    raise exception 'INVALID_PRICE' using errcode='22023';
  end if;

  select coalesce(sum(sp.quantity),0) into available
  from private.stock_positions sp
  where sp.store_id=w.store_id and sp.product_id=w.product_id and sp.unit=w.unit;

  select id into zone_id
  from public.count_zones
  where store_id=w.store_id and name=w.zone_name
  order by id
  limit 1;

  if w.product_id is not null and w.lot_id is null then
    perform private.stock_adjust_zone(w.store_id,w.product_id,w.unit,zone_id,-qty);
  elsif w.lot_id is not null then
    insert into public.inventory_lot_events(
      organization_id,lot_id,event_type,preservation_state,quantity,unit,
      occurred_on,source_type,source_id,recorded_by,note
    )
    values(
      w.organization_id,w.lot_id,'DISCARDED',
      coalesce((select preservation_state from public.inventory_lot_events where lot_id=w.lot_id order by recorded_at desc,id desc limit 1),'ORIGINAL_EXPIRY'),
      qty,w.unit,(now() at time zone 'Asia/Taipei')::date,'WASTE',w.id,auth.uid(),'行政確認廢棄'
    );
  end if;

  select coalesce(nullif(display_name,''),'行政／後勤')
  into reviewer
  from public.profiles where id=auth.uid();

  insert into private.waste_reviews(
    waste_id,store_id,confirmed_quantity,unit_price,amount,available_before,
    stock_warning,reviewed_by,reviewer_name
  )
  values(
    w.id,w.store_id,qty,price,case when price is null then null else price*qty end,
    available,(w.product_id is not null and available<qty),
    auth.uid(),reviewer
  )
  returning * into review;

  insert into public.audit_logs(
    organization_id,entity_type,entity_id,action,new_value,user_id
  )
  values(
    w.organization_id,'waste_review',w.id::text,'WASTE_CONFIRMED',
    jsonb_build_object(
      'store_id',w.store_id,
      'confirmed_quantity',qty,
      'unit_price',price,
      'amount',case when price is null then null else price*qty end,
      'available_before',available,
      'stock_warning',(w.product_id is not null and available<qty)
    ),
    auth.uid()
  );

  return jsonb_build_object(
    'id',w.id,'type','WASTE_CONFIRM','review',to_jsonb(review)
  );
end;
$$;

revoke all on function public.confirm_baihuayuan_waste(uuid,uuid,numeric,numeric) from public;
grant execute on function public.confirm_baihuayuan_waste(uuid,uuid,numeric,numeric) to authenticated;

do $patch$
declare
  src text;
  original text;
begin
  select pg_get_functiondef('private.expiry_waste_command(uuid,uuid,text,jsonb)'::regprocedure) into src;
  original:=src;
  src:=replace(
    src,
    'if item.lot_id is not null then',
    'if item.lot_id is not null and s.name not in (''BeApe'',''Gras'') then'
  );
  if src=original then raise exception 'WASTE_LOT_STAGE_PATCH_MISSING'; end if;
  execute src;

  select pg_get_functiondef('private.expiry_waste_workspace(uuid,date,date)'::regprocedure) into src;
  original:=src;
  src:=replace(
    src,
    '''permissions'',jsonb_build_object(''field'',field,''manage'',manager,''audit'',private.has_active_store_role(p_store_id,array[''ADMIN'',''SUPERVISOR'',''LOGISTICS'',''OWNER'']::public.app_role[])),',
    '''permissions'',jsonb_build_object(''field'',field,''manage'',manager,''audit'',private.has_active_store_role(p_store_id,array[''ADMIN'',''SUPERVISOR'',''LOGISTICS'',''OWNER'']::public.app_role[]),''review'',private.app_role(p_store_id) in (''LOGISTICS'',''OWNER'') or private.can_manage_business(p_store_id)),'
  );
  if src=original then raise exception 'WASTE_REVIEW_PERMISSION_PATCH_MISSING'; end if;

  original:=src;
  src:=replace(
    src,
    '''reference_price'',case when price_allowed then w.reference_price end,''reference_amount'',case when price_allowed then w.quantity*w.reference_price end,'||
    chr(10)||'   ''erp_report'',',
    '''review_status'',case when w.requires_review and not exists(select 1 from private.waste_reviews wr where wr.waste_id=w.id) then ''PENDING'' else ''CONFIRMED'' end,'||
    '''review'',(select jsonb_build_object(''confirmed_quantity'',wr.confirmed_quantity,''unit_price'',wr.unit_price,''amount'',wr.amount,''available_before'',wr.available_before,''stock_warning'',wr.stock_warning,''reviewer_name'',wr.reviewer_name,''reviewed_at'',wr.reviewed_at) from private.waste_reviews wr where wr.waste_id=w.id),'||
    '''suggested_price'',case when price_allowed and w.requires_review and not exists(select 1 from private.waste_reviews wr where wr.waste_id=w.id) then private.waste_review_quote(w.id) end,'||
    '''reference_price'',case when price_allowed then coalesce((select wr.unit_price from private.waste_reviews wr where wr.waste_id=w.id),w.reference_price) end,'||
    '''reference_amount'',case when price_allowed then coalesce((select wr.amount from private.waste_reviews wr where wr.waste_id=w.id),case when w.reference_price is null then null else w.quantity*w.reference_price end) end,'||
    chr(10)||'   ''erp_report'','
  );
  if src=original then raise exception 'WASTE_REVIEW_WORKSPACE_PATCH_MISSING'; end if;
  execute src;
end
$patch$;
