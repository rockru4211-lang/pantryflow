import assert from 'node:assert/strict';
import test from 'node:test';
import { appShellPage } from '../public/shell/pages/app-shell-pages.js';

test('on-site roles start from stock search and completed records', () => {
  for (const role of ['STAFF', 'SUPERVISOR']) {
    const html = appShellPage(role, 'transfers', 'CHAIN_RESTAURANT');
    for (const label of ['搜尋跨店庫存', '未結清借貸', '借貸與調撥紀錄']) assert.match(html, new RegExp(label));
    assert.doesNotMatch(html, /記錄已取得/);
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
  assert.match(html, /這家已借到/);
  assert.match(html, /不代表對方已答應或已替你保留/);
});

test('inventory changes only after the manager records actual receipt', () => {
  const record = appShellPage('STAFF', 'transfer-record', 'CHAIN_RESTAURANT');
  assert.match(record, /快速記錄/);
  assert.match(record, /BeApe 信義店 → BeApe 大安店/);
  assert.match(record, /實際取得數量/);
  assert.doesNotMatch(record, /select aria-label="提供門市"/);
  assert.doesNotMatch(record, /input type="text" value="火腿"/);
  assert.match(record, /只有實際拿到貨才記錄/);
  const recorded = appShellPage('STAFF', 'transfer-recorded', 'CHAIN_RESTAURANT');
  assert.match(recorded, /兩店庫存已同步/);
  assert.match(recorded, /公司流程待辦/);
});

test('independent restaurant uses the same flow without ERP', () => {
  const search = appShellPage('SUPERVISOR', 'transfer-search', 'INDEPENDENT_RESTAURANT');
  assert.match(search, /優先推薦 3 家/);
  assert.match(appShellPage('SUPERVISOR', 'transfer-record', 'INDEPENDENT_RESTAURANT'), /記錄金額（選填）/);
  assert.doesNotMatch(appShellPage('SUPERVISOR', 'transfer-record', 'CHAIN_RESTAURANT'), /記錄金額（選填）/);
  assert.doesNotMatch(appShellPage('SUPERVISOR', 'transfer-recorded', 'INDEPENDENT_RESTAURANT'), /ERP/);
});

test('actual return closes the remaining loan without an approval queue', () => {
  const html = appShellPage('STAFF', 'transfer-return-sent', 'CHAIN_RESTAURANT');
  assert.match(html, /這筆借貸已結清/);
  assert.doesNotMatch(html, /等待.*確認/);
});
