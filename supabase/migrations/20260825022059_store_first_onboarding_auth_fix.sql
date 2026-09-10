-- STORE-FIRST-ONBOARDING-FIX-20260824
--
-- Forward-only source for a future reviewed deployment. This file is created
-- locally only; it must not be applied to production without explicit approval.
-- It deliberately keeps the deployed create_owner_business signature.

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
  v_profile public.profiles%rowtype;
  v_org_name text := nullif(btrim(p_organization_name), '');
  v_store_name text := nullif(btrim(p_store_name), '');
  v_store_code text := upper(btrim(coalesce(p_store_code, '')));
  v_org_id uuid;
  v_store_id uuid;
  v_existing_org_id uuid;
  v_existing_store_id uuid;
  v_display_name text;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'OWNER_AUTH_REQUIRED';
  end if;

  -- The authorization boundary is the verified Auth identity plus canonical
  -- profile/membership rows. Auth metadata is intentionally never consulted.
  if not exists (
    select 1
    from auth.users u
    where u.id = v_user_id
      and u.email_confirmed_at is not null
  ) then
    raise exception using errcode = '28000', message = 'OWNER_EMAIL_NOT_VERIFIED';
  end if;

  select p.*
  into v_profile
  from public.profiles p
  where p.id = v_user_id
  for update;

  if v_profile.id is null then
    raise exception using errcode = '23503', message = 'OWNER_PROFILE_MISSING';
  end if;

  -- A transaction-scoped, user-specific lock makes double clicks and retries
  -- serialize before any merchant data is created.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text, 20260824)
  );

  -- Idempotent replay: if this user already owns an active organization and
  -- its first store, return those canonical identifiers without inserting.
  select o.id
  into v_existing_org_id
  from public.organizations o
  join public.organization_members om
    on om.organization_id = o.id
   and om.user_id = v_user_id
   and om.is_active
   and om.is_owner
  where o.owner_user_id = v_user_id
  order by o.created_at
  limit 1;

  if v_existing_org_id is not null then
    select s.id
    into v_existing_store_id
    from public.stores s
    where s.organization_id = v_existing_org_id
      and s.is_active
    order by s.is_pilot_store desc, s.created_at, s.id
    limit 1;

    if v_existing_store_id is not null then
      return jsonb_build_object(
        'organization_id', v_existing_org_id,
        'store_id', v_existing_store_id,
        'reused', true
      );
    end if;
  end if;

  if exists (
    select 1
    from public.organization_members om
    where om.user_id = v_user_id
      and om.is_active
  ) then
    raise exception using errcode = '23505', message = 'OWNER_ALREADY_ONBOARDED';
  end if;

  if v_org_name is null or v_store_name is null then
    raise exception using errcode = '22023', message = 'OWNER_BUSINESS_NAME_REQUIRED';
  end if;
  if p_business_type not in ('SINGLE_RESTAURANT', 'CHAIN_RESTAURANT') then
    raise exception using errcode = '22023', message = 'OWNER_BUSINESS_TYPE_INVALID';
  end if;
  if v_store_code !~ '^[A-Z0-9][A-Z0-9_-]{1,31}$' then
    raise exception using errcode = '22023', message = 'OWNER_STORE_CODE_INVALID';
  end if;
  if p_staff_login_mode not in ('NAME_OR_NICKNAME', 'EMPLOYEE_NUMBER') then
    raise exception using errcode = '22023', message = 'OWNER_LOGIN_MODE_INVALID';
  end if;

  v_display_name := coalesce(nullif(btrim(v_profile.display_name), ''), '管理者');

  insert into public.organizations(name, business_type, owner_user_id)
  values (v_org_name, p_business_type, v_user_id)
  returning id into v_org_id;

  update public.profiles
  set organization_id = v_org_id,
      display_name = v_display_name,
      role = 'ADMIN',
      store = v_store_name,
      updated_at = now()
  where id = v_user_id;

  insert into public.organization_members(
    organization_id, user_id, role, is_active, is_owner
  ) values (
    v_org_id, v_user_id, 'ADMIN', true, true
  );

  insert into public.staff_identities(
    user_id, organization_id, display_name, job_title, created_by
  ) values (
    v_user_id, v_org_id, v_display_name, 'Owner', v_user_id
  );

  insert into public.stores(
    organization_id, store_code, name, staff_login_mode,
    is_pilot_store, created_by
  ) values (
    v_org_id, v_store_code, v_store_name, p_staff_login_mode,
    true, v_user_id
  ) returning id into v_store_id;

  insert into public.store_memberships(
    store_id, organization_id, user_id, login_identifier, role, assigned_by
  ) values (
    v_store_id, v_org_id, v_user_id, 'owner-' || v_user_id::text,
    'ADMIN', v_user_id
  );

  insert into public.audit_logs(
    organization_id, entity_type, entity_id, action, new_value, user_id
  ) values (
    v_org_id, 'organization', v_org_id, 'OWNER_BUSINESS_CREATED',
    jsonb_build_object(
      'business_type', p_business_type,
      'first_store_id', v_store_id,
      'staff_login_mode', p_staff_login_mode
    ),
    v_user_id
  );

  return jsonb_build_object(
    'organization_id', v_org_id,
    'store_id', v_store_id,
    'reused', false
  );
end;
$$;

revoke all on function public.create_owner_business(text, text, text, text, text)
  from public, anon;
grant execute on function public.create_owner_business(text, text, text, text, text)
  to authenticated;

comment on function public.create_owner_business(text, text, text, text, text) is
  'Idempotent, email-verified store-first onboarding based only on canonical profile and membership rows.';

-- Compensation hook used only by the service-role manage-staff function when
-- an Auth-backed staff provision fails after the PIN hash was created. It is
-- intentionally unavailable to browser roles and never returns the hash.
create or replace function public.delete_staff_pin_for_provisioning(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from private.staff_pin_credentials where user_id = p_user_id;
end;
$$;

revoke all on function public.delete_staff_pin_for_provisioning(uuid)
  from public, anon, authenticated;
grant execute on function public.delete_staff_pin_for_provisioning(uuid)
  to service_role;

comment on function public.delete_staff_pin_for_provisioning(uuid) is
  'Service-role-only compensation for an incomplete staff provisioning transaction.';

notify pgrst, 'reload schema';
