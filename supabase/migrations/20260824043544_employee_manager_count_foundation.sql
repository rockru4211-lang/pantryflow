-- PF-EMPLOYEE-MANAGER-COUNT-FOUNDATION-20260824
-- FUTURE-APPLY ONLY. This migration has not been applied to production.

alter table public.inventory_count_sessions
  add column if not exists opening_source text,
  add column if not exists task_date date not null default (now() at time zone 'Asia/Taipei')::date;

alter table public.inventory_count_sessions
  drop constraint if exists inventory_count_sessions_opening_source_check;
alter table public.inventory_count_sessions
  add constraint inventory_count_sessions_opening_source_check check (
    opening_source is null or opening_source in (
      'LAST_APPROVED_COUNT', 'OPENING_INVENTORY_EXCEL', 'MANAGER_MANUAL_OPENING'
    )
  );

alter table public.count_zone_progress drop constraint if exists count_zone_progress_status_check;
alter table public.count_zone_progress add constraint count_zone_progress_status_check
  check (status in ('NOT_STARTED','IN_PROGRESS','COMPLETED','RECOUNT_REQUIRED'));

create table public.inventory_count_task_assignments (
  session_id uuid not null references public.inventory_count_sessions(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  assigned_at timestamptz not null default now(),
  primary key(session_id,user_id)
);
alter table public.inventory_count_task_assignments enable row level security;
grant select on public.inventory_count_task_assignments to authenticated;
create policy count_task_assignment_self_or_manager_select on public.inventory_count_task_assignments
for select to authenticated using (
  user_id=(select auth.uid()) or exists(
    select 1 from public.inventory_count_sessions s
    where s.id=session_id and private.has_active_store_role(s.store_id,array['ADMIN','SUPERVISOR']::public.app_role[])
  )
);

create or replace function private.assign_store_staff_to_count_session()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.inventory_count_task_assignments(session_id,user_id)
  select new.id,m.user_id from public.store_memberships m
  where m.store_id=new.store_id and m.is_active and m.role='STAFF'::public.app_role;
  return new;
end; $$;
create trigger assign_store_staff_after_count_session
after insert on public.inventory_count_sessions for each row
execute function private.assign_store_staff_to_count_session();

alter table public.store_product_opening_balances
  drop constraint if exists store_product_opening_balances_source_check;
alter table public.store_product_opening_balances
  add constraint store_product_opening_balances_source_check check (
    source in ('LAST_APPROVED_COUNT', 'OPENING_INVENTORY_EXCEL', 'MANAGER_MANUAL_OPENING', 'ADMIN_OPENING_COUNT')
  );

create table public.inventory_count_recount_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  store_id uuid not null references public.stores(id),
  session_id uuid not null references public.inventory_count_sessions(id),
  zone_id uuid not null references public.count_zones(id),
  discrepancy_id uuid not null references public.inventory_count_discrepancies(id),
  reason text not null,
  status text not null default 'OPEN' check (status in ('OPEN','COMPLETED')),
  opened_by uuid not null references public.profiles(id),
  opened_at timestamptz not null default now(),
  completed_by uuid references public.profiles(id),
  completed_at timestamptz
);

alter table public.inventory_count_recount_events enable row level security;
grant select, insert, update on public.inventory_count_recount_events to authenticated;

create policy recount_events_store_select on public.inventory_count_recount_events
for select to authenticated using (private.has_active_store_role(store_id, null));
create policy recount_events_manager_insert on public.inventory_count_recount_events
for insert to authenticated with check (
  opened_by = (select auth.uid()) and
  private.has_active_store_role(store_id, array['ADMIN','SUPERVISOR']::public.app_role[])
);
create policy recount_events_store_update on public.inventory_count_recount_events
for update to authenticated using (private.has_active_store_role(store_id, null))
with check (private.has_active_store_role(store_id, null));

create or replace function public.import_count_catalog(p_store_id uuid, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid()); v_org uuid; v_row jsonb; v_results jsonb := '[]'::jsonb;
  v_row_no integer := 2; v_product uuid; v_code text; v_name text; v_count_unit text;
  v_purchase_unit text; v_opening numeric;
