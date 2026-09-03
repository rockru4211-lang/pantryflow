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

test('today waste allows an additive correction while preserving original record', () => {
  const today = appShellPage('SUPERVISOR', 'waste-today', 'INDEPENDENT_RESTAURANT');
  assert.match(today, /今日廢棄/);
  assert.match(today, /更正/);
  const correction = appShellPage('SUPERVISOR', 'waste-correction', 'INDEPENDENT_RESTAURANT');
  assert.match(correction, /原紀錄會完整保留/);
  assert.match(correction, /更正原因/);
});

test('waste history defaults to the current month', () => {
  const html = appShellPage('LOGISTICS', 'waste-history', 'INDEPENDENT_RESTAURANT');
  assert.match(html, /2026 年 9 月/);
  assert.match(html, /9 月紀錄/);
  assert.match(html, /大安店/);
});

test('ERP only changes the post-record company step', () => {
  const independent = appShellPage('STAFF', 'waste-complete', 'INDEPENDENT_RESTAURANT');
  const chain = appShellPage('STAFF', 'waste-complete', 'CHAIN_RESTAURANT');
  assert.match(independent, /廢棄已記錄/);
  assert.doesNotMatch(independent, /ERP/);
  assert.match(chain, /已加入今日 ERP 廢棄彙整/);
});
