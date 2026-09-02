import assert from 'node:assert/strict';
import test from 'node:test';
import { appShellPage } from '../public/shell/pages/app-shell-pages.js';

test('expiry home only shows ingredients inside the reminder window', () => {
  const html = appShellPage('STAFF', 'expiry', 'CHAIN_RESTAURANT');
  for (const label of ['效期提醒', '只顯示已進入提醒期', '今日到期', '明日到期', '3 日內', '進入處理', '主管留言', '加入效期品項']) assert.match(html, new RegExp(label));
  assert.doesNotMatch(html, /待處理效期 3 項|加入邊緣食材|3 區需巡檢|開始巡檢|本區正常/);
});

test('expiry uses inbound and edge ingredients for both restaurant types', () => {
  for (const businessType of ['CHAIN_RESTAURANT', 'INDEPENDENT_RESTAURANT']) {
    const inbound = appShellPage('STAFF', 'expiry-inbound', businessType);
    const edge = appShellPage('STAFF', 'expiry-edge', businessType);
    for (const label of ['進貨效期', '原包裝效期', '生鮮', '進貨日', '品質巡檢']) assert.match(inbound, new RegExp(label));
    for (const label of ['邊緣食材', '開封後用得慢', '現場標籤', '加入邊緣食材']) assert.match(edge, new RegExp(label));
  }
});

test('chain manager sees only due items and can leave item-linked comments', () => {
  const page = appShellPage('SUPERVISOR', 'expiry', 'CHAIN_RESTAURANT');
  for (const label of ['門市效期看板', '已到期', '今日到期', '明日到期', '門市需要留意', '留言', '主管留言', '待回覆']) assert.match(page, new RegExp(label));
  assert.doesNotMatch(page, /尚未巡檢|App 使用追蹤|最後登入/);
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

test('reminder list is grouped by area and item actions stay minimal', () => {
  const overview = appShellPage('STAFF', 'expiry-inspection', 'CHAIN_RESTAURANT');
  const zone = appShellPage('STAFF', 'expiry-zone-work', 'CHAIN_RESTAURANT');
  for (const label of ['待處理效期', '1 日／3 日提醒期', '工作冰箱', '冷藏庫', '雞高湯', '自製奶油醬', '鮮奶油 1L']) assert.match(overview, new RegExp(label));
  for (const label of ['雞高湯', '明日到期', '日期依據', '現場標籤', '未到期・繼續使用', '紀錄廢棄', '其他', '主管留言']) assert.match(zone, new RegExp(label));
  assert.doesNotMatch(zone, /已使用完/);
  assert.doesNotMatch(`${overview}${zone}`, /尚未巡檢|開始巡檢|完成本區巡檢|本區正常/);
});

test('staff home embeds expiry and supervisor comment in daily work', () => {
  const home = appShellPage('STAFF', 'home', 'CHAIN_RESTAURANT');
  for (const label of ['效期需留意 3 項', '今日到期 1 項', '明日到期 2 項', '工作冰箱 2 項', '冷藏庫 1 項', '主管留言', '雞高湯請今晚優先使用']) assert.match(home, new RegExp(label));
});

test('expired discovery flows directly into one-time waste registration', () => {
  const issue = appShellPage('STAFF', 'expiry-issue', 'CHAIN_RESTAURANT');
  const expired = appShellPage('STAFF', 'expiry-expired', 'CHAIN_RESTAURANT');
  const discard = appShellPage('STAFF', 'expiry-discard', 'CHAIN_RESTAURANT');
  for (const label of ['發現其他效期問題', '發現已到期', '日期標示不清', '食材品質異常']) assert.match(issue, new RegExp(label));
  for (const label of ['已到期，請立即移出可使用區', '移出待廢棄', '已使用完', '找不到', '標示異常']) assert.match(expired, new RegExp(label));
  for (const label of ['紀錄廢棄', '效期到期', '廢棄數量', '新增照片', '選填', '確認移出並紀錄廢棄', '不必再進入廢棄模組']) assert.match(discard, new RegExp(label));
});

test('add expiry item covers packaged and edge ingredients with supervisor-defined reasons', () => {
  const form = appShellPage('STAFF', 'expiry-suggest', 'CHAIN_RESTAURANT');
  for (const label of ['加入效期品項', '包裝效期', '效期依據', '原包裝／進貨時輸入', '現場開封或解凍標籤', '儲物區效期表', '到期日', '保存期限短', '使用速度慢', '容易被遺忘', '主管自訂']) assert.match(form, new RegExp(label));
  assert.doesNotMatch(form, /加入邊緣食材/);
});

test('waste completion differs only after the shared expiry flow', () => {
  const chain = appShellPage('STAFF', 'expiry-discard-complete', 'CHAIN_RESTAURANT');
  const independent = appShellPage('STAFF', 'expiry-discard-complete', 'INDEPENDENT_RESTAURANT');
  for (const label of ['已移出並完成廢棄紀錄', '一次完成兩筆紀錄', '效期處理結果', '廢棄與庫存異動']) {
    assert.match(chain, new RegExp(label));
    assert.match(independent, new RegExp(label));
  }
  assert.match(chain, /ERP 入廢棄待辦/);
  assert.doesNotMatch(independent, /ERP 入廢棄待辦/);
});

test('completed inspection records operator, area and time', () => {
  const result = appShellPage('STAFF', 'expiry-result-inspected', 'CHAIN_RESTAURANT');
  for (const text of ['本區巡檢已完成', '工作冰箱・王小明・今天 16:20', '必要確認 2 項已完成', '巡下一個區域']) assert.match(result, new RegExp(text));
});

test('expiry child routes stay restricted to on-site roles', () => {
  const html = appShellPage('OWNER', 'expiry-lot-cream', 'CHAIN_RESTAURANT');
  assert.match(html, /此角色沒有操作權限/);
});
