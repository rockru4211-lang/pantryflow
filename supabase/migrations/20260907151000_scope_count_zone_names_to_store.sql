-- Count zones are operationally store-scoped. The legacy organization/name
-- index prevented a second store in the same organization from using standard
-- names such as "冷藏" or "未分類", which caused every imported row to roll
-- back after its product was parsed successfully.

drop index if exists public.count_zones_organization_name_uidx;

create unique index if not exists count_zones_store_normalized_name_uidx
  on public.count_zones (
    store_id,
    (regexp_replace(lower(name), '\s+', '', 'g'))
  )
  where store_id is not null;

create unique index if not exists count_zones_legacy_organization_normalized_name_uidx
  on public.count_zones (
    organization_id,
    (regexp_replace(lower(name), '\s+', '', 'g'))
  )
  where store_id is null;

create or replace function public.create_pilot_zone(p_store_id uuid, p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_org uuid;
  v_zone uuid;
  v_sort integer;
  v_normalized_name text;
begin
  select organization_id into v_org
  from public.stores
  where id = p_store_id and is_active;

  if v_org is null
    or not private.has_active_store_role(
      p_store_id,
      array['ADMIN','SUPERVISOR']::public.app_role[]
    )
  then
    raise exception using errcode = '42501', message = 'STORE_MANAGER_REQUIRED';
  end if;

  if btrim(coalesce(p_name, '')) = '' then
    raise exception using errcode = '22023', message = 'ZONE_NAME_REQUIRED';
  end if;

  v_normalized_name := regexp_replace(lower(btrim(p_name)), '\s+', '', 'g');
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_store_id::text || ':' || v_normalized_name, 0)
  );

  select id into v_zone
  from public.count_zones
  where store_id = p_store_id
    and is_active
    and regexp_replace(lower(name), '\s+', '', 'g') = v_normalized_name
  order by created_at
  limit 1;

  if v_zone is not null then
    return v_zone;
  end if;

  select coalesce(max(sort_order), -1) + 1 into v_sort
  from public.count_zones
  where store_id = p_store_id;

  insert into public.count_zones(organization_id, store_id, name, sort_order)
  values (v_org, p_store_id, btrim(p_name), v_sort)
  returning id into v_zone;

  insert into public.audit_logs(
    organization_id, entity_type, entity_id, action, new_value, user_id
  ) values (
    v_org, 'count_zone', v_zone, 'PILOT_ZONE_CREATED',
    jsonb_build_object('store_id', p_store_id, 'name', btrim(p_name)), v_user
  );

  return v_zone;
end;
$$;

revoke all on function public.create_pilot_zone(uuid, text) from public, anon;
grant execute on function public.create_pilot_zone(uuid, text) to authenticated;

create or replace function public.get_app_schema_version()
returns text
language sql
stable
security invoker
set search_path = ''
as $$ select '20260907_merchant_beta_v7'::text $$;

revoke all on function public.get_app_schema_version() from public;
grant execute on function public.get_app_schema_version() to anon, authenticated;

comment on index public.count_zones_store_normalized_name_uidx is
  'A zone name is unique within one store, not across every store in an organization.';

notify pgrst, 'reload schema';
