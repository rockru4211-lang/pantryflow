import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { appShellPage } from '../public/shell/pages/app-shell-pages.js';

test('expiry home uses four fixed summary cards before opening lists', () => {
  const html = appShellPage('STAFF', 'expiry', 'CHAIN_RESTAURANT');
  for (const label of ['效期提醒', '現場效期表負責完整記錄', '立即處理', '預告', '風險區', '特別注意', '新增現場提醒']) assert.match(html, new RegExp(label));
  assert.doesNotMatch(html, /現在需要處理|近期需要留意|目前不需操作|登記廢棄|已使用完|3 區需巡檢|開始巡檢/);
});

test('upcoming and special-attention cards use distinct status colors', () => {
  const css = readFileSync(new URL('../public/shell/app-shell.css', import.meta.url), 'utf8');
  assert.match(css, /\.expiry-entry-card\.warning\{border-color:#efd5a6;background:#fffaf0\}/);
  assert.match(css, /\.expiry-entry-card\.special\{border-color:#d9d0dc;background:#f4f1f5\}/);
  assert.match(css, /\.expiry-food-card\.special\{border-color:#d9d0dc;background:#f4f1f5\}/);
});

test('expiry card destinations show direct content without another area step', () => {
  const urgent = appShellPage('STAFF', 'expiry-urgent', 'CHAIN_RESTAURANT');
  const upcoming = appShellPage('STAFF', 'expiry-upcoming', 'CHAIN_RESTAURANT');
  const risks = appShellPage('STAFF', 'expiry-risk-zones', 'CHAIN_RESTAURANT');
  const special = appShellPage('STAFF', 'expiry-special', 'CHAIN_RESTAURANT');

  for (const label of ['雞高湯', '已到期｜09/02', '工作冰箱', '鮮奶油', '今日到期｜09/02', '冷藏庫 A', '登記廢棄', '已使用完', '前一天已提醒']) assert.match(urgent, new RegExp(label));
  assert.doesNotMatch(urgent, /仍在現場|其他/);
  for (const label of ['自製奶油醬', '明日到期｜09/03', '工作冰箱', '煙燻鮭魚', '3 日後到期｜09/05', '冷藏庫 A']) assert.match(upcoming, new RegExp(label));
  assert.doesNotMatch(upcoming, /目前不需操作|登記廢棄|已使用完/);
  for (const label of ['工作台抽屜', '抽屜最內側', '冷藏貨架最下層', '後方死角', '乾料櫃頂層', '視線以上']) assert.match(risks, new RegExp(label));
  for (const label of ['煙燻紅椒粉', '2027\/02\/18', '松露粉', '2026\/12\/30', '香料油', '2026\/10\/15']) assert.match(special, new RegExp(label));
  assert.doesNotMatch(`${urgent}${upcoming}${risks}${special}`, /加入效期品項|選擇儲物區/);
});

test('expiry uses inbound and edge ingredients for both restaurant types', () => {
  for (const businessType of ['CHAIN_RESTAURANT', 'INDEPENDENT_RESTAURANT']) {
    const inbound = appShellPage('STAFF', 'expiry-inbound', businessType);
    const edge = appShellPage('STAFF', 'expiry-edge', businessType);
    for (const label of ['進貨效期', '原包裝效期', '生鮮', '進貨日', '品質巡檢']) assert.match(inbound, new RegExp(label));
    for (const label of ['邊緣食材', '開封後用得慢', '現場標籤', '新增現場提醒']) assert.match(edge, new RegExp(label));
  }
});

test('staff and managers share one four-entry expiry surface', () => {
  for (const businessType of ['CHAIN_RESTAURANT', 'INDEPENDENT_RESTAURANT']) {
    for (const role of ['STAFF', 'SUPERVISOR']) {
      const page = appShellPage(role, 'expiry', businessType);
      for (const label of ['立即處理', '預告', '風險區', '特別注意']) assert.match(page, new RegExp(label));
    }
  }
  const manager = appShellPage('SUPERVISOR', 'expiry', 'CHAIN_RESTAURANT');
  for (const label of ['共用同一份待處理清單', '作業紀錄／廢棄紀錄']) assert.match(manager, new RegExp(label));
  assert.doesNotMatch(manager, /管理與查核|延誤與廢棄查核|今日 ERP 廢棄彙整/);
  const independent = appShellPage('SUPERVISOR', 'expiry', 'INDEPENDENT_RESTAURANT');
  assert.doesNotMatch(independent, /ERP/);
});

test('chain area supervisor reuses expiry cards with cross-store read-only controls', () => {
  const page = appShellPage('LOGISTICS', 'expiry', 'CHAIN_RESTAURANT');
  for (const label of ['立即處理', '預告', '風險區', '特別注意', '查看範圍', '切換門市']) assert.match(page, new RegExp(label));
  assert.doesNotMatch(page, /跨店查核|跨店 ERP 完成狀況/);
  assert.doesNotMatch(page, /新增現場提醒/);
  const urgent = appShellPage('LOGISTICS', 'expiry-urgent', 'CHAIN_RESTAURANT');
  assert.doesNotMatch(urgent, /data-route="expiry-discard|data-route="expiry-used-confirm/);
  assert.match(appShellPage('LOGISTICS', 'expiry', 'INDEPENDENT_RESTAURANT'), /此角色沒有操作權限/);
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
  for (const label of ['公司流程待辦', '可在較有空時統一', '進貨・ERP 驗收', '登入 ERP 輸入今日廢棄', '6 筆', '21:30', '不會讀取、查驗或寫回 ERP']) assert.match(staff, new RegExp(label));
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

test('staff home turns the three priorities into direct action shortcuts', () => {
  const home = appShellPage('STAFF', 'home', 'CHAIN_RESTAURANT');
  for (const [label, route] of [['缺貨品項', 'shortage-items'], ['效期提醒', 'expiry'], ['待處理', 'tasks']]) {
    assert.match(home, new RegExp(`data-route="${route}"[^>]*>[\\s\\S]*?${label}`));
  }
  assert.doesNotMatch(home, /缺貨風險|即期提醒|待確認|另有風險區與特別注意提醒/);
  const shortage = appShellPage('STAFF', 'shortage-items', 'CHAIN_RESTAURANT');
  for (const label of ['火腿', '鮮奶油', '牛菲力', '搜尋其他門市庫存']) assert.match(shortage, new RegExp(label));
  const singleStore = appShellPage('STAFF', 'shortage-items', 'INDEPENDENT_RESTAURANT', { linkedStoreCount: 1 });
  assert.doesNotMatch(singleStore, /搜尋其他門市庫存|transfer-search/);
});

test('expired discovery flows directly into one-time waste registration', () => {
  const issue = appShellPage('STAFF', 'expiry-issue', 'CHAIN_RESTAURANT');
  const expired = appShellPage('STAFF', 'expiry-expired', 'CHAIN_RESTAURANT');
  const directDiscard = appShellPage('STAFF', 'expiry-discard-work', 'CHAIN_RESTAURANT');
  const overdueDiscard = appShellPage('STAFF', 'expiry-discard-overdue-work', 'CHAIN_RESTAURANT');
  for (const label of ['發現其他效期問題', '發現已到期', '日期標示不清', '食材品質異常']) assert.match(issue, new RegExp(label));
  for (const label of ['前一天已提醒', '現在必須完成處理', '登記廢棄', '已使用完']) assert.match(expired, new RegExp(label));
  assert.doesNotMatch(expired, /仍在現場/);
  for (const label of ['登記廢棄', '正常處理今日到期品', '廢棄數量', '確認並記錄廢棄']) assert.match(directDiscard, new RegExp(label));
  assert.doesNotMatch(directDiscard, /為什麼還在現場|未處理原因/);
  for (const label of ['登記廢棄並回報延誤', '為什麼未在到期前處理？（必填）', '未依前一天提醒處理', '廢棄數量', '回報延誤並記錄廢棄']) assert.match(overdueDiscard, new RegExp(label));
  assert.doesNotMatch(overdueDiscard, /仍在現場|未查看 App 提醒|已查看但未處理|儲放死角遺漏|照片|拍照|camera/);
});

test('on-site reminder is a lightweight supplement to receiving expiry', () => {
  const form = appShellPage('STAFF', 'expiry-suggest', 'CHAIN_RESTAURANT');
  for (const label of ['新增現場提醒', '現場巡視', '自製、分裝、開封', '到期日', '目前儲放區', '系統建議', '現場人員確認', '保存期限短', '使用速度慢', '容易被遺忘', '資料來源：現場巡視', '進貨驗收負責建立大部分包裝效期', '系統判定：預告', '立即處理 ＞ 預告 ＞ 特別注意']) assert.match(form, new RegExp(label));
  assert.doesNotMatch(form, /效期依據|原包裝／進貨時輸入|加入效期品項|加入邊緣食材/);
});

test('waste completion differs only after the shared expiry flow', () => {
  const chain = appShellPage('STAFF', 'expiry-discard-complete-work', 'CHAIN_RESTAURANT');
  const overdue = appShellPage('STAFF', 'expiry-discard-complete-overdue-work', 'CHAIN_RESTAURANT');
  const independent = appShellPage('STAFF', 'expiry-discard-complete', 'INDEPENDENT_RESTAURANT');
  for (const label of ['廢棄紀錄已完成', '本次廢棄紀錄', '品項：雞高湯', '數量：1 份', '原因：效期到期', '儲放區：工作冰箱', '紀錄人員：王小明']) {
    assert.match(chain, new RegExp(label));
    assert.match(independent, new RegExp(label));
  }
  assert.doesNotMatch(chain, /未處理原因/);
  assert.match(overdue, /未處理原因：晚班交接遺漏/);
  assert.match(chain, /已加入今日 ERP 廢棄彙整/);
  assert.match(chain, /統一輸入時間 21:30/);
  assert.doesNotMatch(chain, /請至 ERP 輸入廢棄|已加入 ERP 入廢棄待辦/);
  assert.doesNotMatch(independent, /ERP/);
});

test('used-up confirmation removes only the current batch and area', () => {
  const confirm = appShellPage('STAFF', 'expiry-used-confirm-work', 'CHAIN_RESTAURANT');
  const done = appShellPage('STAFF', 'expiry-result-used', 'CHAIN_RESTAURANT');
  for (const label of ['確認已使用完', '雞高湯', '09/02', '工作冰箱', '只結束這個批次與區域的追蹤', '確認使用完並移除']) assert.match(confirm, new RegExp(label));
  for (const label of ['已使用完並移除提醒', '09/02 批次', '工作冰箱', '歷史紀錄仍保留', '其他批次與其他區域不受影響']) assert.match(done, new RegExp(label));
});

test('chain waste ERP is one daily summary with an auditable completion record', () => {
  const summary = appShellPage('STAFF', 'expiry-erp-waste-summary', 'CHAIN_RESTAURANT');
  const complete = appShellPage('STAFF', 'expiry-erp-waste-complete', 'CHAIN_RESTAURANT');
  for (const label of ['登入 ERP 輸入今日廢棄', '依下列彙整一次輸入', '21:30', '6 筆', '今日廢棄明細', '確認已完成 ERP 輸入']) assert.match(summary, new RegExp(label));
  for (const label of ['今日 ERP 廢棄已回報', '6 筆', '李店長', '今日彙整已備存', '主管可依日期與門市查核']) assert.match(complete, new RegExp(label));
  assert.match(appShellPage('STAFF', 'expiry-erp-waste-summary', 'INDEPENDENT_RESTAURANT'), /此角色沒有操作權限/);
});

test('risk zones are configured per store by managers and read-only for staff', () => {
  const manager = appShellPage('SUPERVISOR', 'expiry-risk-settings', 'CHAIN_RESTAURANT');
  for (const label of ['本店風險區設定', '依本店格局設定', '新增風險位置', '工作台抽屜', '冷藏貨架最下層', '乾料櫃頂層', '每日提醒', '每週一提醒', '員工不可修改', '編輯']) assert.match(manager, new RegExp(label));
  assert.match(appShellPage('STAFF', 'expiry-risk-settings', 'CHAIN_RESTAURANT'), /此角色沒有操作權限/);
  assert.doesNotMatch(appShellPage('SUPERVISOR', 'expiry', 'CHAIN_RESTAURANT'), /設定本店風險區/);
  assert.match(appShellPage('SUPERVISOR', 'expiry-risk-zones', 'CHAIN_RESTAURANT'), /設定本店風險區/);
  const areaSupervisor = appShellPage('LOGISTICS', 'expiry-risk-settings', 'CHAIN_RESTAURANT');
  assert.match(areaSupervisor, /區主管查核/);
  assert.match(areaSupervisor, /唯讀/);
  assert.doesNotMatch(areaSupervisor, /新增風險位置|>編輯</);
});

test('manager can add, edit and pause a simple risk-zone reminder', () => {
  const create = appShellPage('SUPERVISOR', 'expiry-risk-new', 'CHAIN_RESTAURANT');
  for (const label of ['新增風險位置', '所屬儲物區', '死角位置名稱', '補充位置', '提醒頻率', '每日', '每週一', '儲存風險位置', '取消']) assert.match(create, new RegExp(label));
  assert.doesNotMatch(create, /食材名稱|到期日/);
  assert.match(create, /不建立額外打卡或回報/);

  const edit = appShellPage('SUPERVISOR', 'expiry-risk-edit-work', 'CHAIN_RESTAURANT');
  for (const label of ['編輯風險位置', '工作區', '工作台抽屜', '抽屜最內側', '停用此風險位置']) assert.match(edit, new RegExp(label));
  assert.match(appShellPage('SUPERVISOR', 'expiry-risk-saved-work', 'CHAIN_RESTAURANT'), /風險位置已儲存/);
  assert.match(appShellPage('SUPERVISOR', 'expiry-risk-paused-work', 'CHAIN_RESTAURANT'), /風險位置已停用/);
  assert.match(appShellPage('STAFF', 'expiry-risk-edit-work', 'CHAIN_RESTAURANT'), /此角色沒有操作權限/);
  assert.match(appShellPage('LOGISTICS', 'expiry-risk-edit-work', 'CHAIN_RESTAURANT'), /此角色沒有操作權限/);
});

test('risk-zone cards are simple non-interactive location reminders', () => {
  const list = appShellPage('STAFF', 'expiry-risk-zones', 'CHAIN_RESTAURANT');
  for (const label of ['工作台抽屜', '工作區｜抽屜最內側', '每日提醒', '冷藏貨架最下層', '乾料櫃頂層', '每週一提醒', '新增現場提醒']) assert.match(list, new RegExp(label));
  assert.doesNotMatch(list, /expiry-risk-detail-|expiry-risk-report-|查看重點|發現到期品|日期／標示異常|回報其他問題|<b>›<\/b>/);
});

test('completed expiry items leave the shared pending list and appear in activity records', () => {
  const oneDiscarded = { expiryHandledKeys: ['work'], expiryDiscardedKeys: ['work'] };
  for (const role of ['STAFF', 'SUPERVISOR']) {
    const urgent = appShellPage(role, 'expiry-urgent', 'CHAIN_RESTAURANT', oneDiscarded);
    assert.doesNotMatch(urgent, /雞高湯/);
    assert.match(urgent, /鮮奶油/);
    assert.match(appShellPage(role, 'expiry', 'CHAIN_RESTAURANT', oneDiscarded), /<b>1 項<\/b>/);
  }
  const activity = appShellPage('SUPERVISOR', 'activity', 'CHAIN_RESTAURANT', oneDiscarded);
  assert.match(activity, /廢棄/);
  assert.match(activity, /雞高湯已登記廢棄/);

  const allHandled = { expiryHandledKeys: ['work', 'cold'], expiryDiscardedKeys: ['work', 'cold'] };
  const empty = appShellPage('SUPERVISOR', 'expiry-urgent', 'CHAIN_RESTAURANT', allHandled);
  assert.match(empty, /目前沒有需要立即處理的效期品項/);
  assert.match(empty, /查看廢棄紀錄/);
  assert.doesNotMatch(empty, /登記廢棄|已使用完/);
});

test('completed inspection records operator, area and time', () => {
  const result = appShellPage('STAFF', 'expiry-result-inspected', 'CHAIN_RESTAURANT');
  for (const text of ['本區巡檢已完成', '工作冰箱・王小明・今天 16:20', '必要確認 2 項已完成', '巡下一個區域']) assert.match(result, new RegExp(text));
});

test('expiry child routes stay restricted to on-site roles', () => {
  const html = appShellPage('OWNER', 'expiry-lot-cream', 'CHAIN_RESTAURANT');
  assert.match(html, /此角色沒有操作權限/);
});
