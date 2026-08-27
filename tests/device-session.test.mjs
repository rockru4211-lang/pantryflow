import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clearDevicePolicy,
  closeBrowserSessionForTest,
  evaluateDeviceSession,
  readDevicePolicy,
  rememberDevice,
} from '../pilot-v1/services/device-session.js';

class MemoryStorage {
  #items = new Map();
  getItem(key) { return this.#items.has(key) ? this.#items.get(key) : null; }
  setItem(key, value) { this.#items.set(key, String(value)); }
  removeItem(key) { this.#items.delete(key); }
}

globalThis.localStorage = new MemoryStorage();
globalThis.sessionStorage = new MemoryStorage();

test.beforeEach(() => clearDevicePolicy());

test('a personal staff device resumes without the full login flow inside the configured window', () => {
  const now = Date.UTC(2026, 7, 26);
  rememberDevice({ kind: 'STAFF', authorized: true, remember: true, timeoutDays: 7, deviceMode: 'PERSONAL', storeCode: 'BEAPE01', identifier: '小林' }, now);
  closeBrowserSessionForTest();
  assert.deepEqual(evaluateDeviceSession({ hasSession: true, now: now + 6 * 86400000 }).action, 'continue');
  const missingSession = evaluateDeviceSession({ hasSession: false, now: now + 6 * 86400000 });
  assert.equal(missingSession.action, 'reauth');
  assert.equal(missingSession.view, 'employee-pin');
});

test('an expired personal staff device asks only for PIN with remembered identity', () => {
  const now = Date.UTC(2026, 7, 26);
  rememberDevice({ kind: 'STAFF', authorized: true, remember: true, timeoutDays: 7, deviceMode: 'PERSONAL', storeCode: 'BEAPE01', identifier: '小林' }, now);
  const result = evaluateDeviceSession({ hasSession: true, now: now + 7 * 86400000 });
  assert.equal(result.action, 'reauth');
  assert.equal(result.view, 'employee-pin');
  assert.equal(result.context.storeCode, 'BEAPE01');
  assert.equal(result.context.identifier, '小林');
});

test('a shared device remembers only the store and asks for employee identity again', () => {
  rememberDevice({ kind: 'STAFF', authorized: true, remember: true, timeoutDays: 7, deviceMode: 'SHARED', storeCode: 'BEAPE01', identifier: '小林' });
  closeBrowserSessionForTest();
  const result = evaluateDeviceSession({ hasSession: true });
  assert.equal(result.action, 'reauth');
  assert.equal(result.view, 'employee-identity');
  assert.equal(result.context.storeCode, 'BEAPE01');
  assert.equal(result.context.identifier, '');
});

test('not remembering the device forces the complete login entry on reopen', () => {
  rememberDevice({ kind: 'STAFF', authorized: true, remember: false, timeoutDays: 7, deviceMode: 'PERSONAL', storeCode: 'BEAPE01', identifier: '小林' });
  closeBrowserSessionForTest();
  const result = evaluateDeviceSession({ hasSession: true });
  assert.equal(result.action, 'reauth');
  assert.equal(result.view, 'identity');
  assert.deepEqual(result.context, {});
});

test('management timeout returns to password login without forgetting the email', () => {
  const now = Date.UTC(2026, 7, 26);
  rememberDevice({ kind: 'MANAGEMENT', authorized: true, remember: true, timeoutDays: 1, email: 'owner@example.com' }, now);
  const result = evaluateDeviceSession({ hasSession: true, now: now + 86400000 });
  assert.equal(result.view, 'manager');
  assert.equal(result.context.email, 'owner@example.com');
});

test('explicit logout removes the remembered policy', () => {
  rememberDevice({ kind: 'MANAGEMENT', authorized: true, remember: true, timeoutDays: 30, email: 'owner@example.com' });
  clearDevicePolicy();
  assert.equal(readDevicePolicy(), null);
  assert.equal(evaluateDeviceSession({ hasSession: false }).action, 'identity');
});

test('a device cannot remember identity without supervisor authorization', () => {
  rememberDevice({ kind: 'STAFF', authorized: false, remember: true, timeoutDays: 30, deviceMode: 'PERSONAL', storeCode: 'BEAPE01', identifier: '小林' });
  const policy = readDevicePolicy();
  assert.equal(policy.authorized, false);
  assert.equal(policy.remember, false);
  assert.equal(policy.timeoutDays, 0);
  assert.equal(policy.storeCode, '');
  assert.equal(policy.identifier, '');
});
