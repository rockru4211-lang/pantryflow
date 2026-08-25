import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [destination] = process.argv.slice(2);
if (!destination) throw new Error('usage: node prepare-pilot-local-frontend.mjs DESTINATION');

const apiUrl = String(process.env.PF_LOCAL_SUPABASE_URL || '').trim();
const anonKey = String(process.env.PF_LOCAL_ANON_KEY || '').trim();
const branch = String(process.env.GITHUB_REF_NAME || 'release/pilot-v01-beape');
const sha = String(process.env.GITHUB_SHA || '').trim();
const url = new URL(apiUrl);
if (!['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('LOCAL_API_HOST_REQUIRED');
if (!anonKey || anonKey === process.env.PF_LOCAL_SERVICE_ROLE_KEY) throw new Error('LOCAL_ANON_KEY_REQUIRED');
if (!/^[0-9a-f]{40}$/i.test(sha)) throw new Error('GITHUB_SHA_REQUIRED');

await cp('pilot-v1', destination, { recursive: true });
await mkdir(path.join(destination, 'vendor'), { recursive: true });
await cp(
  'node_modules/@supabase/supabase-js/dist/umd/supabase.min.js',
  path.join(destination, 'vendor/supabase.min.js'),
);

const config = `window.PANTRYFLOW_CONFIG = {\n  supabaseUrl: ${JSON.stringify(apiUrl)},\n  supabaseAnonKey: ${JSON.stringify(anonKey)}\n};\n`;
const build = `window.PILOT_BUILD = {\n  branch: ${JSON.stringify(branch)},\n  sha: ${JSON.stringify(sha)},\n  deployedAt: ${JSON.stringify(new Date().toISOString())}\n};\n`;
await writeFile(path.join(destination, 'config.js'), config);
await writeFile(path.join(destination, 'build-info.js'), build);

const indexPath = path.join(destination, 'index.html');
const index = (await readFile(indexPath, 'utf8')).replace(
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/dist/umd/supabase.min.js',
  './vendor/supabase.min.js',
);
if (!index.includes('./vendor/supabase.min.js')) throw new Error('LOCAL_SUPABASE_JS_REWRITE_FAILED');
await writeFile(indexPath, index);
console.log('LOCAL_FRONTEND_PREPARED_WITH_ANON_KEY_ONLY');
