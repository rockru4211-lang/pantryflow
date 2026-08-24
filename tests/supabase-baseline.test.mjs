import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('supabase/baseline/manifest.json', root), 'utf8'));
const edgeManifest = JSON.parse(await readFile(new URL('supabase/baseline/edge-functions/manifest.json', root), 'utf8'));
const sha256 = value => createHash('sha256').update(value).digest('hex');

test('baseline is an immutable production snapshot, never a production deployment input', () => {
  assert.equal(manifest.baseline_id, 'PF-SUPABASE-CANONICAL-BASELINE-20260823');
  assert.equal(manifest.safety.production_mutations_performed, false);
  assert.equal(manifest.safety.production_apply_allowed, false);
  assert.equal(manifest.safety.blank_environment_only, true);
  assert.deepEqual(manifest.future_migrations, []);
});

test('all 18 production-applied SQL statements match their recorded hashes', async () => {
  assert.equal(manifest.production_applied_migrations.length, 18);
  for (const migration of manifest.production_applied_migrations) {
    assert.equal(migration.state, 'already-applied-production');
    assert.equal(migration.future_apply, false);
    const source = await readFile(new URL(`supabase/baseline/${migration.snapshot_path}`, root), 'utf8');
    const marker = 'blank-environment reconstruction only.\n\n';
    assert.ok(source.includes(marker), `${migration.version} safety marker missing`);
    const sql = source.slice(source.indexOf(marker) + marker.length).replace(/\n$/, '');
    assert.equal(sha256(sql), migration.sql_sha256);
  }
});

test('blank-only prehistory prerequisites are pinned and prohibited from production', async () => {
  assert.equal(manifest.blank_environment_prerequisites.length, 1);
  for (const prerequisite of manifest.blank_environment_prerequisites) {
    assert.equal(prerequisite.state, 'blank-only-prerequisite');
    assert.equal(prerequisite.apply_to_production, false);
    const source = await readFile(new URL(`supabase/baseline/${prerequisite.path}`, root));
    assert.equal(sha256(source), prerequisite.sql_sha256);
  }
});

test('legacy main migrations remain byte-identical and are never classified as pending production work', async () => {
  assert.equal(manifest.legacy_main_migration_ledger.length, 7);
  for (const entry of manifest.legacy_main_migration_ledger) {
    assert.equal(entry.classification, 'legacy-main-ledger');
    assert.equal(entry.apply_to_production, false);
    assert.equal(sha256(await readFile(new URL(entry.path, root))), entry.sql_sha256);
  }
});

test('all four deployed Edge Function packages are preserved with file fingerprints', async () => {
  assert.equal(edgeManifest.functions.length, 4);
  for (const fn of edgeManifest.functions) {
    assert.match(fn.ezbr_sha256, /^[a-f0-9]{64}$/);
    for (const file of fn.files) {
      const source = await readFile(new URL(`supabase/baseline/edge-functions/${fn.slug}/${file.path}`, root));
      assert.equal(sha256(source), file.sha256, `${fn.slug}/${file.path}`);
    }
  }
});
