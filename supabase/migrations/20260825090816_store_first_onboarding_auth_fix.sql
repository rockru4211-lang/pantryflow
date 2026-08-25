-- PF-STORE-FIRST-ONBOARDING-AUTH-FIX-20260824
-- Local migration only. Do not apply to production without an approved release.

create schema if not exists private;

create or replace function private.create_owner_business_internal(
  p_organization_name text,
  p_business_type text,
  p_store_name text,
  p_store_code text,
  p_staff_login_mode text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_email_confirmed_at timestamptz;
  v_display_name text;
  v_org_name text := nullif(btrim(p_organization_name), '');
  v_store_name text := nullif(btrim(p_store_name), '');
  v_store_code text := upper(btrim(coalesce(p_store_code, '')));
  v_existing_org public.organizations%rowtype;
  v_existing_member public.organization_members%rowtype;
  v_existing_store public.stores%rowtype;
  v_org_id uuid;
  v_store_id uuid;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'OWNER_AUTH_REQUIRED';
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

  -- Serialize onboarding per authenticated user. A hash collision only causes
  -- harmless additional serialization; it cannot grant access or mix tenants.
  perform pg_advisory_xact_lock(
    hashtextextended('pantryflow-owner:' || v_user_id::text, 0)
  );

  select u.email_confirmed_at
  into v_email_confirmed_at
  from auth.users u
  where u.id = v_user_id;
  if not found then
    raise exception using errcode = '28000', message = 'OWNER_AUTH_REQUIRED';
  end if;
  if v_email_confirmed_at is null then
    raise exception using errcode = '28000', message = 'OWNER_EMAIL_NOT_VERIFIED';
  end if;

  select nullif(btrim(p.display_name), '')
  into v_display_name
  from public.profiles p
  where p.id = v_user_id;
  if not found then
    raise exception using errcode = '23503', message = 'OWNER_PROFILE_MISSING';
  end if;
  if v_display_name is null then
    raise exception using errcode = '22023', message = 'OWNER_PROFILE_DISPLAY_NAME_REQUIRED';
  end if;

  select om, o
  into v_existing_member, v_existing_org
  from public.organization_members om
  join public.organizations o on o.id = om.organization_id
  where om.user_id = v_user_id
    and om.is_active
  order by om.created_at
  limit 1;

  if v_existing_member.user_id is not null then
    if v_existing_member.is_owner
       and v_existing_org.owner_user_id = v_user_id then
      select s.*
      into v_existing_store
      from public.store_memberships sm
      join public.stores s
        on s.id = sm.store_id
       and s.organization_id = sm.organization_id
      where sm.user_id = v_user_id
        and sm.organization_id = v_existing_org.id
        and sm.is_active
        and s.is_active
      order by s.created_at
      limit 1;

      if v_existing_store.id is not null
         and v_existing_org.name = v_org_name
         and v_existing_org.business_type = p_business_type
         and v_existing_store.name = v_store_name
         and lower(v_existing_store.store_code) = lower(v_store_code)
         and v_existing_store.staff_login_mode = p_staff_login_mode then
        return jsonb_build_object(
          'organization_id', v_existing_org.id,
          'store_id', v_existing_store.id,
          'replayed', true
        );
      end if;
    end if;

    raise exception using errcode = '23505', message = 'OWNER_ALREADY_ONBOARDED';
  end if;

  insert into public.organizations(name, business_type, owner_user_id)
  values (v_org_name, p_business_type, v_user_id)
  returning id into v_org_id;

  update public.profiles p
  set organization_id = v_org_id,
      display_name = v_display_name,
      role = 'ADMIN',
      store = v_store_name,
      updated_at = now()
  where p.id = v_user_id;
  if not found then
    raise exception using errcode = '23503', message = 'OWNER_PROFILE_MISSING';
  end if;

  insert into public.organization_members(
    organization_id, user_id, role, is_active, is_owner
  ) values (v_org_id, v_user_id, 'ADMIN', true, true);

  insert into public.staff_identities(
    user_id, organization_id, display_name, job_title, created_by
  ) values (v_user_id, v_org_id, v_display_name, 'Owner', v_user_id);

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
    v_store_id, v_org_id, v_user_id,
    'owner-' || v_user_id::text, 'ADMIN', v_user_id
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
    'replayed', false
  );
end;
$$;

create or replace function public.create_owner_business(
  p_organization_name text,
  p_business_type text,
  p_store_name text,
  p_store_code text,
  p_staff_login_mode text
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.create_owner_business_internal(
    p_organization_name,
    p_business_type,
    p_store_name,
    p_store_code,
    p_staff_login_mode
  )
$$;

revoke all on function private.create_owner_business_internal(text, text, text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.create_owner_business(text, text, text, text, text)
  from public, anon, service_role;
grant execute on function public.create_owner_business(text, text, text, text, text)
  to authenticated;

comment on function private.create_owner_business_internal(text, text, text, text, text)
is 'Store-first Owner onboarding implementation. Authorization uses auth.uid, verified email, profiles, and active memberships only.';
comment on function public.create_owner_business(text, text, text, text, text)
is 'Authenticated compatibility RPC for idempotent store-first Owner onboarding.';

notify pgrst, 'reload schema';
