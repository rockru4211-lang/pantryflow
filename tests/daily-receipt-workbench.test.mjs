import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(new URL('../supabase/migrations/20260822120500_daily_receipt_workbench_queue.sql', import.meta.url), 'utf8');
const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const backend = await readFile(new URL('../pilot-backend.js', import.meta.url), 'utf8');

test('queue is durable, leased, limited, and browser roles cannot operate workers', () => {
  assert.match(migration, /create table if not exists public\.receipt_ocr_jobs/);
  assert.match(migration, /for update skip locked/);
  assert.match(migration, /limit least\(greatest\(p_limit, 1\), 2\)/);
  assert.match(migration, /status in \('QUEUED', 'RUNNING'\)/);
  assert.match(migration, /revoke execute on function public\.claim_receipt_ocr_jobs\(integer\) from public, anon, authenticated/);
});

test('daily workbench dimensions are snapshots and formal receipts stay batch-scoped', () => {
  assert.match(migration, /add column if not exists store_name text/);
  assert.match(migration, /add column if not exists work_date date/);
  assert.match(migration, /receipt_batches_daily_workbench_idx/);
  assert.doesNotMatch(migration, /update public\.goods_receipts set source_batch_id/);
});

test('mobile upload enqueues once and never invokes OCR once per batch', () => {
  assert.match(app, /enqueueReceiptOcr\(successful\.map/);
  assert.doesNotMatch(app, /Promise\.allSettled\(successful\.map\(result =>\s*window\.PantryBackend\.processReceiptOcr/);
  assert.match(backend, /functions\.invoke\('enqueue-receipt-ocr'/);
});
