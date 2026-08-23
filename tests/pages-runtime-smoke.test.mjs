import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const receivingUrl = new URL('../pilot-v1/pages/receiving.js', import.meta.url);
const html = await readFile(new URL('../pilot-v1/index.html', import.meta.url), 'utf8');
const app = await readFile(new URL('../pilot-v1/app.js', import.meta.url), 'utf8');

test('receiving page passes an explicit syntax check and renders its empty state', async () => {
  const syntax = spawnSync(process.execPath, ['--check', fileURLToPath(receivingUrl)], { encoding: 'utf8' });
  assert.equal(syntax.status, 0, syntax.stderr);

  const { receivingPage } = await import(receivingUrl);
  const output = receivingPage({ batches: [], detail: null });

  assert.match(output, /上傳真實收據/);
  assert.match(output, /每日收貨工作台/);
  assert.match(output, /尚無正式收據/);
});

test('the main page wires the complete module graph to visible build metadata', () => {
  assert.match(html, /<script src="\.\/build-info\.js"><\/script>/);
  assert.match(html, /<script type="module" src="\.\/app\.js"><\/script>/);
  assert.match(html, /id="build-version"/);
  assert.match(app, /build\.branch/);
  assert.match(app, /build\.sha/);
  assert.match(app, /build\.deployedAt/);
});
