import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const baseUrl = process.env.STORE_FIRST_FIXTURE_URL;
const browserBin = process.env.BROWSER_BIN;
const artifactDir = process.env.STORE_FIRST_ARTIFACT_DIR;
assert(baseUrl, 'STORE_FIRST_FIXTURE_URL is required');
assert(browserBin, 'BROWSER_BIN is required');
assert(artifactDir, 'STORE_FIRST_ARTIFACT_DIR is required');

await mkdir(artifactDir, { recursive: true });
const browser = await chromium.launch({ executablePath: browserBin, headless: true });
const viewports = [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'mobile', width: 390, height: 844 },
];
const states = ['no-org', 'no-store', 'has-store', 'add-store', 'add-staff'];
const results = [];

try {
  for (const viewport of viewports) {
    for (const state of states) {
      const page = await browser.newPage({ viewport });
      const errors = [];
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`${baseUrl}?state=${state}`, { waitUntil: 'networkidle' });

      const measurement = await page.evaluate(() => ({
        bodyText: document.body.innerText,
        bodyBackground: getComputedStyle(document.body).backgroundColor,
        bodyWidth: document.body.scrollWidth,
        viewportWidth: innerWidth,
        hasBack: Boolean(document.querySelector('[data-back]')),
        hasStaffForm: Boolean(document.querySelector('#create-staff')),
        hasStoreForm: Boolean(document.querySelector('#create-store, #create-first-store')),
        state: document.querySelector('[data-onboarding-state]')?.getAttribute('data-onboarding-state') || 'secondary',
      }));
      assert.equal(errors.length, 0, `${viewport.name}/${state} console errors: ${errors.join(' | ')}`);
      assert.equal(measurement.bodyBackground, 'rgb(255, 255, 255)');
      assert(measurement.bodyWidth <= measurement.viewportWidth, `${viewport.name}/${state} has horizontal overflow`);
      assert.doesNotMatch(measurement.bodyText, /legacy-demo|preview|封閉 Pilot|BeApe/i);

      if (state === 'no-org') {
        assert.equal(measurement.state, 'no-organization');
        assert.equal(measurement.hasStaffForm, false);
        assert.equal(measurement.hasStoreForm, false);
      } else if (state === 'no-store') {
        assert.equal(measurement.state, 'no-store');
        assert.equal(measurement.hasStaffForm, false);
        assert.equal(measurement.hasStoreForm, true);
      } else if (state === 'has-store') {
        assert.equal(measurement.state, 'has-store');
        assert.equal(measurement.hasStaffForm, false);
        assert.equal(measurement.hasStoreForm, false);
        for (const label of ['商家名稱', '目前門市', '門市成員', '新增店長／員工', '新增門市']) assert.match(measurement.bodyText, new RegExp(label));
      } else {
        assert.equal(measurement.hasBack, true, `${state} needs a back control`);
      }

      const screenshot = `${artifactDir}/${state}-${viewport.name}.png`;
      await page.screenshot({ path: screenshot, fullPage: true });
      results.push({ viewport: viewport.name, state, consoleErrors: errors.length, screenshot, ...measurement });
      await page.close();
    }
  }

  const page = await browser.newPage({ viewport: viewports[0] });
  await page.goto(`${baseUrl}?state=has-store`, { waitUntil: 'networkidle' });
  await page.click('[data-route="add-staff"]');
  await page.waitForURL(/state=add-staff/);
  assert(await page.locator('[data-back]').isVisible());
  await page.click('[data-back]');
  await page.waitForURL(/state=has-store/);
  assert(await page.locator('[data-onboarding-state="has-store"]').isVisible());
  await page.close();
} finally {
  await browser.close();
}

await writeFile(`${artifactDir}/browser-results.json`, `${JSON.stringify(results, null, 2)}\n`);
console.log(`Store-first browser QA passed: ${results.length} viewport/state combinations, console errors 0.`);
