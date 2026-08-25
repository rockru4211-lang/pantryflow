import { appendFile, readFile } from 'node:fs/promises';

const [statusPath, githubEnvPath] = process.argv.slice(2);
if (!statusPath || !githubEnvPath) {
  throw new Error('usage: node export-local-supabase-env.mjs STATUS_JSON GITHUB_ENV');
}

const status = JSON.parse(await readFile(statusPath, 'utf8'));
const manifest = JSON.parse(await readFile('supabase/baseline/manifest.json', 'utf8'));
const values = {
  PF_LOCAL_SUPABASE_URL: status.API_URL,
  PF_LOCAL_ANON_KEY: status.ANON_KEY,
  PF_LOCAL_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
};

for (const [name, raw] of Object.entries(values)) {
  const value = String(raw || '').trim();
  if (!value) throw new Error(`LOCAL_STATUS_MISSING_${name}`);
  if (value.includes(manifest.production_project_ref) || value.includes('supabase.co')) {
    throw new Error(`REMOTE_VALUE_REJECTED_${name}`);
  }
  if (name.endsWith('_URL')) {
    const url = new URL(value);
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('LOCAL_API_HOST_REQUIRED');
  }
  process.stdout.write(`::add-mask::${value}\n`);
}

await appendFile(githubEnvPath, Object.entries(values).map(([name, value]) => `${name}=${value}\n`).join(''));
console.log('LOCAL_SUPABASE_ENV_EXPORTED_WITH_VALUES_MASKED');
