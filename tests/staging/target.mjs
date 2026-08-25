import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

export const target = JSON.parse(
  await readFile(new URL('./target.json', import.meta.url), 'utf8'),
);

export const normalizeRef = (value) => String(value ?? '').trim().toLowerCase();

export function refDiagnostics(requestedValue, accessibleValue) {
  const requested = String(requestedValue ?? '');
  const accessible = String(accessibleValue ?? '');
  const normalizedRequested = normalizeRef(requested);
  const normalizedAccessible = normalizeRef(accessible);
  const limit = Math.max(normalizedRequested.length, normalizedAccessible.length);
  const characters = Array.from({ length: limit }, (_, index) => ({
    index,
    requested: normalizedRequested[index] ?? '',
    requestedCharCode: normalizedRequested.charCodeAt(index) || null,
    accessible: normalizedAccessible[index] ?? '',
    accessibleCharCode: normalizedAccessible.charCodeAt(index) || null,
  }));

  return {
    requested: JSON.stringify(requested),
    accessible: JSON.stringify(accessible),
    requestedLengthBefore: requested.length,
    requestedLengthAfter: normalizedRequested.length,
    accessibleLengthBefore: accessible.length,
    accessibleLengthAfter: normalizedAccessible.length,
    equal: normalizedRequested === normalizedAccessible,
    differences: characters.filter((entry) => entry.requested !== entry.accessible),
    characters,
  };
}

export function projectRefFromUrl(value) {
  const host = new URL(value).hostname.toLowerCase();
  const suffix = '.supabase.co';
  assert.ok(host.endsWith(suffix), 'INVALID_STAGING_SUPABASE_URL');
  return host.slice(0, -suffix.length);
}

export function validateTarget({ requestedRef, accessibleRef, supabaseUrl }) {
  const expected = normalizeRef(target.project.ref);
  const production = normalizeRef(target.forbidden_production_ref);
  const requested = normalizeRef(requestedRef);
  const accessible = normalizeRef(accessibleRef);
  const urlRef = normalizeRef(projectRefFromUrl(supabaseUrl));

  assert.equal(expected, 'qckwzwyeqpuqogbydvvl', 'UNREVIEWED_STAGING_TARGET');
  assert.notEqual(expected, production, 'WRONG_TARGET_PROJECT');
  assert.equal(requested, expected, 'WRONG_TARGET_PROJECT');
  assert.equal(accessible, expected, 'WRONG_TARGET_PROJECT');
  assert.equal(urlRef, expected, 'WRONG_TARGET_PROJECT');

  return { expected, production, requested, accessible, urlRef };
}

export function validateRequestEmail(value) {
  const requestEmail = String(value ?? '').trim().toLowerCase();
  const safeEmailForLog = '[REDACTED_EMAIL]';
  const emailPattern = /^[^\s@\[\]]+@[^\s@\[\]]+\.[^\s@\[\]]+$/;

  assert.ok(requestEmail, 'MISSING_STAGING_E2E_EMAIL');
  assert.match(requestEmail, emailPattern, 'INVALID_STAGING_E2E_EMAIL');
  assert.notEqual(requestEmail, safeEmailForLog, 'REDACTED_EMAIL_IS_NOT_REQUEST_DATA');
  assert.doesNotMatch(requestEmail, /redacted|placeholder|[\r\n]/i, 'INVALID_STAGING_E2E_EMAIL');
  assert.doesNotMatch(requestEmail, /@example\.com$/i, 'INVALID_STAGING_E2E_EMAIL');

  return { requestEmail, safeEmailForLog };
}

export function redactForLog(value) {
  if (typeof value === 'string' && value.includes('@')) return '[REDACTED_EMAIL]';
  if (Array.isArray(value)) return value.map(redactForLog);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        /email|password|pin|token|key/i.test(key) ? `[REDACTED_${key.toUpperCase()}]` : redactForLog(entry),
      ]),
    );
  }
  return value;
}
