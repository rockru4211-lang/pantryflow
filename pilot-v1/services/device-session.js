const POLICY_KEY = 'pantryflow.auth.device-policy.v2';
const ACTIVE_KEY = 'pantryflow.auth.browser-session.v2';
const DAY_MS = 24 * 60 * 60 * 1000;
const ALLOWED_TIMEOUTS = new Set([0, 1, 7, 30]);

function storage(kind) {
  try { return globalThis[kind] || null; } catch { return null; }
}

function cleanText(value, max = 160) {
  return String(value || '').trim().slice(0, max);
}

export function readDevicePolicy() {
  const local = storage('localStorage');
  if (!local) return null;
  try {
    const value = JSON.parse(local.getItem(POLICY_KEY) || 'null');
    if (!value || !['STAFF', 'MANAGEMENT'].includes(value.kind)) return null;
    const timeoutDays = Number(value.timeoutDays);
    return {
      version: 2,
      kind: value.kind,
      authorized: value.authorized === true,
      remember: value.authorized === true && Boolean(value.remember),
      timeoutDays: value.authorized === true && ALLOWED_TIMEOUTS.has(timeoutDays) ? timeoutDays : 0,
      deviceMode: value.deviceMode === 'SHARED' ? 'SHARED' : 'PERSONAL',
      email: cleanText(value.email),
      storeCode: cleanText(value.storeCode, 32),
      storeName: cleanText(value.storeName, 80),
      identifier: cleanText(value.identifier, 80),
      loginMode: value.loginMode === 'EMPLOYEE_NUMBER' ? 'EMPLOYEE_NUMBER' : 'NAME_OR_NICKNAME',
      lastActiveAt: Number(value.lastActiveAt) || 0,
    };
  } catch { return null; }
}

export function rememberDevice(input, now = Date.now()) {
  const local = storage('localStorage');
  const session = storage('sessionStorage');
  if (!local) return null;
  const timeoutDays = Number(input.timeoutDays);
  const authorized = input.authorized === true;
  const remember = authorized && Boolean(input.remember);
  const kind = input.kind === 'STAFF' ? 'STAFF' : 'MANAGEMENT';
  const deviceMode = input.deviceMode === 'SHARED' ? 'SHARED' : 'PERSONAL';
  const policy = {
    version: 2,
    kind,
    authorized,
    remember,
    timeoutDays: authorized && ALLOWED_TIMEOUTS.has(timeoutDays) ? timeoutDays : 0,
    deviceMode,
    email: remember && kind === 'MANAGEMENT' ? cleanText(input.email) : '',
    storeCode: remember && kind === 'STAFF' ? cleanText(input.storeCode, 32) : '',
    storeName: remember && kind === 'STAFF' ? cleanText(input.storeName, 80) : '',
    identifier: remember && kind === 'STAFF' && deviceMode === 'PERSONAL' ? cleanText(input.identifier, 80) : '',
    loginMode: input.loginMode === 'EMPLOYEE_NUMBER' ? 'EMPLOYEE_NUMBER' : 'NAME_OR_NICKNAME',
    lastActiveAt: now,
  };
  local.setItem(POLICY_KEY, JSON.stringify(policy));
  session?.setItem(ACTIVE_KEY, '1');
  return policy;
}

export function updateDevicePolicy(patch, now = Date.now()) {
  const current = readDevicePolicy();
  if (!current) return null;
  return rememberDevice({ ...current, ...patch, remember: current.remember }, now);
}

export function markDeviceActivity(now = Date.now()) {
  const current = readDevicePolicy();
  if (!current) return null;
  return rememberDevice(current, now);
}

export function clearDevicePolicy() {
  storage('localStorage')?.removeItem(POLICY_KEY);
  storage('sessionStorage')?.removeItem(ACTIVE_KEY);
}

export function closeBrowserSessionForTest() {
  storage('sessionStorage')?.removeItem(ACTIVE_KEY);
}

export function evaluateDeviceSession({ hasSession, now = Date.now() }) {
  const policy = readDevicePolicy();
  if (!policy) return { action: hasSession ? 'continue' : 'identity', context: {} };
  const browserActive = storage('sessionStorage')?.getItem(ACTIVE_KEY) === '1';
  const timedOut = policy.timeoutDays > 0 && now - policy.lastActiveAt >= policy.timeoutDays * DAY_MS;
  const reopenRequiresAuth = !browserActive && (!policy.remember || policy.timeoutDays === 0 || policy.deviceMode === 'SHARED');
  const view = policy.kind === 'STAFF'
    ? (policy.deviceMode === 'SHARED' ? 'employee-identity' : (policy.identifier ? 'employee-pin' : 'employee-store'))
    : 'manager';
  const context = { ...policy, reauthentication: true };
  if (hasSession && !policy.remember && reopenRequiresAuth) return { action: 'reauth', view: 'identity', context: {} };
  if (hasSession && (timedOut || reopenRequiresAuth)) return { action: 'reauth', view, context };
  if (!hasSession && policy.remember) return { action: 'reauth', view, context };
  if (!hasSession) return { action: 'identity', context: {} };
  storage('sessionStorage')?.setItem(ACTIVE_KEY, '1');
  return { action: 'continue', context };
}

export const deviceSessionKeys = { policy: POLICY_KEY, active: ACTIVE_KEY };
