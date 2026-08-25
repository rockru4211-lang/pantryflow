\set ON_ERROR_STOP on

do $$
declare
  v_plaintext_pin_count bigint;
  v_cross_store_membership_count bigint;
begin
  select count(*) into v_plaintext_pin_count
  from private.staff_pin_credentials
  where pin_hash ~ '^[0-9]{6}$';
  if v_plaintext_pin_count <> 0 then
    raise exception 'PLAINTEXT_PIN_DETECTED';
  end if;

  select count(*) into v_cross_store_membership_count
  from public.store_memberships sm
  join public.stores s on s.id = sm.store_id
  where sm.organization_id <> s.organization_id;
  if v_cross_store_membership_count <> 0 then
    raise exception 'CROSS_ORGANIZATION_STORE_MEMBERSHIP_DETECTED';
  end if;

  if (select count(*) from public.organizations) < 3 then
    raise exception 'E2E_ORGANIZATIONS_MISSING';
  end if;
  if (select count(*) from public.stores) < 3 then
    raise exception 'E2E_STORES_MISSING';
  end if;
  if (select count(*) from public.store_memberships where role = 'STAFF') < 2 then
    raise exception 'E2E_STAFF_MEMBERSHIPS_MISSING';
  end if;
  if (select count(*) from public.store_memberships where role = 'SUPERVISOR') < 2 then
    raise exception 'E2E_SUPERVISOR_MEMBERSHIPS_MISSING';
  end if;
  if (select count(*) from private.staff_login_attempts where was_successful) < 2 then
    raise exception 'E2E_PIN_LOGIN_SUCCESS_MISSING';
  end if;
  if (select count(*) from private.staff_login_attempts where outcome = 'LOCKED') < 1 then
    raise exception 'E2E_PIN_LOCK_EVENT_MISSING';
  end if;
  if (select count(*) from public.stores where is_pilot_store) <> 2 then
    raise exception 'FIRST_STORE_PILOT_INVARIANT_FAILED';
  end if;
  if (select count(*) from public.stores where not is_pilot_store) < 1 then
    raise exception 'SECOND_STORE_NON_PILOT_INVARIANT_FAILED';
  end if;
  if (select count(*) from public.audit_logs where action = 'OWNER_BUSINESS_CREATED') < 2 then
    raise exception 'OWNER_AUDIT_LOG_MISSING';
  end if;
  if (select count(*) from public.audit_logs where action = 'STAFF_PROVISION_ATTEMPT') < 4 then
    raise exception 'STAFF_AUDIT_LOG_MISSING';
  end if;
end
$$;

select json_build_object(
  'status', 'PASS',
  'organizations', (select count(*) from public.organizations),
  'stores', (select count(*) from public.stores),
  'staff_memberships', (select count(*) from public.store_memberships where role = 'STAFF'),
  'supervisor_memberships', (select count(*) from public.store_memberships where role = 'SUPERVISOR'),
  'pin_credentials', (select count(*) from private.staff_pin_credentials),
  'pin_login_successes', (select count(*) from private.staff_login_attempts where was_successful),
  'pin_lock_events', (select count(*) from private.staff_login_attempts where outcome = 'LOCKED'),
  'plaintext_pin_rows', (select count(*) from private.staff_pin_credentials where pin_hash ~ '^[0-9]{6}$'),
  'cross_organization_memberships', 0
) as local_e2e_database_verification;
