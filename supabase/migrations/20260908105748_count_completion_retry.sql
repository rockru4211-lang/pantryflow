CREATE OR REPLACE FUNCTION public.complete_pilot_count_zone(p_session_id uuid, p_zone_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid := (select auth.uid());
  v_org uuid;
  v_store uuid;
  v_status public.count_session_status;
  v_expected integer;
  v_actual integer;
begin
  select organization_id, store_id, status
  into v_org, v_store, v_status
  from public.inventory_count_sessions
  where id = p_session_id for update;

  if v_store is null or not private.has_active_store_role(v_store, array['ADMIN','SUPERVISOR','STAFF']::public.app_role[]) then
    raise exception using errcode = '42501', message = 'ACTIVE_STORE_MEMBERSHIP_REQUIRED';
  end if;

  -- The session lock and role check precede this retry path. A timed-out
  -- successful submission must not insert rows or report a permission error.
  if exists (select 1 from public.count_zone_progress
    where session_id=p_session_id and zone_id=p_zone_id and status='COMPLETED') then
    return;
  end if;
  if v_status <> 'IN_PROGRESS' then
    raise exception using errcode='22023',message='COUNT_SESSION_NOT_ACTIVE';
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
  from public.inventory_count_sessions s, jsonb_array_elements(s.snapshot->'zones') item
  where s.id=p_session_id and item->>'zone_id'=p_zone_id::text;

  select count(*) into v_actual
  from public.count_drafts
  where session_id = p_session_id
    and zone_id = p_zone_id
    and quantity is not null;

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
  select organization_id, session_id, zone_id, product_id, quantity, unit, entered_by, 'INITIAL_COUNT'
  from public.count_drafts
  where session_id = p_session_id
    and zone_id = p_zone_id
    and quantity is not null;

  delete from public.count_drafts
  where session_id = p_session_id
    and zone_id = p_zone_id
    and quantity is not null;

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
    join (
      select product_id,quantity,confirmed_at as created_at from private.count_opening_snapshots where session_id=p_session_id
      union all
      select product_id,quantity,created_at from public.store_product_opening_balances
      where store_id=v_store and not exists(
        select 1 from public.inventory_count_sessions s where s.id=p_session_id and s.snapshot->>'opening_captured'='true'
      )
    ) b on b.product_id=e.product_id and b.quantity is not null
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
$function$;
