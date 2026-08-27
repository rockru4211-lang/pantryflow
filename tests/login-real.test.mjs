import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  businessSetupPage,
  employeeIdentityConfirmPage,
  employeeIdentityPage,
  employeePinPage,
  employeeStoreConfirmPage,
  employeeStorePage,
  firstManagerSetupPage,
  firstStoreSetupPage,
  forgotPasswordPage,
  loginPage,
  managementLoginPage,
  ownerSetupPage,
  registrationPage,
  unassignedStorePage,
  updatePasswordPage,
} from '../pilot-v1/pages/login.js';
import { utilityPage } from '../pilot-v1/pages/utility.js';

const app = await readFile(new URL('../pilot-v1/app.js', import.meta.url), 'utf8');
const auth = await readFile(new URL('../pilot-v1/services/auth.js', import.meta.url), 'utf8');
const data = await readFile(new URL('../pilot-v1/services/data.js', import.meta.url), 'utf8');

test('final login entry has two primary choices and one new-business link', () => {
  const html = loginPage();
  for (const label of ['員工快速登入', '管理帳號登入', '建立新商家']) assert.match(html, new RegExp(label));
  assert.equal((html.match(/identity-choice/g) || []).length, 2);
  assert.match(html, /<ellipse/);
  assert.doesNotMatch(html, /店長／主管<\/strong>|後勤／管理<\/strong>|sprout/);
  assert.doesNotMatch(html, /封閉 Pilot|內部測試|本次測試範圍|admin-login-note/);
  assert.doesNotMatch(html, /進貨|OCR|盤點/);
});

test('management access is unified and shows supervisor-controlled device policy', () => {
  const html = managementLoginPage({ authorized: true, remember: true, timeoutDays: 7 });
  assert.match(html, /管理帳號登入/);
  assert.match(html, /登入後依權限顯示內容/);
  assert.match(html, /name="email"/);
  assert.match(html, /name="password"/);
  assert.match(html, /忘記密碼/);
  assert.match(html, /裝置政策由主管設定/);
  assert.match(html, /7 天未使用需重新輸入 密碼/);
  assert.doesNotMatch(html, /name="rememberDevice"|name="timeoutDays"|name="deviceMode"/);
  assert.match(registrationPage(), /id="owner-registration"/);
  assert.match(forgotPasswordPage(), /id="forgot-password"/);
  assert.match(updatePasswordPage(), /id="update-password"/);
  assert.match(auth, /db\.auth\.signUp/);
  assert.match(auth, /db\.auth\.resetPasswordForEmail/);
  assert.match(auth, /db\.auth\.updateUser/);
  assert.match(app, /event==='PASSWORD_RECOVERY'/);
});

test('employee login follows five separate confirmed steps', () => {
  const store = employeeStorePage();
  const storeConfirm = employeeStoreConfirmPage({ storeCode: 'BEAPE01', storeName: 'BeApe 台中店' });
  const identity = employeeIdentityPage({ storeCode: 'BEAPE01', mode: 'NAME_OR_NICKNAME' });
  const identityConfirm = employeeIdentityConfirmPage({ storeCode: 'BEAPE01', identifier: '小林' });
  const pin = employeePinPage({ storeCode: 'BEAPE01', identifier: '小林', mode: 'NAME_OR_NICKNAME', authorized: true, remember: true, timeoutDays: 7, deviceMode: 'PERSONAL' });
  assert.match(store, /id="staff-store"/);
  assert.match(storeConfirm, /確認門市/);
  assert.match(storeConfirm, /這是我的門市/);
  assert.match(identity, /id="staff-identity"/);
  assert.match(identity, /姓名／暱稱/);
  assert.match(identity, /登入方式由門市設定/);
  assert.match(identityConfirm, /確認是你嗎/);
  assert.match(pin, /id="staff-pin-login"/);
  assert.match(pin, /name="pin"[^>]*pattern="\[0-9\]\{6\}"/);
  assert.match(pin, /個人裝置｜7 天未使用需重新輸入 PIN/);
  assert.match(pin, /裝置政策由主管設定/);
  assert.doesNotMatch(pin, /name="rememberDevice"|name="timeoutDays"|name="deviceMode"/);
  assert.match(pin, /連續錯誤 5 次將鎖定 15 分鐘/);
});

