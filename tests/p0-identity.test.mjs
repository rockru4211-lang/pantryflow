import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(new URL('../supabase/migrations/20260822153719_store_staff_pin_identity.sql', import.meta.url), 'utf8');
const backend = await readFile(new URL('../pilot-backend.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const staffLogin = await readFile(new URL('../supabase/functions/staff-pin-login/index.ts', import.meta.url), 'utf8');
const staffManagement = await readFile(new URL('../supabase/functions/manage-staff/index.ts', import.meta.url), 'utf8');

test('staff PINs are server-hashed and lock after five failures', () => {
  assert.match(migration, /extensions\.crypt\(p_pin, extensions\.gen_salt\('bf', 12\)\)/);
  assert.match(migration, /failed_attempts \+ 1 >= 5/);
  assert.match(migration, /interval '15 minutes'/);
  assert.match(migration, /private\.staff_pin_credentials/);
  assert.match(migration, /revoke all on schema private from public, anon, authenticated/);
});

test('staff login exchanges a verified PIN for an official Supabase Auth session', () => {
  assert.match(staffLogin, /verify_staff_pin/);
  assert.match(staffLogin, /auth\.admin\.generateLink/);
  assert.match(staffLogin, /auth\.verifyOtp/);
  assert.doesNotMatch(staffLogin, /sign|encode.*jwt|localStorage/i);
  assert.match(backend, /auth\.setSession/);
});

test('staff are supervisor-created and public self signup is disabled', () => {
  assert.match(staffManagement, /auth\.admin\.createUser/);
  assert.match(staffManagement, /organization_members/);
  assert.match(staffManagement, /store_memberships/);
  assert.doesNotMatch(html, /id="pilot-signup-form"|id="show-signup"/);
  assert.match(html, /員工帳號由主管建立/);
});

test('cloud configuration failure never activates fallback mode', () => {
  assert.match(backend, /configured \? 'cloud' : 'blocked'/);
  assert.match(backend, /CLOUD_CONFIG_REQUIRED/);
  assert.doesNotMatch(backend, /configured \? 'cloud' : 'fallback'/);
});
