import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { loginPage } from '../pilot-v1/pages/login.js';
import {
  firstStoreOnboardingPage,
  ownerBusinessOnboardingPage,
} from '../pilot-v1/pages/onboarding.js';
import { utilityPage } from '../pilot-v1/pages/utility.js';

const app = await readFile(new URL('../pilot-v1/app.js', import.meta.url), 'utf8');
const auth = await readFile(new URL('../pilot-v1/services/auth.js', import.meta.url), 'utf8');

const organization = { id: 'org-1', name: '測試商家' };
const store = {
  id: 'store-1',
  name: '第一門市',
  store_code: 'FIRST01',
  staff_login_mode: 'NAME_OR_NICKNAME',
};

test('signed-out entry exposes management login, registration, and employee PIN login', () => {
  const html = loginPage();
  for (const label of ['管理者登入', '管理者註冊', '員工 PIN']) assert.match(html, new RegExp(label));
  for (const formId of ['management-login', 'management-sign-up', 'staff-pin-login']) {
    assert.match(html, new RegExp(`id="${formId}"`));
  }
});

test('authenticated user without an organization enters business and first-store onboarding', () => {
  const html = ownerBusinessOnboardingPage({ display_name: '管理者' });
  assert.match(html, /建立商家與第一間門市/);
  assert.match(html, /name="organizationName"/);
  assert.match(html, /name="storeName"/);
  assert.match(html, /name="storeCode"/);
  assert.doesNotMatch(html, /create-staff|建立門市成員|門市成員/);
  assert.match(app, /if\(!state\.organization\)return renderOwnerOnboarding\(\)/);
});

test('organization without stores shows only the first-store onboarding state', () => {
  const html = firstStoreOnboardingPage(organization);
  assert.match(html, /建立第一間門市/);
  assert.match(html, /測試商家/);
  assert.doesNotMatch(html, /create-staff|id="create-staff"|member-list|盤點入口/);
  assert.match(app, /if\(!state\.stores\.length\)\{if\(state\.profile\.organization_role==='ADMIN'\)return renderFirstStoreOnboarding\(\)/);
});

test('store management keeps long create forms on separate secondary pages', () => {
  const profile = utilityPage('profile', {
    organization,
    store,
    staff: [],
    canManage: true,
    canCreateStore: true,
    canCreateSupervisor: true,
  });
  assert.match(profile, /門市管理/);
  assert.match(profile, /測試商家/);
  assert.match(profile, /第一門市/);
  assert.match(profile, /FIRST01/);
  assert.match(profile, /data-route="staff-create"/);
  assert.match(profile, /data-route="store-create"/);
  assert.doesNotMatch(profile, /id="create-staff"|id="create-store"/);

  const staffCreate = utilityPage('staff-create', {
    organization,
    store,
    canManage: true,
    canCreateSupervisor: true,
  });
  assert.match(staffCreate, /data-back/);
  assert.match(staffCreate, /id="create-staff"/);
  assert.match(staffCreate, /name="storeId"[^>]*value="store-1"/);
  assert.match(staffCreate, /value="STAFF"/);
  assert.match(staffCreate, /value="SUPERVISOR"/);
  assert.doesNotMatch(staffCreate, /value="ADMIN"/);

  const storeCreate = utilityPage('store-create', {
    organization,
    canCreateStore: true,
  });
  assert.match(storeCreate, /data-back/);
  assert.match(storeCreate, /id="create-store"/);
  assert.doesNotMatch(storeCreate, /id="create-staff"/);
});

test('first and subsequent stores use separate isPilotStore paths', () => {
  assert.match(auth, /createStore\(input, \{ isFirstStore = false \} = \{\}\)/);
  assert.match(auth, /isPilotStore:\s*Boolean\(isFirstStore\)/);
  assert.match(app, /createStore\(Object\.fromEntries\(form\),\{isFirstStore:false\}\)/);
  assert.match(app, /createStore\(\{name:values\.storeName,storeCode:values\.storeCode,loginMode:values\.loginMode\},\{isFirstStore:true\}\)/);
  assert.equal((app.match(/isFirstStore:true/g) || []).length, 1);
});

test('create forms prevent duplicate clicks and require PIN confirmation', () => {
  assert.match(app, /if\(submit\?\.disabled\)return/);
  assert.match(app, /if\(submit\)submit\.disabled=true/);
  assert.match(app, /PIN_CONFIRMATION_MISMATCH/);
  assert.match(auth, /requestId:\s*input\.requestId\s*\|\|\s*crypto\.randomUUID\(\)/);
});

test('a staff form cannot render until a selected store exists', () => {
  const html = utilityPage('staff-create', {
    organization,
    store: null,
    canManage: true,
    canCreateSupervisor: true,
  });
  assert.doesNotMatch(html, /id="create-staff"/);
  assert.match(html, /目前角色沒有此頁面的權限/);
});
