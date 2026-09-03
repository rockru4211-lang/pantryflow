import assert from 'node:assert/strict';
import test from 'node:test';
import { appShellPage } from '../public/shell/pages/app-shell-pages.js';

test('on-site roles start from stock search and completed records', () => {
  for (const role of ['STAFF', 'SUPERVISOR']) {
    const html = appShellPage(role, 'transfers', 'CHAIN_RESTAURANT');
    for (const label of ['搜尋跨店庫存', '記錄已取得', '未結清借貸', '借貸與調撥紀錄']) assert.match(html, new RegExp(label));
    assert.doesNotMatch(html, /待我方確認|等待對方確認|線上同意/);
  }
});

test('management roles can search and view without recording movement', () => {
  for (const role of ['LOGISTICS', 'OWNER']) {
    const html = appShellPage(role, 'transfers', 'CHAIN_RESTAURANT');
    assert.match(html, /跨店總覽/);
    assert.match(html, /搜尋跨店庫存/);
    assert.doesNotMatch(html, /記錄已取得/);
  }
});

test('search narrows all stores to three recommendations without reserving stock', () => {
  const html = appShellPage('SUPERVISOR', 'transfer-search', 'CHAIN_RESTAURANT');
  assert.match(html, /從 16 家門市中快篩/);
  assert.match(html, /優先推薦 3 家/);
  assert.match(html, /目前庫存/);
  assert.match(html, /安全庫存/);
  assert.match(html, /不代表對方已答應或已替你保留/);
});

test('inventory changes only after the manager records actual receipt', () => {
  assert.match(appShellPage('STAFF', 'transfer-record', 'CHAIN_RESTAURANT'), /只有實際拿到貨才完成記錄/);
  const recorded = appShellPage('STAFF', 'transfer-recorded', 'CHAIN_RESTAURANT');
  assert.match(recorded, /兩店庫存已同步/);
  assert.match(recorded, /公司流程待辦/);
});

test('independent restaurant uses the same flow without ERP', () => {
  const search = appShellPage('SUPERVISOR', 'transfer-search', 'INDEPENDENT_RESTAURANT');
  assert.match(search, /優先推薦 3 家/);
  assert.doesNotMatch(appShellPage('SUPERVISOR', 'transfer-recorded', 'INDEPENDENT_RESTAURANT'), /ERP/);
});

test('actual return closes the remaining loan without an approval queue', () => {
  const html = appShellPage('STAFF', 'transfer-return-sent', 'CHAIN_RESTAURANT');
  assert.match(html, /這筆借貸已結清/);
  assert.doesNotMatch(html, /等待.*確認/);
});
