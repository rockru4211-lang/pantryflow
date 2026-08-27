import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, join, normalize } from 'node:path';

const moduleDir = process.env.PLAYWRIGHT_NODE_MODULES;
assert(moduleDir, 'PLAYWRIGHT_NODE_MODULES must point to a node_modules directory containing playwright');
const require = createRequire(join(moduleDir, 'package.json'));
const { chromium } = require('playwright');
const root = new URL('../', import.meta.url).pathname;
const mime = { '.css': 'text/css', '.js': 'text/javascript' };
const componentByPath = {
  '/': 'loginPage()',
  '/manager': 'managementLoginPage()',
  '/employee-store': 'employeeStorePage()',
  '/employee-store-confirm': "employeeStoreConfirmPage({storeCode:'BEAPE01',storeName:'BeApe 台中店'})",
  '/employee-identity': "employeeIdentityPage({storeCode:'BEAPE01',mode:'NAME_OR_NICKNAME'})",
  '/employee-confirm': "employeeIdentityConfirmPage({storeCode:'BEAPE01',identifier:'測試員工',mode:'NAME_OR_NICKNAME'})",
  '/employee-pin': "employeePinPage({storeCode:'BEAPE01',identifier:'測試員工',mode:'NAME_OR_NICKNAME'})",
  '/register': 'registrationPage()',
  '/forgot': 'forgotPasswordPage()',
  '/update-password': 'updatePasswordPage()',
  '/business-setup': "businessSetupPage({displayName:'測試管理者'})",
  '/first-store': "firstStoreSetupPage({organizationName:'BeApe'})",
  '/first-manager': "firstManagerSetupPage({displayName:'測試管理者',storeName:'台中店'})",
};

const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (pathname === '/home' || componentByPath[pathname]) {
    response.setHeader('content-type', 'text/html; charset=utf-8');
    const module = pathname === '/home'
      ? `import {layout} from '/pilot-v1/components/layout.js';import {homePage} from '/pilot-v1/pages/home.js';document.querySelector('#app').innerHTML=layout({storeName:'BeApe',displayName:'測試管理者',role:'ADMIN',page:'home',content:homePage({role:'ADMIN'})});`
      : `import {loginPage,managementLoginPage,employeeStorePage,employeeStoreConfirmPage,employeeIdentityPage,employeeIdentityConfirmPage,employeePinPage,registrationPage,forgotPasswordPage,updatePasswordPage,businessSetupPage,firstStoreSetupPage,firstManagerSetupPage} from '/pilot-v1/pages/login.js';document.body.classList.add('admin-auth-view');document.querySelector('#app').innerHTML=${componentByPath[pathname]};`;
    response.end(`<!doctype html><html lang="zh-Hant"><head><title>PantryFlow｜餐飲管理</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/pilot-v1/design-tokens.css"></head><body><main id="app"></main><script type="module">${module}</script></body></html>`);
    return;
  }
  const file = normalize(join(root, pathname));
  if (!file.startsWith(root)) return response.writeHead(403).end();
  try {
    response.setHeader('content-type', mime[extname(file)] || 'application/octet-stream');
    response.end(await readFile(file));
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_BIN });
const forbidden = /封閉 Pilot|legacy-demo|preview|pilot-v1/i;
const artifactDir = process.env.LOGIN_ARTIFACT_DIR || '';
if (artifactDir) await mkdir(artifactDir, { recursive: true });

async function inspect(viewport, pathname = '/', screenshotName = '') {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(new URL(pathname, url).href);
  const title = await page.title();
  const bodyText = await page.locator('body').innerText();
  assert.equal(title, 'PantryFlow｜餐飲管理');
  assert.doesNotMatch(bodyText, forbidden);
  const result = pathname === '/home' ? { title, bodyText } : await page.locator('.admin-login-frame').evaluate(card => {
    const rect = card.getBoundingClientRect();
    return {
      width: rect.width,
      left: rect.left,
      right: innerWidth - rect.right,
      top: rect.top,
      controls: card.querySelectorAll('input:not([type="hidden"]),select,button.primary').length,
      choices: card.querySelectorAll('.identity-choice').length,
    };
  });
  if (artifactDir && screenshotName) await page.screenshot({ path: join(artifactDir, screenshotName), fullPage: true });
  assert.deepEqual(errors, [], `${viewport.width}x${viewport.height} ${pathname} console errors`);
  await page.close();
  return result;
}

try {
  const desktop = await inspect({ width: 1440, height: 1000 }, '/', 'login-choice-desktop.png');
  assert(desktop.width >= 480 && desktop.width <= 520, `desktop card width: ${desktop.width}`);
  assert(Math.abs(desktop.left - desktop.right) <= 1, `desktop centering: ${JSON.stringify(desktop)}`);
  assert.equal(desktop.choices, 2);

  const mobile = await inspect({ width: 390, height: 844 }, '/', 'login-choice-mobile.png');
  assert(mobile.width >= 358 && mobile.width <= 390, `mobile card width: ${mobile.width}`);
  assert(mobile.left >= 0 && mobile.left <= 24, `mobile left margin: ${mobile.left}`);
  assert(mobile.right >= 0 && mobile.right <= 24, `mobile right margin: ${mobile.right}`);
  assert.equal(mobile.choices, 2);

  for (const path of ['/manager', '/employee-store', '/employee-store-confirm', '/employee-identity', '/employee-confirm', '/employee-pin', '/register', '/forgot', '/update-password', '/business-setup', '/first-store', '/first-manager']) {
    const name = path.slice(1);
    const result = await inspect({ width: 390, height: 844 }, path, `${name}-mobile.png`);
    assert(result.width >= 358 && result.width <= 390, `${path} mobile card width: ${result.width}`);
    assert(result.controls > 0, `${path} has interactive controls`);
  }
  await inspect({ width: 1440, height: 1000 }, '/manager', 'manager-login-desktop.png');
  await inspect({ width: 390, height: 844 }, '/home');
  console.log(JSON.stringify({ desktop, mobile, testedAuthViews: 13, consoleErrors: 0 }));
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
