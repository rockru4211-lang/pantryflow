-- Single-store controlled Pilot vertical slice.
-- Catalog setup is manager-only; drafts are mutable until completion, while
-- opening balances, submitted counts and resolutions remain append-only.

create table public.store_product_opening_balances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  store_id uuid not null references public.stores(id),
  product_id uuid not null references public.products(id),
  quantity numeric(14,3) not null check (quantity >= 0),
  unit text not null,
  source text not null default 'ADMIN_OPENING_COUNT'
    check (source = 'ADMIN_OPENING_COUNT'),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (store_id, product_id)
);

create table public.inventory_count_resolution_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  store_id uuid not null references public.stores(id),
  discrepancy_id uuid not null references public.inventory_count_discrepancies(id),
  action text not null check (action in ('CORRECTION', 'RECOUNT')),
  reason text not null check (reason in (
    'INPUT_ERROR', 'MISSED_OR_WRONG_ZONE', 'WASTE_NOT_RECORDED',
    'TRANSFER_NOT_RECORDED', 'RECEIPT_NOT_RECORDED', 'OTHER'
  )),
  original_entry_id uuid not null references public.count_entries(id),
  resulting_entry_id uuid not null references public.count_entries(id),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create or replace function private.prevent_pilot_history_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'PILOT_HISTORY_IS_APPEND_ONLY';
end;
$$;

create trigger immutable_store_product_opening_balances
before update or delete on public.store_product_opening_balances
for each row execute function private.prevent_pilot_history_mutation();

create trigger immutable_inventory_count_resolution_events
before update or delete on public.inventory_count_resolution_events
for each row execute function private.prevent_pilot_history_mutation();

alter table public.store_product_opening_balances enable row level security;
alter table public.inventory_count_resolution_events enable row level security;

create policy opening_balances_store_select
on public.store_product_opening_balances for select to authenticated
using (private.has_active_store_role(store_id, null));

create policy opening_balances_manager_insert
on public.store_product_opening_balances for insert to authenticated
with check (
  organization_id = public.current_organization_id()
  and created_by = (select auth.uid())
  and private.has_active_store_role(store_id, array['ADMIN','SUPERVISOR']::public.app_role[])
);

create policy count_resolution_events_manager_select
on public.inventory_count_resolution_events for select to authenticated
using (private.has_active_store_role(store_id, array['ADMIN','SUPERVISOR']::public.app_role[]));

grant select, insert on public.store_product_opening_balances to authenticated;
grant select on public.inventory_count_resolution_events to authenticated;

