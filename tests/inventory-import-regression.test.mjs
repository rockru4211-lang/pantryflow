import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const importFlowPath = new URL('../app/pilot/inventory-import-flow.tsx', import.meta.url);
const countWorkspacePath = new URL('../app/pilot/count-workspace.tsx', import.meta.url);
const historyPath = new URL('../app/pilot/import-history.tsx', import.meta.url);

async function source(url) {
  return readFile(url, 'utf8');
}

test('inventory import keeps the approved system-first flow', async () => {
  const text = await source(importFlowPath);

  for (const required of [
    '已恢復上次進度',
    '重新辨識',
    '本次建檔',
    '需確認項目',
    '開始盤點',
    '本次略過',
    '移除品項',
    '整批移除資料與品項',
    '歷史建檔',
    'loadPersisted',
    'removeInventoryImport',
    'remove_single_imported_product_safely',
    'set_pilot_count_next_period',
    'update_imported_inventory_item',
    'EXCLUDE_CURRENT',
  ]) {
    assert.match(text, new RegExp(required), `missing approved import behavior: ${required}`);
  }

  assert.doesNotMatch(text, /確認並進入盤點/, 'old final CTA must not return');
  assert.doesNotMatch(text, /exclude_product_from_active_count/, 'retired standalone exclusion RPC must not return');
  assert.doesNotMatch(text, /系統整理.*開始盤點/s, 'system processing must not appear as a required user-facing step');
});

test('importing a new file must keep already-built data and require confirmation', async () => {
  const text = await source(importFlowPath);
  assert.match(text, /改用新的檔案？目前已建立的資料會保留，不會被刪除。/);
  assert.match(text, /window\.confirm/);
});

test('exceptions use one direct edit card without a second editor expansion', async () => {
  const text = await source(importFlowPath);
  assert.match(text, /查看並修改/);
  assert.match(text, /p_zone_name/);
  assert.match(text, /p_opening_quantity/);
  assert.doesNotMatch(text, /ProductBasicEditor/);
});

test('only true import exceptions require confirmation', async () => {
  const text = await source(importFlowPath);
  assert.match(text, /const needsFix=\(item:BuiltItem\)=>Boolean\(item\.reason\)/);
  assert.match(text, /__review_reason/);
});

test('history remains compact until the user opens one build', async () => {
  const text = await source(historyPath);
  assert.match(text, /匯入盤點總覽/);
  assert.match(text, /返回匯入盤點總覽/);
  assert.match(text, /setFileId\(item\.id\)/);
});

test('count entry bypasses the legacy settings hub', async () => {
  const text = await source(countWorkspacePath);
  assert.match(text, /品項與盤點資料/);
  assert.match(text, /goTo\(productCount \? "catalog" : canImport \? "import" : "setup"\)/);
  assert.match(text, /onHistory=\{\(\)=>goTo\("source"\)\}/);
});
