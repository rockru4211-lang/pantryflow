import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'vite';
const vite = await createServer({ configFile: false, appType: 'custom', cacheDir: 'node_modules/.vite/setup-tests', server: { middlewareMode: true } });
after(() => vite.close());
const { parseOwnerSetup, ownerSetupError } = await vite.ssrLoadModule('/lib/owner-setup.ts');
test('a merchant ID alone does not imply completed onboarding', () => {
  for (const step of ['business', 'store', 'manager']) {
    const state = parseOwnerSetup({ required: true, step, revision: 2, organization_id: 'existing', draft: { organization_name: 'BeApe', store_name: 'Existing store', store_code: 'BEAPE01' } });
    assert.equal(state.required, true); assert.equal(state.step, step);
    assert.equal(state.draft.organization_name, 'BeApe'); assert.equal(state.draft.store_code, 'BEAPE01');
  }
  assert.equal(parseOwnerSetup({ required: false, step: 'complete' }).required, false);
});
test('failed, missing or inconsistent setup responses cannot enter onboarding or home', () => {
  for (const state of [null, {}, { required: true, step: 'complete' }, { required: false, step: 'business' }, { required: true, step: 'store' }, { required: true, step: 'store', revision: 0 }])
    assert.throws(() => parseOwnerSetup(state), /OWNER_SETUP_READ_FAILED/);
});
test('business mode and store structure retain independent real choices', () => {
  const state = parseOwnerSetup({ required: true, step: 'manager', revision: 3, draft: { business_type: 'CHAIN_RESTAURANT', store_mode: 'SINGLE', staff_login_mode: 'EMPLOYEE_NUMBER' } });
  assert.equal(state.draft.business_type, 'CHAIN_RESTAURANT'); assert.equal(state.draft.store_mode, 'SINGLE');
  assert.equal(state.draft.staff_login_mode, 'EMPLOYEE_NUMBER');
});
test('setup validation errors distinguish duplicate codes, stale drafts and missing values', () => {
  assert.match(ownerSetupError('OWNER_STORE_CODE_TAKEN'), /代碼已被使用/);
  assert.match(ownerSetupError('OWNER_SETUP_CHANGED'), /另一個視窗/);
  assert.match(ownerSetupError('OWNER_SETUP_STORE_REQUIRED'), /門市名称|門市名稱/);
  assert.match(ownerSetupError('OWNER_BUSINESS_NAME_REQUIRED'), /品牌名稱/);
  assert.match(ownerSetupError('unavailable'), /輸入會保留/);
});
