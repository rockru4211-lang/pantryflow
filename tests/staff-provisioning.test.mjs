import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BCRYPT_MAX_PASSWORD_BYTES,
  createInternalAuthPassword,
  provisionStaffIdentity,
} from '../supabase/functions/_shared/staff-provisioning.js';

test('internal Auth passwords are cryptographically random ASCII and always below bcrypt limit', () => {
  const passwords = new Set();
  for (let index = 0; index < 256; index += 1) {
    const password = createInternalAuthPassword();
    const bytes = new TextEncoder().encode(password);
    assert(bytes.length > 32 && bytes.length < BCRYPT_MAX_PASSWORD_BYTES);
    assert.match(password, /^[A-Za-z0-9_-]+$/u);
    passwords.add(password);
  }
  assert.equal(passwords.size, 256);
});

function operationHarness(failAt = '') {
  const calls = [];
  let capturedPasswordLength = 0;
  const step = name => async () => {
    calls.push(name);
    if (name === failAt) throw new Error(`${name.toUpperCase()}_FAILED`);
  };
  return {
    calls,
    get capturedPasswordLength() { return capturedPasswordLength; },
    operations: {
      randomUUID: () => '11111111-1111-4111-8111-111111111111',
      crypto,
      createAuthUser: async payload => {
        calls.push('auth');
        capturedPasswordLength = new TextEncoder().encode(payload.password).length;
        if (failAt === 'auth') return { error: new Error('AUTH_FAILED') };
        return { error: null };
      },
      updateProfile: step('profile'),
      insertOrganizationMember: step('organization'),
      insertStaffIdentity: step('identity'),
      insertStoreMembership: step('membership'),
      setPin: step('pin'),
      insertAuditSuccess: step('audit'),
      deletePin: async () => { calls.push('pin-rollback'); return { error: null }; },
      deleteAuthUser: async () => { calls.push('rollback'); return { error: null }; },
    },
  };
}

const input = {
  displayName: '測試員工',
  organizationId: '22222222-2222-4222-8222-222222222222',
  storeId: '33333333-3333-4333-8333-333333333333',
  role: 'STAFF',
  pin: '123456',
};

test('successful provisioning creates every required identity component without returning a password', async () => {
  const harness = operationHarness();
  const result = await provisionStaffIdentity(harness.operations, input);
  assert.deepEqual(harness.calls, ['auth', 'profile', 'organization', 'identity', 'membership', 'pin', 'audit']);
  assert(harness.capturedPasswordLength < BCRYPT_MAX_PASSWORD_BYTES);
  assert.deepEqual(result, {
    staffId: '11111111-1111-4111-8111-111111111111',
    storeId: input.storeId,
    role: 'STAFF',
  });
  assert.equal('password' in result, false);
});

for (const role of ['STAFF', 'SUPERVISOR', 'ADMIN']) {
  test(`successful provisioning preserves the legal ${role} role`, async () => {
    const harness = operationHarness();
    const result = await provisionStaffIdentity(harness.operations, { ...input, role });
    assert.equal(result.role, role);
    assert.deepEqual(harness.calls, ['auth', 'profile', 'organization', 'identity', 'membership', 'pin', 'audit']);
  });
}

for (const failingStep of ['profile', 'organization', 'identity', 'membership', 'audit', 'pin']) {
  test(`provisioning rollback removes the new Auth user when ${failingStep} fails`, async () => {
    const harness = operationHarness(failingStep);
    await assert.rejects(() => provisionStaffIdentity(harness.operations, input), new RegExp(`${failingStep.toUpperCase()}_FAILED`));
    assert.equal(harness.calls.at(-1), 'rollback');
    assert.equal(harness.calls.filter(call => call === 'rollback').length, 1);
    assert.equal(harness.calls.includes('pin-rollback'), failingStep === 'audit');
  });
}
