import assert from 'node:assert/strict';
import test from 'node:test';
import { createInternalAuthPassword, provisionStaffIdentity } from '../supabase/functions/_shared/staff-provisioning.js';

test('staff provisioning issues a separate high-entropy activation code and never sets a PIN', async () => {
  const code = createInternalAuthPassword(crypto);
  const calls = [];
  const input = { storeId: 'store', role: 'STAFF', activationCode: code };
  const operations = {
    randomUUID: () => crypto.randomUUID(), crypto,
    createAuthUser: async payload => { assert.notEqual(payload.password, code); return {}; },
    ...Object.fromEntries(['updateProfile', 'insertOrganizationMember', 'insertStaffIdentity', 'insertStoreMembership', 'insertAuditSuccess'].map(name => [name, async () => calls.push(name)])),
    issueActivation: async (_id, activation) => { assert.equal(activation, code); calls.push('issueActivation'); },
    deleteAuthUser: async () => { assert.fail('unexpected rollback'); },
  };
  const result = await provisionStaffIdentity(operations, input);
  assert.match(code, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(result.role, 'STAFF');
  assert.deepEqual(calls.slice(-2), ['issueActivation', 'insertAuditSuccess']);
});

test('failed activation provisioning rolls back the new identity', async () => {
  const removed = [];
  const operations = {
    randomUUID: () => 'new-user', crypto,
    createAuthUser: async () => ({}),
    ...Object.fromEntries(['updateProfile', 'insertOrganizationMember', 'insertStaffIdentity', 'insertStoreMembership'].map(name => [name, async () => {}])),
    issueActivation: async () => { throw new Error('activation unavailable'); },
    deleteAuthUser: async id => { removed.push(id); return {}; },
  };
  await assert.rejects(provisionStaffIdentity(operations, { activationCode: 'test' }), /activation unavailable/);
  assert.deepEqual(removed, ['new-user']);
});
