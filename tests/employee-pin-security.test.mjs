import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const manage = await readFile(new URL('../supabase/functions/manage-staff/index.ts', import.meta.url), 'utf8');
const provisioning = await readFile(new URL('../supabase/functions/_shared/staff-provisioning.js', import.meta.url), 'utf8');
const pinLogin = await readFile(new URL('../supabase/baseline/edge-functions/staff-pin-login/source/staff-pin-login/index.ts', import.meta.url), 'utf8');
const pinSchema = await readFile(new URL('../supabase/baseline/production-applied/20260822154229_store_staff_pin_identity.sql', import.meta.url), 'utf8');

test('manage-staff keeps six-digit PINs and returns distinct client errors', () => {
  assert.ok(manage.includes('const pinPattern = /^\\d{6}$/;'));
  for (const [code, status] of [
    ['INVALID_STAFF_INPUT', 400],
    ['ROLE_NOT_ALLOWED', 403],
    ['STORE_NOT_FOUND', 404],
    ['STAFF_ALREADY_EXISTS', 409],
  ]) {
    assert.match(manage, new RegExp(`error: "${code}"[\\s\\S]{0,200}${status}`));
  }
});

test('provisioning never returns or logs the internal Auth password', () => {
  assert.match(provisioning, /INTERNAL_PASSWORD_BYTES = 32/);
  assert.match(provisioning, /return \{ staffId: userId, storeId: input\.storeId, role: input\.role \}/);
  assert.doesNotMatch(manage, /console\.(?:log|error)[^\n]*password/i);
  assert.doesNotMatch(manage, /jsonResponse\([^\n]*password/i);
});

test('production PIN contract preserves rejection, lockout and rate-limit state', () => {
  assert.match(pinLogin, /body\.storeCode/);
  assert.match(pinLogin, /body\.identifier/);
  assert.match(pinLogin, /body\.pin/);
  assert.match(pinLogin, /INVALID_STAFF_CREDENTIALS/);
  assert.match(pinLogin, /PIN_LOCKED/);
  assert.match(pinLogin, /verify_staff_pin/);
  assert.match(pinSchema, /failed_attempts between 0 and 5/);
  assert.match(pinSchema, /failed_attempts \+ 1 >= 5 then now\(\) \+ interval '15 minutes'/);
  assert.match(pinSchema, /outcome in \('OK', 'INVALID', 'LOCKED', 'INACTIVE'\)/);
});
