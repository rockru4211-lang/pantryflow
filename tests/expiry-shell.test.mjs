import assert from 'node:assert/strict';
import test from 'node:test';
import { appShellPage } from '../public/shell/pages/app-shell-pages.js';

test('expiry preview follows count zones and only lists action risks', () => {
  const html = appShellPage('STAFF', 'expiry', 'INDEPENDENT_RESTAURANT');
  for (const label of ['今日效期巡檢', '沿用盤點儲物區', '正常品項不顯示', '冷藏庫', '工作冰箱', '冷凍庫', '已用完、報廢與數量不符']) assert.match(html, new RegExp(label));
  assert.doesNotMatch(html, /上次|本次/);
});

test('chain manager receives ERP waste reminder without claiming an integration', () => {
  const page = appShellPage('SUPERVISOR', 'expiry', 'CHAIN_RESTAURANT');
  for (const label of ['效期管理', '公司流程提醒', '不連線、不查驗也不寫回 ERP', '提醒完成 ERP 入廢棄']) assert.match(page, new RegExp(label));
  const result = appShellPage('SUPERVISOR', 'expiry-result-waste-chain', 'CHAIN_RESTAURANT');
  for (const label of ['序內報廢已記錄', '請至 ERP 完成入廢棄', '已完成 ERP 入廢棄']) assert.match(result, new RegExp(label));
});

test('independent expiry result stays in the app and never mentions ERP', () => {
  const page = appShellPage('SUPERVISOR', 'expiry', 'INDEPENDENT_RESTAURANT');
  const result = appShellPage('STAFF', 'expiry-result-waste', 'INDEPENDENT_RESTAURANT');
  assert.match(page, /序內資料串連/);
  assert.match(result, /報廢已記錄・已銜接庫存與廢棄/);
  assert.doesNotMatch(`${page}${result}`, /ERP/);
});

test('expiry detail keeps actual dates and immutable source wording', () => {
  const zone = appShellPage('STAFF', 'expiry-zone-cold', 'CHAIN_RESTAURANT');
  const lot = appShellPage('STAFF', 'expiry-lot-cream', 'CHAIN_RESTAURANT');
  for (const label of ['有效日期 2026/09/01', '解凍日期 2026/08/31', '正常品項不必打勾']) assert.match(zone, new RegExp(label));
  for (const label of ['原始效期不會被延後或覆蓋', '2026/09/01', '只新增事件']) assert.match(lot, new RegExp(label));
});

test('expiry child routes stay restricted to on-site roles', () => {
  const html = appShellPage('OWNER', 'expiry-lot-cream', 'CHAIN_RESTAURANT');
  assert.match(html, /此角色沒有操作權限/);
});
