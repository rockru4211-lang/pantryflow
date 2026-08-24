-- Production-applied immutable snapshot
-- Project: tkedzwlzknetmhpsmths
-- Version: 20260822154229
-- Name: store_staff_pin_identity
-- DO NOT apply to production; retained for blank-environment reconstruction only.

-- P0 vertical slice: store-scoped staff identity and secure PIN authentication.
-- This migration deliberately migrates no legacy count sessions or receipt batches.

create schema if not exists private;

create table public.stores (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  store_code text not null,
  name text not null,
  staff_login_mode text not null default 'NAME_OR_NICKNAME'
    check (staff_login_mode in ('NAME_OR_NICKNAME', 'EMPLOYEE_NUMBER')),
  is_pilot_store boolean not null default false,
  is_active boolean not null default true,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stores_code_format check (store_code ~ '^[A-Za-z0-9][A-Za-z0-9_-]{1,31}$'),
  unique (organization_id, store_code),
  unique (id, organization_id)
);

create unique index stores_one_pilot_per_organization_idx
  on public.stores (organization_id) where is_pilot_store;

create table public.staff_identities (
  user_id uuid primary key references public.profiles(id),
  organization_id uuid not null references public.organizations(id),
  display_name text not null,
  nickname text,
  job_title text,
  employee_number text,
  is_active boolean not null default true,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  disabled_at timestamptz,
  disabled_by uuid references public.profiles(id),
  unique (user_id, organization_id),
  constraint staff_display_name_present check (btrim(display_name) <> ''),
  constraint staff_employee_number_format check (
    employee_number is null or employee_number ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$'
  )
);

create table public.store_memberships (
  store_id uuid not null,
  organization_id uuid not null,
  user_id uuid not null,
  login_identifier text not null,
  role public.app_role not null default 'STAFF',
  is_active boolean not null default true,
  assigned_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (store_id, user_id),
  foreign key (store_id, organization_id) references public.stores(id, organization_id),
  foreign key (user_id, organization_id) references public.staff_identities(user_id, organization_id),
  foreign key (organization_id, user_id)
    references public.organization_members(organization_id, user_id),
  constraint store_membership_login_identifier_present check (btrim(login_identifier) <> '')
);

-- Existing ADMIN/SUPERVISOR accounts remain management identities. This does not
-- carry forward any legacy operational session or OCR data.
insert into public.staff_identities (
  user_id, organization_id, display_name, job_title, is_active, created_by
)
select om.user_id, om.organization_id,
  coalesce(nullif(btrim(p.display_name), ''), '管理者'),
  case when om.role = 'ADMIN' then 'ADMIN' else '店長' end,
  om.is_active, om.user_id
from public.organization_members om
join public.profiles p on p.id = om.user_id
where om.role in ('ADMIN', 'SUPERVISOR')
on conflict (user_id) do nothing;

create unique index staff_login_identifier_per_store_idx
  on public.store_memberships (store_id, lower(login_identifier));

create table private.staff_pin_credentials (
  user_id uuid primary key references auth.users(id),
  pin_hash text not null,
  failed_attempts smallint not null default 0 check (failed_attempts between 0 and 5),
  locked_until timestamptz,
  pin_changed_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table private.staff_login_attempts (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id),
  store_id uuid references public.stores(id),
  identifier_hash text not null,
  was_successful boolean not null,
  outcome text not null check (outcome in ('OK', 'INVALID', 'LOCKED', 'INACTIVE')),
  attempted_at timestamptz not null default now()
);

create index staff_login_attempts_user_time_idx
  on private.staff_login_attempts(user_id, attempted_at desc);

create or replace function private.prevent_staff_security_history_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'staff security history is append-only';
end;
$$;

create trigger immutable_staff_login_attempts
before update or delete on private.staff_login_attempts
for each row execute function private.prevent_staff_security_history_mutation();