begin
  select organization_id into v_org from public.stores where id=p_store_id and is_active;
  if v_org is null or not private.has_active_store_role(p_store_id,array['ADMIN','SUPERVISOR']::public.app_role[]) then
    raise exception using errcode='42501',message='STORE_MANAGER_REQUIRED';
  end if;
  if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)=0 or jsonb_array_length(p_rows)>500 then
    raise exception using errcode='22023',message='IMPORT_REQUIRES_1_TO_500_ROWS';
  end if;
  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_code:=upper(btrim(coalesce(v_row->>'product_code',''))); v_name:=btrim(coalesce(v_row->>'name',''));
    v_count_unit:=btrim(coalesce(v_row->>'count_unit','')); v_purchase_unit:=btrim(coalesce(v_row->>'purchase_unit',''));
    begin v_opening:=(v_row->>'opening_quantity')::numeric; exception when others then v_opening:=null; end;
    if v_code='' then v_results:=v_results||jsonb_build_array(jsonb_build_object('row',v_row_no,'field','product_code','status','ERROR','message','商品編碼為必填'));
    elsif v_name='' then v_results:=v_results||jsonb_build_array(jsonb_build_object('row',v_row_no,'field','name','status','ERROR','message','商品名稱為必填'));
    elsif v_count_unit='' then v_results:=v_results||jsonb_build_array(jsonb_build_object('row',v_row_no,'field','count_unit','status','ERROR','message','盤點單位為必填'));
    elsif v_purchase_unit='' then v_results:=v_results||jsonb_build_array(jsonb_build_object('row',v_row_no,'field','purchase_unit','status','ERROR','message','進貨單位為必填'));
    elsif v_opening is null or v_opening<0 then v_results:=v_results||jsonb_build_array(jsonb_build_object('row',v_row_no,'field','opening_quantity','status','ERROR','message','期初數量必須為 0 或正數'));
    else
      select id into v_product from public.products where organization_id=v_org and product_code=v_code;
      if v_product is null then
        insert into public.products(organization_id,product_code,name,category,base_unit,count_unit)
        values(v_org,v_code,v_name,'其他',v_purchase_unit,v_count_unit) returning id into v_product;
        v_results:=v_results||jsonb_build_array(jsonb_build_object('row',v_row_no,'status','CREATED','product_id',v_product));
      else
        update public.products set name=v_name,base_unit=v_purchase_unit,count_unit=v_count_unit,is_active=true where id=v_product;
        v_results:=v_results||jsonb_build_array(jsonb_build_object('row',v_row_no,'status','UPDATED','product_id',v_product));
      end if;
      insert into public.store_product_opening_balances(organization_id,store_id,product_id,quantity,unit,source,created_by)
      values(v_org,p_store_id,v_product,v_opening,v_count_unit,'OPENING_INVENTORY_EXCEL',v_user)
      on conflict(store_id,product_id) do update set quantity=excluded.quantity,unit=excluded.unit,
        source='OPENING_INVENTORY_EXCEL',created_by=v_user,created_at=now();
    end if;
    v_row_no:=v_row_no+1; v_product:=null;
  end loop;
  return v_results;
end; $$;

create or replace function public.set_manual_opening_balance(p_store_id uuid,p_product_id uuid,p_quantity numeric,p_unit text)
returns void language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(select auth.uid());v_org uuid;
begin
  select organization_id into v_org from public.stores where id=p_store_id and is_active;
  if v_org is null or not private.has_active_store_role(p_store_id,array['ADMIN','SUPERVISOR']::public.app_role[]) then
    raise exception using errcode='42501',message='STORE_MANAGER_REQUIRED';
  end if;
  if p_quantity is null or p_quantity<0 or btrim(coalesce(p_unit,''))='' or not exists(
    select 1 from public.products where id=p_product_id and organization_id=v_org
  ) then raise exception using errcode='22023',message='INVALID_MANUAL_OPENING_BALANCE'; end if;
  insert into public.store_product_opening_balances(organization_id,store_id,product_id,quantity,unit,source,created_by)
  values(v_org,p_store_id,p_product_id,p_quantity,p_unit,'MANAGER_MANUAL_OPENING',v_user)
  on conflict(store_id,product_id) do update set quantity=excluded.quantity,unit=excluded.unit,
    source='MANAGER_MANUAL_OPENING',created_by=v_user,created_at=now();
