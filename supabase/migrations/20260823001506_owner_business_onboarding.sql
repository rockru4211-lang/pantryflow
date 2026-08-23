-- Atomic, email-verified Owner onboarding for the closed Pilot.
-- Employee accounts remain supervisor-provisioned and cannot call this flow.

alter table public.organizations
  add column if not exists business_type text,
  add column if not exists owner_user_id uuid references auth.users(id);

alter table public.organizations
  drop constraint if exists organizations_business_type_check;
alter table public.organizations
  add constraint organizations_business_type_check
  check (business_type is null or business_type in ('SINGLE_RESTAURANT', 'CHAIN_RESTAURANT'));

alter table public.organization_members
  add column if not exists is_owner boolean not null default false;

create unique index if not exists organizations_one_owner_user_idx
  on public.organizations(owner_user_id)
  where owner_user_id is not null;

create or replace function public.create_owner_business(
  p_organization_name text,
  p_business_type text,
  p_store_name text,
  p_store_code text,
  p_staff_login_mode text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_user auth.users%rowtype;
  v_org_name text := nullif(btrim(p_organization_name), '');
  v_store_name text := nullif(btrim(p_store_name), '');
  v_store_code text := btrim(p_store_code);
  v_org_id uuid;
  v_store_id uuid;
begin
  if v_user_id is null then raise exception using errcode = '28000', message = 'OWNER_AUTH_REQUIRED'; end if;

  select * into v_user from auth.users where id = v_user_id;
  if v_user.email_confirmed_at is null then
    raise exception using errcode = '28000', message = 'OWNER_EMAIL_NOT_VERIFIED';
  end if;
  if coalesce(v_user.raw_user_meta_data ->> 'account_type', '') <> 'OWNER_REGISTRATION' then
    raise exception using errcode = '42501', message = 'OWNER_REGISTRATION_REQUIRED';
  end if;
  if exists (select 1 from public.organization_members where user_id = v_user_id and is_active) then
    raise exception using errcode = '23505', message = 'OWNER_ALREADY_ONBOARDED';
  end if;
  if v_org_name is null or v_store_name is null then
    raise exception using errcode = '22023', message = 'OWNER_BUSINESS_NAME_REQUIRED';
  end if;
  if p_business_type not in ('SINGLE_RESTAURANT', 'CHAIN_RESTAURANT') then
    raise exception using errcode = '22023', message = 'OWNER_BUSINESS_TYPE_INVALID';
  end if;
  if v_store_code !~ '^[A-Za-z0-9][A-Za-z0-9_-]{1,31}$' then
    raise exception using errcode = '22023', message = 'OWNER_STORE_CODE_INVALID';
  end if;
  if p_staff_login_mode not in ('NAME_OR_NICKNAME', 'EMPLOYEE_NUMBER') then
    raise exception using errcode = '22023', message = 'OWNER_LOGIN_MODE_INVALID';
  end if;

  insert into public.organizations(name, business_type, owner_user_id)
  values (v_org_name, p_business_type, v_user_id)
  returning id into v_org_id;

  update public.profiles set
    organization_id = v_org_id,
    display_name = coalesce(nullif(btrim(v_user.raw_user_meta_data ->> 'display_name'), ''), split_part(v_user.email, '@', 1)),
    role = 'ADMIN', store = v_store_name, updated_at = now()
  where id = v_user_id;
  if not found then raise exception using errcode = '23503', message = 'OWNER_PROFILE_MISSING'; end if;

  insert into public.organization_members(organization_id, user_id, role, is_active, is_owner)
  values (v_org_id, v_user_id, 'ADMIN', true, true);

  insert into public.staff_identities(user_id, organization_id, display_name, job_title, created_by)
  values (
    v_user_id, v_org_id,
    coalesce(nullif(btrim(v_user.raw_user_meta_data ->> 'display_name'), ''), split_part(v_user.email, '@', 1)),
    'Owner', v_user_id
  );

  insert into public.stores(organization_id, store_code, name, staff_login_mode, is_pilot_store, created_by)
  values (v_org_id, v_store_code, v_store_name, p_staff_login_mode, true, v_user_id)
  returning id into v_store_id;

  insert into public.store_memberships(store_id, organization_id, user_id, login_identifier, role, assigned_by)
  values (v_store_id, v_org_id, v_user_id, 'owner-' || v_user_id::text, 'ADMIN', v_user_id);

  insert into public.audit_logs(organization_id, entity_type, entity_id, action, new_value, user_id)
  values (
    v_org_id, 'organization', v_org_id, 'OWNER_BUSINESS_CREATED',
    jsonb_build_object('business_type', p_business_type, 'first_store_id', v_store_id, 'staff_login_mode', p_staff_login_mode),
    v_user_id
  );

  return jsonb_build_object('organization_id', v_org_id, 'store_id', v_store_id);
end;
$$;

revoke all on function public.create_owner_business(text, text, text, text, text) from public, anon;
grant execute on function public.create_owner_business(text, text, text, text, text) to authenticated;

-- Superseded self-service path could create an ADMIN without Owner/store records.
revoke execute on function public.create_my_organization(text) from authenticated;

comment on column public.organizations.owner_user_id is 'Email-verified creator of the merchant account. Immutable through public APIs.';
comment on column public.organization_members.is_owner is 'True only for the merchant creator; store ADMIN is a separate permission.';
comment on function public.create_owner_business(text, text, text, text, text) is 'Atomic first organization/store onboarding for an email-verified Owner registration.';

notify pgrst, 'reload schema';