create or replace function public.set_staff_pin(p_user_id uuid, p_pin text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_pin !~ '^[0-9]{6}$' then
    raise exception using errcode = '22023', message = 'PIN_MUST_BE_SIX_DIGITS';
  end if;

  if not exists (
    select 1 from public.staff_identities si
    where si.user_id = p_user_id and si.is_active
  ) then
    raise exception using errcode = '22023', message = 'ACTIVE_STAFF_REQUIRED';
  end if;

  insert into private.staff_pin_credentials(user_id, pin_hash)
  values (p_user_id, extensions.crypt(p_pin, extensions.gen_salt('bf', 12)))
  on conflict (user_id) do update set
    pin_hash = excluded.pin_hash,
    failed_attempts = 0,
    locked_until = null,
    pin_changed_at = now(),
    updated_at = now();
end;
$$;

create or replace function public.verify_staff_pin(
  p_store_code text,
  p_identifier text,
  p_pin text
)
returns table (
  outcome text,
  user_id uuid,
  auth_email text,
  organization_id uuid,
  store_id uuid,
  role public.app_role,
  locked_until timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store public.stores%rowtype;
  v_staff public.staff_identities%rowtype;
  v_membership public.store_memberships%rowtype;
  v_credential private.staff_pin_credentials%rowtype;
  v_email text;
  v_identifier_hash text := encode(extensions.digest(lower(btrim(coalesce(p_identifier, ''))), 'sha256'), 'hex');
begin
  select * into v_store
  from public.stores s
  where lower(s.store_code) = lower(btrim(p_store_code)) and s.is_active
  limit 1;

  if v_store.id is null then
    insert into private.staff_login_attempts(identifier_hash, was_successful, outcome)
    values (v_identifier_hash, false, 'INVALID');
    return query select 'INVALID'::text, null::uuid, null::text, null::uuid, null::uuid, null::public.app_role, null::timestamptz;
    return;
  end if;

  select sm.* into v_membership
  from public.store_memberships sm
  where sm.store_id = v_store.id and lower(sm.login_identifier) = lower(btrim(p_identifier))
  limit 1;

  if v_membership.user_id is not null then
    select si.* into v_staff
    from public.staff_identities si
    where si.user_id = v_membership.user_id and si.organization_id = v_membership.organization_id;
  end if;

  if v_staff.user_id is null or not v_staff.is_active or not v_membership.is_active then
    insert into private.staff_login_attempts(user_id, store_id, identifier_hash, was_successful, outcome)
    values (v_staff.user_id, v_store.id, v_identifier_hash, false,
      case when v_staff.user_id is null then 'INVALID' else 'INACTIVE' end);
    return query select 'INVALID'::text, null::uuid, null::text, null::uuid, v_store.id, null::public.app_role, null::timestamptz;
    return;
  end if;

  select * into v_credential
  from private.staff_pin_credentials c
  where c.user_id = v_staff.user_id
  for update;

  if v_credential.user_id is null then
    insert into private.staff_login_attempts(user_id, store_id, identifier_hash, was_successful, outcome)
    values (v_staff.user_id, v_store.id, v_identifier_hash, false, 'INVALID');
    return query select 'INVALID'::text, null::uuid, null::text, v_store.organization_id, v_store.id, null::public.app_role, null::timestamptz;
    return;
  end if;

  if v_credential.locked_until is not null and v_credential.locked_until > now() then
    insert into private.staff_login_attempts(user_id, store_id, identifier_hash, was_successful, outcome)
    values (v_staff.user_id, v_store.id, v_identifier_hash, false, 'LOCKED');
    return query select 'LOCKED'::text, null::uuid, null::text, v_store.organization_id, v_store.id, v_membership.role, v_credential.locked_until;
    return;
  end if;

  if extensions.crypt(p_pin, v_credential.pin_hash) <> v_credential.pin_hash then
    update private.staff_pin_credentials c set
      failed_attempts = least(5, c.failed_attempts + 1),
      locked_until = case when c.failed_attempts + 1 >= 5 then now() + interval '15 minutes' else null end,
      updated_at = now()
    where c.user_id = v_staff.user_id
    returning c.locked_until into v_credential.locked_until;

    insert into private.staff_login_attempts(user_id, store_id, identifier_hash, was_successful, outcome)
    values (v_staff.user_id, v_store.id, v_identifier_hash, false,
      case when v_credential.locked_until is null then 'INVALID' else 'LOCKED' end);
    return query select
      case when v_credential.locked_until is null then 'INVALID' else 'LOCKED' end,
      null::uuid, null::text, v_store.organization_id, v_store.id, v_membership.role, v_credential.locked_until;
    return;
  end if;

  update private.staff_pin_credentials c
  set failed_attempts = 0, locked_until = null, updated_at = now()
  where c.user_id = v_staff.user_id;

  select u.email into v_email from auth.users u where u.id = v_staff.user_id;
  insert into private.staff_login_attempts(user_id, store_id, identifier_hash, was_successful, outcome)
  values (v_staff.user_id, v_store.id, v_identifier_hash, true, 'OK');

  return query select 'OK'::text, v_staff.user_id, v_email, v_store.organization_id,
    v_store.id, v_membership.role, null::timestamptz;
end;
$$;

revoke all on schema private from public, anon, authenticated;
revoke all on all tables in schema private from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
revoke all on function public.set_staff_pin(uuid, text) from public, anon, authenticated;
revoke all on function public.verify_staff_pin(text, text, text) from public, anon, authenticated;
grant execute on function public.set_staff_pin(uuid, text) to service_role;
grant execute on function public.verify_staff_pin(text, text, text) to service_role;

alter table public.stores enable row level security;
alter table public.staff_identities enable row level security;
alter table public.store_memberships enable row level security;

create policy stores_member_select on public.stores for select to authenticated
using (
  organization_id = public.current_organization_id()
  and exists (
    select 1 from public.store_memberships sm
    where sm.store_id = id and sm.user_id = (select auth.uid()) and sm.is_active
  )
);

create policy staff_identities_self_or_supervisor_select on public.staff_identities for select to authenticated
using (
  user_id = (select auth.uid())
  or (organization_id = public.current_organization_id() and public.can_supervise())
);

create policy store_memberships_self_or_supervisor_select on public.store_memberships for select to authenticated
using (
  user_id = (select auth.uid())
  or (organization_id = public.current_organization_id() and public.can_supervise())
);

grant select on public.stores, public.staff_identities, public.store_memberships to authenticated;
revoke insert, update, delete on public.stores, public.staff_identities, public.store_memberships from anon, authenticated;

comment on table public.stores is 'Formal organization stores. No legacy free-text profile.store data is migrated.';
comment on table public.staff_identities is 'Supervisor-provisioned unique staff identities backed by individual auth.users.';
comment on table public.store_memberships is 'Store-scoped roles. Historical rows are disabled, never deleted.';
comment on table private.staff_pin_credentials is 'Bcrypt PIN hashes and lock state; never exposed through the Data API.';
comment on table private.staff_login_attempts is 'Append-only audit of staff PIN authentication attempts.';

notify pgrst, 'reload schema';

