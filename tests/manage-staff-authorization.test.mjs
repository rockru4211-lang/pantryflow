import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  hasTargetStoreManagerAccess,
  managesEveryTargetStore,
} from '../supabase/functions/_shared/staff-authorization.js';

const source = await readFile(new URL('../supabase/functions/manage-staff/index.ts', import.meta.url), 'utf8');

const base = {
  callerId: 'caller-1',
  organizationId: 'org-1',
  storeId: 'store-1',
  store: { id: 'store-1', organization_id: 'org-1', is_active: true },
  membership: {
    store_id: 'store-1',
    organization_id: 'org-1',
    user_id: 'caller-1',
    role: 'ADMIN',
    is_active: true,
  },
};

test('only active target-store ADMIN or SUPERVISOR membership can manage staff', () => {
  assert.equal(hasTargetStoreManagerAccess(base), true);
  assert.equal(hasTargetStoreManagerAccess({
    ...base,
    membership: { ...base.membership, role: 'SUPERVISOR' },
  }), true);
  assert.equal(hasTargetStoreManagerAccess({
    ...base,
    membership: { ...base.membership, role: 'STAFF' },
  }), false);
  assert.equal(hasTargetStoreManagerAccess({
    ...base,
    membership: { ...base.membership, store_id: 'store-2' },
  }), false);
  assert.equal(hasTargetStoreManagerAccess({
    ...base,
    membership: { ...base.membership, is_active: false },
  }), false);
  assert.equal(hasTargetStoreManagerAccess({
    ...base,
    store: { ...base.store, is_active: false },
  }), false);
});

test('reset and disable require management rights for every active target store', () => {
  const memberships = [
    { ...base.membership, store_id: 'store-1' },
    { ...base.membership, store_id: 'store-2', role: 'SUPERVISOR' },
  ];
  assert.equal(managesEveryTargetStore({
    callerId: 'caller-1',
    organizationId: 'org-1',
    targetStoreIds: ['store-1', 'store-2'],
    memberships,
  }), true);
  assert.equal(managesEveryTargetStore({
    callerId: 'caller-1',
    organizationId: 'org-1',
    targetStoreIds: ['store-1', 'store-2', 'store-3'],
    memberships,
  }), false);
});

test('Edge Function authenticates caller before privileged writes and enforces target-store access', () => {
  const getUser = source.indexOf('userClient.auth.getUser()');
  const firstPrivilegedWrite = source.indexOf('.from("stores").insert');
  assert(getUser > 0 && firstPrivilegedWrite > getUser);
  assert.match(source, /requireTargetStoreManager\(admin, caller, callerId, storeId\)/);
  assert.match(source, /requireEveryStaffStoreManager\(admin, caller, callerId, staffId\)/);
  assert.match(source, /\["STAFF", "SUPERVISOR"\]\.includes\(requestedRole\)/);
  assert.doesNotMatch(source, /\["STAFF", "SUPERVISOR", "ADMIN"\]/);
});

test('create operations include deterministic replay or duplicate protection', () => {
  assert.match(source, /requestIdPattern/);
  assert.match(source, /request_id: requestId/);
  assert.match(source, /replayed: true/);
  assert.match(source, /STAFF_ALREADY_EXISTS/);
  assert.match(source, /STORE_ALREADY_EXISTS/);
});
