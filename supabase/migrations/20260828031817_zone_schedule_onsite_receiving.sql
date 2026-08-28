-- PF-ZONE-SCHEDULE-ONSITE-RECEIVING-20260828
-- Store-scoped count scheduling, optional paper workflow, ERP assistance and
-- immutable on-site receiving confirmations.

create table if not exists public.store_workflow_settings (
  store_id uuid primary key references public.stores(id),
  organization_id uuid not null references public.organizations(id),
  count_frequency text not null default 'MANUAL'
    check (count_frequency in ('MANUAL','DAILY','WEEKLY','MONTHLY')),
  count_run_time time not null default '09:00',
  count_days_of_week smallint[] not null default array[1]::smallint[]
    check (count_days_of_week <@ array[1,2,3,4,5,6,7]::smallint[]),
  count_day_of_month smallint not null default 1
    check (count_day_of_month between 1 and 28),
  count_selected_product_ids uuid[] not null default '{}'::uuid[],
  paper_transcription_enabled boolean not null default false,
  erp_assist_enabled boolean not null default false,
  erp_reminder_time time not null default '17:00',
  currency text not null default 'TWD' check (currency = 'TWD'),
  is_active boolean not null default true,
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, organization_id)
);

alter table public.store_workflow_settings enable row level security;

drop policy if exists store_workflow_settings_member_select on public.store_workflow_settings;
create policy store_workflow_settings_member_select
on public.store_workflow_settings for select to authenticated
using ((select auth.uid()) is not null and private.has_active_store_role(store_id,null));

drop policy if exists store_workflow_settings_manager_insert on public.store_workflow_settings;
create policy store_workflow_settings_manager_insert
on public.store_workflow_settings for insert to authenticated
with check (
  updated_by = (select auth.uid())
  and private.has_active_store_role(store_id,array['ADMIN','SUPERVISOR']::public.app_role[])
  and exists (
    select 1 from public.stores s
    where s.id=store_id and s.organization_id=organization_id and s.is_active
  )
);

drop policy if exists store_workflow_settings_manager_update on public.store_workflow_settings;
create policy store_workflow_settings_manager_update
on public.store_workflow_settings for update to authenticated
using (private.has_active_store_role(store_id,array['ADMIN','SUPERVISOR']::public.app_role[]))
with check (
  updated_by = (select auth.uid())
  and private.has_active_store_role(store_id,array['ADMIN','SUPERVISOR']::public.app_role[])
  and exists (
    select 1 from public.stores s
    where s.id=store_id and s.organization_id=organization_id and s.is_active
  )
);

grant select,insert,update on public.store_workflow_settings to authenticated;
revoke delete on public.store_workflow_settings from authenticated,anon;

alter table public.inventory_count_sessions
  add column if not exists work_date date,
  add column if not exists trigger_source text not null default 'MANUAL'
    check (trigger_source in ('MANUAL','SCHEDULED'));

update public.inventory_count_sessions
set work_date=(started_at at time zone 'Asia/Taipei')::date
where work_date is null;

alter table public.inventory_count_sessions alter column work_date set not null;

create unique index if not exists inventory_count_sessions_one_scheduled_day_idx
  on public.inventory_count_sessions(store_id,work_date)
  where trigger_source='SCHEDULED';

create table if not exists public.receipt_site_check_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  store_id uuid not null references public.stores(id),
  batch_id uuid not null references public.receipt_upload_batches(id),
  ocr_run_id uuid references public.receipt_ocr_runs(id),
  row_key text not null check (btrim(row_key)<>''),
  ordered_quantity numeric,
  received_quantity numeric not null check (received_quantity>=0),
  unit text not null default '',
  discrepancy text not null
    check (discrepancy in ('MATCH','SHORT','OVER','NOT_DELIVERED','WRONG_ITEM')),
  note text,
  confirmed_by uuid not null references public.profiles(id),
  confirmed_at timestamptz not null default now()
);

