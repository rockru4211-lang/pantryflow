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
  assert.match(source, /rpc\("create_owner_business"/);
  assert.match(source, /p_organization_name/);
  assert.match(source, /p_business_type: "SINGLE_RESTAURANT"/);
  assert.match(source, /p_store_name: organizationName/);
  assert.doesNotMatch(source, /第一家門市/);
  assert.doesNotMatch(source, /門市數量|公司有使用 ERP|name="store_mode"|name="has_erp"/);
  assert.doesNotMatch(source, /setup.*count|count.*setup/i);
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
  assert.match(count, /\["REVIEWING", "CLOSED"\]/);
  assert.ok(count.indexOf('盤點已送出') < count.indexOf('差異整理'));
  assert.match(count, /inventory_count_discrepancies/);
  assert.match(count, /importComplete \|\| productCount > 0/);
});

test('email signup verifies a six-digit OTP without a browser redirect', () => {
  assert.match(source, /verifyOtp\(\{ email: pendingEmail, token, type: "signup" \}\)/);
  assert.match(source, /resend\(\{ type: "signup", email: pendingEmail \}\)/);
  assert.match(source, /autoComplete="one-time-code"/);
  assert.match(source, /pattern="\[0-9\]\{6\}"/);
  assert.match(source, /setResendSeconds\(60\)/);
  assert.match(source, /maskEmail\(pendingEmail\)/);
  assert.match(source, /返回修改 Email/);
  assert.doesNotMatch(source, /emailRedirectTo|window\.location\.origin|localhost|127\.0\.0\.1/);
});

test('production entry has no preview escape hatch or preview metadata', async () => {
  const layout = await readFile(new URL('../app/layout.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /href="\/preview"/);
  assert.doesNotMatch(layout, /外殼預覽|codex-preview/);
});

test('schema contract blocks a mismatched frontend before data operations', () => {
  assert.match(source, /get_app_schema_version/);
  assert.match(source, /actual !== EXPECTED_SCHEMA_VERSION/);
  assert.match(source, /版本無法使用/);
  assert.match(source, /activeProjectRef\.slice\(0, 8\)/);
});

test('home prioritizes initial inventory import and keeps manual entry secondary', () => {
  assert.match(source, /匯入現有品項檔案/);
  assert.match(source, /手動新增品項/);
  assert.ok(source.indexOf('匯入現有品項檔案') < source.indexOf('手動新增品項'));
});
