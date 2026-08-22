import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(new URL('../supabase/migrations/20260822041733_controlled_pilot_catalog_count_lots.sql', import.meta.url), 'utf8');
const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const backend = await readFile(new URL('../pilot-backend.js', import.meta.url), 'utf8');

test('catalog import is ADMIN-only, transactional, and duplicate-aware', () => {
  assert.match(migration, /create or replace function public\.import_catalog_products/);
  assert.match(migration, /if not public\.is_admin\(\)/);
  assert.match(migration, /'status', 'DUPLICATE'/);
  assert.match(migration, /PRODUCT_IMPORTED/);
  assert.match(app, /data-import-field/);
  assert.match(backend, /rpc\('import_catalog_products'/);
});

test('blank count is distinct from zero and initial entries remain append-only', () => {
  assert.match(migration, /observation_state = 'BLANK' and quantity is null/);
  assert.match(migration, /observation_state = 'COUNTED' and quantity is not null and quantity >= 0/);
  assert.match(app, /空白（非 0）/);
  assert.match(app, /data-count-blank/);
});

test('receipt creates immutable lot identity and append-only preservation events', () => {
  assert.match(migration, /create table public\.inventory_lots/);
  assert.match(migration, /create table public\.inventory_lot_events/);
  assert.match(migration, /THAWED_UNOPENED/);
  assert.match(migration, /create_inventory_lot_after_receipt_line/);
  assert.match(migration, /Inventory lot identities and events are append-only/);
});

test('formal receipt keeps ERP handoff explicit', () => {
  assert.match(app, /待 ERP 驗收/);
  assert.match(backend, /待 ERP 驗收／已完成 PantryFlow 核對/);
});
