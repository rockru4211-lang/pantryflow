import assert from 'node:assert/strict';
import test from 'node:test';
import { appShellPage } from '../public/shell/pages/app-shell-pages.js';

test('expiry home keeps routine work area-based and exceptions focused', () => {
  const html = appShellPage('STAFF', 'expiry', 'CHAIN_RESTAURANT');
  for (const label of ['效期管理', '3 區需巡檢', '今日儲放區巡檢', '特別注意品項', '到期警報', '建議加入注意品項', '未完成不會自動視為正常']) assert.match(html, new RegExp(label));
  assert.doesNotMatch(html, /登記解凍／開封|每個品項都要|本區正常/);
});

test('chain manager sees completion evidence and only actionable exceptions', () => {
  const page = appShellPage('SUPERVISOR', 'expiry', 'CHAIN_RESTAURANT');
  for (const label of ['效期巡檢管理', '尚未巡檢', '陳怡安・今天 15:42', 'App 使用追蹤', '最後登入', '未使用 App 不會被視為已巡檢']) assert.match(page, new RegExp(label));
});

test('quantity mismatch requires employee reason before notifying manager', () => {
  const form = appShellPage('STAFF', 'expiry-quantity-reason', 'CHAIN_RESTAURANT');
  for (const label of ['回報數量不符', '系統紀錄 4 瓶／現場 3 瓶', '請選擇原因（必填）', '使用未登記', '報廢未登記', '移轉／借用未登記', '標示或盤點錯誤', '補充說明']) assert.match(form, new RegExp(label));
  const result = appShellPage('STAFF', 'expiry-result-quantity', 'CHAIN_RESTAURANT');
  for (const label of ['數量不符・員工已回報原因', '系統 4 瓶／現場 3 瓶', '原因：使用未登記', '王小明']) assert.match(result, new RegExp(label));
  assert.doesNotMatch(`${form}${result}`, /已送主管確認/);
});

test('chain staff and manager share the deferred company task queue', () => {
  const staff = appShellPage('STAFF', 'store-company-tasks', 'CHAIN_RESTAURANT');
  for (const label of ['公司流程待辦', '可在較有空時統一', '進貨・ERP 驗收', '廢棄・ERP 入廢棄', '閉店前提醒店長', '不會讀取、查驗或寫回 ERP']) assert.match(staff, new RegExp(label));
  assert.match(appShellPage('STAFF', 'home', 'CHAIN_RESTAURANT'), /ERP 待完成/);
  assert.match(appShellPage('SUPERVISOR', 'home', 'CHAIN_RESTAURANT'), /門市統一處理/);
  assert.match(appShellPage('STAFF', 'store-company-tasks', 'INDEPENDENT_RESTAURANT'), /此角色沒有操作權限/);
});

test('independent expiry management never mentions ERP', () => {
  const page = appShellPage('SUPERVISOR', 'expiry', 'INDEPENDENT_RESTAURANT');
  const result = appShellPage('STAFF', 'expiry-result-waste', 'INDEPENDENT_RESTAURANT');
  assert.match(result, /報廢已記錄・已銜接庫存與廢棄/);
  assert.doesNotMatch(`${page}${result}`, /ERP/);
});

test('area inspection requires explicit checks before completion', () => {
  const overview = appShellPage('STAFF', 'expiry-inspection', 'CHAIN_RESTAURANT');
  const zone = appShellPage('STAFF', 'expiry-zone-work', 'CHAIN_RESTAURANT');
  for (const label of ['尚未巡檢', '開始巡檢', '已巡檢', '陳怡安・今天 15:42']) assert.match(overview, new RegExp(label));
  for (const label of ['必要確認 1', '必要確認 2', '仍在現場', '已使用完', '找不到', '發現異常', '未標示品項', '完成本區巡檢', 'disabled']) assert.match(zone, new RegExp(label));
  assert.doesNotMatch(`${overview}${zone}`, /本區正常|確認正常/);
});

test('completed inspection records operator, area and time', () => {
  const result = appShellPage('STAFF', 'expiry-result-inspected', 'CHAIN_RESTAURANT');
  for (const text of ['本區巡檢已完成', '工作冰箱・王小明・今天 16:20', '必要確認 2 項已完成', '巡下一個區域']) assert.match(result, new RegExp(text));
});

test('expiry child routes stay restricted to on-site roles', () => {
  const html = appShellPage('OWNER', 'expiry-lot-cream', 'CHAIN_RESTAURANT');
  assert.match(html, /此角色沒有操作權限/);
});
