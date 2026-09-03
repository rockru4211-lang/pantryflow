import assert from 'node:assert/strict';
import test from 'node:test';
import { appShellPage } from '../public/shell/pages/app-shell-pages.js';

test('waste home has three concise entries without approval queue', () => {
  const html = appShellPage('STAFF', 'waste', 'INDEPENDENT_RESTAURANT');
  for (const label of ['新增廢棄', '今日廢棄', '廢棄紀錄']) assert.match(html, new RegExp(label));
  assert.ok(html.indexOf('新增廢棄') < html.indexOf('今日廢棄'));
  assert.ok(html.indexOf('今日廢棄') < html.indexOf('廢棄紀錄'));
  assert.doesNotMatch(html, /待確認紀錄|廢棄趨勢/);
});

test('new waste record only asks for necessary fields', () => {
  const html = appShellPage('STAFF', 'waste-new', 'INDEPENDENT_RESTAURANT');
  for (const label of ['品項', '數量', '單位', '廢棄原因', '補充說明（選填）']) assert.match(html, new RegExp(label));
  assert.match(html, /list="waste-item-options"/);
  assert.match(html, /門市、經手人與時間會自動保存/);
  assert.doesNotMatch(html, /主管核准|送出審核/);
});

test('today waste is a clean read-only list', () => {
  const today = appShellPage('SUPERVISOR', 'waste-today', 'INDEPENDENT_RESTAURANT');
  assert.match(today, /今日廢棄/);
  assert.doesNotMatch(today, /更正|data-route="waste-correction"/);
});

test('waste history defaults to the current month', () => {
  const html = appShellPage('LOGISTICS', 'waste-history', 'INDEPENDENT_RESTAURANT');
  assert.match(html, /2026 年 9 月/);
  assert.match(html, /9 月紀錄/);
  assert.match(html, /大安店/);
  assert.match(html, /本月參考金額/);
});

test('non-ERP stores can reveal estimated amounts without manual price entry', () => {
  const independent = appShellPage('STAFF', 'waste-today', 'INDEPENDENT_RESTAURANT');
  assert.match(independent, /顯示金額/);
  assert.match(independent, /今日參考金額/);
  assert.match(independent, /參考金額 NT\$360/);
  assert.doesNotMatch(appShellPage('STAFF', 'waste-new', 'INDEPENDENT_RESTAURANT'), /單價|金額/);
  const erp = appShellPage('STAFF', 'waste-today', 'CHAIN_RESTAURANT');
  assert.doesNotMatch(erp, /顯示金額|參考金額|NT\$/);
});

test('ERP only changes the post-record company step', () => {
  const independent = appShellPage('STAFF', 'waste-complete', 'INDEPENDENT_RESTAURANT');
  const chain = appShellPage('STAFF', 'waste-complete', 'CHAIN_RESTAURANT');
  assert.match(independent, /廢棄已記錄/);
  assert.doesNotMatch(independent, /ERP/);
  assert.match(chain, /已加入今日 ERP 廢棄彙整/);
  assert.match(chain, /提醒負責人登入 ERP 輸入/);
});