create or replace function public.create_pilot_product(
  p_store_id uuid,
  p_product_code text,
  p_name text,
  p_count_unit text,
  p_purchase_unit text,
  p_opening_quantity numeric
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_org uuid;
  v_product uuid;
begin
  select organization_id into v_org from public.stores where id = p_store_id and is_active;
  if v_org is null or not private.has_active_store_role(p_store_id, array['ADMIN','SUPERVISOR']::public.app_role[]) then
    raise exception using errcode = '42501', message = 'STORE_MANAGER_REQUIRED';
  end if;
  if btrim(coalesce(p_product_code,'')) = '' or btrim(coalesce(p_name,'')) = ''
    or btrim(coalesce(p_count_unit,'')) = '' or btrim(coalesce(p_purchase_unit,'')) = ''
    or p_opening_quantity is null or p_opening_quantity < 0 then
    raise exception using errcode = '22023', message = 'INVALID_PRODUCT_SETUP';
  end if;

  insert into public.products(
    organization_id, product_code, name, category, base_unit, count_unit
  ) values (
    v_org, upper(btrim(p_product_code)), btrim(p_name), '其他',
    btrim(p_purchase_unit), btrim(p_count_unit)
  ) returning id into v_product;

  insert into public.store_product_opening_balances(
    organization_id, store_id, product_id, quantity, unit, created_by
  ) values (v_org, p_store_id, v_product, p_opening_quantity, btrim(p_count_unit), v_user);

  insert into public.audit_logs(organization_id,entity_type,entity_id,action,new_value,user_id)
  values (v_org,'product',v_product,'PILOT_PRODUCT_CREATED',jsonb_build_object(
    'store_id',p_store_id,'product_code',upper(btrim(p_product_code)),
    'opening_quantity',p_opening_quantity
  ),v_user);
  return v_product;
end;
$$;

create or replace function public.create_pilot_zone(p_store_id uuid, p_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user uuid := (select auth.uid()); v_org uuid; v_zone uuid; v_sort integer;
begin
  select organization_id into v_org from public.stores where id=p_store_id and is_active;
  if v_org is null or not private.has_active_store_role(p_store_id,array['ADMIN','SUPERVISOR']::public.app_role[]) then
    raise exception using errcode='42501',message='STORE_MANAGER_REQUIRED';
  end if;
  if btrim(coalesce(p_name,''))='' then raise exception using errcode='22023',message='ZONE_NAME_REQUIRED'; end if;
  select coalesce(max(sort_order),-1)+1 into v_sort from public.count_zones where store_id=p_store_id;
  insert into public.count_zones(organization_id,store_id,name,sort_order)
  values(v_org,p_store_id,btrim(p_name),v_sort) returning id into v_zone;
  insert into public.audit_logs(organization_id,entity_type,entity_id,action,new_value,user_id)
  values(v_org,'count_zone',v_zone,'PILOT_ZONE_CREATED',jsonb_build_object('store_id',p_store_id,'name',btrim(p_name)),v_user);
  return v_zone;
end;
$$;

create or replace function public.assign_pilot_product_to_zone(p_zone_id uuid,p_product_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid := (select auth.uid()); v_org uuid; v_store uuid; v_unit text; v_sort integer;
begin
  select z.organization_id,z.store_id,p.count_unit into v_org,v_store,v_unit
  from public.count_zones z join public.products p on p.id=p_product_id and p.organization_id=z.organization_id
  where z.id=p_zone_id and z.is_active and p.is_active;
  if v_store is null or not private.has_active_store_role(v_store,array['ADMIN','SUPERVISOR']::public.app_role[]) then
    raise exception using errcode='42501',message='STORE_MANAGER_REQUIRED';
  end if;
  select coalesce(max(sort_order),-1)+1 into v_sort from public.zone_products where zone_id=p_zone_id;
  insert into public.zone_products(zone_id,product_id,sort_order,count_unit)
  values(p_zone_id,p_product_id,v_sort,v_unit) on conflict(zone_id,product_id) do nothing;
  insert into public.audit_logs(organization_id,entity_type,entity_id,action,new_value,user_id)
  values(v_org,'count_zone',p_zone_id,'PRODUCT_ASSIGNED_TO_ZONE',jsonb_build_object('product_id',p_product_id),v_user);
end;
$$;

create or replace function public.create_pilot_count_session(p_store_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user uuid := (select auth.uid()); v_org uuid; v_session uuid; v_snapshot jsonb;
begin
  select organization_id into v_org from public.stores where id=p_store_id and is_active;
  if v_org is null or not private.has_active_store_role(p_store_id,array['ADMIN','SUPERVISOR']::public.app_role[]) then
    raise exception using errcode='42501',message='STORE_MANAGER_REQUIRED';
  end if;
  if not exists(select 1 from public.count_zones where store_id=p_store_id and is_active) then
    raise exception using errcode='22023',message='COUNT_ZONE_REQUIRED';
  end if;
  if exists(select 1 from public.count_zones z where z.store_id=p_store_id and z.is_active
    and not exists(select 1 from public.zone_products zp where zp.zone_id=z.id)) then
    raise exception using errcode='22023',message='ZONE_PRODUCTS_REQUIRED';
  end if;
  if exists(select 1 from public.zone_products zp join public.count_zones z on z.id=zp.zone_id
    where z.store_id=p_store_id and not exists(select 1 from public.store_product_opening_balances b
      where b.store_id=p_store_id and b.product_id=zp.product_id)) then
    raise exception using errcode='22023',message='OPENING_BALANCE_REQUIRED';
  end if;
  if exists(select 1 from public.inventory_count_sessions where store_id=p_store_id and status in('DRAFT','IN_PROGRESS','REVIEWING')) then
    raise exception using errcode='22023',message='ACTIVE_COUNT_SESSION_EXISTS';
  end if;
  select jsonb_build_object('created_at',now(),'zones',coalesce(jsonb_agg(jsonb_build_object(
    'zone_id',z.id,'zone_name',z.name,'product_id',p.id,'product_code',p.product_code,
    'product_name',p.name,'unit',zp.count_unit) order by z.sort_order,zp.sort_order),'[]'::jsonb))
  into v_snapshot
  from public.count_zones z join public.zone_products zp on zp.zone_id=z.id
  join public.products p on p.id=zp.product_id where z.store_id=p_store_id and z.is_active and p.is_active;
  insert into public.inventory_count_sessions(organization_id,store_id,started_by,status,snapshot)
  values(v_org,p_store_id,v_user,'IN_PROGRESS',v_snapshot) returning id into v_session;
  insert into public.count_zone_progress(organization_id,session_id,zone_id,status)
  select v_org,v_session,id,'NOT_STARTED' from public.count_zones where store_id=p_store_id and is_active;
  insert into public.audit_logs(organization_id,entity_type,entity_id,action,new_value,user_id)
  values(v_org,'inventory_count_session',v_session,'COUNT_SESSION_CREATED',jsonb_build_object('store_id',p_store_id),v_user);
  return v_session;
end;
$$;

create or replace function public.complete_pilot_count_zone(p_session_id uuid,p_zone_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid := (select auth.uid()); v_org uuid; v_store uuid; v_expected integer; v_actual integer;
begin
  select organization_id,store_id into v_org,v_store from public.inventory_count_sessions
  where id=p_session_id and status='IN_PROGRESS';
  if v_store is null or not private.has_active_store_role(v_store,null) then
    raise exception using errcode='42501',message='ACTIVE_STORE_MEMBERSHIP_REQUIRED';
  end if;
  if not exists(select 1 from public.count_zone_progress where session_id=p_session_id and zone_id=p_zone_id and status<>'COMPLETED') then
    raise exception using errcode='22023',message='COUNT_ZONE_NOT_AVAILABLE';
  end if;
  select count(*) into v_expected from public.zone_products where zone_id=p_zone_id;
  select count(*) into v_actual from public.count_drafts where session_id=p_session_id and zone_id=p_zone_id and entered_by=v_user;
  if v_expected=0 or v_actual<>v_expected then raise exception using errcode='22023',message='COUNT_ZONE_INCOMPLETE'; end if;
  insert into public.count_entries(organization_id,session_id,zone_id,product_id,quantity,unit,entered_by,entry_type)
  select organization_id,session_id,zone_id,product_id,quantity,unit,v_user,'INITIAL_COUNT'
  from public.count_drafts where session_id=p_session_id and zone_id=p_zone_id and entered_by=v_user;
  delete from public.count_drafts where session_id=p_session_id and zone_id=p_zone_id and entered_by=v_user;
  update public.count_zone_progress set status='COMPLETED',completed_by=v_user,completed_at=now()
  where session_id=p_session_id and zone_id=p_zone_id;
  insert into public.audit_logs(organization_id,entity_type,entity_id,action,new_value,user_id)
  values(v_org,'inventory_count_session',p_session_id,'COUNT_ZONE_COMPLETED',jsonb_build_object('zone_id',p_zone_id),v_user);

  if not exists(select 1 from public.count_zone_progress where session_id=p_session_id and status<>'COMPLETED') then
    insert into public.inventory_count_discrepancies(
      organization_id,session_id,zone_id,product_id,initial_entry_id,
      previous_quantity,previous_confirmed_at,estimated_quantity,difference,status
    )
    select v_org,p_session_id,(array_agg(e.zone_id order by e.entered_at))[1],e.product_id,(array_agg(e.id order by e.entered_at))[1],
      b.quantity,b.created_at,sum(e.quantity),sum(e.quantity)-b.quantity,'PENDING'
    from public.count_entries e join public.store_product_opening_balances b
      on b.store_id=v_store and b.product_id=e.product_id
    where e.session_id=p_session_id and e.entry_type='INITIAL_COUNT'
    group by e.product_id,b.quantity,b.created_at
    having sum(e.quantity)<>b.quantity
    on conflict(session_id,zone_id,product_id) do nothing;
    update public.inventory_count_sessions set status=case when exists(
      select 1 from public.inventory_count_discrepancies where session_id=p_session_id
    ) then 'REVIEWING' else 'CLOSED' end,completed_at=now() where id=p_session_id;
  end if;
end;
$$;

create or replace function public.resolve_pilot_count_discrepancy(
  p_discrepancy_id uuid,p_reason text,p_action text,p_quantity numeric
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user uuid := (select auth.uid()); v_org uuid; v_store uuid; v_session uuid; v_zone uuid;
  v_product uuid; v_initial uuid; v_unit text; v_entry uuid;
begin
  select d.organization_id,s.store_id,d.session_id,d.zone_id,d.product_id,d.initial_entry_id,e.unit
  into v_org,v_store,v_session,v_zone,v_product,v_initial,v_unit
  from public.inventory_count_discrepancies d join public.inventory_count_sessions s on s.id=d.session_id
  join public.count_entries e on e.id=d.initial_entry_id where d.id=p_discrepancy_id and d.status='PENDING';
  if v_store is null or not private.has_active_store_role(v_store,array['ADMIN','SUPERVISOR']::public.app_role[]) then
    raise exception using errcode='42501',message='STORE_MANAGER_REQUIRED';
  end if;
  if p_reason not in('INPUT_ERROR','MISSED_OR_WRONG_ZONE','WASTE_NOT_RECORDED','TRANSFER_NOT_RECORDED','RECEIPT_NOT_RECORDED','OTHER')
    or p_action not in('CORRECTION','RECOUNT') or p_quantity is null or p_quantity<0 then
    raise exception using errcode='22023',message='INVALID_COUNT_RESOLUTION';
  end if;
  insert into public.count_entries(organization_id,session_id,zone_id,product_id,quantity,unit,entered_by,entry_type,parent_entry_id)
  values(v_org,v_session,v_zone,v_product,p_quantity,v_unit,v_user,p_action,v_initial) returning id into v_entry;
  insert into public.inventory_count_resolution_events(
    organization_id,store_id,discrepancy_id,action,reason,original_entry_id,resulting_entry_id,created_by
  ) values(v_org,v_store,p_discrepancy_id,p_action,p_reason,v_initial,v_entry,v_user);
  update public.inventory_count_discrepancies set final_entry_id=v_entry,reason=p_reason,status='RESOLVED',answered_by=v_user,answered_at=now()
  where id=p_discrepancy_id;
  insert into public.audit_logs(organization_id,entity_type,entity_id,action,old_value,new_value,user_id)
  select v_org,'inventory_count_discrepancy',p_discrepancy_id,'COUNT_DISCREPANCY_RESOLVED',
    jsonb_build_object('initial_entry_id',v_initial),jsonb_build_object('resulting_entry_id',v_entry,'reason',p_reason,'action',p_action),v_user;
  if not exists(select 1 from public.inventory_count_discrepancies where session_id=v_session and status='PENDING') then
    update public.inventory_count_sessions set status='CLOSED' where id=v_session;
  end if;
  return v_entry;
end;
$$;

revoke all on function public.create_pilot_product(uuid,text,text,text,text,numeric) from public,anon;
revoke all on function public.create_pilot_zone(uuid,text) from public,anon;
revoke all on function public.assign_pilot_product_to_zone(uuid,uuid) from public,anon;
revoke all on function public.create_pilot_count_session(uuid) from public,anon;
revoke all on function public.complete_pilot_count_zone(uuid,uuid) from public,anon;
revoke all on function public.resolve_pilot_count_discrepancy(uuid,text,text,numeric) from public,anon;
grant execute on function public.create_pilot_product(uuid,text,text,text,text,numeric) to authenticated;
grant execute on function public.create_pilot_zone(uuid,text) to authenticated;
grant execute on function public.assign_pilot_product_to_zone(uuid,uuid) to authenticated;
grant execute on function public.create_pilot_count_session(uuid) to authenticated;
grant execute on function public.complete_pilot_count_zone(uuid,uuid) to authenticated;
grant execute on function public.resolve_pilot_count_discrepancy(uuid,text,text,numeric) to authenticated;

notify pgrst, 'reload schema';
