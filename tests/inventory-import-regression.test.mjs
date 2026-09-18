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
    '處理',
    '本次略過',
    '移除品項',
    '整批移除本次建檔',
    '歷史建檔',
    'loadPersisted',
    'undo_inventory_import_batch',
    'remove_single_imported_product_safely',
    'set_pilot_count_next_period',
    'EXCLUDE_CURRENT',
  ]) {
    assert.match(text, new RegExp(required), `missing approved import behavior: ${required}`);
  }

  assert.doesNotMatch(text, /確認並進入盤點/, 'old final CTA must not return');
  assert.doesNotMatch(text, /exclude_product_from_active_count/, 'retired standalone exclusion RPC must not return');
});

test('importing a new file must keep already-built data and require confirmation', async () => {
  const text = await source(importFlowPath);
  assert.match(text, /改用新的檔案？目前已建立的資料會保留，不會被刪除。/);
  assert.match(text, /window\.confirm/);
});

test('main flow stays at three user-facing steps', async () => {
  const text = await source(importFlowPath);
  for (const required of ['上傳資料','系統整理','開始盤點']) {
    assert.match(text, new RegExp(required), `main flow step disappeared: ${required}`);
  }
  assert.match(text, /只處理例外/);
  assert.match(text, /未完整資料可之後補/);
});

test('history remains compact until the user opens one build', async () => {
  const text = await source(historyPath);
  assert.match(text, /歷史建檔/);
  assert.match(text, /返回歷史建檔/);
  assert.match(text, /setFileId\(item\.id\)/);
});

test('count entry bypasses the legacy settings hub', async () => {
  const text = await source(countWorkspacePath);
  assert.match(text, /品項與盤點資料/);
  assert.match(text, /goTo\(productCount \? "catalog" : canImport \? "import" : "setup"\)/);
  assert.match(text, /onHistory=\{\(\)=>goTo\("source"\)\}/);
});
