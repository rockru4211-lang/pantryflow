create table private.beape_onboarding_grants (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null
);
alter table private.beape_onboarding_grants enable row level security;
revoke all on private.beape_onboarding_grants from public, anon, authenticated;

create function private.beape_onboarding_enabled(p_user_id uuid)
returns boolean language sql stable set search_path = '' as $$
  select coalesce(
    (select g.enabled from private.beape_onboarding_grants g where g.user_id = p_user_id),
    exists (
      select 1 from private.beape_onboarding_stores() s
      join private.beape_onboarding_access a on a.store_id = s.id and a.user_id = p_user_id
      join public.store_memberships m on m.store_id = s.id and m.user_id = p_user_id
      where a.can_open and m.access_mode = 'EDIT' and private.member_active(s.id, p_user_id)
    )
  )
$$;
revoke all on function private.beape_onboarding_enabled(uuid) from public, anon, authenticated;

create function public.get_beape_onboarding_grant(p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.beape_onboarding_enabled(p_user_id)
  where exists (
    select 1 from private.beape_onboarding_stores() s
    where private.can_set_beape_onboarding_access(s.id, p_user_id)
  )
$$;

create function public.save_beape_onboarding_grant(
  p_user_id uuid, p_enabled boolean, p_previous boolean, p_settings jsonb default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  audit_store uuid;
  previous_enabled boolean;
  result jsonb := '{"saved":true}'::jsonb;
begin
  if p_enabled is null or p_previous is null then
    raise exception 'INVALID_ACCESS' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('7e6693e0-8530-4903-9b3d-0c1c47730d9f' || p_user_id::text, 927));
  select s.id into audit_store from private.beape_onboarding_stores() s
  where private.can_set_beape_onboarding_access(s.id, p_user_id) order by s.id limit 1;
  if audit_store is null then raise exception 'APP_FORBIDDEN' using errcode = '42501'; end if;

  previous_enabled := private.beape_onboarding_enabled(p_user_id);
  if previous_enabled is distinct from p_enabled then
    if previous_enabled is distinct from p_previous then
      raise exception 'REVISION_CONFLICT' using errcode = '40001';
    end if;
    insert into private.beape_onboarding_grants values (p_user_id, p_enabled)
    on conflict (user_id) do update set enabled = excluded.enabled;
    insert into public.audit_logs (organization_id, store_id, user_id, entity_type, entity_id, action, old_value, new_value)
    select s.organization_id, s.id, auth.uid(), 'partner', p_user_id::text, 'ONBOARDING_ACCESS_UPDATED',
      jsonb_build_object('enabled', previous_enabled), jsonb_build_object('enabled', p_enabled)
    from public.stores s where s.id = audit_store;
  end if;

  if p_settings is not null then
    result := public.save_person_settings(
      (p_settings->>'p_store_id')::uuid, p_user_id, p_settings->>'p_revision', p_settings->>'p_name',
      p_settings->'p_stores', array(select jsonb_array_elements_text(p_settings->'p_functions')),
      (p_settings->>'p_default_store_id')::uuid, (p_settings->>'p_request_id')::uuid,
      p_settings->'p_features', (p_settings->>'p_features_revision')::integer
    );
    if result->'saved' is distinct from 'true'::jsonb then raise exception 'SAVE_UNCONFIRMED'; end if;
  end if;
  return result;
end
$$;

create or replace function public.get_beape_onboarding_access()
returns jsonb language sql stable security definer set search_path = '' as $$
  with active_memberships as (
    select s.name, coalesce(a.can_receive, false) as can_receive, o.owner_user_id
    from private.beape_onboarding_stores() s
    join public.store_memberships m on m.store_id = s.id and m.user_id = auth.uid()
    join public.organizations o on o.id = m.organization_id
    left join private.beape_onboarding_access a on a.store_id = s.id and a.user_id = auth.uid()
    where private.member_active(s.id, auth.uid())
  )
  select jsonb_build_object(
    'open_stores', case when exists (select 1 from active_memberships)
      and private.beape_onboarding_enabled(auth.uid()) then (
        select coalesce(jsonb_agg(s.name order by s.name), '[]'::jsonb) from private.beape_onboarding_stores() s
      ) else '[]'::jsonb end,
    'receive_stores', coalesce(jsonb_agg(name order by name) filter (where can_receive), '[]'::jsonb),
    'is_owner', coalesce(bool_or(owner_user_id = auth.uid()), false)
  ) from active_memberships
$$;

revoke all on function public.get_beape_onboarding_grant(uuid),
  public.save_beape_onboarding_grant(uuid, boolean, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.get_beape_onboarding_grant(uuid),
  public.save_beape_onboarding_grant(uuid, boolean, boolean, jsonb) to authenticated;
