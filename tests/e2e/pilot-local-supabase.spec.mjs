import { test, expect } from '@playwright/test';
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const apiUrl = String(process.env.PF_LOCAL_SUPABASE_URL || '').trim();
const anonKey = String(process.env.PF_LOCAL_ANON_KEY || '').trim();
const serviceRoleKey = String(process.env.PF_LOCAL_SERVICE_ROLE_KEY || '').trim();
const frontendUrl = String(process.env.PF_E2E_FRONTEND_URL || 'http://127.0.0.1:4173').trim();
const artifactDir = path.resolve(process.env.PF_E2E_ARTIFACT_DIR || 'tests/artifacts/pilot-v01-local-e2e');
const runId = String(process.env.PF_E2E_RUN_ID || 'local').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
const token = createHash('sha256').update(runId).digest('hex').slice(0, 10);

function assertLocalConfiguration() {
  const api = new URL(apiUrl);
  const frontend = new URL(frontendUrl);
  if (!['127.0.0.1', 'localhost'].includes(api.hostname)) throw new Error('LOCAL_SUPABASE_HOST_REQUIRED');
  if (!['127.0.0.1', 'localhost'].includes(frontend.hostname)) throw new Error('LOCAL_FRONTEND_HOST_REQUIRED');
  if (!anonKey || !serviceRoleKey || anonKey === serviceRoleKey) throw new Error('LOCAL_RUNTIME_KEYS_REQUIRED');
}

assertLocalConfiguration();

const password = `Aa!${randomBytes(24).toString('base64url')}`;
const managerEmail = `manager-${token}@pantryflow.test`;
const secondManagerEmail = `manager2-${token}@pantryflow.test`;
const noStoreEmail = `nostore-${token}@pantryflow.test`;
const metadataEmail = `metadata-${token}@pantryflow.test`;
const staffPin = String(randomInt(100000, 1000000));
const supervisorPin = String(randomInt(100000, 1000000));
const lockPin = String(randomInt(100000, 1000000));
const secondStoreSupervisorPin = String(randomInt(100000, 1000000));
const wrongPin = lockPin === '000000' ? '111111' : '000000';
const organizationName = `PF CI 商家 ${token}`;
const secondOrganizationName = `PF CI 隔離商家 ${token}`;
const noStoreOrganizationName = `PF CI 無門市商家 ${token}`;
const firstStoreName = `PF CI 第一門市 ${token}`;
const secondStoreName = `PF CI 第二門市 ${token}`;
const otherOrganizationStoreName = `PF CI 隔離門市 ${token}`;
const storeCode = `PF${token}`.toUpperCase();
const secondStoreCode = `PF2${token}`.toUpperCase();
const otherStoreCode = `PX${token}`.toUpperCase();
const staffIdentifier = `staff-${token}`;
const supervisorIdentifier = `supervisor-${token}`;
const lockIdentifier = `lock-${token}`;
const replayIdentifier = `replay-${token}`;
const secondStoreSupervisorIdentifier = `supervisor2-${token}`;

const results = [];
const browserErrors = [];

