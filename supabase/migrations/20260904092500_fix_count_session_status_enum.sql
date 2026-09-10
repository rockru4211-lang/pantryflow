-- Keep the blind-count completion RPC compatible with the enum-backed
-- inventory_count_sessions.status column created by the baseline schema.
create or replace function public.complete_pilot_count_zone(
  p_session_id uuid,
  p_zone_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_org uuid;
  v_store uuid;
  v_expected integer;
  v_actual integer;
begin
  select organization_id, store_id
  into v_org, v_store
  from public.inventory_count_sessions
  where id = p_session_id
    and status = 'IN_PROGRESS';

  if v_store is null or not private.has_active_store_role(v_store, null) then
    raise exception using errcode = '42501', message = 'ACTIVE_STORE_MEMBERSHIP_REQUIRED';
  end if;

  if not exists (
    select 1
    from public.count_zone_progress
    where session_id = p_session_id
      and zone_id = p_zone_id
      and status <> 'COMPLETED'
  ) then
    raise exception using errcode = '22023', message = 'COUNT_ZONE_NOT_AVAILABLE';
  end if;

  select count(*) into v_expected
  from public.zone_products
  where zone_id = p_zone_id;

  select count(*) into v_actual
  from public.count_drafts
  where session_id = p_session_id
    and zone_id = p_zone_id
    and entered_by = v_user;

  if v_expected = 0 or v_actual <> v_expected then
    raise exception using errcode = '22023', message = 'COUNT_ZONE_INCOMPLETE';
  end if;

  insert into public.count_entries(
    organization_id,
    session_id,
    zone_id,
    product_id,
    quantity,
    unit,
    entered_by,
    entry_type
  )
  select organization_id, session_id, zone_id, product_id, quantity, unit, v_user, 'INITIAL_COUNT'
  from public.count_drafts
  where session_id = p_session_id
    and zone_id = p_zone_id
    and entered_by = v_user;

  delete from public.count_drafts
  where session_id = p_session_id
    and zone_id = p_zone_id
    and entered_by = v_user;

  update public.count_zone_progress
  set status = 'COMPLETED', completed_by = v_user, completed_at = now()
  where session_id = p_session_id
    and zone_id = p_zone_id;

  insert into public.audit_logs(
    organization_id,
    entity_type,
    entity_id,
    action,
    new_value,
    user_id
  )
  values (
    v_org,
    'inventory_count_session',
    p_session_id,
    'COUNT_ZONE_COMPLETED',
    jsonb_build_object('zone_id', p_zone_id),
    v_user
  );

  if not exists (
    select 1
    from public.count_zone_progress
    where session_id = p_session_id
      and status <> 'COMPLETED'
  ) then
    insert into public.inventory_count_discrepancies(
      organization_id,
      session_id,
      zone_id,
      product_id,
      initial_entry_id,
      previous_quantity,
      previous_confirmed_at,
      estimated_quantity,
      difference,
      status
    )
    select
      v_org,
      p_session_id,
      (array_agg(e.zone_id order by e.entered_at))[1],
      e.product_id,
      (array_agg(e.id order by e.entered_at))[1],
      b.quantity,
      b.created_at,
      sum(e.quantity),
      sum(e.quantity) - b.quantity,
      'PENDING'
    from public.count_entries e
    join public.store_product_opening_balances b
      on b.store_id = v_store
      and b.product_id = e.product_id
    where e.session_id = p_session_id
      and e.entry_type = 'INITIAL_COUNT'
    group by e.product_id, b.quantity, b.created_at
    having sum(e.quantity) <> b.quantity
    on conflict (session_id, zone_id, product_id) do nothing;

    update public.inventory_count_sessions
    set
      status = case
        when exists (
          select 1
          from public.inventory_count_discrepancies
          where session_id = p_session_id
        ) then 'REVIEWING'::public.count_session_status
        else 'CLOSED'::public.count_session_status
      end,
      completed_at = now()
    where id = p_session_id;
  end if;
end;
$$;

revoke all on function public.complete_pilot_count_zone(uuid, uuid) from public, anon;
grant execute on function public.complete_pilot_count_zone(uuid, uuid) to authenticated;

create or replace function public.get_app_schema_version()
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select '20260904_merchant_beta_v2'::text
$$;

revoke all on function public.get_app_schema_version() from public;
grant execute on function public.get_app_schema_version() to anon, authenticated;

notify pgrst, 'reload schema';