test('supervisor settings owns device policy controls instead of the login form', () => {
  const html = utilityPage('profile', { canManage: true, store: { id: 'store-1', name: 'BeApe 台中店', role: 'ADMIN', staff_login_mode: 'NAME_OR_NICKNAME' }, staff: [], isOwner: true });
  assert.match(html, /登入與裝置/);
  assert.match(html, /允許記住已授權裝置/);
  assert.match(html, /此裝置類型/);
  assert.match(html, /登入者不能自行修改/);
});

test('verified owner sees business, store and first-manager as separate steps', () => {
  const business = businessSetupPage({ displayName: '新管理者', businessType: 'CHAIN_RESTAURANT' });
  const store = firstStoreSetupPage({ organizationName: 'BeApe', loginMode: 'EMPLOYEE_NUMBER' });
  const manager = firstManagerSetupPage({ displayName: '新管理者', storeName: '台中店' });
  assert.match(business, /id="owner-business"/);
  assert.match(business, /所屬公司（可選；資料串接後開放）/);
  assert.match(business, /name="companyName"[^>]*disabled/);
  assert.match(business, /避免送出後未保存/);
  assert.match(business, /value="CHAIN_RESTAURANT" selected/);
  assert.match(store, /id="owner-store"/);
  assert.match(store, /name="loginMode"/);
  assert.match(store, /value="EMPLOYEE_NUMBER" selected/);
  assert.match(manager, /建立第一位管理者/);
  assert.match(manager, /id="owner-business-setup"/);
  assert.match(manager, /設定 → 員工與權限/);
  assert.match(auth, /db\.rpc\('create_owner_business'/);
  assert.match(app, /renderLogin\('business-setup'/);
  assert.match(app, /state\.profile\?\.is_owner\?'OWNER'/);
});

test('unassigned store state is explicit and allows sign-out', () => {
  const html = unassignedStorePage();

  assert.match(html, /尚未指派門市/);
  assert.match(html, /Owner 或管理者完成指派/);
  assert.match(html, /data-sign-out/);
  assert.match(app, /renderUnassignedStore/);
});

test('existing ADMIN auth, store loading, session restore and sign-out remain wired', () => {
  assert.match(auth, /db\.auth\.signInWithPassword/);
  assert.match(auth, /db\.from\('profiles'\)/);
  assert.match(auth, /db\.from\('organization_members'\)/);
  assert.match(data, /db\.from\('store_memberships'\)/);
  assert.match(data, /db\.from\('stores'\)/);
  assert.match(app, /state\.session=await session\(\)/);
  assert.match(app, /signOutAndForget/);
});

test('employee PIN login uses the deployed staff-pin-login contract and resumes the real store session', () => {
  assert.match(auth, /db\.functions\.invoke\('staff-pin-login',\{body:\{storeCode,identifier,pin\}\}\)/);
  assert.match(auth, /db\.auth\.setSession/);
  assert.match(app, /await staffPinLogin\(form\.get\('storeCode'\),form\.get\('identifier'\),form\.get\('pin'\)\)/);
  assert.match(app, /await boot\(storeId\)/);
  assert.doesNotMatch(app, /user_metadata.*role|role.*user_metadata/i);
});

test('formal ADMIN proposal contains no demo or local fallback', () => {
  const source = `${loginPage()}\n${managementLoginPage()}\n${employeeStorePage()}\n${employeeIdentityPage()}\n${app}\n${auth}\n${data}`;

  assert.doesNotMatch(source, /MOCK_SESSION|DEFAULT_PRODUCTS|DEFAULT_RECEIVING_REVIEWS/);
  assert.doesNotMatch(source, /localStorage/);
});
