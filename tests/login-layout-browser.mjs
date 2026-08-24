import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, join, normalize } from 'node:path';

const moduleDir = process.env.PLAYWRIGHT_NODE_MODULES;
assert(moduleDir, 'PLAYWRIGHT_NODE_MODULES must point to a node_modules directory containing playwright');
const require = createRequire(join(moduleDir, 'package.json'));
const { chromium } = require('playwright');
const root = new URL('../', import.meta.url).pathname;
const mime = { '.css': 'text/css', '.js': 'text/javascript' };

const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (pathname === '/' || pathname === '/home') {
    response.setHeader('content-type', 'text/html; charset=utf-8');
    const module = pathname === '/home'
      ? `import {layout} from '/pilot-v1/components/layout.js';import {homePage} from '/pilot-v1/pages/home.js';document.querySelector('#app').innerHTML=layout({storeName:'BeApe',displayName:'BeApe 管理員',role:'ADMIN',page:'home',content:homePage({role:'ADMIN',storeName:'BeApe'})});`
      : `import {loginPage} from '/pilot-v1/pages/login.js';document.body.classList.add('admin-auth-view');document.querySelector('#app').innerHTML=loginPage();const buttons=[...document.querySelectorAll('[data-login-mode]')],panels=[...document.querySelectorAll('[data-login-panel]')];buttons.forEach(button=>button.onclick=()=>{buttons.forEach(item=>{const active=item===button;item.classList.toggle('active',active);item.setAttribute('aria-selected',String(active))});panels.forEach(panel=>panel.hidden=panel.dataset.loginPanel!==button.dataset.loginMode)});`;
    response.end(`<!doctype html><html><head><title>PantryFlow｜餐飲管理</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/pilot-v1/design-tokens.css"></head><body><main id="app"></main><script type="module">${module}</script></body></html>`);
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

async function inspect(viewport, pathname = '/', loginMode = 'manager') {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto(new URL(pathname, url).href);
  const title = await page.title();
  const bodyText = await page.locator('body').innerText();
  assert.equal(title, 'PantryFlow｜餐飲管理');
  assert.doesNotMatch(bodyText, forbidden);
  if (pathname === '/' && loginMode === 'employee') await page.locator('[data-login-mode="employee"]').click();
  const result = pathname === '/' ? await page.locator('.admin-login-frame').evaluate(card => {
    const cardRect = card.getBoundingClientRect();
    const panel = card.querySelector('[data-login-panel]:not([hidden])');
    const widths = [...panel.querySelectorAll('input, button[type="submit"]')].map(node => node.getBoundingClientRect().width);
    return { width: cardRect.width, left: cardRect.left, right: innerWidth - cardRect.right, top: cardRect.top, controlWidths: widths };
  }) : { title, bodyText };
  assert.deepEqual(errors, [], `${viewport.width}x${viewport.height} console errors`);
  await page.close();
  return result;
}

try {
  const desktop = await inspect({ width: 1440, height: 1000 });
  assert(desktop.width >= 480 && desktop.width <= 520, `desktop card width: ${desktop.width}`);
  assert(Math.abs(desktop.left - desktop.right) <= 1, `desktop centering: ${JSON.stringify(desktop)}`);
  assert(desktop.top >= 96 && desktop.top <= 160, `desktop card top: ${desktop.top}`);

  const mobile = await inspect({ width: 390, height: 844 });
  assert(mobile.width >= 358 && mobile.width <= 390, `mobile card width: ${mobile.width}`);
  assert(mobile.left >= 16 && mobile.left <= 24, `mobile left margin: ${mobile.left}`);
  assert(mobile.right >= 16 && mobile.right <= 24, `mobile right margin: ${mobile.right}`);
  assert(mobile.controlWidths.length === 3 && mobile.controlWidths.every(width => Math.abs(width - mobile.controlWidths[0]) <= 1), `mobile controls: ${mobile.controlWidths}`);

  const employeeDesktop = await inspect({ width: 1440, height: 1000 }, '/', 'employee');
  assert(employeeDesktop.width >= 480 && employeeDesktop.width <= 520, `employee desktop card width: ${employeeDesktop.width}`);
  assert(employeeDesktop.controlWidths.length === 4 && employeeDesktop.controlWidths.every(width => Math.abs(width - employeeDesktop.controlWidths[0]) <= 1), `employee desktop controls: ${employeeDesktop.controlWidths}`);
  const employeeMobile = await inspect({ width: 390, height: 844 }, '/', 'employee');
  assert(employeeMobile.left >= 16 && employeeMobile.left <= 24, `employee mobile left margin: ${employeeMobile.left}`);
  assert(employeeMobile.right >= 16 && employeeMobile.right <= 24, `employee mobile right margin: ${employeeMobile.right}`);
  assert(employeeMobile.controlWidths.length === 4 && employeeMobile.controlWidths.every(width => Math.abs(width - employeeMobile.controlWidths[0]) <= 1), `employee mobile controls: ${employeeMobile.controlWidths}`);

  await inspect({ width: 1440, height: 1000 }, '/home');
  await inspect({ width: 390, height: 844 }, '/home');

  console.log(JSON.stringify({ desktop, mobile, employeeDesktop, employeeMobile, consoleErrors: 0 }));
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
