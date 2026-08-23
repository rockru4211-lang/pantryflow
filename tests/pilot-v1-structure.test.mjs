import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const html=await readFile(new URL('../pilot-v1/index.html',import.meta.url),'utf8');
const app=await readFile(new URL('../pilot-v1/app.js',import.meta.url),'utf8');
const auth=await readFile(new URL('../pilot-v1/services/auth.js',import.meta.url),'utf8');
const data=await readFile(new URL('../pilot-v1/services/data.js',import.meta.url),'utf8');
const countPage=await readFile(new URL('../pilot-v1/pages/count.js',import.meta.url),'utf8');
const migration=await readFile(new URL('../supabase/migrations/20260823132516_single_store_operational_slice.sql',import.meta.url),'utf8');
const workflow=await readFile(new URL('../.github/workflows/deploy-pages.yml',import.meta.url),'utf8');

test('formal HTML only boots pilot-v1 modules',()=>{
  assert.match(html,/type="module" src="\.\/app\.js"/);
  assert.doesNotMatch(html,/legacy-demo|\.\.\/app\.js|pilot-backend|receipt-upload-routing/);
  assert.doesNotMatch(app+auth+data,/DEFAULT_PRODUCTS|DEFAULT_RECEIVING_REVIEWS|MOCK_SESSION|localStorage/);
});

test('single-store slice exposes real setup, blind count and immutable resolution',()=>{
  for(const label of ['建立商品','建立區域','匯入商品 Excel','建立盤點任務'])assert.match(countPage,new RegExp(label));
  assert.match(data,/create_pilot_product/);
  assert.match(data,/complete_pilot_count_zone/);
  assert.match(data,/resolve_pilot_count_discrepancy/);
  assert.match(migration,/inventory_count_resolution_events/);
  assert.match(migration,/PILOT_HISTORY_IS_APPEND_ONLY/);
  assert.doesNotMatch(app+data+countPage,/localStorage|DEFAULT_PRODUCTS|DEFAULT_RECEIVING_REVIEWS|MOCK_SESSION/);
});

test('cloud services use formal Supabase data and no local fallback',()=>{
  assert.match(auth,/signInWithPassword/);
  assert.match(auth,/staff-pin-login/);
  assert.match(auth,/create_owner_business/);
  assert.match(data,/inventory_count_sessions/);
  assert.match(data,/receipt_upload_batches/);
  assert.match(data,/receipt-documents/);
  assert.match(data,/enqueue-receipt-ocr/);
  assert.doesNotMatch(app+auth+data,/localStorage|DEFAULT_PRODUCTS|DEFAULT_RECEIVING_REVIEWS|MOCK_SESSION/);
});

test('Pages deploys only pilot-v1 from dedicated preview branch',()=>{
  assert.match(workflow,/branches: \[pilot-v1-preview\]/);
  assert.match(workflow,/path: pilot-v1/);
  assert.match(workflow,/PILOT_BUILD/);
  assert.match(workflow,/github\.ref_name/);
});

test('legacy files are isolated outside formal frontend',async()=>{
  const files=await readdir(new URL('../legacy-demo/',import.meta.url));
  for(const required of ['app.js','index.html','styles.css','enhancements.css','pilot-backend.js'])assert.ok(files.includes(required));
});
