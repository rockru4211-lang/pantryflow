import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../app/pilot/pilot-client.tsx', import.meta.url), 'utf8');
const client = await readFile(new URL('../lib/supabase-browser.ts', import.meta.url), 'utf8');
const home = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
const count = await readFile(new URL('../app/pilot/count-workspace.tsx', import.meta.url), 'utf8');

test('formal pilot uses Supabase authentication instead of preview role switching', () => {
  assert.match(source, /signInWithPassword/);
  assert.match(source, /signUp/);
  assert.match(source, /onAuthStateChange/);
  assert.doesNotMatch(source, /activeRole|data-role/);
});

test('public home opens the real application instead of the preview iframe', () => {
  assert.match(home, /PilotClient/);
  assert.doesNotMatch(home, /iframe|shell\/index\.html/);
});

test('formal pilot loads stores through row-level security', () => {
  assert.match(source, /from\("stores"\)/);
  assert.match(source, /\.eq\("is_active", true\)/);
  assert.doesNotMatch(client, /service_role|SUPABASE_SERVICE/);
  assert.match(client, /NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
});

test('first-time onboarding creates the organization and first store once', () => {
  assert.match(source, /rpc\("create_owner_business_v2"/);
  assert.match(source, /p_organization_name/);
  assert.match(source, /p_store_mode/);
  assert.match(source, /p_has_erp/);
  assert.doesNotMatch(source, /第一家門市/);
});

test('first merchant test flow writes a real blind count', () => {
  assert.match(count, /create_pilot_zone/);
  assert.match(count, /create_pilot_product/);
  assert.match(count, /create_pilot_count_session/);
  assert.match(count, /from\("count_drafts"\)\.upsert/);
  assert.ok(count.indexOf('await persistZone(zone)') < count.indexOf('rpc("complete_pilot_count_zone"'));
  assert.match(count, /complete_pilot_count_zone/);
  assert.match(count, /XLSX\.read/);
  assert.match(count, /accept="\.xlsx,\.xls,\.csv"/);
  assert.doesNotMatch(count, /上次數量|系統數量/);
});
