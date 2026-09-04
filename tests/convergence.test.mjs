import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const missing = async path => access(new URL(path, import.meta.url)).then(() => false, () => true);

test('root is the only application implementation and legacy shell is absent', async () => {
  const root = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
  const pilot = await readFile(new URL('../app/pilot/page.tsx', import.meta.url), 'utf8');
  assert.match(root, /<PilotClient/);
  assert.match(pilot, /redirect\("\/"\)/);
  assert.equal(await missing('../app/preview/page.tsx'), true);
  assert.equal(await missing('../public/shell/index.html'), true);
});

test('beta environment and database contract are pinned without secrets', async () => {
  const client = await readFile(new URL('../lib/supabase-browser.ts', import.meta.url), 'utf8');
  const release = await readFile(new URL('../lib/release.ts', import.meta.url), 'utf8');
  assert.match(client, /qckwzwyeqpuqogbydvvl/);
  assert.match(client, /activeProjectRef !== BETA_PROJECT_REF/);
  assert.doesNotMatch(client, /service_role|sb_secret_/);
  assert.match(release, /20260904_merchant_beta_v1/);
});

test('database migrations and generated types contain the beta schema contract', async () => {
  const types = await readFile(new URL('../lib/database.types.ts', import.meta.url), 'utf8');
  const contract = await readFile(new URL('../supabase/migrations/20260904055100_merchant_beta_schema_contract.sql', import.meta.url), 'utf8');
  const config = await readFile(new URL('../supabase/config.toml', import.meta.url), 'utf8');
  assert.match(types, /get_app_schema_version/);
  assert.match(contract, /20260904_merchant_beta_v1/);
  assert.match(contract, /grant execute.*anon, authenticated/s);
  assert.match(config, /project_id = "pantryflow-beta"/);
});
