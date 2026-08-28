-- System-first count creation: never block frontline work because an imported
-- catalog did not include an opening balance. Missing balances are initialized
-- to zero at task materialization and remain auditable rows.

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
  v_created_balances integer := 0;
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

  insert into public.store_product_opening_balances(
    organization_id,store_id,product_id,quantity,unit,created_by
  )
  select v_org,p_store_id,p.id,0,p.count_unit,p_actor
  from public.products p
  where p.organization_id=v_org and p.is_active and p.id=any(v_selected)
  on conflict(store_id,product_id) do nothing;
  get diagnostics v_created_balances = row_count;
  if v_created_balances>0 then
    insert into public.audit_logs(organization_id,entity_type,entity_id,action,new_value,user_id)
    values(v_org,'store',p_store_id,'OPENING_BALANCES_AUTO_INITIALIZED',
      jsonb_build_object('count',v_created_balances,'quantity',0,'source',p_source),p_actor);
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

revoke all on function private.create_count_session_from_workflow(uuid,uuid,text,date) from public,anon;
grant execute on function private.create_count_session_from_workflow(uuid,uuid,text,date) to authenticated;
