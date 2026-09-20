import test from 'node:test';
import assert from 'node:assert/strict';
import { importRemovalConfirmation, importRemovalError, removeInventoryImport } from '../lib/inventory-import-removal.ts';

test('one batch RPC removes the selected file from the selected store, without individual product calls', async () => {
  const calls = [];
  const message = await removeInventoryImport(async (...args) => {
    calls.push(args);
    return {data: {removed: 300, shared: 0, hidden: true}, error: null};
  }, 'store-b', 'file-sha');
  assert.deepEqual(calls, [['undo_inventory_import_batch', {p_store_id: 'store-b', p_file_sha256: 'file-sha'}]]);
  assert.match(message, /300 個品項/);
});

test('confirmation identifies both the file and store and includes unfinished count contents', () => {
  const text = importRemovalConfirmation('錯店盤點表.xlsx', '二店');
  assert.match(text, /錯店盤點表.xlsx/);
  assert.match(text, /門市：二店/);
  assert.match(text, /未完成盤點內容/);
});

test('shared products are disclosed rather than claiming all products were removed', async () => {
  const message = await removeInventoryImport(async () => ({data: {removed: 298, shared: 2, hidden: true}, error: null}), 'store-b', 'file-sha');
  assert.match(message, /298 個品項/);
  assert.match(message, /2 個品項仍由其他匯入資料使用/);
});

test('denied, partial or missing acknowledgements never become a completed removal', async () => {
  for (const result of [
    {data: null, error: {message: 'STORE_MANAGER_REQUIRED'}},
    {data: null, error: null},
    {data: {removed: 3, hidden: false}, error: null},
    {data: {hidden: true}, error: null},
    {data: {removed: -1, hidden: true}, error: null},
  ]) await assert.rejects(removeInventoryImport(async () => result, 'store-b', 'file-sha'));
  await assert.rejects(removeInventoryImport(async () => {throw Error('offline');}, 'store-b', 'file-sha'));
  assert.match(importRemovalError(new Error('STORE_MANAGER_REQUIRED')), /權限/);
  assert.doesNotMatch(importRemovalError(new Error('private details')), /private details/);
});
