import assert from 'node:assert/strict';
import test from 'node:test';
import { appShellPage } from '../public/shell/pages/app-shell-pages.js';

test('on-site roles get the three-part transfer workspace', () => {
  for (const role of ['STAFF', 'SUPERVISOR']) {
    const html = appShellPage(role, 'transfers', 'CHAIN_RESTAURANT');
    for (const label of ['新增借貸／調撥', '待我方確認', '未結清借貸']) assert.match(html, new RegExp(label));
  }
});

test('management roles see cross-store status without create action', () => {
  for (const role of ['LOGISTICS', 'OWNER']) {
    const html = appShellPage(role, 'transfers', 'CHAIN_RESTAURANT');
    assert.match(html, /跨店總覽/);
    assert.doesNotMatch(html, /新增借貸／調撥/);
  }
});

test('inventory changes only after receipt confirmation', () => {
  assert.match(appShellPage('STAFF', 'transfer-created', 'CHAIN_RESTAURANT'), /確認前不更新兩店庫存/);
  const received = appShellPage('STAFF', 'transfer-received', 'CHAIN_RESTAURANT');
  assert.match(received, /兩店庫存現在才同步/);
  assert.match(received, /公司流程待辦/);
});

test('independent restaurant completion has no ERP task', () => {
  assert.doesNotMatch(appShellPage('SUPERVISOR', 'transfer-received', 'INDEPENDENT_RESTAURANT'), /ERP/);
});

test('loan return stays open until lender confirms', () => {
  const html = appShellPage('STAFF', 'transfer-return-sent', 'CHAIN_RESTAURANT');
  assert.match(html, /這筆借貸仍未結清/);
  assert.match(html, /對方確認實收 2 瓶後/);
});
