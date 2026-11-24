create table private.beape_onboarding_access (
  store_id uuid not null references public.stores(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  can_open boolean not null,
  can_receive boolean not null,
  primary key (store_id, user_id),
  check (can_open or can_receive)
);
alter table private.beape_onboarding_access enable row level security;
revoke all on private.beape_onboarding_access from public, anon, authenticated;

create function private.beape_onboarding_stores()
returns table (id uuid, name text)
language sql stable set search_path = '' as $$
  select s.id, case s.id when '7c2e22fa-a5de-4f80-89e9-e75ff2cd9774' then 'BeApe' else 'Gras' end
  from public.stores s
  where s.organization_id = '7e6693e0-8530-4903-9b3d-0c1c47730d9f'
    and s.id in ('7c2e22fa-a5de-4f80-89e9-e75ff2cd9774', '9e43e1ea-e609-49cd-941e-b1694c917bb2')
    and s.is_active
$$;

create function private.can_set_beape_onboarding_access(p_store uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from private.beape_onboarding_stores() s
    join public.stores st on st.id = s.id
    join public.organizations o on o.id = st.organization_id
    where s.id = p_store and private.member_active(s.id, p_user)
      and private.member_active(s.id, auth.uid())
      and private.can_administer_people(s.id)
      and (
        o.owner_user_id = auth.uid()
        or (
          private.can_manage_member_store_access(s.id, p_user)
          and not private.can_manage_business(s.id, p_user)
        )
      )
  )
$$;

create function public.get_beape_onboarding_permissions(p_user_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'store_id', s.id, 'name', s.name, 'can_open', coalesce(a.can_open, false),
    'can_receive', coalesce(a.can_receive, false)
  ) order by s.name), '[]'::jsonb)
  from private.beape_onboarding_stores() s
  left join private.beape_onboarding_access a on a.store_id = s.id and a.user_id = p_user_id
  where private.can_set_beape_onboarding_access(s.id, p_user_id)
$$;

create function public.save_beape_onboarding_permissions(p_user_id uuid, p_changes jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  change jsonb;
  store uuid;
  next_open boolean;
  next_receive boolean;
  previous_open boolean;
  previous_receive boolean;
begin
  if auth.uid() is null then raise exception 'APP_FORBIDDEN' using errcode = '42501'; end if;
  if p_user_id is null or jsonb_typeof(p_changes) is distinct from 'array' then
    raise exception 'INVALID_ACCESS' using errcode = '22023';
  end if;
  if jsonb_array_length(p_changes) not between 1 and 2
    or (select count(distinct c->>'store_id') from jsonb_array_elements(p_changes) c) <> jsonb_array_length(p_changes) then
    raise exception 'INVALID_ACCESS' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('7e6693e0-8530-4903-9b3d-0c1c47730d9f' || p_user_id::text, 927));
  for change in select value from jsonb_array_elements(p_changes) order by value->>'store_id' loop
    store := (change->>'store_id')::uuid;
    if not private.can_set_beape_onboarding_access(store, p_user_id) then
      raise exception 'APP_FORBIDDEN' using errcode = '42501';
    end if;
    if jsonb_typeof(change->'can_open') is distinct from 'boolean'
      or jsonb_typeof(change->'can_receive') is distinct from 'boolean'
      or jsonb_typeof(change->'previous_open') is distinct from 'boolean'
      or jsonb_typeof(change->'previous_receive') is distinct from 'boolean' then
      raise exception 'INVALID_ACCESS' using errcode = '22023';
    end if;
    next_open := (change->>'can_open')::boolean;
    next_receive := (change->>'can_receive')::boolean;
    select a.can_open, a.can_receive into previous_open, previous_receive
    from private.beape_onboarding_access a where a.store_id = store and a.user_id = p_user_id;
    previous_open := coalesce(previous_open, false);
    previous_receive := coalesce(previous_receive, false);
    if (previous_open, previous_receive) = (next_open, next_receive) then continue; end if;
    if (previous_open, previous_receive) is distinct from (
      (change->>'previous_open')::boolean, (change->>'previous_receive')::boolean
    ) then raise exception 'REVISION_CONFLICT' using errcode = '40001'; end if;
    if next_open or next_receive then
      insert into private.beape_onboarding_access (store_id, user_id, can_open, can_receive)
      values (store, p_user_id, next_open, next_receive)
      on conflict (store_id, user_id) do update
      set can_open = excluded.can_open, can_receive = excluded.can_receive;
    else
      delete from private.beape_onboarding_access a where a.store_id = store and a.user_id = p_user_id;
    end if;
    insert into public.audit_logs (organization_id, store_id, user_id, entity_type, entity_id, action, old_value, new_value)
    select s.organization_id, s.id, auth.uid(), 'partner', p_user_id::text, 'ONBOARDING_ACCESS_UPDATED',
      jsonb_build_object('can_open', previous_open, 'can_receive', previous_receive),
      jsonb_build_object('can_open', next_open, 'can_receive', next_receive)
    from public.stores s where s.id = store;
  end loop;
  return public.get_beape_onboarding_permissions(p_user_id);
end
$$;

create function public.get_beape_onboarding_access()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'open_stores', coalesce(jsonb_agg(s.name order by s.name) filter (where a.can_open and m.access_mode = 'EDIT'), '[]'::jsonb),
    'receive_stores', coalesce(jsonb_agg(s.name order by s.name) filter (where a.can_receive), '[]'::jsonb),
    'is_owner', coalesce(bool_or(o.owner_user_id = auth.uid()), false)
  )
  from private.beape_onboarding_stores() s
  join public.store_memberships m on m.store_id = s.id and m.user_id = auth.uid()
  join public.organizations o on o.id = m.organization_id
  left join private.beape_onboarding_access a on a.store_id = s.id and a.user_id = auth.uid()
  where private.member_active(s.id, auth.uid())
$$;

revoke all on function private.beape_onboarding_stores(), private.can_set_beape_onboarding_access(uuid, uuid)
from public, anon, authenticated;

revoke all on function public.get_beape_onboarding_permissions(uuid),
  public.save_beape_onboarding_permissions(uuid, jsonb), public.get_beape_onboarding_access()
from public, anon, authenticated;
grant execute on function public.get_beape_onboarding_permissions(uuid),
  public.save_beape_onboarding_permissions(uuid, jsonb), public.get_beape_onboarding_access()
to authenticated;
