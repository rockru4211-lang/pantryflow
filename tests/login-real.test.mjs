import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { loginPage, unassignedStorePage } from '../pilot-v1/pages/login.js';

const app = await readFile(new URL('../pilot-v1/app.js', import.meta.url), 'utf8');
const auth = await readFile(new URL('../pilot-v1/services/auth.js', import.meta.url), 'utf8');
const data = await readFile(new URL('../pilot-v1/services/data.js', import.meta.url), 'utf8');

test('login page keeps ADMIN access and adds the locked employee PIN contract', () => {
  const html = loginPage();

  assert.match(html, /管理者登入/);
  assert.match(html, /使用既有管理帳號登入/);
  assert.match(html, /<strong>PantryFlow<\/strong>/);
  assert.match(html, /name="email"/);
  assert.match(html, /name="password"/);
  assert.match(html, /data-error aria-live="polite"/);
  assert.match(html, /<button class="primary" type="submit">登入<\/button>/);
  assert.match(html, /員工快速登入/);
  assert.match(html, /id="staff-pin-login"/);
  assert.match(html, /name="storeCode"/);
  assert.match(html, /name="identifier"/);
  assert.match(html, /name="pin"[^>]*pattern="\[0-9\]\{6\}"/);
  assert.doesNotMatch(html, /Owner|建立商家|進貨|OCR|盤點/);
  assert.doesNotMatch(html, /封閉 Pilot|內部測試|本次測試範圍|admin-login-note/);
  assert.doesNotMatch(html, /auth-brand|brand-mark|identity-choice/);
});

test('unassigned store state is explicit and allows sign-out', () => {
  const html = unassignedStorePage();

  assert.match(html, /尚未指派門市/);
  assert.match(html, /membership 指派/);
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
  assert.match(app, /await signOut\(\);renderLogin\(\)/);
});

test('employee PIN login uses the deployed staff-pin-login contract and resumes the real store session', () => {
  assert.match(auth, /db\.functions\.invoke\('staff-pin-login',\{body:\{storeCode,identifier,pin\}\}\)/);
  assert.match(auth, /db\.auth\.setSession/);
  assert.match(app, /await staffPinLogin\(form\.get\('storeCode'\),form\.get\('identifier'\),form\.get\('pin'\)\)/);
  assert.match(app, /await boot\(storeId\)/);
  assert.doesNotMatch(app, /user_metadata.*role|role.*user_metadata/i);
});

test('formal ADMIN proposal contains no demo or local fallback', () => {
  const source = `${loginPage()}\n${app}\n${auth}\n${data}`;

  assert.doesNotMatch(source, /MOCK_SESSION|DEFAULT_PRODUCTS|DEFAULT_RECEIVING_REVIEWS/);
  assert.doesNotMatch(source, /localStorage/);
});
