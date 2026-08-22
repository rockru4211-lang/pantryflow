import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(new URL('../supabase/migrations/20260822041733_controlled_pilot_catalog_count_lots.sql', import.meta.url), 'utf8');
const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const backend = await readFile(new URL('../pilot-backend.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const actorRelationshipMigration = await readFile(new URL('../supabase/migrations/20260822144836_fix_count_actor_profile_relationships.sql', import.meta.url), 'utf8');

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

test('count actors use an explicit PostgREST profile relationship', () => {
  assert.match(actorRelationshipMigration, /count_entries_entered_by_profile_fkey/);
  assert.match(actorRelationshipMigration, /references public\.profiles\(id\)/);
  assert.match(actorRelationshipMigration, /notify pgrst, 'reload schema'/);
  assert.match(backend, /actor:profiles!count_entries_entered_by_profile_fkey\(display_name\)/);
  assert.doesNotMatch(backend, /profiles!count_entries_entered_by_fkey/);
  assert.match(app, /盤點資料關聯尚未就緒/);
  assert.match(app, /pilot-retry-load/);
  assert.match(html, /封閉 Pilot／內部測試中/);
});
