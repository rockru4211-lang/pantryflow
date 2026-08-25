import { readFile } from 'node:fs/promises';

const [logPath] = process.argv.slice(2);
if (!logPath) throw new Error('usage: node sanitize-local-supabase-log.mjs LOG_PATH');
const manifest = JSON.parse(await readFile('supabase/baseline/manifest.json', 'utf8'));
const raw = await readFile(logPath, 'utf8').catch(() => 'LOCAL_SUPABASE_COMMAND_FAILED_WITHOUT_LOG');
const escapedRef = String(manifest.production_project_ref).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const sanitized = raw
  .replace(new RegExp(escapedRef, 'g'), '[REMOTE_REF_REDACTED]')
  .replace(/postgres(?:ql)?:\/\/[^\s]+/giu, '[DATABASE_URL_REDACTED]')
  .replace(/https?:\/\/[^\s]+/giu, '[URL_REDACTED]')
  .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu, '[JWT_REDACTED]')
  .replace(/\bsb_(?:publishable|secret)_[A-Za-z0-9_-]+\b/giu, '[API_KEY_REDACTED]')
  .replace(/\b(?:anon|service[_ -]?role|jwt)[_ -]?(?:key|secret)\s*[:=]\s*\S+/giu, '[RUNTIME_CREDENTIAL_REDACTED]');
process.stdout.write(sanitized.slice(-12000));