create index if not exists receipt_site_check_events_batch_row_idx
  on public.receipt_site_check_events(batch_id,row_key,confirmed_at desc);

alter table public.receipt_site_check_events enable row level security;

drop policy if exists receipt_site_check_events_member_select on public.receipt_site_check_events;
create policy receipt_site_check_events_member_select
on public.receipt_site_check_events for select to authenticated
using ((select auth.uid()) is not null and private.has_active_store_role(store_id,null));

drop policy if exists receipt_site_check_events_member_insert on public.receipt_site_check_events;
create policy receipt_site_check_events_member_insert
on public.receipt_site_check_events for insert to authenticated
with check (
  confirmed_by=(select auth.uid())
  and private.has_active_store_role(store_id,array['STAFF','ADMIN','SUPERVISOR']::public.app_role[])
  and exists (
    select 1 from public.receipt_upload_batches b
    where b.id=batch_id and b.store_id=store_id and b.organization_id=organization_id
  )
  and (ocr_run_id is null or exists (
    select 1 from public.receipt_ocr_runs r
    where r.id=ocr_run_id and r.batch_id=batch_id and r.organization_id=organization_id
  ))
);

grant select,insert on public.receipt_site_check_events to authenticated;
revoke update,delete on public.receipt_site_check_events from authenticated,anon;

create or replace function private.count_schedule_is_due(
  p_frequency text,
  p_run_time time,
  p_days smallint[],
  p_day_of_month smallint,
  p_is_active boolean,
  p_now timestamptz default now()
)
returns boolean
language plpgsql
stable
set search_path=''
as $$
declare v_local timestamp := p_now at time zone 'Asia/Taipei';
begin
  if not p_is_active or p_frequency='MANUAL' or v_local::time < p_run_time then return false; end if;
  if p_frequency='DAILY' then return true; end if;
  if p_frequency='WEEKLY' then return extract(isodow from v_local)::smallint=any(p_days); end if;
  if p_frequency='MONTHLY' then return extract(day from v_local)::smallint=p_day_of_month; end if;
  return false;
end;
$$;

