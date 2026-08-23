import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { loginPage } from '../pilot-v1/pages/login.js';

const app = await readFile(new URL('../pilot-v1/app.js', import.meta.url), 'utf8');
const auth = await readFile(new URL('../pilot-v1/services/auth.js', import.meta.url), 'utf8');
const data = await readFile(new URL('../pilot-v1/services/data.js', import.meta.url), 'utf8');

test('locked login identity hierarchy is present before any credential form', () => {
  const html = loginPage();

  assert.match(html, /選擇登入身分/);
  assert.match(html, /data-login-role="staff"[\s\S]*員工快速登入/);
  assert.match(html, /data-login-role="supervisor"[\s\S]*店長／主管/);
  assert.match(html, /data-login-role="management"[\s\S]*後勤／管理/);
  assert.match(html, /id="management-login" class="hidden"/);
  assert.match(html, /id="staff-login" class="hidden"/);
});

test('staff PIN entry keeps the locked security text and secure server flow', () => {
  const html = loginPage();

  assert.match(html, /選姓名／暱稱/);
  assert.match(html, /輸入員工編號/);
  assert.match(html, /輸入 6 位 PIN/);
  assert.match(html, /連續錯誤 5 次將暫時鎖定 15 分鐘/);
  assert.match(auth, /db\.functions\.invoke\('staff-pin-login'/);
  assert.match(auth, /db\.auth\.setSession/);
});

test('manager login, membership loading, session restore and sign-out stay wired to Supabase', () => {
  assert.match(auth, /db\.auth\.signInWithPassword/);
  assert.match(auth, /db\.from\('profiles'\)/);
  assert.match(auth, /db\.from\('organization_members'\)/);
  assert.match(data, /db\.from\('store_memberships'\)/);
  assert.match(data, /db\.from\('stores'\)/);
  assert.match(app, /state\.session=await session\(\)/);
  assert.match(app, /await signOut\(\);renderLogin\(\)/);
});

test('formal login contains no demo or local fallback', () => {
  const source = `${loginPage()}\n${app}\n${auth}\n${data}`;

  assert.doesNotMatch(source, /MOCK_SESSION|DEFAULT_PRODUCTS|DEFAULT_RECEIVING_REVIEWS/);
  assert.doesNotMatch(source, /localStorage/);
});
