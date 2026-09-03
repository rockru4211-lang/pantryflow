import assert from 'node:assert/strict';
import test from 'node:test';
import { appShellPage } from '../public/shell/pages/app-shell-pages.js';

test('on-site roles order search, new record, open loans and history', () => {
  for (const role of ['STAFF', 'SUPERVISOR']) {
    const html = appShellPage(role, 'transfers', 'CHAIN_RESTAURANT');
    for (const label of ['搜尋跨店庫存', '新增借貸／調撥紀錄', '未結清借貸', '借貸與調撥紀錄']) assert.match(html, new RegExp(label));
    assert.ok(html.indexOf('搜尋跨店庫存') < html.indexOf('新增借貸／調撥紀錄'));
    assert.ok(html.indexOf('新增借貸／調撥紀錄') < html.indexOf('未結清借貸'));
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

test('search only recommends stores and update times without quantities or record actions', () => {
  const html = appShellPage('SUPERVISOR', 'transfer-search', 'CHAIN_RESTAURANT');
  assert.match(html, /從 16 家門市中快篩/);
  assert.match(html, /優先推薦 3 家/);
  assert.match(html, /庫存較寬裕/);
  assert.match(html, /今日 09:40 更新/);
  assert.doesNotMatch(html, /目前庫存/);
  assert.doesNotMatch(html, /安全庫存/);
  assert.doesNotMatch(html, /約可提供/);
  assert.doesNotMatch(html, /借貸記錄/);
  assert.doesNotMatch(html, /調撥記錄/);
  assert.doesNotMatch(html, /這家已借到/);
  assert.match(html, /實際品項與數量請聯絡門市確認/);
});

test('new record is separate from search results', () => {
  const html = appShellPage('SUPERVISOR', 'transfer-record', 'CHAIN_RESTAURANT');
  assert.match(html, /新增借貸／調撥紀錄/);
  assert.match(html, /異動方式/);
  assert.match(html, /提供門市/);
  assert.match(html, /品項/);
  assert.match(html, /實際取得數量/);
});

test('actual borrowing creates a return reminder without changing inventory or ERP', () => {
  const record = appShellPage('STAFF', 'transfer-loan-record', 'CHAIN_RESTAURANT');
  assert.match(record, /借貸記錄/);
  assert.match(record, /BeApe 信義店 → BeApe 大安店/);
  assert.match(record, /實際取得數量/);
  assert.match(record, /預計歸還日/);
  assert.doesNotMatch(record, /異動方式/);
  assert.doesNotMatch(record, /select aria-label="提供門市"/);
  assert.doesNotMatch(record, /input type="text" value="火腿"/);
  assert.match(record, /只有實際拿到貨才記錄/);
  const recorded = appShellPage('STAFF', 'transfer-recorded', 'CHAIN_RESTAURANT');
  assert.match(recorded, /已建立還貨提醒/);
  assert.match(recorded, /預計 09\/08 歸還/);
  assert.doesNotMatch(recorded, /庫存已同步|信義店 −|大安店 ＋|ERP|公司流程待辦/);
});

test('independent restaurant uses the same flow without ERP', () => {
  const search = appShellPage('SUPERVISOR', 'transfer-search', 'INDEPENDENT_RESTAURANT');
  assert.match(search, /優先推薦 3 家/);
  assert.match(appShellPage('SUPERVISOR', 'transfer-loan-record', 'INDEPENDENT_RESTAURANT'), /記錄金額（選填）/);
  assert.doesNotMatch(appShellPage('SUPERVISOR', 'transfer-loan-record', 'CHAIN_RESTAURANT'), /記錄金額（選填）/);
  assert.doesNotMatch(appShellPage('SUPERVISOR', 'transfer-recorded', 'INDEPENDENT_RESTAURANT'), /ERP/);
});

test('transfer record opens directly without loan-only fields', () => {
  const html = appShellPage('SUPERVISOR', 'transfer-move-record', 'CHAIN_RESTAURANT');
  assert.match(html, /調撥記錄/);
  assert.match(html, /完成調撥記錄/);
  assert.doesNotMatch(html, /預計歸還日/);
  assert.doesNotMatch(html, /異動方式/);
});

test('actual return closes the remaining loan without an approval queue', () => {
  const html = appShellPage('STAFF', 'transfer-return-sent', 'CHAIN_RESTAURANT');
  assert.match(html, /這筆借貸已結清/);
  assert.match(html, /還貨提醒已結束/);
  assert.doesNotMatch(html, /庫存.*同步|ERP/);
  assert.doesNotMatch(html, /等待.*確認/);
});

test('count difference only shows the open-loan number as reference', () => {
  const html = appShellPage('SUPERVISOR', 'count-review', 'CHAIN_RESTAURANT');
  assert.match(html, /未結清借貸：借出 1\.5 kg/);
  assert.doesNotMatch(html, /連結借貸|比對借貸|確認借貸/);
});
