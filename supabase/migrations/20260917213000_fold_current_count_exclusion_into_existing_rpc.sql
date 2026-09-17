create or replace function public.set_pilot_count_next_period(p_store_id uuid, p_product_id uuid, p_action text)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_org uuid;
  v_actor uuid := auth.uid();
  v_name text;
  v_active boolean;
  v_session uuid;
  v_has_quantity boolean;
begin
  select s.organization_id,p.name,p.is_active into v_org,v_name,v_active
  from public.stores s join public.products p on p.organization_id=s.organization_id
  where s.id=p_store_id and s.is_active and p.id=p_product_id;

  if v_org is null or not private.has_active_store_role(p_store_id,array['ADMIN','SUPERVISOR']::public.app_role[]) then
    raise exception using errcode='42501',message='STORE_MANAGER_REQUIRED';
  end if;

  if p_action not in ('KEEP','EXCLUDE','DISABLE','EXCLUDE_CURRENT') then
    raise exception 'INVALID_NEXT_COUNT_ACTION' using errcode='22023';
  end if;

  if p_action='KEEP' then
    delete from private.count_next_exclusions where store_id=p_store_id and product_id=p_product_id;
  elsif p_action='EXCLUDE' then
    insert into private.count_next_exclusions(store_id,product_id,excluded_by)
    values(p_store_id,p_product_id,v_actor)
    on conflict(store_id,product_id) do update set excluded_by=excluded.excluded_by,excluded_at=now();
  elsif p_action='DISABLE' then
    delete from private.count_next_exclusions where store_id=p_store_id and product_id=p_product_id;
    update public.products set is_active=false,updated_at=now() where id=p_product_id and organization_id=v_org;
  else
    select id into v_session from public.inventory_count_sessions
    where store_id=p_store_id and status in ('DRAFT','IN_PROGRESS')
    order by started_at desc limit 1;

    if v_session is not null then
      select exists(
        select 1 from public.count_drafts
        where session_id=v_session and product_id=p_product_id and quantity is not null
      ) into v_has_quantity;

      if v_has_quantity then
        raise exception using errcode='22023',message='PRODUCT_ALREADY_COUNTED';
      end if;

      delete from public.count_drafts where session_id=v_session and product_id=p_product_id;
      delete from private.count_opening_snapshots where session_id=v_session and product_id=p_product_id;

      update public.inventory_count_sessions s
      set snapshot=jsonb_set(
        s.snapshot,'{zones}',
        coalesce((select jsonb_agg(item) from jsonb_array_elements(coalesce(s.snapshot->'zones','[]'::jsonb)) item where item->>'product_id'<>p_product_id::text),'[]'::jsonb),true)
      where s.id=v_session;

      delete from public.count_zone_progress zp
      where zp.session_id=v_session and not exists(
        select 1 from jsonb_array_elements((select snapshot->'zones' from public.inventory_count_sessions where id=v_session)) item
        where item->>'zone_id'=zp.zone_id::text
      );
    end if;
  end if;

  insert into public.audit_logs(organization_id,store_id,entity_type,entity_id,action,new_value,user_id)
  values(v_org,p_store_id,'product',p_product_id,'COUNT_NEXT_PERIOD_SETTING',jsonb_build_object('action',p_action,'name',v_name),v_actor);

  return jsonb_build_object(
    'product_id',p_product_id,
    'action',p_action,
    'active',case when p_action='DISABLE' then false else v_active end,
    'session_id',v_session
  );
end;
$$;

drop function if exists public.exclude_product_from_active_count(uuid,uuid);
