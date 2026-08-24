import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { businessOnboardingPage, firstStoreOnboardingPage } from '../pilot-v1/pages/login.js';
import { addStaffPage, addStorePage, profilePage } from '../pilot-v1/pages/utility.js';
import { normalizeStoreCode } from '../pilot-v1/services/validation.js';

const migration = await readFile(new URL('../supabase/migrations/20260824095042_store_first_onboarding_auth_fix.sql', import.meta.url), 'utf8');
const manage = await readFile(new URL('../supabase/functions/manage-staff/index.ts', import.meta.url), 'utf8');
const pinLogin = await readFile(new URL('../supabase/functions/staff-pin-login/index.ts', import.meta.url), 'utf8');
const provisioning = await readFile(new URL('../supabase/functions/_shared/staff-provisioning.js', import.meta.url), 'utf8');
const app = await readFile(new URL('../pilot-v1/app.js', import.meta.url), 'utf8');
const auth = await readFile(new URL('../pilot-v1/services/auth.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../pilot-v1/design-tokens.css', import.meta.url), 'utf8');

const store = { id: '33333333-3333-4333-8333-333333333333', name: '中山門市', store_code: 'TPE001', role: 'ADMIN' };

test('create_owner_business keeps the deployed signature and uses canonical authorization only', () => {
  assert.match(migration, /create or replace function public\.create_owner_business\(\s*p_organization_name text,\s*p_business_type text,\s*p_store_name text,\s*p_store_code text,\s*p_staff_login_mode text\s*\)/);
  assert.doesNotMatch(migration, /raw_user_meta_data|user_metadata|account_type/i);
  assert.match(migration, /auth\.uid\(\)/);
  assert.match(migration, /email_confirmed_at is not null/);
  assert.match(migration, /from public\.profiles/);
  assert.match(migration, /from public\.organization_members[\s\S]*om\.is_active/);
  assert.match(migration, /v_display_name := coalesce\(nullif\(btrim\(v_profile\.display_name\)/);
});

test('owner onboarding is serialized, atomic in SQL and idempotently returns the existing first store', () => {
  assert.match(migration, /pg_advisory_xact_lock/);
  for (const target of ['public.organizations', 'public.organization_members', 'public.staff_identities', 'public.stores', 'public.store_memberships', 'public.audit_logs']) {
    assert.match(migration, new RegExp(`insert into ${target.replace('.', '\\.')}`));
  }
  assert.match(migration, /'reused', true/);
  assert.match(migration, /'reused', false/);
  assert.match(migration, /is_pilot_store, created_by[\s\S]*true, v_user_id/);
});

test('private PIN tables remain browser-inaccessible and are not given new RLS settings', () => {
  assert.doesNotMatch(migration, /alter table private\.(?:staff_pin_credentials|staff_login_attempts) (?:enable|disable) row level security/i);
  assert.match(migration, /revoke all on function public\.delete_staff_pin_for_provisioning\(uuid\)[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.delete_staff_pin_for_provisioning\(uuid\)[\s\S]*to service_role/);
});

test('store creation normalizes codes and determines the first store on the server', () => {
  assert.equal(normalizeStoreCode('  tp-e_01 '), 'TP-E_01');
  assert.match(manage, /trim\(\)\.toUpperCase\(\)/);
  assert.match(manage, /const isFirstStore = \(storeCount \|\| 0\) === 0/);
  assert.match(manage, /is_pilot_store: isFirstStore/);
  assert.doesNotMatch(manage, /is_pilot_store: Boolean\(body\.isPilotStore\)/);
  assert.match(manage, /STORE_CODE_ALREADY_EXISTS/);
});

test('staff provisioning accepts only store-scoped identifier, legal roles and six-digit PIN', () => {
  assert.match(manage, /loginIdentifier = String\(body\.loginIdentifier/);
  assert.match(manage, /\["ADMIN", "SUPERVISOR", "STAFF"\]/);
  assert.match(manage, /\.eq\("user_id", callerId\)[\s\S]*\.in\("role", \["ADMIN", "SUPERVISOR"\]\)/);
  assert.match(manage, /STORE_MEMBERSHIP_REQUIRED/);
  assert.match(manage, /\.eq\("store_id", storeId\)\.ilike\("login_identifier", loginIdentifier\)/);
  assert.doesNotMatch(manage, /duplicateEmployee|employeeNumberPattern/);
  assert.match(auth, /storeId: input\.storeId/);
  assert.match(auth, /loginIdentifier: String\(input\.loginIdentifier/);
  assert.match(app, /form\.get\('pin'\)!==form\.get\('confirmPin'\)/);
});

test('staff Auth password and compensating rollback never expose secrets', () => {
  assert.match(provisioning, /INTERNAL_PASSWORD_BYTES = 32/);
  assert.match(provisioning, /new TextEncoder\(\)\.encode\(password\)\.length >= BCRYPT_MAX_PASSWORD_BYTES/);
  assert.match(provisioning, /await operations\.deletePin\(userId\)/);
  assert.match(provisioning, /await operations\.deleteAuthUser\(userId\)/);
  assert.doesNotMatch(provisioning, /user_metadata|account_type/);
  assert.doesNotMatch(`${manage}\n${pinLogin}`, /console\.(?:log|warn|error)[^\n]*(?:password|service.role|access_token|refresh_token)/i);
});

test('PIN login keeps public errors generic and server diagnostics correlated', () => {
  for (const reason of ['STORE_CODE_NOT_FOUND', 'STAFF_IDENTIFIER_NOT_FOUND', 'INVALID_PIN', 'INACTIVE_MEMBERSHIP', 'INACTIVE_STORE']) {
    assert.match(pinLogin, new RegExp(reason));
  }
  assert.match(pinLogin, /INVALID_STAFF_CREDENTIALS/);
  assert.match(pinLogin, /correlationId/);
  assert.doesNotMatch(pinLogin, /console\.(?:log|warn|error)[^\n]*\bpin\b/i);
});

test('no organization, no store and existing store render mutually exclusive states', () => {
  const noOrganization = businessOnboardingPage({ step: 1 });
  const noStore = firstStoreOnboardingPage({ organizationName: '日常餐飲' });
  const existing = profilePage({ organizationName: '日常餐飲', stores: [store], currentStore: store, staff: [], currentUserId: 'owner' });
  assert.match(noOrganization, /data-onboarding-state="no-organization"/);
  assert.doesNotMatch(noOrganization, /create-staff|門市成員/);
  assert.match(noStore, /data-onboarding-state="no-store"/);
  assert.doesNotMatch(noStore, /create-staff|門市成員/);
  assert.match(existing, /data-onboarding-state="has-store"/);
  assert.match(existing, /目前門市/);
  assert.match(existing, /門市成員/);
  assert.match(existing, /新增店長／員工/);
  assert.doesNotMatch(existing, /id="create-store"|id="create-staff"/);
});

test('store and staff forms are separate secondary pages with a working back control', () => {
  const addStore = addStorePage({ organizationName: '日常餐飲' });
  const addStaff = addStaffPage({ organizationName: '日常餐飲', store });
  for (const html of [addStore, addStaff]) assert.match(html, /data-back/);
  assert.match(addStore, /id="create-store"/);
  assert.doesNotMatch(addStore, /id="create-staff"/);
  assert.match(addStaff, /id="create-staff"/);
  assert.doesNotMatch(addStaff, /id="create-store"/);
  for (const label of ['所屬商家', '所屬門市', '門市代碼', '姓名', '員工編號或登入暱稱', '確認 PIN']) assert.match(addStaff, new RegExp(label));
});

test('forms prevent double submit, refresh canonical data and never hard-code merchant names', () => {
  assert.match(app, /button\.disabled=true/);
  assert.match(app, /state\.stores=await stores\(state\.profile\.id\)/);
  assert.match(app, /state\.stores\.find\(store=>store\.id===result\.store\?\.id\)/);
  assert.match(app, /staffForm\.reset\(\)/);
  assert.doesNotMatch(`${app}\n${auth}`, /BeApe/);
});

test('UI uses a white canvas and locked role-home colors', () => {
  assert.match(css, /--canvas:#fff/);
  assert.match(css, /body\{min-height:100vh;margin:0;background:#fff\}/);
  assert.match(css, /\.role-employee\{--role-accent:#25834f/);
  assert.match(css, /\.role-manager\{--role-accent:#d66e22/);
});
