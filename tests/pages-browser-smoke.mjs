import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const { EXPECTED_BRANCH, EXPECTED_SHA, PAGES_URL } = process.env;
assert(EXPECTED_BRANCH, 'EXPECTED_BRANCH is required');
assert.match(EXPECTED_SHA || '', /^[0-9a-f]{40}$/i, 'EXPECTED_SHA must be a complete Git SHA');
assert(PAGES_URL, 'PAGES_URL is required');

const candidates = [process.env.BROWSER_BIN, 'google-chrome', 'chromium', 'chromium-browser'].filter(Boolean);
const browser = candidates.find(command => spawnSync('which', [command]).status === 0);
assert(browser, `No supported headless browser found: ${candidates.join(', ')}`);

const expected = `Branch: ${EXPECTED_BRANCH}｜Git SHA: ${EXPECTED_SHA}｜部署時間:`;
let lastFailure = '';

for (let attempt = 1; attempt <= 6; attempt += 1) {
  const target = new URL(PAGES_URL);
  target.searchParams.set('release', EXPECTED_SHA);
  target.searchParams.set('attempt', String(attempt));

  const result = spawnSync(browser, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--enable-logging=stderr',
    '--virtual-time-budget=5000',
    '--dump-dom',
    target.href,
  ], { encoding: 'utf8', timeout: 20_000 });

  const consoleOutput = result.stderr || '';
  const dom = result.stdout || '';
  const hasExpectedVersion = dom.includes(expected);
  const mainLoaded = !dom.includes('正在連線正式 Supabase…');
  const hasUncaughtError = /Uncaught|SyntaxError/.test(consoleOutput);

  if (result.status === 0 && hasExpectedVersion && mainLoaded && !hasUncaughtError) {
    console.log(`Pages browser smoke passed: ${expected}`);
    process.exit(0);
  }

  lastFailure = JSON.stringify({
    attempt,
    status: result.status,
    hasExpectedVersion,
    mainLoaded,
    hasUncaughtError,
    consoleOutput: consoleOutput.slice(-2000),
  });
  if (attempt < 6) spawnSync('sleep', ['5']);
}

assert.fail(`Pages browser smoke failed after deployment propagation retries: ${lastFailure}`);
