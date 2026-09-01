import assert from 'node:assert/strict';
import test from 'node:test';
import { appShellPage } from '../public/shell/pages/app-shell-pages.js';

test('expiry preview follows count zones and only lists action risks', () => {
  const html = appShellPage('STAFF', 'expiry', 'INDEPENDENT_RESTAURANT');
  for (const label of ['今日效期巡檢', '沿用盤點儲物區', '邊緣品項', '分散存放', '標籤待確認', '品質異常', '冷藏庫', '工作冰箱', '冷凍庫', '紙本標籤保留實際解凍、開封與廢棄日期']) assert.match(html, new RegExp(label));
  assert.doesNotMatch(html, /效期登記|登記解凍／開封|實際日期與時間/);
  assert.doesNotMatch(html, /上次|本次/);
});

test('chain manager uses one deferred store queue without claiming an integration', () => {
  const page = appShellPage('SUPERVISOR', 'expiry', 'CHAIN_RESTAURANT');
  for (const label of ['效期巡檢管理', '效期巡檢設定', '原包裝效期', '解凍／開封食材', '乾貨與邊緣品項', '紙本＋巡檢', '巡檢頻率', '高風險品項', '門市公司流程待辦', '不連線、不查驗也不寫回 ERP', 'ERP 驗收與入廢棄集中成門市待辦']) assert.match(page, new RegExp(label));
  const result = appShellPage('SUPERVISOR', 'expiry-result-waste-chain', 'CHAIN_RESTAURANT');
  for (const label of ['序內報廢已記錄', '已加入門市公司流程待辦', '不必現在執行', '查看公司流程待辦']) assert.match(result, new RegExp(label));
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

test('independent expiry result stays in the app and never mentions ERP', () => {
  const page = appShellPage('SUPERVISOR', 'expiry', 'INDEPENDENT_RESTAURANT');
  const result = appShellPage('STAFF', 'expiry-result-waste', 'INDEPENDENT_RESTAURANT');
  assert.match(page, /序內資料串連/);
  assert.match(result, /報廢已記錄・已銜接庫存與廢棄/);
  assert.doesNotMatch(`${page}${result}`, /ERP/);
});

test('expiry detail uses paper labels and checks every storage location', () => {
  const zone = appShellPage('STAFF', 'expiry-zone-cold', 'CHAIN_RESTAURANT');
  const lot = appShellPage('STAFF', 'expiry-lot-cream', 'CHAIN_RESTAURANT');
  const opened = appShellPage('STAFF', 'expiry-lot-ham', 'CHAIN_RESTAURANT');
  for (const label of ['原包裝效期 2026/09/01', '後排品項', '火腿', '冷藏庫與工作冰箱皆有存放', '本區巡檢完成', '紙本標籤及原包裝為準']) assert.match(zone, new RegExp(label));
  for (const label of ['原包裝日期', '原包裝效期', '確認正常', '標籤異常', '發現變質']) assert.match(lot, new RegExp(label));
  for (const label of ['火腿', '現場紙本標籤', '標籤・氣味・外觀', '冷藏庫＋工作冰箱', '不取代現場標籤']) assert.match(opened, new RegExp(label));
  assert.doesNotMatch(`${zone}${opened}`, /解凍登記|預計使用期限|確認登記並開始計時/);
});

test('zone completion and label exceptions stay simple', () => {
  const normal = appShellPage('STAFF', 'expiry-result-normal', 'CHAIN_RESTAURANT');
  const label = appShellPage('STAFF', 'expiry-result-label', 'CHAIN_RESTAURANT');
  for (const text of ['本區巡檢完成', '已確認紙本標籤與現場品質', '沒有逐包重抄日期', '巡下一個區域']) assert.match(normal, new RegExp(text));
  for (const text of ['標籤異常已回報', '請現場補貼或更正紙本標籤', '工作冰箱仍有同品項', '已通知店長']) assert.match(label, new RegExp(text));
});

test('expiry child routes stay restricted to on-site roles', () => {
  const html = appShellPage('OWNER', 'expiry-lot-cream', 'CHAIN_RESTAURANT');
  assert.match(html, /此角色沒有操作權限/);
});