create or replace function private.create_count_session_from_workflow(
  p_store_id uuid,
  p_actor uuid,
  p_source text,
  p_work_date date
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_org uuid;
  v_session uuid;
  v_snapshot jsonb;
  v_selected uuid[];
begin
  if p_actor is null or p_actor<>(select auth.uid()) or p_source not in ('MANUAL','SCHEDULED') then
    raise exception using errcode='22023',message='WORKFLOW_SETTINGS_INVALID';
  end if;
  select organization_id into v_org from public.stores where id=p_store_id and is_active;
  if v_org is null or not exists(
    select 1 from public.store_memberships sm
    where sm.store_id=p_store_id and sm.user_id=p_actor and sm.is_active
  ) then raise exception using errcode='42501',message='ACTIVE_STORE_MEMBERSHIP_REQUIRED'; end if;
  if p_source='MANUAL' and not exists(
    select 1 from public.store_memberships sm
    where sm.store_id=p_store_id and sm.user_id=p_actor and sm.is_active
      and sm.role in ('ADMIN','SUPERVISOR')
  ) then raise exception using errcode='42501',message='STORE_MANAGER_REQUIRED'; end if;
  if p_source='SCHEDULED' and (
    p_work_date<>(now() at time zone 'Asia/Taipei')::date
    or not exists(
      select 1 from public.store_workflow_settings ws
      where ws.store_id=p_store_id
        and private.count_schedule_is_due(
          ws.count_frequency,ws.count_run_time,ws.count_days_of_week,
          ws.count_day_of_month,ws.is_active,now()
        )
    )
  ) then raise exception using errcode='22023',message='COUNT_SCHEDULE_NOT_DUE'; end if;
  if p_source='SCHEDULED' then
    select id into v_session from public.inventory_count_sessions
    where store_id=p_store_id and work_date=p_work_date and trigger_source='SCHEDULED'
    order by created_at desc limit 1;
    if v_session is not null then return v_session; end if;
  end if;
  if exists(select 1 from public.inventory_count_sessions where store_id=p_store_id and status in('DRAFT','IN_PROGRESS','REVIEWING')) then
    if p_source='SCHEDULED' then return null; end if;
    raise exception using errcode='22023',message='ACTIVE_COUNT_SESSION_EXISTS';
  end if;
  select count_selected_product_ids into v_selected
  from public.store_workflow_settings where store_id=p_store_id;
  if coalesce(cardinality(v_selected),0)=0 then
    select coalesce(array_agg(distinct zp.product_id),'{}'::uuid[]) into v_selected
    from public.zone_products zp join public.count_zones z on z.id=zp.zone_id
    where z.store_id=p_store_id and z.is_active;
  end if;
  if coalesce(cardinality(v_selected),0)=0 then
    raise exception using errcode='22023',message='COUNT_PRODUCTS_REQUIRED';
  end if;
  if exists(
    select 1 from unnest(v_selected) product_id
    where not exists(
      select 1 from public.store_product_opening_balances b
      where b.store_id=p_store_id and b.product_id=product_id
    )
  ) then raise exception using errcode='22023',message='OPENING_BALANCE_REQUIRED'; end if;
  select jsonb_build_object(
    'created_at',now(),
    'trigger_source',p_source,
    'work_date',p_work_date,
    'zones',coalesce(jsonb_agg(jsonb_build_object(
      'zone_id',z.id,'zone_name',z.name,'product_id',p.id,'product_code',p.product_code,
      'product_name',p.name,'unit',zp.count_unit
    ) order by z.sort_order,zp.sort_order),'[]'::jsonb)
  ) into v_snapshot
  from public.count_zones z
  join public.zone_products zp on zp.zone_id=z.id
  join public.products p on p.id=zp.product_id
  where z.store_id=p_store_id and z.is_active and p.is_active and p.id=any(v_selected);
  if jsonb_array_length(v_snapshot->'zones')=0 then
    raise exception using errcode='22023',message='COUNT_PRODUCTS_REQUIRED';
  end if;
  insert into public.inventory_count_sessions(
    organization_id,store_id,started_by,status,snapshot,work_date,trigger_source
  ) values(v_org,p_store_id,p_actor,'IN_PROGRESS',v_snapshot,p_work_date,p_source)
  returning id into v_session;
  insert into public.count_zone_progress(organization_id,session_id,zone_id,status)
  select distinct v_org,v_session,(item->>'zone_id')::uuid,'NOT_STARTED'
  from jsonb_array_elements(v_snapshot->'zones') item;
  insert into public.audit_logs(organization_id,entity_type,entity_id,action,new_value,user_id)
  values(v_org,'inventory_count_session',v_session,'COUNT_SESSION_CREATED',
    jsonb_build_object('store_id',p_store_id,'trigger_source',p_source,'work_date',p_work_date),p_actor);
  return v_session;
end;
$$;

create or replace function public.materialize_my_store_count_task(p_store_id uuid)
returns uuid
language plpgsql
security invoker
set search_path=''
as $$
declare v_user uuid := (select auth.uid()); v_settings public.store_workflow_settings%rowtype; v_date date;
begin
  if v_user is null or not private.has_active_store_role(p_store_id,null) then
    raise exception using errcode='42501',message='ACTIVE_STORE_MEMBERSHIP_REQUIRED';
  end if;
  select * into v_settings from public.store_workflow_settings where store_id=p_store_id;
  if not found or not private.count_schedule_is_due(
    v_settings.count_frequency,v_settings.count_run_time,v_settings.count_days_of_week,
    v_settings.count_day_of_month,v_settings.is_active,now()
  ) then return null; end if;
  v_date := (now() at time zone 'Asia/Taipei')::date;
  return private.create_count_session_from_workflow(p_store_id,v_user,'SCHEDULED',v_date);
end;
$$;

create or replace function public.create_pilot_count_session(p_store_id uuid)
returns uuid
language plpgsql
security invoker
set search_path=''
as $$
declare v_user uuid := (select auth.uid());
begin
  if v_user is null or not private.has_active_store_role(p_store_id,array['ADMIN','SUPERVISOR']::public.app_role[]) then
    raise exception using errcode='42501',message='STORE_MANAGER_REQUIRED';
  end if;
  return private.create_count_session_from_workflow(
    p_store_id,v_user,'MANUAL',(now() at time zone 'Asia/Taipei')::date
  );
end;
$$;

create or replace function public.complete_pilot_count_zone(p_session_id uuid,p_zone_id uuid)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare v_user uuid := (select auth.uid()); v_org uuid; v_store uuid; v_expected integer; v_actual integer;
begin
  select organization_id,store_id into v_org,v_store from public.inventory_count_sessions
  where id=p_session_id and status='IN_PROGRESS';
  if v_store is null or not private.has_active_store_role(v_store,array['STAFF','ADMIN','SUPERVISOR']::public.app_role[]) then
    raise exception using errcode='42501',message='ACTIVE_STORE_MEMBERSHIP_REQUIRED';
  end if;
  if not exists(select 1 from public.count_zone_progress where session_id=p_session_id and zone_id=p_zone_id and status<>'COMPLETED') then
    raise exception using errcode='22023',message='COUNT_ZONE_NOT_AVAILABLE';
  end if;
  select count(*) into v_expected
  from public.inventory_count_sessions s cross join lateral jsonb_array_elements(s.snapshot->'zones') item
  where s.id=p_session_id and (item->>'zone_id')::uuid=p_zone_id;
  select count(*) into v_actual from public.count_drafts
  where session_id=p_session_id and zone_id=p_zone_id and entered_by=v_user;
  if v_expected=0 or v_actual<>v_expected then raise exception using errcode='22023',message='COUNT_ZONE_INCOMPLETE'; end if;
  insert into public.count_entries(organization_id,session_id,zone_id,product_id,quantity,unit,entered_by,entry_type)
  select d.organization_id,d.session_id,d.zone_id,d.product_id,d.quantity,d.unit,v_user,'INITIAL_COUNT'
  from public.count_drafts d
  join public.inventory_count_sessions s on s.id=d.session_id
  where d.session_id=p_session_id and d.zone_id=p_zone_id and d.entered_by=v_user
    and exists(select 1 from jsonb_array_elements(s.snapshot->'zones') item
      where (item->>'zone_id')::uuid=d.zone_id and (item->>'product_id')::uuid=d.product_id);
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
    select v_org,p_session_id,(array_agg(e.zone_id order by e.entered_at))[1],e.product_id,
      (array_agg(e.id order by e.entered_at))[1],b.quantity,b.created_at,sum(e.quantity),sum(e.quantity)-b.quantity,'PENDING'
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

revoke all on function private.create_count_session_from_workflow(uuid,uuid,text,date) from public,anon;
grant execute on function private.create_count_session_from_workflow(uuid,uuid,text,date) to authenticated;
revoke all on function public.materialize_my_store_count_task(uuid) from public,anon;
grant execute on function public.materialize_my_store_count_task(uuid) to authenticated;
revoke all on function public.create_pilot_count_session(uuid) from public,anon;
grant execute on function public.create_pilot_count_session(uuid) to authenticated;
revoke all on function public.complete_pilot_count_zone(uuid,uuid) from public,anon;
grant execute on function public.complete_pilot_count_zone(uuid,uuid) to authenticated;

comment on table public.store_workflow_settings is
  'Store-specific count schedule, optional paper workflow and ERP assistance. Restaurant size does not split the product.';
comment on table public.receipt_site_check_events is
  'Append-only on-site receiving quantity and discrepancy confirmations by staff or store managers.';

notify pgrst,'reload schema';