async function localRequest(endpointName, pathname, {
  method = 'GET',
  key = anonKey,
  bearer = key,
  body,
  prefer,
} = {}) {
  const response = await fetch(`${apiUrl}${pathname}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${bearer}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await response.text();
  let data = null;
  if (raw) {
    try { data = JSON.parse(raw); } catch { data = null; }
  }
  return { endpointName, status: response.status, data };
}

function requireStatus(result, allowed) {
  const statuses = Array.isArray(allowed) ? allowed : [allowed];
  if (!statuses.includes(result.status)) {
    const code = String(result.data?.error || result.data?.code || 'UNEXPECTED_RESPONSE').replace(/[^A-Z0-9_-]/gi, '_').slice(0, 80);
    throw new Error(`${result.endpointName}_HTTP_${result.status}_${code}`);
  }
  return result.data;
}

async function signInApi(email) {
  const result = await localRequest('AUTH_PASSWORD_LOGIN', '/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: { email, password },
  });
  return requireStatus(result, 200);
}

async function signUpApi(email, metadata = {}) {
  const result = await localRequest('AUTH_SIGNUP', '/auth/v1/signup', {
    method: 'POST',
    body: { email, password, data: { display_name: `PF CI ${token}`, ...metadata } },
  });
  return requireStatus(result, 200);
}

async function invokeFunction(name, body, bearer = anonKey) {
  return localRequest(`FUNCTION_${name.toUpperCase()}`, `/functions/v1/${name}`, {
    method: 'POST',
    bearer,
    body,
  });
}

async function rpc(name, body, bearer) {
  return localRequest(`RPC_${name.toUpperCase()}`, `/rest/v1/rpc/${name}`, {
    method: 'POST',
    bearer,
    body,
  });
}

async function serviceInsert(table, body) {
  const result = await localRequest(`SERVICE_INSERT_${table.toUpperCase()}`, `/rest/v1/${table}`, {
    method: 'POST', key: serviceRoleKey, bearer: serviceRoleKey, body, prefer: 'return=representation',
  });
  return requireStatus(result, 201);
}

async function servicePatch(table, query, body) {
  const result = await localRequest(`SERVICE_PATCH_${table.toUpperCase()}`, `/rest/v1/${table}?${query}`, {
    method: 'PATCH', key: serviceRoleKey, bearer: serviceRoleKey, body, prefer: 'return=representation',
  });
  return requireStatus(result, 200);
}

async function serviceQuery(table, query) {
  const result = await localRequest(`SERVICE_QUERY_${table.toUpperCase()}`, `/rest/v1/${table}?${query}`, {
    key: serviceRoleKey, bearer: serviceRoleKey,
  });
  return requireStatus(result, 200);
}

async function authenticatedQuery(table, query, bearer) {
  const result = await localRequest(`AUTHENTICATED_QUERY_${table.toUpperCase()}`, `/rest/v1/${table}?${query}`, { bearer });
  return requireStatus(result, 200);
}

async function createNoStoreManager() {
  const auth = await localRequest('AUTH_ADMIN_CREATE_NO_STORE_USER', '/auth/v1/admin/users', {
    method: 'POST', key: serviceRoleKey, bearer: serviceRoleKey,
    body: { email: noStoreEmail, password, email_confirm: true, user_metadata: { display_name: `PF CI 無門市管理者 ${token}` } },
  });
  const authData = requireStatus(auth, 200);
  const userId = authData.user?.id || authData.id;
  if (!userId) throw new Error('NO_STORE_AUTH_USER_ID_MISSING');
  const [organization] = await serviceInsert('organizations', {
    name: noStoreOrganizationName,
    business_type: 'SINGLE_RESTAURANT',
    owner_user_id: userId,
  });
  await servicePatch('profiles', `id=eq.${userId}`, {
    organization_id: organization.id,
    display_name: `PF CI 無門市管理者 ${token}`,
    role: 'ADMIN',
    store: '',
  });
  await serviceInsert('organization_members', {
    organization_id: organization.id, user_id: userId, role: 'ADMIN', is_active: true, is_owner: true,
  });
  await serviceInsert('staff_identities', {
    user_id: userId,
    organization_id: organization.id,
    display_name: `PF CI 無門市管理者 ${token}`,
    job_title: 'Owner',
    created_by: userId,
  });
}

function attachConsoleGuard(page) {
  page.on('console', message => {
    if (message.type() === 'error') browserErrors.push({ type: 'console' });
  });
  page.on('pageerror', () => browserErrors.push({ type: 'pageerror' }));
}

async function assertSafeVisibleUi(page) {
  const forbidden = ['legacy-demo', 'preview', '封閉 Pilot'];
  const text = await page.locator('body').innerText();
  for (const label of forbidden) expect(text).not.toContain(label);
  expect(await page.evaluate(() => document.body.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

async function capturePair(page, name) {
  for (const viewport of [
    { suffix: 'desktop-1440x1000', width: 1440, height: 1000 },
    { suffix: 'mobile-390x844', width: 390, height: 844 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await assertSafeVisibleUi(page);
    await page.screenshot({ path: path.join(artifactDir, `${name}-${viewport.suffix}.png`) });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
}

async function completePinLogin(page, identifier, pin, expectedRoute, expectedKind, expectedStoreName) {
  await page.locator('[data-login-mode="employee"]').click();
  await page.locator('#staff-pin-login input[name="storeCode"]').fill(storeCode);
  await page.locator('#staff-pin-login input[name="identifier"]').fill(identifier);
  await page.locator('#staff-pin-login input[name="pin"]').fill(pin);
  await page.locator('#staff-pin-login button[type="submit"]').click();
  await expect(page).toHaveURL(new RegExp(`${expectedRoute.replaceAll('/', '\\/')}$`));
  await expect(page.locator(`[data-home-kind="${expectedKind}"]`)).toBeVisible();
  await expect(page.locator('[data-store-switch]')).toContainText(expectedStoreName);
}

async function browserSignOut(page) {
  await page.locator('.bottom-nav [data-route="profile"]').click();
  await expect(page.locator('[data-sign-out]')).toBeVisible();
  await page.locator('[data-sign-out]').click();
  await expect(page.locator('#management-login')).toBeVisible();
}

test('isolated local Supabase real Auth, Database, RLS, Functions and browser E2E', async ({ browser }) => {
  test.setTimeout(240_000);
  await mkdir(artifactDir, { recursive: true });
  let activeStep = 'initialization';
  let managerAccessToken = '';
  let firstStoreId = '';
  let organizationId = '';
  let supervisor2AccessToken = '';

  const runStep = async (name, callback) => {
    activeStep = name;
    try {
      await test.step(name, callback);
      results.push({ name, status: 'PASS' });
    } catch {
      results.push({ name, status: 'FAIL' });
      throw new Error(`E2E_STEP_FAILED_${name.replace(/[^A-Z0-9]+/gi, '_').toUpperCase()}`);
    }
  };

  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  attachConsoleGuard(page);

  try {
    await runStep('manager registration and login', async () => {
      await page.goto(frontendUrl, { waitUntil: 'networkidle' });
      await expect(page.locator('#management-login')).toBeVisible();
      await capturePair(page, '01-login-registration');
      await page.locator('[data-login-mode="register"]').click();
      const form = page.locator('#management-sign-up');
      await form.locator('input[name="displayName"]').fill(`PF CI 管理者 ${token}`);
      await form.locator('input[name="email"]').fill(managerEmail);
      await form.locator('input[name="password"]').fill(password);
      await form.locator('input[name="confirmPassword"]').fill(password);
      await form.locator('button[type="submit"]').click();
      await expect(page.locator('#create-owner-business')).toBeVisible();
      await capturePair(page, '02-create-business-first-store');
    });

    await runStep('create business and first store atomically', async () => {
      const form = page.locator('#create-owner-business');
      await form.locator('input[name="organizationName"]').fill(organizationName);
      await form.locator('input[name="storeName"]').fill(firstStoreName);
      await form.locator('input[name="storeCode"]').fill(storeCode);
      await form.locator('button[type="submit"]').click();
      await expect(page.locator('h1.page-title')).toHaveText('門市管理');
      await expect(page.locator('.settings-context')).toContainText(organizationName);
      await expect(page.locator('.settings-context')).toContainText(firstStoreName);
      await capturePair(page, '04-store-management');

      const managerSession = await signInApi(managerEmail);
      managerAccessToken = managerSession.access_token;
      const profileRows = await authenticatedQuery('profiles', 'select=id,organization_id&id=eq.' + managerSession.user.id, managerAccessToken);
      organizationId = profileRows[0]?.organization_id || '';
      const storeRows = await authenticatedQuery('stores', 'select=id,name,store_code,is_pilot_store&order=created_at.asc', managerAccessToken);
      firstStoreId = storeRows[0]?.id || '';
      expect(organizationId).toMatch(/^[0-9a-f-]{36}$/);
      expect(firstStoreId).toMatch(/^[0-9a-f-]{36}$/);
      expect(storeRows).toHaveLength(1);
      expect(storeRows[0].is_pilot_store).toBe(true);
    });

    await runStep('owner onboarding replay is idempotent', async () => {
      const payload = {
        p_organization_name: organizationName,
        p_business_type: 'SINGLE_RESTAURANT',
        p_store_name: firstStoreName,
        p_store_code: storeCode,
        p_staff_login_mode: 'NAME_OR_NICKNAME',
      };
      const replayOne = requireStatus(await rpc('create_owner_business', payload, managerAccessToken), 200);
      const replayTwo = requireStatus(await rpc('create_owner_business', payload, managerAccessToken), 200);
      expect(replayOne.replayed).toBe(true);
      expect(replayTwo.replayed).toBe(true);
      const stores = await serviceQuery('stores', `select=id&organization_id=eq.${organizationId}`);
      const organizations = await serviceQuery('organizations', `select=id&id=eq.${organizationId}`);
      expect(stores).toHaveLength(1);
      expect(organizations).toHaveLength(1);
    });

    await runStep('existing business without store shows first-store onboarding only', async () => {
      await createNoStoreManager();
      await page.locator('[data-sign-out]').click();
      await expect(page.locator('#management-login')).toBeVisible();
      const form = page.locator('#management-login');
      await form.locator('input[name="email"]').fill(noStoreEmail);
      await form.locator('input[name="password"]').fill(password);
      await form.locator('button[type="submit"]').click();
      await expect(page.locator('#create-first-store')).toBeVisible();
      await expect(page.locator('#create-staff')).toHaveCount(0);
      await expect(page.locator('body')).toContainText(noStoreOrganizationName);
      await capturePair(page, '03-existing-business-no-store');
      await page.locator('[data-sign-out]').click();
      await expect(page.locator('#management-login')).toBeVisible();

      await form.locator('input[name="email"]').fill(managerEmail);
      await form.locator('input[name="password"]').fill(password);
      await form.locator('button[type="submit"]').click();
      await expect(page.locator('[data-home-kind="manager"]')).toBeVisible();
    });

    await runStep('manager route, count back navigation and session restore', async () => {
      await expect(page).toHaveURL(/#\/manager\/home$/);
      await expect(page.locator('.app-view.role-manager')).toBeVisible();
      await expect(page.locator('[data-store-switch]')).toContainText(firstStoreName);
      expect(await page.locator('.app-view').evaluate(node => getComputedStyle(node).backgroundColor)).toBe('rgb(255, 255, 255)');
      expect(await page.locator('.app-view').evaluate(node => getComputedStyle(node).getPropertyValue('--role-accent').trim())).toBe('#d66e22');
      await capturePair(page, '07-manager-home');
      await page.locator('.operation-card[data-feature="count"]').click();
      await expect(page.locator('[data-back]')).toBeVisible();
      await page.locator('[data-back]').click();
      await expect(page.locator('[data-home-kind="manager"]')).toBeVisible();
      await page.reload({ waitUntil: 'networkidle' });
      await expect(page.locator('[data-home-kind="manager"]')).toBeVisible();
    });

    await runStep('create STAFF and SUPERVISOR from the selected store', async () => {
      await page.locator('.bottom-nav [data-route="profile"]').click();
      await page.locator('[data-route="staff-create"]').click();
      await expect(page.locator('#create-staff')).toBeVisible();
      await expect(page.locator('.settings-context')).toContainText(firstStoreName);
      await capturePair(page, '05-create-staff');
      let form = page.locator('#create-staff');
      await form.locator('input[name="displayName"]').fill(`PF CI 員工 ${token}`);
      await form.locator('input[name="loginIdentifier"]').fill(staffIdentifier);
      await form.locator('select[name="role"]').selectOption('STAFF');
      await form.locator('input[name="pin"]').fill(staffPin);
      await form.locator('input[name="confirmPin"]').fill(staffPin);
      await form.locator('button[type="submit"]').click();
      await expect(page.locator('.member-list')).toContainText(staffIdentifier);

      await page.locator('[data-route="staff-create"]').click();
      form = page.locator('#create-staff');
      await form.locator('input[name="displayName"]').fill(`PF CI 主管 ${token}`);
      await form.locator('input[name="loginIdentifier"]').fill(supervisorIdentifier);
      await form.locator('select[name="role"]').selectOption('SUPERVISOR');
      await form.locator('input[name="pin"]').fill(supervisorPin);
      await form.locator('input[name="confirmPin"]').fill(supervisorPin);
      await form.locator('button[type="submit"]').click();
      await expect(page.locator('.member-list')).toContainText(supervisorIdentifier);
    });

    await runStep('request ID replay does not create duplicate staff', async () => {
      const requestId = randomUUID();
      const body = {
        action: 'create', requestId, storeId: firstStoreId,
        displayName: `PF CI Replay ${token}`, loginIdentifier: replayIdentifier,
        role: 'STAFF', pin: staffPin,
      };
      const first = await invokeFunction('manage-staff', body, managerAccessToken);
      const replay = await invokeFunction('manage-staff', body, managerAccessToken);
      requireStatus(first, 201);
      const replayData = requireStatus(replay, 200);
      expect(replayData.replayed).toBe(true);
      const rows = await serviceQuery('store_memberships', `select=user_id&store_id=eq.${firstStoreId}&login_identifier=eq.${replayIdentifier}`);
      expect(rows).toHaveLength(1);
    });

    await runStep('STAFF PIN login obtains real session and employee route', async () => {
      await browserSignOut(page);
      await page.locator('[data-login-mode="employee"]').click();
      await capturePair(page, '06-staff-pin-login');
      await completePinLogin(page, staffIdentifier, staffPin, '#/employee/home', 'employee', firstStoreName);
      await expect(page.locator('.app-view.role-employee')).toBeVisible();
      expect(await page.locator('.app-view').evaluate(node => getComputedStyle(node).getPropertyValue('--role-accent').trim())).toBe('#25834f');
      await capturePair(page, '08-employee-home');
      await page.locator('.operation-card[data-feature="count"]').click();
      await expect(page.locator('[data-back]')).toBeVisible();
      await page.locator('[data-back]').click();
      await expect(page.locator('[data-home-kind="employee"]')).toBeVisible();
      await page.reload({ waitUntil: 'networkidle' });
      await expect(page.locator('[data-home-kind="employee"]')).toBeVisible();
      await browserSignOut(page);
    });

    await runStep('SUPERVISOR PIN login obtains manager route', async () => {
      await completePinLogin(page, supervisorIdentifier, supervisorPin, '#/manager/home', 'manager', firstStoreName);
      await expect(page.locator('.app-view.role-manager')).toBeVisible();
      await capturePair(page, '09-supervisor-home');
      await page.reload({ waitUntil: 'networkidle' });
      await expect(page.locator('[data-home-kind="manager"]')).toBeVisible();
      await browserSignOut(page);
    });

    await runStep('STAFF cannot manage staff', async () => {
      const login = requireStatus(await invokeFunction('staff-pin-login', {
        storeCode, identifier: staffIdentifier, pin: staffPin,
      }), 200);
      const denied = await invokeFunction('manage-staff', {
        action: 'create', requestId: randomUUID(), storeId: firstStoreId,
        displayName: `PF CI Denied ${token}`, loginIdentifier: `denied-${token}`,
        role: 'STAFF', pin: staffPin,
      }, login.session.access_token);
      expect(denied.status).toBe(403);
      const visibleStores = await authenticatedQuery('stores', 'select=id,name', login.session.access_token);
      expect(visibleStores).toHaveLength(1);
      expect(visibleStores[0].id).toBe(firstStoreId);
    });

    await runStep('wrong PIN locks after five attempts', async () => {
      const created = requireStatus(await invokeFunction('manage-staff', {
        action: 'create', requestId: randomUUID(), storeId: firstStoreId,
        displayName: `PF CI Lock ${token}`, loginIdentifier: lockIdentifier,
        role: 'STAFF', pin: lockPin,
      }, managerAccessToken), 201);
      expect(created.staffId).toMatch(/^[0-9a-f-]{36}$/);
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        const failure = await invokeFunction('staff-pin-login', { storeCode, identifier: lockIdentifier, pin: wrongPin });
        expect(failure.status).toBe(401);
      }
      const locked = await invokeFunction('staff-pin-login', { storeCode, identifier: lockIdentifier, pin: wrongPin });
      expect(locked.status).toBe(423);
      const correctWhileLocked = await invokeFunction('staff-pin-login', { storeCode, identifier: lockIdentifier, pin: lockPin });
      expect(correctWhileLocked.status).toBe(423);
    });

    await runStep('second store is non-pilot and cross-store management is denied', async () => {
      const form = page.locator('#management-login');
      await form.locator('input[name="email"]').fill(managerEmail);
      await form.locator('input[name="password"]').fill(password);
      await form.locator('button[type="submit"]').click();
      await expect(page.locator('[data-home-kind="manager"]')).toBeVisible();
      await page.locator('.bottom-nav [data-route="profile"]').click();
      await page.locator('[data-route="store-create"]').click();
      const storeForm = page.locator('#create-store');
      await storeForm.locator('input[name="name"]').fill(secondStoreName);
      await storeForm.locator('input[name="storeCode"]').fill(secondStoreCode);
      await storeForm.locator('button[type="submit"]').click();
      await expect(page.locator('.settings-context')).toContainText(secondStoreName);
      const secondStoreRows = await serviceQuery('stores', `select=id,is_pilot_store&organization_id=eq.${organizationId}&store_code=eq.${secondStoreCode}`);
      expect(secondStoreRows).toHaveLength(1);
      expect(secondStoreRows[0].is_pilot_store).toBe(false);

      const supervisor2 = requireStatus(await invokeFunction('manage-staff', {
        action: 'create', requestId: randomUUID(), storeId: secondStoreRows[0].id,
        displayName: `PF CI 第二店主管 ${token}`, loginIdentifier: secondStoreSupervisorIdentifier,
        role: 'SUPERVISOR', pin: secondStoreSupervisorPin,
      }, managerAccessToken), 201);
      expect(supervisor2.staffId).toMatch(/^[0-9a-f-]{36}$/);
      const supervisor2Login = requireStatus(await invokeFunction('staff-pin-login', {
        storeCode: secondStoreCode, identifier: secondStoreSupervisorIdentifier, pin: secondStoreSupervisorPin,
      }), 200);
      supervisor2AccessToken = supervisor2Login.session.access_token;
      const denied = await invokeFunction('manage-staff', {
        action: 'create', requestId: randomUUID(), storeId: firstStoreId,
        displayName: `PF CI Cross Store ${token}`, loginIdentifier: `cross-${token}`,
        role: 'STAFF', pin: staffPin,
      }, supervisor2AccessToken);
      expect(denied.status).toBe(403);
      await browserSignOut(page);
    });

    await runStep('cross-organization RLS isolation', async () => {
      const secondSignup = await signUpApi(secondManagerEmail);
      const secondToken = secondSignup.access_token || (await signInApi(secondManagerEmail)).access_token;
      const secondOwner = requireStatus(await rpc('create_owner_business', {
        p_organization_name: secondOrganizationName,
        p_business_type: 'SINGLE_RESTAURANT',
        p_store_name: otherOrganizationStoreName,
        p_store_code: otherStoreCode,
        p_staff_login_mode: 'NAME_OR_NICKNAME',
      }, secondToken), 200);
      expect(secondOwner.organization_id).toMatch(/^[0-9a-f-]{36}$/);
      const hidden = await authenticatedQuery('stores', `select=id&organization_id=eq.${secondOwner.organization_id}`, managerAccessToken);
      expect(hidden).toHaveLength(0);
      const denied = await invokeFunction('manage-staff', {
        action: 'create', requestId: randomUUID(), storeId: firstStoreId,
        displayName: `PF CI Cross Org ${token}`, loginIdentifier: `cross-org-${token}`,
        role: 'STAFF', pin: staffPin,
      }, secondToken);
      expect(denied.status).toBe(403);
    });

    await runStep('user metadata cannot grant management authorization', async () => {
      const metadataSignup = await signUpApi(metadataEmail, { role: 'ADMIN', account_type: 'OWNER_REGISTRATION' });
      const metadataToken = metadataSignup.access_token || (await signInApi(metadataEmail)).access_token;
      const hidden = await authenticatedQuery('stores', `select=id&id=eq.${firstStoreId}`, metadataToken);
      expect(hidden).toHaveLength(0);
      const denied = await invokeFunction('manage-staff', {
        action: 'create', requestId: randomUUID(), storeId: firstStoreId,
        displayName: `PF CI Metadata ${token}`, loginIdentifier: `metadata-denied-${token}`,
        role: 'STAFF', pin: staffPin,
      }, metadataToken);
      expect(denied.status).toBe(403);
    });

    await runStep('browser console has zero errors', async () => {
      expect(browserErrors).toHaveLength(0);
    });
  } finally {
    await context.close();
    await writeFile(path.join(artifactDir, 'pilot-local-e2e-summary.json'), `${JSON.stringify({
      status: results.some(item => item.status === 'FAIL') ? 'FAIL' : 'PASS',
      failedStep: results.find(item => item.status === 'FAIL')?.name || null,
      results,
      consoleErrors: browserErrors.length,
      environment: 'isolated-local-supabase-on-github-runner',
      dataCleanup: 'entire Docker-backed local stack is destroyed with supabase stop --no-backup',
    }, null, 2)}\n`);
  }
});
