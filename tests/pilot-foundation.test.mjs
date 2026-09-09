import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../app/pilot/pilot-client.tsx', import.meta.url), 'utf8');
const client = await readFile(new URL('../lib/supabase-browser.ts', import.meta.url), 'utf8');
const home = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
const count = await readFile(new URL('../app/pilot/count-workspace.tsx', import.meta.url), 'utf8');
const shell = await readFile(new URL('../app/pilot/app-shell.tsx', import.meta.url), 'utf8');
const staffSettings = await readFile(new URL('../app/pilot/staff-settings.tsx', import.meta.url), 'utf8');

test('formal pilot uses Supabase authentication instead of preview role switching', () => {
  assert.match(source, /signInWithPassword/);
  assert.match(source, /signUp/);
  assert.match(source, /onAuthStateChange/);
  assert.doesNotMatch(source, /activeRole|data-role/);
});

test('staff quick login exchanges a store identity and PIN for a real session', () => {
  assert.match(source, /functions\.invoke<StaffLoginResponse>\("staff-pin-login"/);
  assert.match(source, /storeCode: staffStoreCode/);
  assert.match(source, /identifier: staffIdentifier/);
  assert.match(source, /auth\.setSession/);
  assert.match(source, /pattern="\[0-9\]\{6\}"/);
  assert.doesNotMatch(source, /service_role|SUPABASE_SERVICE/);
});

test('manager settings provisions store-scoped staff through the controlled edge function', () => {
  assert.match(staffSettings, /functions\.invoke<ManageStaffResponse>\("manage-staff"/);
  assert.match(staffSettings, /action: "create_store"/);
  assert.match(staffSettings, /action: "create"/);
  assert.match(staffSettings, /!data\?\.store\?\.id/);
  assert.match(staffSettings, /!data\?\.staffId/);
  assert.doesNotMatch(staffSettings, /data\?\.ok/);
  assert.match(staffSettings, /role: String\(values\.get\("role"\)/);
  assert.match(staffSettings, /activationCode/);
  assert.doesNotMatch(staffSettings, /name="pin"/);
  assert.doesNotMatch(staffSettings, /service_role|SUPABASE_SERVICE/);
});

test('public home opens the real application instead of the preview iframe', () => {
  assert.match(home, /PilotClient/);
  assert.doesNotMatch(home, /iframe|shell\/index\.html/);
});

test('formal pilot loads stores through row-level security', () => {
  assert.match(source, /from\("profiles"\).*\.eq\("id", activeSession\.user\.id\)\.single\(\)/s);
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
  const onboarding = source.slice(source.indexOf('async function createBusiness'), source.indexOf('const versionPanel'));
  assert.doesNotMatch(onboarding, /create_pilot_count_session|create_pilot_zone|setCountStartPage/);
});

test('first merchant test flow writes a real blind count', () => {
  assert.match(count, /const loadRequestId = useRef\(0\)/);
  assert.match(count, /requestId !== loadRequestId\.current/);
  assert.match(count, /create_pilot_zone/);
  assert.match(count, /create_pilot_product/);
  assert.match(count, /start_pilot_count/);
  assert.match(count, /save_pilot_count_draft/);
  assert.ok(count.indexOf('await persistZone(zone)') < count.indexOf('rpc("complete_pilot_count_zone"'));
  assert.match(count, /complete_pilot_count_zone/);
  assert.match(count, /readInventoryWorkbook/);
  assert.match(count, /parseInventoryWorkbook/);
  assert.match(count, /import_pilot_inventory/);
  assert.match(count, /supplier_name: row\.supplierName/);
  assert.match(count, /row\.sheetName.*row\.sourceRow/s);
  assert.match(count, /row\.status === "FAILED"/);
  assert.match(count, /accept="\.xlsx,\.xls,\.csv"/);
  assert.doesNotMatch(count, /上次數量|系統數量/);
  assert.match(count, /count-item-more/);
  assert.match(count, /canViewFullDetails/);
  assert.match(count, /\["REVIEWING", "CLOSED"\]/);
  assert.match(count, /page === "review" && submitted/);
  assert.match(count, /inventory_count_discrepancies/);
  assert.match(count, /productCount === 0 && !importComplete/);
});

test('email signup retains OTP and resends links to the original App', () => {
  assert.match(source, /verifyOtp\(\{ email: pendingEmail, token, type: "signup" \}\)/);
  assert.match(source, /resend\(\{ type: "signup", email, options: \{ emailRedirectTo: authRedirect\("signup"\) \} \}\)/);
  assert.match(source, /autoComplete="one-time-code"/);
  assert.match(source, /pattern="\[0-9\]\{6\}"/);
  assert.match(source, /setResendSeconds\(60\)/);
  assert.match(source, /maskEmail\(pendingEmail\)/);
  assert.match(source, /返回修改 Email/);
  assert.doesNotMatch(source, /window\.location\.origin|localhost|127\.0\.0\.1/);
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

test('home exposes counting and import while manual entry stays in inventory settings', () => {
  assert.match(shell, /onCount/);
  assert.match(shell, /匯入品項檔案/);
  assert.doesNotMatch(shell, /手動新增品項/);
  assert.match(count, /少量手動新增品項/);
});

test('approved v59 shell and the formal daisy identity are the only React skin', async () => {
  const daisy = await readFile(new URL('../app/pilot/daisy-logo.tsx', import.meta.url), 'utf8');
  const page = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
  const logo = await readFile(new URL('../public/logo.svg', import.meta.url), 'utf8');
  const favicon = await readFile(new URL('../public/favicon.svg', import.meta.url), 'utf8');
  assert.match(page, /v59-shell\.css/);
  assert.doesNotMatch(page, /pilot\.css|convergence\.css/);
  assert.match(shell, /DaisyLogo/);
  assert.match(daisy, /45, 90, 135, 180, 225, 270, 315/);
  assert.equal(logo, favicon);
  assert.doesNotMatch(source + shell, /PantryFlow|完整\s*App\s*外殼預覽/);
});
