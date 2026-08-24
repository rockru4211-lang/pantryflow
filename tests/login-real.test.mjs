import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { loginPage, unassignedStorePage } from '../pilot-v1/pages/login.js';

const app = await readFile(new URL('../pilot-v1/app.js', import.meta.url), 'utf8');
const auth = await readFile(new URL('../pilot-v1/services/auth.js', import.meta.url), 'utf8');
const data = await readFile(new URL('../pilot-v1/services/data.js', import.meta.url), 'utf8');

test('ADMIN proposal contains only the approved test-release controls', () => {
  const html = loginPage();

  assert.match(html, /既有管理帳號/);
  assert.match(html, /管理者登入/);
  assert.match(html, /name="email"/);
  assert.match(html, /name="password"/);
  assert.match(html, /data-error aria-live="polite"/);
  assert.match(html, /<button class="primary" type="submit">登入<\/button>/);
  assert.doesNotMatch(html, /Owner|建立商家|員工快速登入|PIN|進貨|OCR|盤點/);
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

test('formal ADMIN proposal contains no demo or local fallback', () => {
  const source = `${loginPage()}\n${app}\n${auth}\n${data}`;

  assert.doesNotMatch(source, /MOCK_SESSION|DEFAULT_PRODUCTS|DEFAULT_RECEIVING_REVIEWS/);
  assert.doesNotMatch(source, /localStorage/);
});
