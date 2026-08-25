import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [destination] = process.argv.slice(2);
if (!destination) throw new Error('usage: node prepare-pilot-local-supabase.mjs DESTINATION');

const supabaseRoot = path.join(destination, 'supabase');
await mkdir(path.join(supabaseRoot, 'functions'), { recursive: true });
await mkdir(path.join(supabaseRoot, 'migrations'), { recursive: true });
await cp('supabase/functions/_shared', path.join(supabaseRoot, 'functions/_shared'), { recursive: true });
await cp('supabase/functions/manage-staff', path.join(supabaseRoot, 'functions/manage-staff'), { recursive: true });
await cp('supabase/functions/staff-pin-login', path.join(supabaseRoot, 'functions/staff-pin-login'), { recursive: true });
await cp('supabase/tests', path.join(supabaseRoot, 'tests'), { recursive: true });

const original = await readFile('supabase/config.toml', 'utf8');
const base = original
  .replace(/^project_id\s*=.*$/m, 'project_id = "pf-pilot-v01-e2e"')
  .replace(/\n\[functions\.[\s\S]*$/u, '')
  .trimEnd();
const config = `${base}\n\n[auth.email]\nenable_signup = true\nenable_confirmations = false\n\n[functions.manage-staff]\nverify_jwt = true\n\n[functions.staff-pin-login]\nverify_jwt = false\n`;
await writeFile(path.join(supabaseRoot, 'config.toml'), config);

if (/supabase\.co|project-ref|access_token/iu.test(config)) throw new Error('REMOTE_CONFIG_REJECTED');
console.log('ISOLATED_LOCAL_SUPABASE_PROJECT_PREPARED');
