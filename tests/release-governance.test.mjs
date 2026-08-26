import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflow = await readFile(new URL('../.github/workflows/deploy-pages.yml', import.meta.url), 'utf8');
const html = await readFile(new URL('../pilot-v1/index.html', import.meta.url), 'utf8');
const app = await readFile(new URL('../pilot-v1/app.js', import.meta.url), 'utf8');
const registry = await readFile(new URL('../docs/DECISION_REGISTRY.md', import.meta.url), 'utf8');
const acceptance = await readFile(new URL('../docs/UI_V2_ACCEPTANCE.md', import.meta.url), 'utf8');

test('Pages is triggered only by a main push', () => {
  assert.match(workflow, /push:\s*\n\s+branches:\s*\n\s+- main/);
  assert.doesNotMatch(workflow, /workflow_dispatch|pilot-v1-preview|feature\//);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /github\.event_name == 'push'/);
});

test('Pages artifact contains only the formal Pilot directory', () => {
  assert.match(workflow, /path: pilot-v1/);
  assert.doesNotMatch(workflow, /path:\s+\.|legacy-demo/);
});

test('deployment requires visible immutable version metadata', () => {
  assert.match(workflow, /GITHUB_SHA/);
  assert.match(workflow, /Require visible version metadata/);
  assert.match(html, /id="build-version"/);
  assert.match(app, /build\.branch/);
  assert.match(app, /build\.sha/);
  assert.match(app, /build\.deployedAt/);
});

test('final login decision supersedes the old three-entry baseline', () => {
  assert.match(registry, /PF-LOGIN-FINAL-20260826/);
  assert.match(registry, /66fe4c03…1ff28/);
  assert.match(acceptance, /PF-LOGIN-FINAL-20260826\.jpeg/);
  assert.match(acceptance, /兩入口/);
});
