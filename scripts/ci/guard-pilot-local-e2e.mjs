import { readFile } from 'node:fs/promises';

const workflowPath = '.github/workflows/pilot-v01-local-e2e.yml';
const guardedPaths = [
  workflowPath,
  'scripts/ci/export-local-supabase-env.mjs',
  'scripts/ci/prepare-pilot-local-supabase.mjs',
  'scripts/ci/prepare-pilot-local-frontend.mjs',
  'scripts/ci/sanitize-local-supabase-log.mjs',
  'tests/e2e/pilot-local-supabase.spec.mjs',
  'tests/e2e/serve-pilot-local.mjs',
];

const manifest = JSON.parse(await readFile('supabase/baseline/manifest.json', 'utf8'));
const productionRef = String(manifest.production_project_ref || '').trim();
if (!/^[a-z]{20}$/.test(productionRef)) throw new Error('BASELINE_PRODUCTION_REF_INVALID');

const documents = await Promise.all(guardedPaths.map(async path => ({
  path,
  text: await readFile(path, 'utf8'),
})));

const prohibited = [
  ['REMOTE_DATABASE_PUSH', new RegExp(`\\bdb\\s+${'pu' + 'sh'}\\b`, 'iu')],
  ['LINKED_TARGET', new RegExp(`--${'link' + 'ed'}\\b`, 'iu')],
  ['REMOTE_FUNCTION_DEPLOY', new RegExp(`\\bfunctions\\s+${'depl' + 'oy'}\\b`, 'iu')],
  ['MIGRATION_HISTORY_REPAIR', new RegExp(`\\bmigration\\s+${'rep' + 'air'}\\b`, 'iu')],
  ['GITHUB_SECRET_REFERENCE', new RegExp(`\\$\\{\\{\\s*${'secr' + 'ets'}\\.`, 'iu')],
];

const failures = [];
for (const { path, text } of documents) {
  if (text.includes(productionRef)) failures.push(`${path}:PRODUCTION_PROJECT_REF`);
  for (const [name, pattern] of prohibited) {
    if (pattern.test(text)) failures.push(`${path}:${name}`);
  }
}

const workflow = documents.find(item => item.path === workflowPath)?.text || '';
const requiredWorkflowFragments = [
  'runs-on: ubuntu-latest',
  'permissions:\n  contents: read',
  'version: 2.115.0',
  'retention-days: 3',
  'release/pilot-v01-beape',
  'workflow_dispatch:',
  'if: always()',
  'supabase stop --no-backup',
  'node-version: 22.17.1',
  'deno-version: 2.4.5',
];
for (const fragment of requiredWorkflowFragments) {
  if (!workflow.includes(fragment)) failures.push(`${workflowPath}:MISSING:${fragment}`);
}

for (const remoteVariable of [
  'SUPABASE_ACCESS_TOKEN',
  'SUPABASE_DB_URL',
  'SUPABASE_PROJECT_ID',
]) {
  if (process.env[remoteVariable]) failures.push(`ENV:${remoteVariable}_MUST_BE_UNSET`);
}

if (failures.length) {
  console.error(JSON.stringify({ policy: 'PF-PILOT-V01-LOCAL-E2E', status: 'FAIL', failures }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  policy: 'PF-PILOT-V01-LOCAL-E2E',
  status: 'PASS',
  scannedFiles: guardedPaths.length,
  remoteCredentialsReferenced: false,
  productionRefReferenced: false,
}, null, 2));
