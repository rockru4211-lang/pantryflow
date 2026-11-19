-- Existing store lock in start_pilot_count serializes concurrent opens, including the daily job.
do $$
declare src text := pg_get_functiondef('public.start_pilot_count(uuid,jsonb)'::regprocedure);
  needle text := 'where store_id=p_store_id order by started_at desc limit 1;';
begin
  if strpos(src,needle)=0 then raise exception 'Unexpected count start definition'; end if;
  src := replace(src,needle,'where store_id=p_store_id and (v_type<>''CHAIN_RESTAURANT'' or (started_at at time zone ''Asia/Taipei'')::date=(now() at time zone ''Asia/Taipei'')::date) order by started_at desc limit 1;');
  src := replace(src,'v_old.status=''CLOSED''','v_old.status in (''REVIEWING'',''CLOSED'')');
  src := replace(src,'if not private.has_active_store_role(p_store_id,array[''ADMIN'',''SUPERVISOR'']::public.app_role[]) and not(', 'if not (v_type=''CHAIN_RESTAURANT'' and p_selection is null and private.can_count_inline(p_store_id)) and not private.has_active_store_role(p_store_id,array[''ADMIN'',''SUPERVISOR'']::public.app_role[]) and not(');
  if strpos(src,'v_snapshot,v_type=''CHAIN_RESTAURANT'') returning id')=0 then raise exception 'Unexpected paper flag definition'; end if;
  src := replace(src,'v_snapshot,v_type=''CHAIN_RESTAURANT'') returning id','v_snapshot,false) returning id');
  execute src;
end $$;

