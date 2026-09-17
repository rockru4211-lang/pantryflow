import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const importFlowPath = new URL('../app/pilot/inventory-import-flow.tsx', import.meta.url);
const countWorkspacePath = new URL('../app/pilot/count-workspace.tsx', import.meta.url);

async function source(url) {
  return readFile(url, 'utf8');
}

test('inventory import keeps the new guided end-to-end flow', async () => {
  const text = await source(importFlowPath);

  for (const required of [
    '已恢復上次進度',
    '重新辨識',
    '建檔確認',
    '待補項目',
    '開始盤點',
    '移除品項',
    '本次不納入',
    'loadPersisted',
    'remove_single_imported_product_safely',
    'exclude_product_from_active_count',
  ]) {
    assert.match(text, new RegExp(required), `missing approved import behavior: ${required}`);
  }

  assert.doesNotMatch(text, /移除本次建立資料/, 'bulk removal must not return');
  assert.doesNotMatch(text, /確認並進入盤點/, 'old final CTA must not return');
});

test('importing a new file must keep already-built data and require confirmation', async () => {
  const text = await source(importFlowPath);
  assert.match(text, /改用新的檔案？目前已建立的資料會保留，不會被刪除。/);
  assert.match(text, /window\.confirm/);
});

test('guided flow keeps the approved five steps', async () => {
  const text = await source(importFlowPath);
  for (const required of ['上傳','辨識','建檔確認','待補','開始盤點']) {
    assert.match(text, new RegExp(required), `guided step disappeared: ${required}`);
  }
});

test('count workspace still contains the surrounding approved inventory features', async () => {
  const text = await source(countWorkspacePath);
  for (const required of [
    '資料匯入',
    '新增品項',
    '儲物區域',
    '期初及品項',
    '盤點範圍',
    '盤點歷史',
    'ProductBasicEditor',
    'InventoryCatalog',
  ]) {
    assert.match(text, new RegExp(required), `surrounding feature disappeared: ${required}`);
  }
});