end; $$;

create or replace function public.open_count_recount(p_discrepancy_id uuid,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(select auth.uid());v_event uuid;v_store uuid;v_org uuid;v_session uuid;v_zone uuid;
begin
  select d.organization_id,s.store_id,d.session_id,d.zone_id into v_org,v_store,v_session,v_zone
  from public.inventory_count_discrepancies d join public.inventory_count_sessions s on s.id=d.session_id
  where d.id=p_discrepancy_id and d.status='PENDING';
  if v_store is null or not private.has_active_store_role(v_store,array['ADMIN','SUPERVISOR']::public.app_role[]) then
    raise exception using errcode='42501',message='STORE_MANAGER_REQUIRED';
  end if;
  if p_reason not in('INPUT_ERROR','MISSED_OR_WRONG_ZONE','WASTE_NOT_RECORDED','TRANSFER_NOT_RECORDED','RECEIPT_NOT_RECORDED','OTHER') then
    raise exception using errcode='22023',message='INVALID_RECOUNT_REASON';
  end if;
  if exists(select 1 from public.inventory_count_recount_events where session_id=v_session and zone_id=v_zone and status='OPEN') then
    raise exception using errcode='22023',message='RECOUNT_ALREADY_OPEN';
  end if;
  insert into public.inventory_count_recount_events(organization_id,store_id,session_id,zone_id,discrepancy_id,reason,opened_by)
  values(v_org,v_store,v_session,v_zone,p_discrepancy_id,p_reason,v_user) returning id into v_event;
  update public.count_zone_progress set status='RECOUNT_REQUIRED',completed_by=null,completed_at=null
  where session_id=v_session and zone_id=v_zone;
  update public.inventory_count_sessions set status='IN_PROGRESS',completed_at=null where id=v_session;
  insert into public.audit_logs(organization_id,entity_type,entity_id,action,new_value,user_id)
  values(v_org,'inventory_count_discrepancy',p_discrepancy_id,'COUNT_RECOUNT_OPENED',jsonb_build_object('event_id',v_event,'zone_id',v_zone,'reason',p_reason),v_user);
  return v_event;
end; $$;

create or replace function public.complete_pilot_count_zone(p_session_id uuid,p_zone_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare
  v_user uuid := (select auth.uid()); v_org uuid; v_store uuid; v_expected integer; v_actual integer;
  v_recount uuid; v_recount_reason text;
begin
  select organization_id,store_id into v_org,v_store from public.inventory_count_sessions
  where id=p_session_id and status='IN_PROGRESS';
  if v_store is null or not private.has_active_store_role(v_store,null) then
    raise exception using errcode='42501',message='ACTIVE_STORE_MEMBERSHIP_REQUIRED';
  end if;
  if not private.has_active_store_role(v_store,array['ADMIN','SUPERVISOR']::public.app_role[])
    and not exists(select 1 from public.inventory_count_task_assignments where session_id=p_session_id and user_id=v_user) then
    raise exception using errcode='42501',message='COUNT_TASK_ASSIGNMENT_REQUIRED';
  end if;
  if not exists(select 1 from public.count_zone_progress where session_id=p_session_id and zone_id=p_zone_id and status<>'COMPLETED') then
    raise exception using errcode='22023',message='COUNT_ZONE_NOT_AVAILABLE';
  end if;
  select id,reason into v_recount,v_recount_reason from public.inventory_count_recount_events
  where session_id=p_session_id and zone_id=p_zone_id and status='OPEN' order by opened_at desc limit 1;
  select count(*) into v_expected from public.zone_products where zone_id=p_zone_id;
  select count(*) into v_actual from public.count_drafts
  where session_id=p_session_id and zone_id=p_zone_id and entered_by=v_user and quantity is not null;
  if v_expected=0 or v_actual<>v_expected then
    raise exception using errcode='22023',message='COUNT_ZONE_INCOMPLETE';
  end if;

  insert into public.count_entries(
    organization_id,session_id,zone_id,product_id,quantity,unit,entered_by,entry_type,parent_entry_id
  )
  select d.organization_id,d.session_id,d.zone_id,d.product_id,d.quantity,d.unit,v_user,
    case when v_recount is null then 'INITIAL_COUNT' else 'RECOUNT' end,
    case when v_recount is null then null else x.initial_entry_id end
  from public.count_drafts d
  left join public.inventory_count_discrepancies x
    on x.session_id=d.session_id and x.zone_id=d.zone_id and x.product_id=d.product_id
  where d.session_id=p_session_id and d.zone_id=p_zone_id and d.entered_by=v_user;
  delete from public.count_drafts where session_id=p_session_id and zone_id=p_zone_id and entered_by=v_user;
  update public.count_zone_progress set status='COMPLETED',completed_by=v_user,completed_at=now()
  where session_id=p_session_id and zone_id=p_zone_id;
  insert into public.audit_logs(organization_id,entity_type,entity_id,action,new_value,user_id)
  values(v_org,'inventory_count_session',p_session_id,
    case when v_recount is null then 'COUNT_ZONE_COMPLETED' else 'COUNT_RECOUNT_COMPLETED' end,
    jsonb_build_object('zone_id',p_zone_id,'recount_event_id',v_recount),v_user);

  if v_recount is not null then
    with latest as(
      select distinct on(product_id) product_id,id,quantity,entered_at
      from public.count_entries where session_id=p_session_id and zone_id=p_zone_id and entry_type='RECOUNT'
      order by product_id,entered_at desc
    )
    update public.inventory_count_discrepancies d set
      final_entry_id=l.id,estimated_quantity=l.quantity,difference=l.quantity-d.previous_quantity,
      reason=v_recount_reason,status=case when l.quantity=d.previous_quantity then 'RESOLVED' else 'PENDING' end,
      answered_by=case when l.quantity=d.previous_quantity then v_user else null end,
      answered_at=case when l.quantity=d.previous_quantity then now() else null end
    from latest l where d.session_id=p_session_id and d.zone_id=p_zone_id and d.product_id=l.product_id;
    update public.inventory_count_recount_events set status='COMPLETED',completed_by=v_user,completed_at=now() where id=v_recount;
  end if;

  if not exists(select 1 from public.count_zone_progress where session_id=p_session_id and status<>'COMPLETED') then
    if v_recount is null then
      insert into public.inventory_count_discrepancies(
        organization_id,session_id,zone_id,product_id,initial_entry_id,
        previous_quantity,previous_confirmed_at,estimated_quantity,difference,status
      )
      select v_org,p_session_id,e.zone_id,e.product_id,e.id,
        (x->>'opening_quantity')::numeric,(s.snapshot->>'created_at')::timestamptz,e.quantity,
        e.quantity-(x->>'opening_quantity')::numeric,'PENDING'
      from public.count_entries e
      join public.inventory_count_sessions s on s.id=e.session_id
      join lateral jsonb_array_elements(s.snapshot->'zones') x
        on (x->>'zone_id')::uuid=e.zone_id and (x->>'product_id')::uuid=e.product_id
      where e.session_id=p_session_id and e.entry_type='INITIAL_COUNT'
        and e.quantity<>(x->>'opening_quantity')::numeric
      on conflict(session_id,zone_id,product_id) do nothing;
    end if;
    update public.inventory_count_sessions set
      status=case when exists(select 1 from public.inventory_count_discrepancies where session_id=p_session_id and status='PENDING') then 'REVIEWING' else 'CLOSED' end,
      completed_at=now() where id=p_session_id;
  end if;
end; $$;

create or replace function public.create_count_session_with_source(p_store_id uuid,p_opening_source text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(select auth.uid());v_org uuid;v_session uuid;v_snapshot jsonb;v_last uuid;
begin
  select organization_id into v_org from public.stores where id=p_store_id and is_active;
  if v_org is null or not private.has_active_store_role(p_store_id,array['ADMIN','SUPERVISOR']::public.app_role[]) then
    raise exception using errcode='42501',message='STORE_MANAGER_REQUIRED';
  end if;
  if p_opening_source not in('LAST_APPROVED_COUNT','OPENING_INVENTORY_EXCEL','MANAGER_MANUAL_OPENING') then
    raise exception using errcode='22023',message='OPENING_SOURCE_REQUIRED';
  end if;
  if exists(select 1 from public.inventory_count_sessions where store_id=p_store_id and status in('DRAFT','IN_PROGRESS','REVIEWING')) then
    raise exception using errcode='22023',message='ACTIVE_COUNT_SESSION_EXISTS';
  end if;
  select id into v_last from public.inventory_count_sessions where store_id=p_store_id and status='CLOSED' order by completed_at desc limit 1;
  if p_opening_source='LAST_APPROVED_COUNT' and v_last is null then
    raise exception using errcode='22023',message='LAST_APPROVED_COUNT_REQUIRED';
  end if;
  with assigned as(
    select z.id zone_id,z.name zone_name,z.sort_order zone_sort,zp.sort_order,p.id product_id,p.product_code,p.name product_name,zp.count_unit unit
    from public.count_zones z join public.zone_products zp on zp.zone_id=z.id join public.products p on p.id=zp.product_id
    where z.store_id=p_store_id and z.is_active and p.is_active
  ), opening as(
    select a.*,case when p_opening_source='LAST_APPROVED_COUNT' then(
      select sum(e.quantity) from public.count_entries e where e.session_id=v_last and e.product_id=a.product_id
        and e.entry_type in('INITIAL_COUNT','RECOUNT','CORRECTION')
    ) else(
      select b.quantity from public.store_product_opening_balances b where b.store_id=p_store_id and b.product_id=a.product_id
        and (b.source=p_opening_source or (p_opening_source='MANAGER_MANUAL_OPENING' and b.source='ADMIN_OPENING_COUNT'))
    ) end opening_quantity from assigned a
  )
  select jsonb_build_object('created_at',now(),'opening_source',p_opening_source,'zones',coalesce(jsonb_agg(jsonb_build_object(
    'zone_id',zone_id,'zone_name',zone_name,'product_id',product_id,'product_code',product_code,
    'product_name',product_name,'unit',unit,'opening_quantity',opening_quantity) order by zone_sort,sort_order),'[]'::jsonb))
  into v_snapshot from opening;
  if jsonb_array_length(v_snapshot->'zones')=0 or exists(
    select 1 from jsonb_array_elements(v_snapshot->'zones') x where x->'opening_quantity'='null'::jsonb
  ) then raise exception using errcode='22023',message='OPENING_SOURCE_INCOMPLETE'; end if;
  insert into public.inventory_count_sessions(organization_id,store_id,started_by,status,snapshot,opening_source)
  values(v_org,p_store_id,v_user,'IN_PROGRESS',v_snapshot,p_opening_source) returning id into v_session;
  insert into public.count_zone_progress(organization_id,session_id,zone_id,status)
  select v_org,v_session,id,'NOT_STARTED' from public.count_zones where store_id=p_store_id and is_active;
  insert into public.audit_logs(organization_id,entity_type,entity_id,action,new_value,user_id)
  values(v_org,'inventory_count_session',v_session,'COUNT_SESSION_CREATED',jsonb_build_object('store_id',p_store_id,'opening_source',p_opening_source),v_user);
  return v_session;
end; $$;

revoke all on function public.import_count_catalog(uuid,jsonb) from public,anon;
revoke all on function public.set_manual_opening_balance(uuid,uuid,numeric,text) from public,anon;
revoke all on function public.open_count_recount(uuid,text) from public,anon;
revoke all on function public.complete_pilot_count_zone(uuid,uuid) from public,anon;
grant execute on function public.import_count_catalog(uuid,jsonb) to authenticated;
grant execute on function public.set_manual_opening_balance(uuid,uuid,numeric,text) to authenticated;
grant execute on function public.open_count_recount(uuid,text) to authenticated;
grant execute on function public.complete_pilot_count_zone(uuid,uuid) to authenticated;
revoke all on function public.create_count_session_with_source(uuid,text) from public,anon;
grant execute on function public.create_count_session_with_source(uuid,text) to authenticated;
notify pgrst,'reload schema';