create or replace function public.ensure_pilot_daily_count(p_store_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
begin
  if not private.can_count_inline(p_store_id) then raise insufficient_privilege; end if;
  if not exists(select 1 from public.stores s join public.organizations o on o.id=s.organization_id
    where s.id=p_store_id and s.is_active and o.business_type='CHAIN_RESTAURANT') then return null; end if;
  return public.start_pilot_count(p_store_id,null);
exception when raise_exception then
  if sqlerrm='ZONE_PRODUCTS_REQUIRED' then return null; end if;
  raise;
end $$;

-- Capture yesterday's submitted actuals in the server-only opening snapshot.
-- Apply on both initial capture and refresh of an untouched count.
create function private.xu_daily_opening() returns trigger language plpgsql set search_path='' as $$
declare previous record;
begin
  select sum(e.quantity) qty, max(prev.completed_at) stamp,
    bool_and(e.unit=u.unit) same_unit into previous
  from public.inventory_count_sessions cur
  join lateral (select distinct x->>'unit' as unit from jsonb_array_elements(cur.snapshot->'zones') x
                where x->>'product_id'=new.product_id::text) u on true
  join lateral (select s.id,s.completed_at from public.inventory_count_sessions s
    where s.store_id=cur.store_id and s.status in ('CLOSED','REVIEWING')
      and (s.started_at at time zone 'Asia/Taipei')::date=(cur.started_at at time zone 'Asia/Taipei')::date-1
    order by s.completed_at desc nulls last limit 1) prev on true
  join public.count_entries e on e.session_id=prev.id and e.product_id=new.product_id and e.entry_type='INITIAL_COUNT'
  where cur.id=new.session_id and cur.snapshot->>'business_type'='CHAIN_RESTAURANT';
  if previous.stamp is not null then
    new.quantity:=case when previous.same_unit then previous.qty end;
    new.confirmed_at:=previous.stamp;
  end if;
  return new;
end $$;
create trigger xu_daily_opening before insert on private.count_opening_snapshots
for each row execute function private.xu_daily_opening();

-- A flag belongs to the session and product so changing its storage zone keeps the request.
create table private.xu_count_orders(
  session_id uuid references public.inventory_count_sessions(id) on delete cascade,
  product_id uuid references public.products(id), handled_at timestamptz,
  primary key(session_id,product_id)
);
revoke all on private.xu_count_orders from public,anon,authenticated;

create function public.xu_count_orders(p_session uuid,p_product uuid default null,p_needed boolean default null)
returns uuid[] language plpgsql security definer set search_path='' as $$
declare s public.inventory_count_sessions;
begin
  select * into s from public.inventory_count_sessions where id=p_session for update;
  if s.id is null or not private.can_count_inline(s.store_id) then raise insufficient_privilege; end if;
  if p_product is not null then
    if s.status<>'IN_PROGRESS' or p_needed is null or not exists(select 1 from jsonb_array_elements(s.snapshot->'zones') i
      where i->>'product_id'=p_product::text) then raise exception 'COUNT_ITEM_UNAVAILABLE'; end if;
    if p_needed then insert into private.xu_count_orders(session_id,product_id) values(p_session,p_product) on conflict do nothing;
    else delete from private.xu_count_orders where session_id=p_session and product_id=p_product; end if;
  end if;
  return array(select product_id from private.xu_count_orders where session_id=p_session);
end $$;

create function public.xu_order_inbox(p_store uuid,p_handled uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if coalesce(private.app_role(p_store)::text,'') not in ('SUPERVISOR','OWNER','LOGISTICS') then raise insufficient_privilege; end if;
  if p_handled is not null then
    update private.xu_count_orders r set handled_at=now() from public.inventory_count_sessions s
    where r.session_id=s.id and s.store_id=p_store and s.id=p_handled and s.status in ('REVIEWING','CLOSED') and r.handled_at is null;
  end if;
  return (select coalesce(jsonb_agg(to_jsonb(g) order by g.started_at desc),'[]') from (
    select a.id,a.started_at,jsonb_agg(jsonb_build_object('name',a.name,'quantity',a.qty,'unit',a.unit) order by a.name,a.unit) items from (
      select s.id,s.started_at,r.product_id,coalesce(max(i.item->>'product_name'),p.name) name,e.unit,sum(e.quantity) qty
      from private.xu_count_orders r join public.inventory_count_sessions s on s.id=r.session_id
      join public.products p on p.id=r.product_id
      join public.count_entries e on e.session_id=s.id and e.product_id=r.product_id and e.entry_type='INITIAL_COUNT'
      left join lateral (select x item from jsonb_array_elements(s.snapshot->'zones') x where x->>'product_id'=e.product_id::text limit 1) i on true
      where s.store_id=p_store and s.status in ('REVIEWING','CLOSED') and r.handled_at is null
      group by s.id,s.started_at,r.product_id,p.name,e.unit) a group by a.id,a.started_at) g);
end $$;

create function public.xu_submit_count(p_session uuid) returns void language plpgsql security definer set search_path='' as $$
declare s public.inventory_count_sessions; z uuid;
begin
  select * into s from public.inventory_count_sessions where id=p_session for update;
  if s.id is null or not private.can_count_inline(s.store_id) then raise insufficient_privilege; end if;
  if s.status in ('REVIEWING','CLOSED') then return; end if;
  if s.status<>'IN_PROGRESS' or jsonb_array_length(s.snapshot->'zones')=0 then raise exception 'COUNT_EMPTY'; end if;
  for z in select zone_id from public.count_zone_progress where session_id=s.id order by zone_id loop
    perform public.complete_pilot_count_zone(s.id,z);
  end loop;
  if not exists(select 1 from public.inventory_count_sessions where id=s.id and status in ('CLOSED','REVIEWING')) then
    raise exception 'COUNT_INCOMPLETE';
  end if;
end $$;
revoke all on function public.xu_count_orders(uuid,uuid,boolean),public.xu_order_inbox(uuid,uuid),public.xu_submit_count(uuid) from public,anon;
grant execute on function public.xu_count_orders(uuid,uuid,boolean),public.xu_order_inbox(uuid,uuid),public.xu_submit_count(uuid) to authenticated;
