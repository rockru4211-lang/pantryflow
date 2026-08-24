import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { layout } from '../pilot-v1/components/layout.js';
import { homePage } from '../pilot-v1/pages/home.js';
import { loginPage } from '../pilot-v1/pages/login.js';

const forbidden = /封閉 Pilot|BeApe|legacy-demo|preview|pilot-v1/i;
const index = await readFile(new URL('../pilot-v1/index.html', import.meta.url), 'utf8');

test('formal title and initial brand are canonical', () => {
  assert.match(index, /<title>PantryFlow｜餐飲管理<\/title>/);
  assert.match(index, /<header id="build-banner" class="build-banner">PantryFlow<\/header>/);
  assert.doesNotMatch(loginPage(), forbidden);
});

test('simulated existing ADMIN session renders no legacy labels', () => {
  const home = layout({
    storeName: 'BeApe',
    displayName: 'BeApe 管理員',
    role: 'ADMIN',
    page: 'home',
    content: homePage({ role: 'ADMIN', storeName: 'BeApe' }),
  });
  assert.doesNotMatch(home, forbidden);
  assert.match(home, />PantryFlow</);
  assert.match(home, /管理員，歡迎回來/);
});
