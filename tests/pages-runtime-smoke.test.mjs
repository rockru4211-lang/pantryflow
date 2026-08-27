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

  assert.match(output, /拍攝到貨單/);
  assert.match(output, /拍攝／選擇多張照片/);
  assert.match(output, /最多 10 張/);
  assert.match(output, /尚無進貨紀錄/);
});

test('the main page wires the complete module graph to visible build metadata', () => {
  assert.match(html, /<script src="\.\/build-info\.js"><\/script>/);
  assert.match(html, /<script type="module" src="\.\/app\.js"><\/script>/);
  assert.match(html, /id="build-version"/);
  assert.match(app, /build\.branch/);
  assert.match(app, /build\.sha/);
  assert.match(app, /build\.deployedAt/);
});
