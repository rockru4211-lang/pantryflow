import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const manifest = await readFile(new URL('../app/manifest.ts', import.meta.url), 'utf8');
const layout = await readFile(new URL('../app/layout.tsx', import.meta.url), 'utf8');
const client = await readFile(new URL('../app/pilot/pilot-client.tsx', import.meta.url), 'utf8');
const releaseChecklist = await readFile(new URL('../docs/merchant-beta-release-checklist.md', import.meta.url), 'utf8');

test('PWA manifest uses the approved 序 identity and fixed public start URL', () => {
  assert.match(manifest, /name: "序｜餐飲庫存管理"/);
  assert.match(manifest, /short_name: "序"/);
  assert.match(manifest, /pantryflow-app-shell-preview\.rockru4211\.chatgpt\.site/);
  assert.match(manifest, /display: "standalone"/);
  assert.match(manifest, /theme_color: "#173f35"/);
  assert.match(manifest, /icon-192\.png/);
  assert.match(manifest, /icon-512\.png/);
});

test('Apple standalone metadata and installation guidance are present without a service worker', () => {
  assert.match(layout, /appleWebApp/);
  assert.match(layout, /apple-mobile-web-app-capable/);
  assert.match(layout, /apple-touch-icon\.png/);
  assert.match(client, /分享/);
  assert.match(client, /加入主畫面/);
  assert.doesNotMatch(`${manifest}\n${layout}\n${client}`, /serviceWorker|navigator\.serviceWorker/);
});

test('release checklist blocks multi-merchant use until custom SMTP is configured', () => {
  assert.match(releaseChecklist, /custom SMTP/i);
  assert.match(releaseChecklist, /\{\{ \.Token \}\}/);
  assert.match(releaseChecklist, /built-in SMTP/);
});
