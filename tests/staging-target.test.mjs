import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeRef,
  projectRefFromUrl,
  redactForLog,
  refDiagnostics,
  validateRequestEmail,
  validateTarget,
} from './staging/target.mjs';

const STAGING_REF = 'qckwzwyeqpuqogbydvvl';

test('Supabase Management API staging target is canonical and distinct from production', () => {
  const result = validateTarget({
    requestedRef: ` ${STAGING_REF.toUpperCase()}\n`,
    accessibleRef: STAGING_REF,
    supabaseUrl: `https://${STAGING_REF}.supabase.co`,
  });
  assert.equal(result.expected, STAGING_REF);
  assert.notEqual(result.expected, result.production);
  assert.equal(projectRefFromUrl(`https://${STAGING_REF}.supabase.co`), STAGING_REF);
});

test('manual typo is reported at index 8 instead of a false positive', () => {
  const diagnostics = refDiagnostics('qckwzwyegpuqogbydvvl', STAGING_REF);
  assert.equal(diagnostics.equal, false);
  assert.deepEqual(diagnostics.differences, [{
    index: 8,
    requested: 'g',
    requestedCharCode: 103,
    accessible: 'q',
    accessibleCharCode: 113,
  }]);
  assert.equal(normalizeRef(` ${STAGING_REF.toUpperCase()}\n`), STAGING_REF);
});

test('Auth request email and safe log value cannot be confused', () => {
  const candidate = ['PF.STAGING.RUN', 'valid.testmail.dev'].join('@');
  const { requestEmail, safeEmailForLog } = validateRequestEmail(`  ${candidate}  `);
  assert.equal(requestEmail, candidate.toLowerCase());
  assert.equal(safeEmailForLog, '[REDACTED_EMAIL]');
  assert.notEqual(requestEmail, safeEmailForLog);
  assert.throws(() => validateRequestEmail('[REDACTED_EMAIL]'), /INVALID_STAGING_E2E_EMAIL/);
  assert.throws(() => validateRequestEmail(['pf.staging', 'example.com'].join('@')), /INVALID_STAGING_E2E_EMAIL/);
});

test('logging redacts all secret-bearing fields without mutating request data', () => {
  const candidate = ['pf.staging.run', 'valid.testmail.dev'].join('@');
  const request = {
    email: candidate,
    password: ['runtime', 'only'].join('-'),
    nested: { pin: Array(6).fill(String(0)).join(''), storeCode: 'TEST' },
  };
  const safe = redactForLog(request);
  assert.equal(request.email, candidate);
  assert.equal(safe.email, '[REDACTED_EMAIL]');
  assert.equal(safe.password, '[REDACTED_PASSWORD]');
  assert.equal(safe.nested.pin, '[REDACTED_PIN]');
  assert.equal(safe.nested.storeCode, 'TEST');
});
