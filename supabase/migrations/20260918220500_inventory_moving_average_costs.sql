-- Moving-average inventory cost propagation from confirmed receiving into stock, transfers, loans and waste.
-- Keeps cost entry system-driven: field users record quantities/reasons while cost snapshots are derived automatically.

create table if not exists private.stock_costs(
  store_id uuid not null references public.stores(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  unit text not null check(length(btrim(unit)) between 1 and 30),
  average_unit_cost numeric not null check(average_unit_cost>=0),
  updated_at timestamptz not null default now(),
  primary key(store_id,product_id,unit)
);

create or replace function private.stock_cost_quote(s uuid,p uuid,u text)
returns numeric
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v numeric;
  r record;
  f numeric;
begin
  if s is null or p is null or nullif(btrim(u),'') is null then return null; end if;
  select c.average_unit_cost into v
  from private.stock_costs c
  where c.store_id=s and c.product_id=p and c.unit=u;
  if v is not null then return v; end if;

  for r in
    select c.unit,c.average_unit_cost
    from private.stock_costs c
    where c.store_id=s and c.product_id=p
    order by c.updated_at desc,c.unit
  loop
    f:=private.stock_unit_factor(s,p,r.unit,u);
    if f is not null and f>0 then return r.average_unit_cost/f; end if;
    f:=private.stock_unit_factor(s,p,u,r.unit);
    if f is not null and f>0 then return r.average_unit_cost*f; end if;
  end loop;
  return null;
end;
$function$;

create or replace function private.stock_cost_blend(
  s uuid,p uuid,u text,q numeric,unit_cost numeric,stock_includes_incoming boolean default false
)
returns numeric
language plpgsql
security definer
set search_path to ''
as $function$
declare
  target_unit text;
  factor numeric;
  incoming_qty numeric;
  incoming_cost numeric;
  current_qty numeric;
  prior_qty numeric;
  old_cost numeric;
  next_cost numeric;
  snap jsonb;
begin
  if s is null or p is null or nullif(btrim(u),'') is null or q is null or q<=0 or unit_cost is null or unit_cost<0 then return null; end if;

  select coalesce(nullif(pr.count_unit,''),nullif(pr.base_unit,''),u)
  into target_unit
  from public.products pr
  where pr.id=p;

  target_unit:=coalesce(target_unit,u);
  factor:=private.stock_unit_factor(s,p,u,target_unit);
  if factor is null or factor<=0 then
    target_unit:=u;
    factor:=1;
  end if;

  incoming_qty:=q*factor;
  incoming_cost:=unit_cost/factor;
  snap:=private.stock_snapshot(s,p,target_unit);
  current_qty:=nullif(snap->>'total','')::numeric;
  prior_qty:=greatest(coalesce(current_qty,0)-case when stock_includes_incoming then incoming_qty else 0 end,0);

  select c.average_unit_cost into old_cost
  from private.stock_costs c
  where c.store_id=s and c.product_id=p and c.unit=target_unit
  for update;

  if old_cost is null or prior_qty<=0 then
    next_cost:=incoming_cost;
  else
    next_cost:=((old_cost*prior_qty)+(incoming_cost*incoming_qty))/(prior_qty+incoming_qty);
  end if;

  insert into private.stock_costs(store_id,product_id,unit,average_unit_cost,updated_at)
  values(s,p,target_unit,next_cost,now())
  on conflict(store_id,product_id,unit)
  do update set average_unit_cost=excluded.average_unit_cost,updated_at=excluded.updated_at;

  return next_cost;
end;
$function$;

-- Seed current cost references from confirmed historical receipts.
with source_lines as (
  select
    g.store_id,
    rl.product_id,
    rl.unit,
    rl.quantity,
    rl.unit_price_ex_tax,
    coalesce(nullif(p.count_unit,''),nullif(p.base_unit,''),rl.unit) candidate_unit,
    private.stock_unit_factor(g.store_id,rl.product_id,rl.unit,coalesce(nullif(p.count_unit,''),nullif(p.base_unit,''),rl.unit)) factor
  from public.receipt_lines rl
  join public.goods_receipts g on g.id=rl.receipt_id
  join public.products p on p.id=rl.product_id
  left join public.receipt_upload_batches b on b.id=g.source_batch_id
  where g.store_id is not null
    and g.reviewed_at is not null
    and rl.product_id is not null
    and rl.quantity is not null and rl.quantity>0
    and nullif(btrim(coalesce(rl.unit,'')),'') is not null
    and rl.unit_price_ex_tax is not null and rl.unit_price_ex_tax>=0
    and (g.source_batch_id is null or b.status::text='COMPLETED')
),
normalized as (
  select
    store_id,
    product_id,
    case when factor is not null and factor>0 then candidate_unit else unit end target_unit,
    quantity*case when factor is not null and factor>0 then factor else 1 end normalized_quantity,
    quantity*unit_price_ex_tax line_cost
  from source_lines
)
insert into private.stock_costs(store_id,product_id,unit,average_unit_cost,updated_at)
select store_id,product_id,target_unit,sum(line_cost)/nullif(sum(normalized_quantity),0),now()
from normalized
group by store_id,product_id,target_unit
having sum(normalized_quantity)>0
on conflict(store_id,product_id,unit)
do update set average_unit_cost=excluded.average_unit_cost,updated_at=excluded.updated_at;

create or replace function private.stock_cost_receipt_line()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare s uuid;
begin
  if new.product_id is null or new.quantity is null or new.quantity<=0 or new.unit is null or new.unit_price_ex_tax is null or new.unit_price_ex_tax<0 then return new; end if;
  select g.store_id into s from public.goods_receipts g where g.id=new.receipt_id;
  if s is null then return new; end if;
  perform private.stock_cost_blend(s,new.product_id,new.unit,new.quantity,new.unit_price_ex_tax,true);
  return new;
end;
$function$;

drop trigger if exists zz_stock_cost_receipt_line on public.receipt_lines;
create trigger zz_stock_cost_receipt_line
after insert on public.receipt_lines
for each row execute function private.stock_cost_receipt_line();

create or replace function private.stock_cost_prepare_movement()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare v_cost numeric;
begin
  if new.product_id is null then return new; end if;
  v_cost:=private.stock_cost_quote(new.from_store_id,new.product_id,new.unit);
  if v_cost is not null then
    new.unit_price_snapshot:=v_cost;
    new.amount_snapshot:=v_cost*new.quantity;
  end if;
  return new;
end;
$function$;

drop trigger if exists stock_cost_prepare_movement on private.store_movements;
create trigger stock_cost_prepare_movement
before insert on private.store_movements
for each row execute function private.stock_cost_prepare_movement();

create or replace function private.stock_cost_receive_movement()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if new.product_id is not null and new.unit_price_snapshot is not null then
    perform private.stock_cost_blend(new.to_store_id,new.product_id,new.unit,new.quantity,new.unit_price_snapshot,false);
  end if;
  return new;
end;
$function$;

drop trigger if exists stock_cost_receive_movement on private.store_movements;
create trigger stock_cost_receive_movement
after insert on private.store_movements
for each row execute function private.stock_cost_receive_movement();

create or replace function private.stock_cost_return_movement()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare returned_now numeric;
begin
  returned_now:=new.returned_quantity-old.returned_quantity;
  if returned_now>0 and new.product_id is not null and new.unit_price_snapshot is not null then
    perform private.stock_cost_blend(new.from_store_id,new.product_id,new.unit,returned_now,new.unit_price_snapshot,false);
  end if;
  return new;
end;
$function$;

drop trigger if exists stock_cost_return_movement on private.store_movements;
create trigger stock_cost_return_movement
after update of returned_quantity on private.store_movements
for each row
when (new.returned_quantity>old.returned_quantity)
execute function private.stock_cost_return_movement();

create or replace function private.stock_cost_prepare_waste()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare v_cost numeric;
begin
  if new.erp_required or new.product_id is null then return new; end if;
  v_cost:=private.stock_cost_quote(new.store_id,new.product_id,new.unit);
  if v_cost is not null then
    new.reference_price:=v_cost;
    new.price_receipt_line_id:=null;
  end if;
  return new;
end;
$function$;

drop trigger if exists stock_cost_prepare_waste on private.waste_records;
create trigger stock_cost_prepare_waste
before insert on private.waste_records
for each row execute function private.stock_cost_prepare_waste();

CREATE OR REPLACE FUNCTION private.transfers_workspace_v2(p_store uuid, p_filter jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_role text:=private.app_role(p_store);
  v_org uuid;
  v_mode text;
  v_erp boolean;
  v_start timestamptz:=coalesce(nullif(p_filter->>'from','')::timestamptz,date_trunc('month',now()));
  v_end timestamptz:=coalesce(nullif(p_filter->>'to','')::timestamptz,now()+interval '1 day');
  v_records jsonb;
begin
  if v_role is null then raise exception 'APP_FORBIDDEN' using errcode='42501'; end if;
  select s.organization_id,o.store_mode,o.has_erp into v_org,v_mode,v_erp
  from public.stores s join public.organizations o on o.id=s.organization_id
  where s.id=p_store and s.is_active;
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
    and (m.from_store_id=p_store or m.to_store_id=p_store)
    and (m.status='OPEN' or (m.created_at>=v_start and m.created_at<v_end));

  return jsonb_build_object(
    'records',v_records,
    'role',v_role,
    'has_erp',v_erp,
    'stores',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.name) order by s.name),'[]'::jsonb)
              from public.stores s
              where s.organization_id=v_org and s.is_active and s.id<>p_store),
    'units',(select coalesce(jsonb_agg(unit order by unit),'[]'::jsonb)
             from private.store_units where store_id=p_store),
    'products',(
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'id',p.id,
          'name',p.name,
          'unit',coalesce(nullif(p.count_unit,''),p.base_unit),
          'current_supplier_id',p.current_supplier_id,
          'current_supplier_name',cs.name,
          'average_cost',private.stock_cost_quote(p_store,p.id,coalesce(nullif(p.count_unit,''),p.base_unit)),
          'suppliers',(
            select coalesce(jsonb_agg(jsonb_build_object(
              'id',q.supplier_id,
              'name',q.supplier_name,
              'unit_price',q.unit_price,
              'receipt_date',q.receipt_date
            ) order by q.receipt_date desc nulls last),'[]'::jsonb)
            from (
              select distinct on(g.supplier_id)
                g.supplier_id,
                s2.name supplier_name,
                rl.unit_price_ex_tax unit_price,
                g.receipt_date
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
          select 1
          from public.count_zones z
          join public.zone_products zp on zp.zone_id=z.id
          where z.store_id=p_store and z.is_active and zp.product_id=p.id
        )
    )
  );
end;
$function$;

