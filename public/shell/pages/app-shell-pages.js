import { icon } from '../components/icons.js';
import {
  emptyPanel,
  escapeHtml,
  iconTile,
  listRow,
  sectionHeading,
  shellBack,
} from '../components/app-shell-layout.js';
import { MANAGEMENT, OPERATIONS, roleCanOpen, roleMeta, visibleItems } from '../services/app-shell-routes.js';

const sampleBadge = '<span class="sample-badge">畫面示意</span>';

const EXPIRY_URGENT_ITEMS = [
  { key: 'work', item: '雞高湯', due: '已到期｜09/02', zone: '工作冰箱', overdue: true },
  { key: 'cold', item: '鮮奶油', due: '今日到期｜09/02', zone: '冷藏庫 A', overdue: false },
];

function handledExpiryKeys(previewState = {}) {
  return new Set(Array.isArray(previewState.expiryHandledKeys) ? previewState.expiryHandledKeys : []);
}

function hasLinkedStores(previewState = {}) {
  return Number(previewState.linkedStoreCount ?? 2) > 1;
}

function unresolvedExpiryItems(previewState = {}) {
  const handled = handledExpiryKeys(previewState);
  return EXPIRY_URGENT_ITEMS.filter(item => !handled.has(item.key));
}

function pageIntro(title, copy, tag = 'APP 外殼') {
  return `<div class="shell-page-intro"><span class="page-kicker">${escapeHtml(tag)}</span><h1>${escapeHtml(title)}</h1><p>${escapeHtml(copy)}</p></div>`;
}

function metric(label, value, tone = '') {
  return `<div class="shell-metric ${tone}"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`;
}

function metricButton(label, value, route, tone = '') {
  return `<button class="shell-metric ${tone}" type="button" data-route="${escapeHtml(route)}"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span><i aria-hidden="true">›</i></button>`;
}

function actionButton(label, route, style = 'primary') {
  return `<button class="shell-${style}" type="button" data-route="${route}">${escapeHtml(label)}</button>`;
}

function shellActionButton(label, action, style = 'secondary') {
  return `<button class="shell-${style}" type="button" data-shell-action="${escapeHtml(action)}">${escapeHtml(label)}</button>`;
}

function expiryEntryCard({ title, count, copy, route, tone = '', iconName = 'calendarClock' }) {
  return `<button class="expiry-entry-card ${tone}" type="button" data-route="${escapeHtml(route)}">
    <span class="expiry-entry-icon">${icon(iconName)}</span>
    <span class="expiry-entry-copy"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(copy)}</small></span>
    <b>${escapeHtml(count)}</b><i aria-hidden="true">›</i>
  </button>`;
}

function expiryFoodCard({ item, due, zone, tone = '', actions = '' }) {
  return `<article class="shell-card expiry-food-card ${tone}">
    <span class="expiry-food-icon">${icon(tone === 'danger' ? 'warning' : 'calendarClock')}</span>
    <div class="expiry-food-copy"><strong>${escapeHtml(item)}</strong><span>${escapeHtml(due)}</span><small>${escapeHtml(zone)}</small></div>
    ${actions ? `<div class="expiry-food-actions">${actions}</div>` : ''}
  </article>`;
}

function zoneProgressRow({ route, title, total, completed = 0, state = 'pending' }) {
  const labels = { active: '進行中', complete: '已完成', pending: '未開始' };
  const progress = state === 'complete' ? 100 : Math.round((completed / total) * 100);
  const marker = state === 'complete' ? '✓' : state === 'active' ? '◐' : '○';
  return `<button class="zone-progress-row is-${state}" type="button" data-route="${escapeHtml(route)}">
    <span class="zone-marker" aria-hidden="true">${marker}</span>
    <span class="zone-detail"><strong>${escapeHtml(title)}</strong><small>${state === 'complete' ? `${total} 項已完成` : state === 'active' ? `${completed} / ${total} 項已完成` : `${total} 項`}</small>${state === 'active' ? `<i class="zone-meter"><b style="width:${progress}%"></b></i>` : ''}</span>
    <span class="zone-state">${labels[state]}</span>
  </button>`;
}

function zoneProgressList() {
  return `<div class="shell-card zone-progress-list">
    ${zoneProgressRow({ route: 'count-entry', title: '冷藏庫', total: 86, completed: 12, state: 'active' })}
    ${zoneProgressRow({ route: 'count-complete', title: '工作冰箱', total: 42, completed: 42, state: 'complete' })}
    ${zoneProgressRow({ route: 'count-entry', title: '冷凍庫', total: 76 })}
    ${zoneProgressRow({ route: 'count-entry', title: '乾貨區', total: 116 })}
  </div>`;
}

function roleHeader(title, subtitle) {
  return `<div class="role-home-title"><div><span>今日・9 月 1 日</span><h1>${escapeHtml(title)}</h1><p>${escapeHtml(subtitle)}</p></div>${sampleBadge}</div>`;
}

function staffHome(businessType, previewState = {}) {
  const urgentCount = unresolvedExpiryItems(previewState).length;
  const operations = visibleItems(OPERATIONS, 'STAFF', businessType).filter(item => ['count', 'receiving', 'waste', 'expiry', 'handover'].includes(item.id));
  const companyQueue = businessType === 'CHAIN_RESTAURANT' ? `<section class="shell-section">${sectionHeading('公司流程待辦', '可稍後統一處理')}<div class="shell-card shell-list">${listRow({ route: 'store-company-tasks', iconName: 'tasks', title: 'ERP 待完成', copy: '進貨驗收 2・入廢棄 1', count: '3 項', tone: 'warning' })}</div></section>` : '';
  return `${roleHeader('歡迎回來', '先完成今天的工作')}
    <section class="shell-section">${sectionHeading('今天先看')}
      <div class="home-metrics home-action-metrics">${metricButton('缺貨品項', '3', 'shortage-items', 'danger')}${metricButton('效期提醒', String(urgentCount), 'expiry', 'warning')}${metricButton('待處理', '1', 'tasks', 'info')}</div>
    </section>
    <section class="shell-section">${sectionHeading('每日作業')}
      <div class="shell-tile-grid">${operations.map(item => iconTile(item)).join('')}${iconTile({ id: 'other', label: '其他作業', icon: 'more' })}</div>
    </section>
    ${companyQueue}
    <section class="shell-section">${sectionHeading('今日建議', '適用')}
      <div class="shell-card suggestion-card"><span>${icon('help')}</span><div><strong>明日午餐訂位較多</strong><p>建議提前確認備料</p></div><b>›</b></div>
    </section>
    <section class="shell-section">${sectionHeading('商家留言板', '適用')}
      ${listRow({ route: 'bulletin-board', iconName: 'bell', title: '午餐訂位較多，請提早備料。', copy: '店長・今天 09:20' })}
    </section>`;
}

function shortageItemsPage(previewState = {}) {
  const canSearchStores = hasLinkedStores(previewState);
  const rows = [
    ['火腿', '目前庫存偏低', '剩 1 包'],
    ['鮮奶油', '今日用量較高', '剩 2 瓶'],
    ['牛菲力', '低於門市備料需求', '剩 1.2 公斤'],
  ];
  return `${shellBack()}${pageIntro('缺貨品項', '目前需要留意的庫存。', '3 項')}
    <section class="shell-card shell-list">${rows.map(([title, copy, count]) => listRow({ route: canSearchStores ? 'transfer-search' : 'receiving', iconName: 'warning', title, copy, count, tone: 'danger' })).join('')}</section>
    ${canSearchStores ? '<p class="shell-note">點選品項可搜尋其他門市庫存。</p>' : ''}`;
}

function managerHome(businessType, previewState = {}) {
  const urgentCount = unresolvedExpiryItems(previewState).length;
  const operations = visibleItems(OPERATIONS, 'SUPERVISOR', businessType).filter(item => ['count', 'receiving', 'waste', 'expiry'].includes(item.id));
  const independent = businessType === 'INDEPENDENT_RESTAURANT';
  return `${roleHeader('今日營運重點', independent ? '依負責門市與儲物區處理營運事項' : '處理門市異常，確認營運順暢')}
    <section class="shell-section">${sectionHeading('今日重點', '查看全部')}
      <div class="shell-card shell-list">
        ${!independent ? listRow({ route: 'count', iconName: 'clipboard', title: '今日盤點尚未完成', copy: '員工尚未開始・店長可接手', count: '可接手', tone: 'warning' }) : ''}
        ${listRow({ route: 'receiving-issues', iconName: 'warning', title: '進貨異常', copy: '缺貨、少到、多到與品質異常', count: '3 項', tone: 'danger' })}
        ${listRow({ route: 'expiry', iconName: 'calendarClock', title: '即期風險', count: `${urgentCount} 項`, tone: 'warning' })}
        ${independent ? listRow({ route: 'incidents', iconName: 'help', title: '待確認異常', count: '1 項', tone: 'info' }) : ''}
      </div>
    </section>
    ${!independent ? `<section class="shell-section">${sectionHeading('最新通知', '通知')}
      <div class="shell-card shell-list">
        ${listRow({ route: 'receiving-erp-complete', iconName: 'tasks', title: 'ERP 驗收已完成', copy: '大森食品・王小明・今天 10:05', count: '已驗收' })}
      </div>
    </section>` : ''}
    ${!independent ? `<section class="shell-section">${sectionHeading('公司流程待辦', '門市統一處理')}<div class="shell-card shell-list">${listRow({ route: 'store-company-tasks', iconName: 'tasks', title: 'ERP 待完成', copy: '進貨驗收 2・入廢棄 1', count: '3 項', tone: 'warning' })}</div></section>` : ''}
    <section class="shell-section">${sectionHeading('每日作業')}
      <div class="shell-tile-grid">${operations.map(item => iconTile(item)).join('')}${iconTile({ id: 'bulletins', label: '公佈欄', icon: 'bell' })}${iconTile({ id: 'other', label: '其他作業', icon: 'more' })}</div>
    </section>`;
}

function logisticsHome(businessType) {
  const management = visibleItems(MANAGEMENT, 'LOGISTICS', businessType);
  if (businessType === 'CHAIN_RESTAURANT') {
    const crossStoreManagement = management.filter(item => ['bulletins', 'company-reminders', 'reports', 'settings'].includes(item.id));
    return `${roleHeader('跨店營運', '查看各門市進度、異常與公司流程')}
      <section class="shell-section">${sectionHeading('今日跨店重點', '查看全部')}
        <div class="shell-card shell-list">
          ${listRow({ route: 'company-reminders', iconName: 'tasks', title: '公司流程待完成', copy: 'ERP 驗收、入廢棄', count: '5 項', tone: 'warning' })}
          ${listRow({ route: 'expiry', iconName: 'calendarClock', title: '跨店效期異常', copy: '切換門市查看相同四類提醒與處理紀錄', count: '2 店', tone: 'danger' })}
          ${listRow({ route: 'incidents', iconName: 'warning', title: '門市異常待處理', copy: '3 間門市回報', count: '3 項', tone: 'danger' })}
          ${listRow({ route: 'count-analysis', iconName: 'clipboard', title: '盤點未完成', copy: '大安店、信義店', count: '2 店' })}
        </div>
      </section>
      <section class="shell-section">${sectionHeading('門市狀態', '今日')}
        <div class="shell-card result-list">
          <div><span>BeApe 大安店</span><strong>2 項待辦</strong></div>
          <div><span>BeApe 信義店</span><strong>正常</strong></div>
          <div><span>BeApe 板橋店</span><strong>1 項異常</strong></div>
        </div>
      </section>
      <section class="shell-section">${sectionHeading('跨店管理')}
        <div class="shell-tile-grid management-grid">${crossStoreManagement.map(item => iconTile(item, { future: item.future })).join('')}</div>
      </section>`;
  }
  return `${roleHeader('後勤工作台', '核對資料，掌握營運成果')}
    <section class="shell-section">${sectionHeading('今日待核對', '查看全部')}
      <div class="shell-card shell-list">
        ${listRow({ route: 'receiving-review', iconName: 'fileText', title: '收貨待核對', count: '2 張' })}
        ${listRow({ route: 'catalog', iconName: 'package', title: '編碼待確認', count: '1 筆' })}
        ${listRow({ route: 'count-analysis', iconName: 'clipboard', title: '貨單差異', count: '2 張' })}
        ${listRow({ route: 'incidents', iconName: 'warning', title: '盤點異常', count: '3 筆' })}
      </div>
    </section>
    <section class="shell-section">${sectionHeading('營運成果', '今日')}
      <div class="shell-card result-list">
        <div><span>今日進貨總額</span><strong>NT$ 68,540</strong></div>
        <div><span>本月進貨總額</span><strong>NT$ 1,285,230</strong></div>
        <div><span>本月食材成本</span><strong>NT$ 892,100</strong></div>
        <div><span>本月盤點次數</span><strong>12 次</strong></div>
        <div><span>本月廢棄金額</span><strong>NT$ 12,450</strong></div>
      </div>
    </section>
    <section class="shell-section">${sectionHeading('管理功能')}
      <div class="shell-tile-grid management-grid">${management.slice(0, 6).map(item => iconTile(item, { future: item.future })).join('')}</div>
    </section>`;
}

function ownerHome(businessType) {
  const management = visibleItems(MANAGEMENT, 'OWNER', businessType).filter(item => ['members', 'business', 'permissions', 'recipes', 'exports', 'audit'].includes(item.id));
  const chain = businessType === 'CHAIN_RESTAURANT';
  return `${roleHeader('營運總覽', '管理商家，掌握全局')}
    <section class="shell-section">${sectionHeading('營運摘要／重大異常', '查看全部')}
      <div class="shell-card shell-list">
        ${listRow({ route: 'receiving-published', iconName: 'fileText', title: chain ? '門市進貨待完成' : '收貨待核對', count: chain ? '2 店' : '2 張' })}
        ${chain ? listRow({ route: 'company-reminders', iconName: 'tasks', title: '公司流程待完成', count: '5 項' }) : listRow({ route: 'catalog', iconName: 'package', title: '編碼待確認', count: '1 筆' })}
        ${listRow({ route: 'count-policy', iconName: 'clipboard', title: chain ? '跨店盤點差異' : '貨單差異', count: chain ? '2 店' : '2 張' })}
        ${listRow({ route: 'incidents', iconName: 'warning', title: '盤點異常', count: '3 筆' })}
      </div>
    </section>
    <section class="shell-section">${sectionHeading('營運成果', '本月')}
      <div class="shell-card result-list">
        <div><span>本月進貨總額</span><strong>NT$ 1,285,230</strong></div>
        <div><span>本月食材成本</span><strong>NT$ 892,100</strong></div>
        <div><span>本月毛利率</span><strong>58.3%</strong></div>
        <div><span>本月盤點次數</span><strong>12 次</strong></div>
        <div><span>本月廢棄金額</span><strong>NT$ 12,450</strong></div>
      </div>
    </section>
    <section class="shell-section">${sectionHeading('管理設定')}
      <div class="shell-tile-grid management-grid">${management.map(item => iconTile(item, { future: item.future })).join('')}</div>
    </section>`;
}

function homePage(role, businessType, previewState = {}) {
  if (role === 'SUPERVISOR') return managerHome(businessType, previewState);
  if (role === 'LOGISTICS') return logisticsHome(businessType);
  if (role === 'OWNER') return ownerHome(businessType);
  return staffHome(businessType, previewState);
}

function countPage(role, businessType, chainState = 'unfinished') {
  if (role === 'SUPERVISOR') {
    const chain = businessType === 'CHAIN_RESTAURANT';
    const chainCompleted = chain && chainState === 'completed';
    return `${shellBack()}${pageIntro('盤點管理', chain ? '每日盤點由系統自動建立；店長只設定儲物區域並查看異常。' : '主管建立本次盤點範圍；員工完成後只查看需要確認的異常。', chain ? '店長' : '主管')}
      <div class="shell-metric-grid">${metric(chain ? '今日進度' : '盤點區域', chain ? (chainCompleted ? '4 / 4' : '0 / 4') : '4')}${metric(chain ? '每日品項' : '本次品項', '320')}${metric('待確認差異', chainCompleted || !chain ? '3' : '—', chainCompleted || !chain ? 'danger' : '')}</div>
      ${chain ? `<section class="shell-section">${sectionHeading('今日每日盤點', '系統自動建立')}
        ${chainCompleted
          ? `<article class="shell-card auto-count-card"><header><span class="status-pill">盤點完成</span><small>2026/09/01</small></header><h2>大安店每日盤點</h2><p>4 個區域・320 項已完成</p><div class="progress"><i style="width:100%"></i></div><div class="shell-card result-list"><div><span>完成時間</span><strong>17:42</strong></div><div><span>盤點人</span><strong>王小明</strong></div></div><div class="shell-button-stack">${actionButton('查看盤點結果', 'count-review')}${actionButton('預覽員工未完成狀態', 'count', 'secondary')}${actionButton('查看提醒設定', 'count-task', 'ghost')}</div></article>`
          : `<article class="shell-card auto-count-card"><header><span class="status-pill">尚未開始</span><small>2026/09/01</small></header><h2>大安店每日盤點</h2><p>員工尚未盤點・4 個區域・320 項</p><div class="progress"><i style="width:0%"></i></div><div class="shell-button-stack">${actionButton('開始／繼續盤點', 'count-zones')}${actionButton('預覽員工已完成狀態', 'count-completed', 'secondary')}${actionButton('查看提醒設定', 'count-task', 'ghost')}</div></article>`}
      </section>` : ''}
      <section class="shell-section">${sectionHeading('盤點設定', chain ? '初次設定／品項異動時' : '建立本次盤點')}
        <div class="shell-card setup-step-list">
          ${setupStep(1, 'count-import', '匯入檔案建立品項', '保留原工作表、欄位與品項順序')}
          ${setupStep(2, 'count-setup', '設定儲物區域與品項', '建立區域後，進入該區新增與排序品項')}
          ${chain ? '' : setupStep(3, 'count-scope', '勾選本次盤點品項', '依儲物區域勾選，完成後建立本次盤點')}
        </div>
      </section>
      <section class="shell-section">${sectionHeading('盤點完成後')}<div class="shell-card shell-list">${listRow({ route: 'count-review', iconName: 'warning', title: '查看盤點異常', copy: `只列需要${chain ? '店長' : '主管'}確認的品項` })}</div></section>
      ${chain ? '<p class="shell-note">實際 App 只顯示當下狀態：員工未盤點時，店長可直接接手；員工完成後，按鈕改為完成資料與結果入口。未完成提醒只通知店長。</p>' : '<p class="shell-note">主管完成前三步後，員工即可看到本次盤點；盤點完成後，主管只查看異常品項。</p>'}`;
  }
  if (role === 'LOGISTICS') {
    const chain = businessType === 'CHAIN_RESTAURANT';
    return `${shellBack()}${pageIntro(chain ? '跨店盤點監督' : '盤點整理與分析', chain ? '查看各門市完成進度與需介入的異常；不處理公司盤點主檔。' : '查看盤點結果、資料完整度與異常趨勢。', chain ? '區主管' : '行政／後勤')}
      <div class="shell-metric-grid">${metric('完成門市', '2 / 2')}${metric('異常品項', '6', 'warning')}${metric('資料完整度', '98%')}</div>
      <section class="shell-section">${sectionHeading(chain ? '跨店入口' : '分析入口')}
        <div class="shell-card shell-list">${listRow({ route: 'count-analysis', iconName: 'chart', title: chain ? '門市完成與差異' : '盤點結果分析', copy: '門市、區域與品項趨勢' })}${listRow({ route: chain ? 'incidents' : 'exports', iconName: chain ? 'warning' : 'download', title: chain ? '需介入異常' : '完整稽核明細', copy: chain ? '追蹤門市回報與處理狀態' : '保留來源、操作者與時間' })}</div>
      </section>`;
  }
  if (role === 'OWNER') {
    return `${shellBack()}${pageIntro('盤點管理摘要', '只看結論、重大異常與盤點政策，不處理逐筆資料。', '老闆')}
      <div class="shell-metric-grid">${metric('本月盤點', '12 次')}${metric('重大異常', '2', 'danger')}${metric('完成率', '96%')}</div>
      <section class="shell-section">${sectionHeading('管理摘要')}<div class="shell-card shell-list">${listRow({ route: 'count-policy', iconName: 'shield', title: '盤點政策與完成率', copy: '依門市查看執行情況' })}${listRow({ route: 'reports', iconName: 'chart', title: '重大差異趨勢', copy: '查看已確認的營運結論' })}</div></section>`;
  }
  return `${shellBack()}${pageIntro('今日盤點', '依現場動線逐區完成；盤點時不顯示前次數量與差異。', '員工作業')}
    <section class="shell-card task-hero"><div><span class="status-pill">進行中</span><h2>2026/09/01 日常盤點</h2><p>2 / 4 區域已完成</p></div><div class="progress"><i style="width:50%"></i></div>${actionButton('繼續盤點', 'count-zones')}</section>
    <section class="shell-section">${sectionHeading('區域進度', '2 / 4 已完成')}${zoneProgressList()}</section>`;
}

function setupStep(number, route, title, copy) {
  return `<button type="button" data-route="${escapeHtml(route)}"><b>${number}</b><span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(copy)}</small></span><i>›</i></button>`;
}

function countFlowPage(route, businessType) {
  if (route === 'count-completed') return countPage('SUPERVISOR', businessType, 'completed');
  if (route === 'count-entry') {
    return `${shellBack('返回區域進度')}${pageIntro('冷藏庫盤點', '數量會自動儲存；完成前系統會檢查漏填項目。', '區域盤點・12 / 86')}
      <div class="progress"><i style="width:14%"></i></div>
      <div class="shell-card count-entry-list">
        ${[['鮮奶油 1L','聯馥食品','瓶'],['牛菲力','美福食集','kg'],['火腿','開元食品','包'],['帕瑪森起司','聯馥／開元','顆']].map(([name, supplier, unit], index) => `<label><span><strong>${name}</strong><small class="supplier-note">供應商：${supplier}${index === 2 ? '・效期提醒' : ''}</small></span><span class="fake-number">${['2', '3.25', '2', '1'][index]}</span><b>${unit}</b></label>`).join('')}
      </div>${actionButton('完成此區域', 'count-complete')}`;
  }
  if (route === 'count-complete') {
    return `${shellBack('返回盤點任務')}<section class="completion-state"><span>${icon('tasks')}</span><h1>冷藏庫盤點完成</h1><p>本區共 86 項・已盤 86 項</p></section><div class="shell-button-stack">${actionButton('查看已盤清單', 'count-entry')}${actionButton('繼續下一區', 'count-zones', 'secondary')}${actionButton('全部區域已完成', 'count-finished', 'ghost')}</div>`;
  }
  if (route === 'count-finished') {
    if (businessType === 'INDEPENDENT_RESTAURANT') return independentCountCompletion();
    return `${shellBack('返回盤點任務')}<section class="completion-state compact"><span>${icon('tasks')}</span><h1>實際盤點已完成</h1><p>4 個區域・320 項已完成</p></section><section class="shell-card chain-paper-card"><span class="status-pill">此門市已啟用紙本謄寫</span><h2>下一步：謄寫店內盤點表</h2><p>系統已依門市設定，自動產生原工作表順序的紙本回填版。</p><div class="paper-meta"><span>原格式回填版</span><strong>320 項</strong></div>${actionButton('開啟紙本謄寫表', 'count-paper')}</section><div class="shell-button-stack">${actionButton('查看本次盤點明細', 'count-entry', 'secondary')}${actionButton('返回首頁', 'home', 'ghost')}</div><p class="shell-note">員工不需選擇餐廳類型；系統只顯示本門市設定的下一步。完成謄寫後會留下經手人與時間。</p>`;
  }
  if (route === 'count-finished-direct') {
    return independentCountCompletion();
  }
  if (route === 'count-paper') {
    return `${shellBack('返回完成頁')}${pageIntro('紙本謄寫表', '依門市匯入表的工作表、列次與品項順序呈現。', '本門市・必做')}
      <section class="paper-reference-toolbar"><span>門市匯入表｜9月食材</span><select aria-label="選擇原表段落"><option>原表第 1 段｜第 1–25 列</option><option>原表第 2 段｜第 26–50 列</option><option>原表第 3 段｜第 51–75 列</option></select><div><strong>第 1–25 項</strong><small>共 320 項</small></div></section>
      <section class="shell-card paper-reference-list">${[['001','鮮奶油 1L','聯馥食品','2 瓶'],['002','牛菲力','美福食集','3.25 kg'],['003','火腿','開元食品','2 包'],['004','帕瑪森起司','聯馥／開元','1 顆']].map(([position,name,supplier,value]) => `<div><span class="paper-position">${position}</span><span><strong>${name}</strong><small>供應商：${supplier}</small></span><b>${value}</b></div>`).join('')}</section>
      <div class="paper-step-actions">${actionButton('上一段', 'count-paper', 'ghost')}${actionButton('下一段 26–50', 'count-paper', 'secondary')}</div><button class="paper-export-link" type="button" data-shell-action="備用匯出 Excel／PDF">備用：匯出 Excel／PDF</button><p class="shell-note">盤點時依現場區域執行；謄寫時系統自動恢復成門市原表順序。完成整份後只送出一次紀錄。</p>${actionButton('完成紙本謄寫', 'count-paper-complete')}`;
  }
  if (route === 'count-paper-complete') {
    return `${shellBack('返回紙本謄寫表')}<section class="completion-state"><span>${icon('tasks')}</span><h1>紙本謄寫已完成</h1><p>經手人：王小明・2026/09/01 18:42</p></section><section class="shell-card completion-card"><strong>下一步</strong><p>等待門市主管確認／稽查<br>系統原始盤點數量不會被覆蓋</p></section>${actionButton('返回首頁', 'home')}`;
  }
  if (route === 'count-review') {
    return `${shellBack()}${pageIntro('盤點差異總覽', '全部區域完成後才產生；只顯示需要確認的項目。', '盤點 6 / 6')}
      <div class="shell-metric-grid">${metric('全部', '5')}${metric('待處理', '3', 'warning')}${metric('已處理', '2')}</div>
      <section class="shell-section"><div class="shell-card discrepancy-list">
        <article><header><strong>牛菲力</strong><span>-1.5 kg</span></header><p>2026/08/31：4.0 kg・2026/09/01：2.5 kg</p><p class="count-loan-reference">未結清借貸：借出 1.5 kg</p><select><option>請選擇原因</option></select><div class="reason-chips"><span>漏盤／錯區</span><span>進貨未登</span><span>報廢未登</span><span>其他</span></div></article>
        <article><header><strong>鮮奶油 1L</strong><span>-2 瓶</span></header><p>2026/08/31：6 瓶・2026/09/01：4 瓶</p><select><option>請選擇原因</option></select></article>
      </div></section><p class="shell-note">不可直接改寫原始數量；更正或重盤會新增事件。</p>`;
  }
  if (route === 'count-setup') {
    const chain = businessType === 'CHAIN_RESTAURANT';
    return `${shellBack()}${pageIntro('設定儲物區域與品項', '建立儲物區域後，直接進入該區新增、移除與排序品項。', `盤點設定 2 / ${chain ? '2' : '3'}`)}
      <div class="shell-card shell-list">${listRow({ route: 'count-assign', iconName: 'package', title: '冷藏庫', copy: '86 項・點入設定品項' })}${listRow({ route: 'count-assign', iconName: 'package', title: '工作冰箱', copy: '42 項・點入設定品項' })}${listRow({ route: 'count-assign', iconName: 'package', title: '冷凍庫', copy: '76 項・點入設定品項' })}${listRow({ route: 'count-assign', iconName: 'package', title: '乾貨區', copy: '116 項・點入設定品項' })}</div><div class="shell-button-stack">${actionButton('新增儲物區域', 'count-setup', 'secondary')}${actionButton(chain ? '完成儲物區域設定' : '下一步：勾選盤點品項', chain ? 'count' : 'count-scope')}</div>`;
  }
  if (route === 'count-import') {
    const chain = businessType === 'CHAIN_RESTAURANT';
    return `${shellBack()}${pageIntro('匯入檔案建立品項', '匯入 Excel／CSV 建立商品細項，並保留工作表、欄位、列號與原始順序。', `盤點設定 1 / ${chain ? '2' : '3'}`)}
      <section class="shell-card upload-shell"><span>${icon('fileText')}</span><h2>選擇 Excel／CSV</h2><p>支援原盤點表與「序」固定範本</p>${actionButton('選擇檔案', 'count-import')}</section>
      <div class="shell-metric-grid">${metric('已對應', '286')}${metric('未對應', '8', 'warning')}${metric('重複', '2', 'danger')}${metric('缺單位', '3', 'warning')}</div>${actionButton('確認品項並設定儲物區域', 'count-setup')}`;
  }
  if (route === 'count-assign') {
    const chain = businessType === 'CHAIN_RESTAURANT';
    return `${shellBack('返回儲物區域')}${pageIntro('冷藏庫品項', '搜尋或下拉加入此區品項；不用滑完 320 項。', `盤點設定 2 / ${chain ? '2' : '3'}`)}
      <div class="scope-zone-grid">${[['冷藏庫','86 項'],['工作冰箱','42 項'],['冷凍庫','76 項'],['乾貨區','116 項']].map(([zone,count],index) => `<button class="scope-zone${index === 0 ? ' active' : ''}" type="button" data-shell-action="切換${zone}"><strong>${zone}</strong><small>${count}</small></button>`).join('')}</div>
      <section class="shell-card assignment-panel"><header><div><strong>冷藏庫</strong><small>目前 86 項</small></div><button type="button" data-shell-action="編輯冷藏庫">編輯區域</button></header><label class="assignment-search">搜尋商品<input type="search" placeholder="輸入品名、編碼或供應商"></label><label class="assignment-select">批次加入<select><option>選擇尚未分區品項（27）</option><option>鮮奶油 1L｜聯馥食品</option><option>牛菲力｜美福食集</option><option>帕瑪森起司｜聯馥／開元</option></select></label><button class="shell-secondary full" type="button" data-shell-action="加入已選品項">＋ 加入已選品項</button></section>
      <section class="shell-section">${sectionHeading('區內順序', '拖曳排序')}<div class="shell-card assignment-items">${[['鮮奶油 1L','聯馥食品'],['牛菲力','美福食集'],['火腿','開元食品'],['帕瑪森起司','聯馥／開元']].map(([name,supplier]) => `<div><i>⋮⋮</i><span><strong>${name}</strong><small>${supplier}</small></span><button type="button" data-shell-action="移至其他區域">移至…</button></div>`).join('')}</div></section>
      <p class="shell-note">手機不使用跨區拖曳。批次分配用搜尋／下拉完成；拖曳只調整目前區域內的盤點順序。</p>${actionButton('儲存此區域', 'count-setup')}`;
  }
  if (route === 'count-order') {
    const chain = businessType === 'CHAIN_RESTAURANT';
    return `${shellBack()}${pageIntro(chain ? '確認每日盤點順序' : '設定盤點規則', chain ? '每日沿用此區域與品項順序，自動建立當日盤點。' : '確認區域順序與本次盤點範圍。', '盤點設定 4 / 4')}
      <section class="shell-card assignment-items order-only">${[['1','冷藏庫','86 項'],['2','工作冰箱','42 項'],['3','冷凍庫','76 項'],['4','乾貨區','116 項']].map(([order,zone,count]) => `<div><i>⋮⋮</i><b>${order}</b><span><strong>${zone}</strong><small>${count}</small></span></div>`).join('')}</section>
      ${chain ? '<section class="shell-card settings-form"><label>建立方式<span>每日自動建立</span></label><label>盤點期限<span>閉店前完成</span></label><label>第一次提醒<span>16:00・店長</span></label><label>第二次提醒<span>閉店前 30 分鐘・店長</span></label><label>逾時提醒<span>店長</span></label></section>' : '<section class="shell-card settings-form"><label>盤點頻率<span>每月月底</span></label><label>預設範圍<span>全品項</span></label></section>'}
      ${actionButton(chain ? '儲存每日盤點設定' : '儲存盤點規則', chain ? 'count' : 'count-task')}`;
  }
  if (route === 'count-scope') {
    return `${shellBack()}${pageIntro('勾選本次盤點品項', '先選儲物區域，再展開勾選該區品項；不一次顯示全部品項。', '盤點設定 3 / 3')}
      <div class="choice-grid"><button class="choice" type="button" data-shell-action="切換全品項"><strong>全品項</strong><small>320 項</small></button><button class="choice active" type="button" data-shell-action="切換分區指定"><strong>分區指定</strong><small>目前 293 項</small></button></div>
      <div class="scope-zone-grid">${[['冷藏庫','45／48'],['工作冰箱','38／42'],['冷凍庫','76／76'],['乾貨區','103／116'],['酒水區','18／22'],['醬料區','13／16']].map(([zone,count],index) => `<button class="scope-zone${index === 0 ? ' active' : ''}" type="button" data-shell-action="展開${zone}"><strong>${zone}</strong><small>已選 ${count} 項</small></button>`).join('')}</div>
      <div class="scope-zone-head"><strong>冷藏庫・48 項</strong><button type="button" data-shell-action="全選冷藏庫">全選此區</button></div>
      <section class="shell-card scope-item-list">${[['鮮奶油 1L','聯馥食品',true],['牛菲力','美福食集',true],['火腿','開元食品',true],['帕瑪森起司','多家供應商：聯馥／開元',false]].map(([name,supplier,checked]) => `<label><input type="checkbox" ${checked ? 'checked' : ''}><span><strong>${name}</strong><small>${supplier}</small></span></label>`).join('')}</section>
      <div class="scope-summary"><span>全部區域</span><strong>已選 293／320 項</strong></div>${actionButton('建立本次盤點', 'count')}`;
  }
  if (route === 'count-task') {
    if (businessType === 'CHAIN_RESTAURANT') {
      return `${shellBack()}${pageIntro('每日盤點提醒', '盤點每天自動建立，不需要店長另行發布任務。', '連鎖餐飲')}
        <section class="shell-card settings-form"><label>每日建立<span>營業日 09:00</span></label><label>尚未開始提醒<span>16:00・店長</span></label><label>閉店前提醒<span>30 分鐘前・店長</span></label><label>逾時提醒<span>店長</span></label></section><p class="shell-note">未完成通知只傳給店長，不通知區主管。員工完成後提醒停止；正常完成不額外干擾。若營業時間調整，提醒會跟著門市閉店時間更新。</p>${actionButton('儲存提醒設定', 'count')}`;
    }
    return `${shellBack()}${pageIntro('發布盤點任務', '員工只有在主管發布後才會看到本次盤點。', '主管盤點設定')}
      <section class="shell-card settings-form"><label>盤點日期<span>2026/09/30</span></label><label>執行頻率<span>每月月底</span></label><label>盤點範本<span>月底全品項</span></label><label>本次範圍<span>6 區域・320 品項</span></label></section><div class="shell-button-stack">${actionButton('調整盤點範圍', 'count-scope', 'secondary')}${actionButton('發布盤點任務', 'count')}</div>`;
  }
  return `${shellBack()}${pageIntro('選擇盤點區域', '先完成進行中的區域，再依現場動線繼續。', '區域進度・2 / 4')}${zoneProgressList()}`;
}

function receivingPage(role, businessType) {
  if (role === 'LOGISTICS') {
    if (businessType === 'CHAIN_RESTAURANT') {
      return `${shellBack()}${pageIntro('跨店進貨追蹤', '查看各門市進貨核對與 ERP 驗收提醒狀態；不在序處理公司後勤資料。', '區主管')}
        <div class="shell-metric-grid">${metric('門市核對中', '2')}${metric('待 ERP 驗收', '5', 'warning')}${metric('今日已完成', '18')}</div>
        <section class="shell-section">${sectionHeading('門市進度')}<div class="shell-card shell-list">${listRow({ route: 'receiving-published', iconName: 'truck', title: 'BeApe 大安店', copy: '數量已確認・待 ERP 驗收', count: '待完成' })}${listRow({ route: 'receiving-published', iconName: 'tasks', title: 'BeApe 信義店', copy: '李店長・15:40 完成', count: '已完成' })}</div></section>`;
    }
    return `${shellBack()}${pageIntro('進貨資料核對', '整理、人工修正並發布；原始照片與 OCR 原值不可覆蓋。', '後勤抽屜')}
      <div class="shell-metric-grid">${metric('識別中', '1')}${metric('待核對', '2', 'warning')}${metric('已發布', '18')}</div>
      <section class="shell-section">${sectionHeading('待核對資料')}<div class="shell-card shell-list">${listRow({ route: 'receiving-review', iconName: 'fileText', title: '大森食品', copy: '3 張・今天 09:12', count: '需核對' })}${listRow({ route: 'receiving-review', iconName: 'fileText', title: '中央廚房', copy: '1 張・今天 08:47', count: '需核對' })}</div></section>`;
  }
  if (role === 'OWNER') {
    const chain = businessType === 'CHAIN_RESTAURANT';
    return `${shellBack()}${pageIntro('進貨管理摘要', chain ? '只看各門市執行、公司流程完成狀態與重大異常。' : '只看行政／後勤發布後的總結、重大異常與稽查。', '老闆')}
      <div class="shell-metric-grid">${metric('本月進貨', 'NT$ 1.28M')}${metric('重大異常', '2', 'danger')}${metric('已發布批次', '18')}</div><section class="shell-section"><div class="shell-card shell-list">${listRow({ route: 'receiving-published', iconName: 'chart', title: '供應商與品項趨勢', copy: '最新／平均單價與進貨總額' })}${listRow({ route: 'receiving-published', iconName: 'warning', title: '少送／多送與重大異常', copy: '門市確認與後勤結論' })}${listRow({ route: 'audit', iconName: 'shield', title: '驗收稽查', copy: '原圖、修正、發布人與時間' })}</div></section>`;
  }
  const chain = businessType === 'CHAIN_RESTAURANT';
  return `${shellBack()}${pageIntro('進貨／收貨', chain ? '現場上傳貨單並確認實收數量；完成後依公司制度提醒 ERP 驗收。' : '現場上傳貨單並確認實收數量；行政／後勤接續整理。', role === 'SUPERVISOR' ? (chain ? '店長' : '主管') : '員工')}
    <section class="shell-card upload-shell"><span>${icon('truck')}</span><h2>上傳貨單</h2><p>可拍照或從相簿選擇，一次最多 10 張</p>${actionButton('開始上傳', 'receiving-upload')}</section>
    <section class="shell-section">${sectionHeading('今天的上傳', '3 批')}<div class="shell-card shell-list">${chain
      ? `${listRow({ route: 'receiving-status', iconName: 'fileText', title: '大森食品', copy: '3 張・OCR 統計進貨量中', count: '待 ERP' })}${listRow({ route: 'receiving-erp-complete', iconName: 'fileText', title: '市場採購', copy: '2 張・王小明 10:05 完成', count: '已驗收' })}`
      : `${listRow({ route: 'receiving-status', iconName: 'fileText', title: '大森食品', copy: '3 張・識別中', count: '處理中' })}${listRow({ route: 'receiving-status', iconName: 'fileText', title: '市場採購', copy: '2 張・待行政核對', count: '已上傳' })}`}</div></section>`;
}

function receivingFlowPage(route, businessType) {
  if (route === 'receiving-issues') {
    return `${shellBack()}${pageIntro('進貨異常', '只列需要店長處理的到貨差異與品質問題。', '店長')}
      <div class="filter-chips"><button class="active">全部 6</button><button>缺貨 1</button><button>少到 2</button><button>多到 1</button><button>品質 2</button></div>
      <section class="shell-card receiving-issue-list">
        <article><span class="issue-kind danger">缺貨</span><div><strong>澳洲牛菲力</strong><small>美福食集・訂 10 kg／到 0 kg</small></div><b>待確認</b></article>
        <article><span class="issue-kind warning">少到</span><div><strong>鮮奶油 1L</strong><small>聯馥食品・訂 12 瓶／到 10 瓶</small></div><b>差 2 瓶</b></article>
        <article><span class="issue-kind info">多到</span><div><strong>帕瑪森起司</strong><small>開元食品・訂 6 顆／到 8 顆</small></div><b>多 2 顆</b></article>
        <article><span class="issue-kind danger">破損</span><div><strong>番茄罐頭</strong><small>大森食品・2 罐凹損滲漏</small></div><b>待回報</b></article>
        <article><span class="issue-kind warning">效期</span><div><strong>鮮奶</strong><small>有效期限短於門市驗收標準</small></div><b>待確認</b></article>
      </section><p class="shell-note">可補充原因、照片與供應商回覆；連鎖店完成現場核對後，再提醒回 ERP 依公司制度驗收。</p>`;
  }
  if (route === 'receiving-upload') {
    const chain = businessType === 'CHAIN_RESTAURANT';
    return `${shellBack()}${pageIntro('上傳貨單', chain ? '拍攝貨單留存本次進貨數量；上傳後直接進入 ERP 驗收提醒。' : '先選擇照片屬於同一張貨單，或是不同貨單。', `進貨 1 / ${chain ? '2' : '4'}`)}
      <div class="choice-grid"><button class="choice active" type="button" data-shell-action="同一張貨單多頁"><strong>同一張貨單</strong><small>多頁或不同角度</small></button><button class="choice" type="button" data-shell-action="不同貨單"><strong>不同貨單</strong><small>系統分批建立</small></button></div>
      <section class="shell-card photo-grid">${[1,2,3].map(number => `<div><span>${icon('fileText')}</span><small>第 ${number} 張</small></div>`).join('')}<button type="button" data-shell-action="新增照片">＋<small>新增照片</small></button></section><p class="shell-note">${chain ? '原圖完整保留；上傳後由 OCR 在背景統計品項與實收數量，不必等待辨識即可前往 ERP 驗收。' : '系統會提醒疑似重複照片；原圖會完整保留。'}</p>${actionButton('確認上傳', 'receiving-status')}`;
  }
  if (route === 'receiving-review') {
    return `${shellBack()}${pageIntro('人工核對・原始單據', '每個欄位可回查原始照片；修改會另存操作人與時間。', '進貨 2 / 4')}
      <section class="shell-card receipt-preview"><div class="fake-receipt">原始貨單<br><small>第 1 / 3 頁</small></div></section>
      <div class="shell-card review-fields">${[['品名 OCR 原文','火腿切片'],['數量','10 包'],['單價','NT$ 200'],['未稅','NT$ 2,000'],['稅額','NT$ 100'],['含稅','NT$ 2,100']].map(([label,value]) => `<button type="button" data-shell-action="修正 ${label}"><span><small>${label}</small><strong>${value}</strong></span>${icon('settings')}</button>`).join('')}</div>${actionButton('下一筆', 'receiving-mapping')}`;
  }
  if (route === 'receiving-mapping') {
    return `${shellBack()}${pageIntro('商品對應與編碼', '把 OCR 品名對應到正式商品主檔。', '進貨 3 / 4')}
      <section class="shell-card mapping-card"><div><small>OCR 品名</small><strong>火腿切片</strong></div><span>→</span><div><small>商品主檔</small><strong>HAM-001｜火腿</strong></div></section>
      <div class="shell-button-stack">${actionButton('選擇既有商品', 'receiving-published')}${actionButton('建立新商品／編碼', 'catalog', 'secondary')}</div>
      <section class="shell-section">${sectionHeading('核對結果')}<div class="choice-grid three"><button class="choice active" data-shell-action="正確"><strong>正確</strong></button><button class="choice" data-shell-action="已修正"><strong>已修正</strong></button><button class="choice" data-shell-action="無法判讀"><strong>無法判讀</strong></button></div></section>${actionButton('儲存並確認收貨', 'receiving-published')}`;
  }
  if (route === 'receiving-published') {
    if (businessType === 'CHAIN_RESTAURANT') {
      return `${shellBack()}<section class="completion-state"><span>${icon('tasks')}</span><h1>貨單紀錄已完成</h1><p>貨單照片已保存，OCR 將在背景統計進貨量</p></section><section class="shell-card completion-card erp"><strong>已加入門市公司流程待辦</strong><p>ERP 驗收不必現在執行，可由門市稍後統一完成。</p>${actionButton('查看公司流程待辦', 'store-company-tasks')}<small>序只提醒與保存回報人員、門市及時間，不會讀取或寫回 ERP。</small></section>${actionButton('返回今日工作', 'home', 'secondary')}`;
    }
    return `${shellBack()}<section class="completion-state"><span>${icon('tasks')}</span><h1>收貨核對完成</h1><p>實際進貨數量已確認無誤</p></section><section class="shell-card completion-card"><strong>本次進貨已完成</strong><p>✓ 完成「序」核對<br>✓ 收貨結案</p></section>${actionButton('返回進貨首頁', 'receiving')}`;
  }
  if (route === 'receiving-erp-complete') {
    return `${shellBack()}<section class="completion-state"><span>${icon('tasks')}</span><h1>ERP 驗收已登記</h1><p>王小明・2026/09/01 10:05</p></section><section class="shell-card completion-card"><strong>本次進貨完成</strong><p>✓ 貨單照片已留存<br>✓ 已回報 ERP 驗收完成<br>✓ 已通知店長</p><small>序只記錄回報人員、門市與時間，不連線或查驗 ERP。</small></section>${actionButton('返回今日工作', 'home')}`;
  }
  const chain = businessType === 'CHAIN_RESTAURANT';
  if (chain) {
    return `${shellBack()}${pageIntro('進貨 OCR 與公司流程', 'OCR 統計進貨量與 ERP 正式驗收分開進行。', '進貨 2 / 2')}
      <section class="shell-card status-timeline"><div class="current"><i></i><span><strong>序：OCR 統計進貨量</strong><small>背景辨識品項、單位與實收數量・原圖已保存</small></span></div><div class="current"><i></i><span><strong>已加入門市公司流程待辦</strong><small>ERP 驗收可稍後統一完成</small></span></div><div><i></i><span><strong>回序登記完成</strong><small>完成後立即通知該門市店長</small></span></div></section><div class="shell-button-stack">${actionButton('查看公司流程待辦', 'store-company-tasks')}${actionButton('返回今日工作', 'home', 'secondary')}</div><p class="shell-note">OCR 只建立序內進貨量與庫存依據；序不會讀取、查驗或寫回 ERP。</p>`;
  }
  return `${shellBack()}${pageIntro('貨單處理狀態', '上傳成功後即可繼續工作，辨識會在背景進行。', '進貨狀態')}
    <section class="shell-card status-timeline"><div class="done"><i></i><span><strong>原圖上傳完成</strong><small>今天 09:12</small></span></div><div class="current"><i></i><span><strong>AI 識別中</strong><small>原圖已保留，可稍後回來查看</small></span></div><div><i></i><span><strong>等待行政核對</strong></span></div><div><i></i><span><strong>已整理</strong></span></div></section>${actionButton('返回今日工作', 'home')}`;
}

function expiryPage(role, businessType, previewState = {}) {
  const manager = role === 'SUPERVISOR';
  const areaSupervisor = role === 'LOGISTICS' && businessType === 'CHAIN_RESTAURANT';
  const canAddReminder = role === 'STAFF' || manager;
  const urgentCount = unresolvedExpiryItems(previewState).length;
  const roleLabel = roleMeta(role, businessType).label;
  const scope = areaSupervisor ? `<section class="shell-card expiry-scope-card"><div><small>查看範圍</small><strong>BeApe 大安店</strong><span>先選門市，再沿用相同效期畫面查核。</span></div><button type="button" data-shell-action="切換門市">切換門市</button></section>` : '';
  return `${shellBack()}${pageIntro('效期提醒', '現場效期表負責完整記錄，序只提醒容易被遺漏的事情。', roleLabel)}
    ${scope}
    <section class="shell-section">${sectionHeading('今天需要看', '只顯示重點')}
      <div class="expiry-entry-grid">
        ${expiryEntryCard({ title: '立即處理', count: `${urgentCount} 項`, copy: urgentCount ? '已到期或今天到期' : '目前沒有待處理品項', route: 'expiry-urgent', tone: 'danger', iconName: 'warning' })}
        ${expiryEntryCard({ title: '預告', count: '2 項', copy: '即將到期，提前留意', route: 'expiry-upcoming', tone: 'warning' })}
        ${expiryEntryCard({ title: '風險區', count: '3 處', copy: '容易遺漏的儲物死角', route: 'expiry-risk-zones', tone: 'risk', iconName: 'search' })}
        ${expiryEntryCard({ title: '特別注意', count: '3 項', copy: '使用週期長的邊緣食材', route: 'expiry-special', tone: 'special', iconName: 'help' })}
      </div>
    </section>
    ${canAddReminder ? '<button class="expiry-suggest-link" type="button" data-route="expiry-suggest">＋ 新增現場提醒 <b>›</b></button>' : ''}
    <p class="shell-note">員工、店長與主管共用同一份待處理清單。任一人完成廢棄或確認已用完後，品項會從所有人的效期頁移除，完成資料只留在作業紀錄／廢棄紀錄。</p>`;
}

function expiryUrgentPage(role = 'STAFF', previewState = {}) {
  const canOperate = role !== 'LOGISTICS';
  const items = unresolvedExpiryItems(previewState);
  const actions = (key, overdue = false) => canOperate ? `${actionButton('登記廢棄', `expiry-discard-${overdue ? 'overdue-' : ''}${key}`)}${actionButton('已使用完', `expiry-used-confirm-${key}`, 'secondary')}` : '';
  const content = items.length
    ? `<div class="expiry-direct-list">${items.map(item => expiryFoodCard({ item: item.item, due: item.due, zone: item.zone, tone: 'danger', actions: actions(item.key, item.overdue) })).join('')}</div><p class="shell-note">員工與店長／主管看到的是同一筆待處理資料；誰先完成，這筆就從所有人的清單移除。已過期品前一天已提醒，登記廢棄時須回報延誤原因。</p>`
    : `<section class="shell-card expiry-empty-state"><span>${icon('tasks')}</span><div><strong>目前沒有需要立即處理的效期品項</strong><p>已完成的廢棄不再顯示於效期頁，請至作業紀錄／廢棄紀錄查看。</p></div></section>${actionButton('查看廢棄紀錄', 'activity', 'secondary')}`;
  return `${shellBack('返回效期提醒')}${pageIntro('立即處理', '只顯示尚未完成的品項；已完成者轉入廢棄紀錄。', `${items.length} 項`)}${content}`;
}

function expiryUpcomingPage() {
  return `${shellBack('返回效期提醒')}${pageIntro('預告', '即將到期，提前留意。', '2 項')}
    <div class="expiry-direct-list">
      ${expiryFoodCard({ item: '自製奶油醬', due: '明日到期｜09/03', zone: '工作冰箱', tone: 'warning' })}
      ${expiryFoodCard({ item: '煙燻鮭魚', due: '3 日後到期｜09/05', zone: '冷藏庫 A', tone: 'warning' })}
    </div>`;
}

function expiryRiskZonesPage(role = 'STAFF') {
  const risks = [
    ['工作台抽屜', '工作區｜抽屜最內側', '每日提醒'],
    ['冷藏貨架最下層', '冷藏庫 A｜後方死角', '每日提醒'],
    ['乾料櫃頂層', '乾料區｜視線以上', '每週一提醒'],
  ];
  const settings = role === 'SUPERVISOR'
    ? actionButton('設定本店風險區', 'expiry-risk-settings', 'secondary')
    : role === 'LOGISTICS' ? actionButton('查看門市風險區設定', 'expiry-risk-settings', 'secondary') : '';
  return `${shellBack('返回效期提醒')}${pageIntro('風險區', '容易遺漏的儲物死角。', '3 處')}
    <div class="expiry-risk-list">${risks.map(([title, meta, cadence]) => `<article class="shell-card expiry-risk-card"><span>${icon('search')}</span><div><strong>${escapeHtml(title)}</strong><small>${escapeHtml(meta)}</small><em>${escapeHtml(cadence)}</em></div></article>`).join('')}</div>
    ${settings}
    <p class="shell-note">這裡只提醒忙碌時最容易漏看的位置，不需要點入或回報。若發現食材問題，請使用「新增現場提醒」。</p>`;
}

function expiryRiskSettingsPage(role = 'SUPERVISOR') {
  const editable = role === 'SUPERVISOR';
  const risks = [
    ['work', '工作台抽屜', '工作區｜抽屜最內側', '每日'],
    ['cold', '冷藏貨架最下層', '冷藏庫 A｜後方死角', '每日'],
    ['dry', '乾料櫃頂層', '乾料區｜視線以上', '每週一'],
  ];
  return `${shellBack('返回風險區')}${pageIntro('本店風險區設定', '依本店格局設定容易遺漏的位置；不需要加入食材。', editable ? '店長／主管' : '區主管查核')}
    ${editable ? '<button class="shell-primary" type="button" data-route="expiry-risk-new">＋ 新增風險位置</button>' : ''}
    <div class="expiry-risk-list">${risks.map(([key, title, meta, cadence]) => `<article class="shell-card expiry-risk-card"><span>${icon('search')}</span><div><strong>${escapeHtml(title)}</strong><small>${escapeHtml(meta)}・${escapeHtml(cadence)}提醒</small></div>${editable ? `<button type="button" data-route="expiry-risk-edit-${escapeHtml(key)}">編輯</button>` : '<b>唯讀</b>'}</article>`).join('')}</div>
    <p class="shell-note">風險區屬於門市設定，不使用公司統一位置；${editable ? '店長／主管負責維護，員工不可修改。' : '區主管可查看各店設定與執行情況，實際設定由門市店長維護。'}</p>`;
}

function expiryRiskFormPage(route = 'expiry-risk-new') {
  const editing = route.startsWith('expiry-risk-edit-');
  const key = route.replace('expiry-risk-edit-', '');
  const records = {
    work: { area: '工作區', name: '工作台抽屜', detail: '抽屜最內側', cadence: '每日' },
    cold: { area: '冷藏庫 A', name: '冷藏貨架最下層', detail: '後方死角', cadence: '每日' },
    dry: { area: '乾料區', name: '乾料櫃頂層', detail: '視線以上', cadence: '每週一' },
  };
  const record = records[key] || { area: '工作區', name: '', detail: '', cadence: '每日' };
  const options = (values, selected) => values.map(value => `<option ${value === selected ? 'selected' : ''}>${escapeHtml(value)}</option>`).join('');
  return `${shellBack('返回風險區設定')}${pageIntro(editing ? '編輯風險位置' : '新增風險位置', '只設定容易被忽略的實際位置，不建立整區巡檢清單。', '本店設定')}
    <section class="shell-card expiry-suggest-form expiry-risk-form">
      <label><span>所屬儲物區</span><select aria-label="所屬儲物區">${options(['工作區', '冷藏庫 A', '冷凍庫', '乾料區'], record.area)}</select></label>
      <label><span>死角位置名稱</span><input value="${escapeHtml(record.name)}" placeholder="例如：工作台抽屜" aria-label="死角位置名稱"></label>
      <label><span>補充位置</span><input value="${escapeHtml(record.detail)}" placeholder="例如：抽屜最內側" aria-label="補充位置"></label>
      <label><span>提醒頻率</span><select aria-label="提醒頻率">${options(['每日', '每週一', '每週三', '每週五'], record.cadence)}</select><small>只在效期提醒中提示，不建立額外打卡或回報。</small></label>
    </section>
    <div class="shell-button-stack">${actionButton('儲存風險位置', editing ? `expiry-risk-saved-${key}` : 'expiry-risk-saved-new')}${editing ? actionButton('停用此風險位置', `expiry-risk-paused-${key}`, 'ghost') : ''}${actionButton('取消', 'expiry-risk-settings', 'secondary')}</div>
    <p class="shell-note">提醒內容會顯示死角位置、所屬儲物區與補充位置；員工只能查看，不能修改。</p>`;
}

function expiryRiskResultPage(route) {
  const paused = route.startsWith('expiry-risk-paused-');
  return `${shellBack('返回風險區設定')}<section class="completion-state"><span>${icon(paused ? 'warning' : 'tasks')}</span><h1>${paused ? '風險位置已停用' : '風險位置已儲存'}</h1><p>BeApe 大安店・李店長・今天 17:05</p></section>
    <section class="shell-card completion-card"><strong>${paused ? '員工不再收到此位置提醒' : '已套用本店風險區提醒'}</strong><p>${paused ? '歷史巡視紀錄仍會保留，需要時可重新啟用。' : '員工下次進入效期提醒時，會依設定頻率看到這個位置。'}</p></section>
    ${actionButton('返回風險區設定', 'expiry-risk-settings')}`;
}

function expirySpecialPage() {
  return `${shellBack('返回效期提醒')}${pageIntro('特別注意', '使用週期長、容易被遺忘的食材。', '3 項')}
    <div class="expiry-direct-list">
      ${expiryFoodCard({ item: '煙燻紅椒粉', due: '到期日｜2027/02/18', zone: '乾料區', tone: 'special' })}
      ${expiryFoodCard({ item: '松露粉', due: '到期日｜2026/12/30', zone: '工作台抽屜', tone: 'special' })}
      ${expiryFoodCard({ item: '香料油', due: '到期日｜2026/10/15', zone: '冷藏庫 A', tone: 'special' })}
    </div>
    <p class="shell-note">例如半年才用完一罐的調味粉；不是全品項清單。進入提前提醒日後會自動轉為「預告」，到期後轉為「立即處理」。</p>`;
}

function expiryZonePage(route) {
  if (route === 'expiry-zone-freezer') return expiryInspectionRecordPage();
  const itemData = route === 'expiry-zone-work'
    ? { key: 'work', zone: '工作冰箱', item: '雞高湯', due: '明日到期・09/03', source: '現場標籤', reminder: '到期前 3 日', comment: true }
    : route === 'expiry-zone-sauce'
      ? { key: 'sauce', zone: '工作冰箱', item: '自製奶油醬', due: '3 日內到期・09/05', source: '儲物區效期表', reminder: '到期前 3 日', comment: false }
      : { key: 'cold', zone: '冷藏庫', item: '鮮奶油 1L', due: '今日到期・09/02', source: '進貨時輸入・原包裝', reminder: '到期前 1 日', comment: false };
  const { key, zone, item, due, source, reminder, comment } = itemData;
  return `${shellBack('返回效期提醒')}${pageIntro(item, '查看日期與主管留言；沒有發生變化就不必操作。', zone)}
    <section class="shell-card expiry-due-card"><header><span>${icon('calendarClock')}</span><div><small>${due}</small><strong>${item}</strong></div><b>${zone}</b></header><div><span>日期依據</span><strong>${source}</strong></div><div><span>提醒設定</span><strong>${reminder}</strong></div></section>
    <section class="shell-card expiry-no-action"><strong>未到期，繼續使用即可</strong><span>目前不需回報；提醒會保留到使用完或登記廢棄。</span></section>
    <section class="shell-section">${sectionHeading('狀態有變化時才登記')}<div class="shell-button-stack">
      ${actionButton('已使用完', `expiry-used-confirm-${key}`, 'secondary')}
      ${actionButton('登記廢棄', `expiry-discard-${key}`, 'secondary')}
    </div></section>
    ${comment ? '<section class="shell-card expiry-usage-audit"><strong>主管留言</strong><span>雞高湯請今晚優先使用，閉店前確認。</span><small>李店長・今天 10:18</small></section>' : ''}
    <p class="shell-note">系統會自動記錄誰查看過提醒；員工不必為「繼續使用」多按一次。</p>`;
}

function expiryInspectionPage() {
  return expiryPage('STAFF', 'CHAIN_RESTAURANT');
}

function expiryAreaCard(title, copy, meta, route, complete = false) {
  return `<article class="shell-card expiry-area-card ${complete ? 'is-complete' : ''}"><span class="expiry-area-icon">${icon(complete ? 'tasks' : 'calendarClock')}</span><div><h2>${title}</h2><strong>${copy}</strong><small>${meta}</small></div><aside><b>${complete ? '已巡檢' : '尚未巡檢'}</b><button type="button" data-route="${route}">${complete ? '檢視紀錄' : '開始巡檢'}</button></aside></article>`;
}

function expiryInboundPage() {
  return `${shellBack('返回效期管理')}${pageIntro('進貨效期', '管理包裝有效日期，以及沒有原廠效期的生鮮進貨批次。', '效期來源 1')}
    <section class="shell-card shell-list">
      ${listRow({ route: 'expiry-alerts', iconName: 'warning', title: '鮮奶油 1L', copy: '原包裝效期 09/08・本批 4 瓶', count: '6 天', tone: 'warning' })}
      ${listRow({ route: 'expiry-alerts', iconName: 'calendarClock', title: '蘿蔓', copy: '09/02 進貨・明日安排品質巡檢', count: '2 箱' })}
    </section>
    <p class="shell-note">有原廠日期就依包裝效期；蔬菜等沒有標示效期的生鮮品，只記錄進貨日並安排品質巡檢，不把巡檢日冒稱為有效日期。</p>`;
}

function expiryEdgePage() {
  return `${shellBack('返回效期管理')}${pageIntro('邊緣食材', '開封後用得慢、每次用量少，容易留在冰箱或倉庫角落。', '效期來源 2')}
    <section class="shell-card shell-list">
      ${listRow({ route: 'expiry-alerts', iconName: 'calendarClock', title: '雞高湯', copy: '開封／製作後依現場標籤巡檢', count: '工作冰箱', tone: 'warning' })}
      ${listRow({ route: 'expiry-alerts', iconName: 'calendarClock', title: '鮮奶油 1L', copy: '依原包裝效期與開封標籤，以較早者優先', count: '冷藏庫' })}
      ${listRow({ route: 'expiry-alerts', iconName: 'calendarClock', title: '解凍牛菲力', copy: '依現場解凍標籤巡檢', count: '冷藏庫' })}
    </section>${actionButton('新增現場提醒', 'expiry-suggest', 'secondary')}
    <p class="shell-note">不是所有開封食材都要登記；只有使用慢、容易被忘記的品項才加入追蹤，日期以現場標籤為準。</p>`;
}

function expiryAlertsPage() {
  return `${shellBack('返回效期提醒')}${pageIntro('效期提醒', '到期前一日或指定三日提出提醒，只顯示需要行動的品項。', '今日提醒')}
    <section class="shell-card expiry-due-card"><header><span>${icon('warning')}</span><div><small>明日到期</small><strong>雞高湯</strong></div><b>09/03</b></header><div><span>儲放區</span><strong>工作冰箱</strong></div><div><span>日期依據</span><strong>現場標籤</strong></div><div><span>目前狀態</span><strong>等待巡檢確認</strong></div></section>
    ${actionButton('查看雞高湯', 'expiry-zone-work')}
    <p class="shell-note">App 不自行猜測未登記的開封或解凍日期；原包裝、現場標籤與已確認的門市規則，取較早需要處理的日期提醒。</p>`;
}

function expirySuggestPage() {
  return `${shellBack('返回效期提醒')}${pageIntro('新增現場提醒', '巡視現場時，補記自製、分裝、開封或容易遺忘的少數食材。', '現場巡視')}
    <section class="shell-card expiry-suggest-form">
      <label><span>品項名稱</span><input value="自製奶油醬" aria-label="品項名稱"></label>
      <label><span>到期日</span><input type="date" value="2026-09-05" aria-label="到期日"></label>
      <label><span>目前儲放區</span><select aria-label="目前儲放區"><option>工作冰箱（系統建議）</option><option>冷藏庫</option><option>冷凍庫</option></select><small>系統可依品項與最近紀錄提供建議，實際位置由現場人員確認。</small></label>
      <label><span>為什麼需要注意</span><select aria-label="注意原因"><option>保存期限短</option><option>使用速度慢</option><option>容易被遺忘</option><option>高單價食材（主管自訂）</option></select></label>
    </section>
    <section class="shell-card expiry-no-action"><strong>資料來源：現場巡視</strong><span>進貨驗收負責建立大部分包裝效期；這裡只補上現場臨時發現的提醒。</span></section>
    <section class="shell-card expiry-no-action"><strong>系統判定：預告</strong><span>到期日為 09/05，已進入提前 3 日提醒。員工不需要自行選擇輕重緩急。</span></section>
    ${shellActionButton('新增提醒', '現場提醒已新增', 'primary')}
    <p class="shell-note">優先順序固定為立即處理 ＞ 預告 ＞ 特別注意；風險區是門市位置提醒，獨立計算。</p>`;
}

function expiryInspectionRecordPage() {
  return `${shellBack('返回巡檢進度')}<section class="completion-state compact"><span>${icon('tasks')}</span><h1>冷凍庫已巡檢</h1><p>陳怡安・今天 15:42</p></section><section class="shell-card result-list"><div><span>必要確認</span><strong>1 項</strong></div><div><span>未標示品項</span><strong>未發現</strong></div><div><span>異常回報</span><strong>0 項</strong></div></section>${actionButton('返回巡檢進度', 'expiry-inspection')}`;
}

function expiryIssuePage() {
  return `${shellBack('返回工作冰箱')}${pageIntro('發現其他效期問題', '選擇現場實際發現的狀況，只針對異常留下紀錄。', '巡檢例外')}
    <section class="shell-card shell-list">
      ${listRow({ route: 'expiry-expired', iconName: 'warning', title: '發現已到期', copy: '必須登記廢棄，或確認此批次已使用完', count: '立即處理', tone: 'danger' })}
      ${listRow({ route: 'expiry-result-label', iconName: 'calendarClock', title: '日期標示不清', copy: '回報缺少、模糊或日期不合理的標籤', count: '回報' })}
      ${listRow({ route: 'expiry-result-label', iconName: 'warning', title: '食材品質異常', copy: '外觀、包裝或保存狀態需要店長確認', count: '回報', tone: 'warning' })}
    </section>
    <p class="shell-note">清單外發現的到期品也走相同流程，不需要先回到效期首頁重新搜尋品項。</p>`;
}

function expiryExpiredPage() {
  return `${shellBack('返回效期問題')}${pageIntro('雞高湯', '工作冰箱・現場標籤 09/01', '已到期')}
    <section class="shell-card expiry-expired-card"><span>${icon('warning')}</span><div><strong>前一天已提醒，現在必須完成處理</strong><p>未在到期前處理者，登記廢棄時須回報延誤原因。</p></div></section>
    <section class="shell-section">${sectionHeading('選擇處理結果')}<div class="shell-button-stack">
      ${actionButton('登記廢棄', 'expiry-discard-overdue-work')}
      ${actionButton('已使用完', 'expiry-used-confirm-work', 'secondary')}
    </div></section>`;
}

function expiryUsedConfirmPage(route = 'expiry-used-confirm-work') {
  const item = route.endsWith('-cold')
    ? { key: 'cold', name: '鮮奶油 1L', zone: '冷藏庫 A', date: '09/02' }
    : { key: 'work', name: '雞高湯', zone: '工作冰箱', date: '09/02' };
  return `${shellBack('返回立即處理')}${pageIntro('確認已使用完', '確認現場已無此批次，再移除效期提醒。', item.name)}
    <section class="shell-card result-list"><div><span>品項</span><strong>${item.name}</strong></div><div><span>效期批次</span><strong>${item.date}</strong></div><div><span>儲放區</span><strong>${item.zone}</strong></div></section>
    <section class="shell-card expiry-no-action"><strong>只結束這個批次與區域的追蹤</strong><span>商品與歷史效期紀錄仍會保留；其他批次或其他區域不受影響。</span></section>
    ${actionButton('確認使用完並移除', `expiry-result-used-${item.key}`)}`;
}

function expiryDiscardPage(route = 'expiry-discard-work') {
  const overdue = route.includes('-overdue-');
  const itemData = route.endsWith('-cold')
    ? { key: 'cold', item: '鮮奶油 1L', zone: '冷藏庫', date: '2026/09/02' }
    : route.endsWith('-sauce')
      ? { key: 'sauce', item: '自製奶油醬', zone: '工作冰箱', date: '2026/09/05' }
      : { key: 'work', item: '雞高湯', zone: '工作冰箱', date: '2026/09/03' };
  const reasonForm = overdue ? `<section class="shell-card quantity-reason-card"><header><span><strong>${itemData.item}</strong><small>${itemData.zone}・到期日 ${itemData.date}</small></span><b>已逾期</b></header><label class="quantity-reason-note"><span>為什麼未在到期前處理？（必填）</span><textarea rows="3" required placeholder="例如：交接時遺漏，未依前一天提醒處理"></textarea></label></section>` : '';
  return `${shellBack('返回立即處理')}${pageIntro(overdue ? '登記廢棄並回報延誤' : '登記廢棄', overdue ? '前一天已提醒；回報延誤原因後立即完成廢棄。' : '正常處理今日到期品，只需確認廢棄數量與單位。', itemData.item)}
    ${reasonForm}
    <section class="shell-card expiry-discard-form">
      <div><span>儲放區</span><strong>${itemData.zone}</strong></div>
      <div><span>標籤到期日</span><strong>${itemData.date}</strong></div>
      <div><span>廢棄原因</span><strong>效期到期</strong></div>
      <label><span>廢棄數量</span><div class="expiry-discard-quantity"><input type="number" value="1" min="0" step="0.1" aria-label="廢棄數量"><select aria-label="廢棄單位"><option>份</option><option>包</option><option>公克</option><option>公斤</option></select></div></label>
    </section>
    ${actionButton(overdue ? '回報延誤並記錄廢棄' : '確認並記錄廢棄', `expiry-discard-complete-${overdue ? 'overdue-' : ''}${itemData.key}`)}
    <p class="shell-note">${overdue ? '店長／主管會看到前一天提醒時間、未處理原因、回報人與完成廢棄時間。' : '完成後加入廢棄紀錄；連鎖門市同時加入今日 ERP 廢棄彙整。'}</p>`;
}

function expiryDiscardCompletePage(businessType, route = 'expiry-discard-complete-work') {
  const chain = businessType === 'CHAIN_RESTAURANT';
  const overdue = route.includes('-overdue-');
  const record = route.endsWith('-cold')
    ? { item: '鮮奶油 1L', quantity: '1 瓶', zone: '冷藏庫' }
    : route.endsWith('-sauce')
      ? { item: '自製奶油醬', quantity: '1 盒', zone: '工作冰箱' }
      : { item: '雞高湯', quantity: '1 份', zone: '工作冰箱' };
  return `${shellBack()}<section class="completion-state"><span>${icon('tasks')}</span><h1>廢棄紀錄已完成</h1><p>${record.item}・${record.quantity}・今天 16:24</p></section>
    <section class="shell-card completion-card"><strong>本次廢棄紀錄</strong><p>品項：${record.item}<br>數量：${record.quantity}<br>原因：效期到期${overdue ? '<br>未處理原因：晚班交接遺漏' : ''}<br>儲放區：${record.zone}<br>紀錄人員：王小明・今天 16:24</p></section>
    ${chain ? '<section class="shell-card completion-card erp"><strong>已加入今日 ERP 廢棄彙整</strong><p>目前共 6 筆・統一輸入時間 21:30。現場不需要逐筆進入 ERP。</p></section>' : ''}
    ${actionButton('返回立即處理', 'expiry-urgent')}`;
}

function expiryLotPage(route, businessType) {
  const chain = businessType === 'CHAIN_RESTAURANT';
  const opened = route === 'expiry-lot-ham';
  const item = route === 'expiry-lot-beef' ? ['牛菲力', '3.25 kg', '易漏看'] : opened ? ['火腿', '2 包', '標籤待確認'] : ['鮮奶油 1L', '4 瓶', '今日到期'];
  return `${shellBack()}${pageIntro(item[0], opened ? '依現場紙本標籤確認日期，同時檢查品質與所有存放位置。' : '核對原包裝日期、外觀與現場數量。', item[2])}
    <section class="shell-card result-list"><div><span>日期依據</span><strong>${opened ? '現場開封標籤' : '原包裝效期'}</strong></div>${opened ? '<div><span>巡檢重點</span><strong>標籤・氣味・外觀</strong></div><div><span>存放位置</span><strong>冷藏庫＋工作冰箱</strong></div>' : '<div><span>包裝有效日期</span><strong>2026/09/01</strong></div><div><span>存放位置</span><strong>冷藏庫後排</strong></div>'}<div><span>現場數量</span><strong>${item[1]}</strong></div></section>
    <section class="shell-section">${sectionHeading('回報巡檢結果', '異常才需要補充')}<div class="shell-button-stack">${actionButton('確認正常', 'expiry-result-normal')}${actionButton('標籤異常', 'expiry-result-label', 'secondary')}${actionButton('發現變質', chain ? 'expiry-result-waste-chain' : 'expiry-result-waste', 'secondary')}${actionButton('已用完', 'expiry-result-used', 'secondary')}${actionButton('數量不符', 'expiry-quantity-reason', 'secondary')}</div></section><p class="shell-note">App 只保留巡檢人員、區域、結果與時間，不取代現場標籤，也不自行推算未登記的開封日期。</p>`;
}

function expiryQuantityReasonPage() {
  const reasons = ['使用未登記', '報廢未登記', '移轉／借用未登記', '標示或盤點錯誤', '其他'];
  return `${shellBack()}${pageIntro('回報數量不符', '員工先提供現場原因，主管才會收到完整異常。', '效期例外')}
    <section class="shell-card quantity-reason-card"><header><span><strong>鮮奶油 1L</strong><small>冷藏庫・系統紀錄 4 瓶／現場 3 瓶</small></span><b>差 1 瓶</b></header><fieldset><legend>請選擇原因（必填）</legend>${reasons.map((reason, index) => `<label><input type="radio" name="quantity-reason" ${index === 0 ? 'checked' : ''}><span>${reason}</span></label>`).join('')}</fieldset><label class="quantity-reason-note"><span>補充說明（選填）</span><textarea rows="3" placeholder="例如：午餐尖峰取用 1 瓶，尚未登記">午餐尖峰使用 1 瓶，尚未登記</textarea></label></section>${actionButton('回報數量不符', 'expiry-result-quantity')}<p class="shell-note">送出後，店長會看到品項、系統數量、現場數量、原因、回報人與時間。</p>`;
}

function expiryResultPage(route, businessType) {
  const chain = businessType === 'CHAIN_RESTAURANT';
  if (route === 'expiry-result-inspected' || route === 'expiry-result-normal') return `${shellBack()}<section class="completion-state"><span>${icon('tasks')}</span><h1>本區巡檢已完成</h1><p>工作冰箱・王小明・今天 16:20</p></section><section class="shell-card completion-card"><strong>巡檢紀錄已留下</strong><p>必要確認 2 項已完成；其他未巡檢區域仍會保留提醒。</p></section>${actionButton('巡下一個區域', 'expiry-inspection')}`;
  if (route === 'expiry-result-label') return `${shellBack()}<section class="completion-state"><span>${icon('warning')}</span><h1>標籤異常已回報</h1><p>火腿・冷藏庫・2026/09/01 16:20</p></section><section class="shell-card completion-card"><strong>請現場補貼或更正紙本標籤</strong><p>已通知店長；工作冰箱仍有同品項，效期提醒不會消失。</p></section>${actionButton('返回效期提醒', 'expiry')}`;
  if (route === 'expiry-result-waste-chain') return `${shellBack()}<section class="completion-state"><span>${icon('trash')}</span><h1>序內報廢已記錄</h1><p>鮮奶油 1L・4 瓶・2026/09/01 16:20</p></section><section class="shell-card completion-card erp"><strong>已加入今日 ERP 廢棄彙整</strong><p>目前共 6 筆・統一輸入時間 21:30。現場不需要逐筆進入 ERP。</p>${actionButton('查看今日彙整', 'expiry-erp-waste-summary')}<small>序保留原始明細與回報人，不會讀取、查驗或寫回 ERP。</small></section>${actionButton('返回效期提醒', 'expiry', 'secondary')}`;
  if (route === 'expiry-erp-waste-complete') return `${shellBack()}<section class="completion-state"><span>${icon('tasks')}</span><h1>今日 ERP 廢棄已回報</h1><p>6 筆・李店長・今天 21:36</p></section><section class="shell-card completion-card"><strong>今日彙整已備存</strong><p>✓ 6 筆廢棄明細<br>✓ 現場紀錄人員與時間<br>✓ ERP 輸入回報人員與時間<br>✓ 主管可依日期與門市查核</p></section>${actionButton('返回今日工作', 'home')}`;
  if (route.startsWith('expiry-result-used')) {
    const item = route.endsWith('-cold')
      ? { name: '鮮奶油 1L', zone: '冷藏庫 A' }
      : { name: '雞高湯', zone: '工作冰箱' };
    return `${shellBack()}<section class="completion-state"><span>${icon('tasks')}</span><h1>已使用完並移除提醒</h1><p>${item.name}・09/02 批次・${item.zone}</p></section><section class="shell-card completion-card"><strong>歷史紀錄仍保留</strong><p>只結束目前批次與所在區域的效期追蹤；商品、其他批次與其他區域不受影響。<br>王小明・今天 16:20</p></section>${actionButton('返回立即處理', 'expiry-urgent')}`;
  }
  const copy = route === 'expiry-result-used' ? '已用完・批次追蹤結束' : route === 'expiry-result-quantity' ? '數量不符・員工已回報原因' : '報廢已記錄・已銜接庫存與廢棄';
  const detail = route === 'expiry-result-quantity' ? '<strong>主管收到的內容</strong><p>系統 4 瓶／現場 3 瓶<br>原因：使用未登記<br>補充：午餐尖峰使用 1 瓶，尚未登記<br>王小明・2026/09/01 16:24</p>' : `<strong>${chain ? '現場紀錄完成' : '序內資料已串連'}</strong><p>保留原始效期、處理人員、門市與 2026/09/01 16:20。</p>`;
  return `${shellBack()}<section class="completion-state"><span>${icon('tasks')}</span><h1>效期例外已記錄</h1><p>${copy}</p></section><section class="shell-card completion-card">${detail}</section>${actionButton('返回效期提醒', 'expiry')}`;
}

function expiryErpWasteSummaryPage() {
  return `${shellBack('返回公司流程待辦')}${pageIntro('登入 ERP 輸入今日廢棄', '依下列彙整一次輸入。', '6 筆')}
    <section class="shell-card result-list"><div><span>門市</span><strong>BeApe 大安店</strong></div><div><span>統一輸入時間</span><strong>21:30</strong></div><div><span>目前狀態</span><strong>等待輸入 ERP</strong></div></section>
    <section class="shell-section">${sectionHeading('今日廢棄明細', '保留原始紀錄')}<div class="shell-card result-list"><div><span>雞高湯</span><strong>1 份</strong></div><div><span>鮮奶油 1L</span><strong>2 瓶</strong></div><div><span>煙燻鮭魚</span><strong>1 包</strong></div><div><span>自製奶油醬</span><strong>2 盒</strong></div></div></section>
    ${actionButton('確認已完成 ERP 輸入', 'expiry-erp-waste-complete')}
    <p class="shell-note">序只保存今日應輸入明細、現場紀錄人、ERP 完成回報人與時間；主管可依日期及門市查核。</p>`;
}

function transferStatusCard({ route, title, copy, status, tone = '', iconName = 'arrowRight' }) {
  return `<button class="transfer-status-card ${tone}" type="button" data-route="${escapeHtml(route)}"><span>${icon(iconName)}</span><div><strong>${escapeHtml(title)}</strong><small>${escapeHtml(copy)}</small></div><b>${escapeHtml(status)}</b></button>`;
}

function transferHomePage(role, businessType) {
  const managementOnly = role === 'LOGISTICS' || role === 'OWNER';
  if (managementOnly) return `${shellBack()}${pageIntro('借貸', '查看紀錄與待處理項目。', '管理')}
    <button class="transfer-search-entry" type="button" data-route="transfer-search"><span>${icon('search')}</span><div><strong>搜尋庫存</strong><small>查看可能有貨的門市</small></div><b>›</b></button>
    <div class="home-metrics transfer-metrics">${metric('借入待還', '1', 'warning')}${metric('借出待還', '1', 'info')}${metric('本月紀錄', '12')}</div>
    <section class="shell-section">${sectionHeading('追蹤')}<div class="transfer-status-list">${transferStatusCard({ route: 'transfer-open', title: '待處理', copy: '尚未歸還', status: '2 筆', tone: 'warning' })}${transferStatusCard({ route: 'transfer-monthly', title: '本月調撥', copy: businessType === 'CHAIN_RESTAURANT' ? '品項、數量與門市' : '品項、數量與參考價格', status: '9 月', iconName: 'activity' })}</div></section>`;
  return `${shellBack()}${pageIntro('借貸', '搜尋、記錄、追蹤。', 'BeApe 大安店')}
    <button class="transfer-search-entry" type="button" data-route="transfer-search"><span>${icon('search')}</span><div><strong>搜尋庫存</strong><small>火腿、鮮奶油、牛菲力</small></div><b>›</b></button>
    <div class="transfer-entry-grid">${transferStatusCard({ route: 'transfer-record', title: '新增紀錄', copy: '借入、借出或調撥', status: '新增', iconName: 'tasks' })}${transferStatusCard({ route: 'transfer-open', title: '待處理', copy: '尚未歸還', status: '2 筆', tone: 'warning', iconName: 'warning' })}${transferStatusCard({ route: 'transfer-history', title: '借貸紀錄', copy: '本月 12 筆', status: '紀錄', iconName: 'activity' })}</div>`;
}

function transferSearchPage() {
  return `${shellBack('返回借貸')}${pageIntro('搜尋庫存', '查看可能有貨的門市。', '找貨')}
    <form class="transfer-search-form"><label><span>${icon('search')}</span><input type="search" value="火腿" aria-label="搜尋品項" placeholder="輸入品項名稱"><button type="button" data-route="transfer-search">搜尋</button></label></form>
    <section class="shell-section">${sectionHeading('火腿', '優先推薦 3 家')}<div class="transfer-recommendations">
      ${transferRecommendationCard({ rank: '1', store: 'BeApe 信義店', updated: '今日 09:40 更新' })}
      ${transferRecommendationCard({ rank: '2', store: 'BeApe 板橋店', updated: '今日 10:15 更新' })}
      ${transferRecommendationCard({ rank: '3', store: 'BeApe 中山店', updated: '昨日 18:30 更新', stale: true })}
    </div></section><p class="shell-note">庫存可能因現場使用而變動，實際品項與數量請聯絡門市確認。</p>`;
}

function transferRecommendationCard({ rank, store, updated, stale = false }) {
  return `<article class="shell-card transfer-recommendation ${stale ? 'is-stale' : ''}"><header><span>${rank}</span><div><strong>${escapeHtml(store)}</strong><small>${escapeHtml(updated)}</small></div><b>${stale ? '資料較舊' : '庫存較寬裕'}</b></header></article>`;
}

function transferRecordPage(businessType, movementType = 'new') {
  const isNew = movementType === 'new';
  const isLoan = movementType === 'loan';
  const referencePrice = businessType === 'INDEPENDENT_RESTAURANT' ? `<div class="transfer-price-reference" data-transfer-reference-price ${isNew ? 'hidden' : ''}><span>品項參考價格</span><strong>NT$ 680／包</strong><small>依最近一筆已發布的進貨價格顯示，不在此處修改。</small></div>` : '';
  if (isNew) return `${shellBack('返回借貸')}${pageIntro('新增紀錄', '', 'BeApe 大安店')}
    <section class="shell-card transfer-form"><label><span>異動方式</span><select aria-label="異動方式" data-transfer-mode-select><option value="loan">借入</option><option value="loan_out">借出</option><option value="move">調撥</option></select></label><label><span>門市</span><select aria-label="門市"><option>BeApe 信義店</option><option>BeApe 板橋店</option><option>BeApe 中山店</option></select></label><label><span>品項</span><input type="text" value="伊比利火腿" list="transfer-item-options" aria-label="品項"><datalist id="transfer-item-options"><option value="伊比利火腿"><option value="鮮奶油"><option value="牛菲力"></datalist></label><label><span>數量</span><div class="transfer-quantity"><input type="number" value="2" min="0" step="1" aria-label="數量"><select aria-label="單位"><option>包</option><option>公斤</option><option>盒</option></select></div></label><label data-transfer-loan-date><span>預計歸還日（選填）</span><input type="date" aria-label="預計歸還日（選填）"></label>${referencePrice}</section><button class="shell-primary" type="button" data-route="transfer-recorded" data-transfer-complete>完成借入紀錄</button>`;
  return `${shellBack('返回搜尋結果')}${pageIntro(isLoan ? '借貸記錄' : '調撥記錄', '門市與品項已帶入，只填實際數量。', '火腿')}
    <section class="shell-card transfer-selected"><small>${isLoan ? '借入門市' : '調撥門市'}</small><strong>BeApe 信義店 → BeApe 大安店</strong><b>火腿</b></section>
    <section class="shell-card transfer-form"><label><span>實際取得數量</span><div class="transfer-quantity"><input type="number" value="2" min="0" step="1" aria-label="實際取得數量"><select aria-label="取得單位"><option>包</option><option>公斤</option><option>盒</option></select></div></label>${isLoan ? '<label><span>預計歸還日</span><input type="date" value="2026-09-08" aria-label="預計歸還日"></label>' : referencePrice}</section>${actionButton(isLoan ? '完成借貸記錄' : '完成調撥記錄', isLoan ? 'transfer-recorded' : 'transfer-move-recorded')}<p class="shell-note">只有實際拿到貨才記錄；此頁不會向對方發送申請或保留庫存。</p>`;
}

function transferRecordedPage(businessType) {
  return `${shellBack()}<section class="completion-state"><span>${icon('tasks')}</span><h1>借貸已記錄</h1><p>信義店 → 大安店・火腿 2 包</p></section><section class="shell-card completion-card"><strong>已建立還貨提醒</strong><p>預計 09/08 歸還</p></section>${actionButton('返回借貸', 'transfers')}`;
}

function transferMoveRecordedPage(businessType) {
  return `${shellBack()}<section class="completion-state"><span>${icon('tasks')}</span><h1>調撥已記錄</h1><p>一店 → 二店・伊比利火腿 2 包</p></section><section class="shell-card completion-card"><strong>已加入本月調撥</strong></section>${actionButton('返回借貸', 'transfers')}`;
}

function transferExchangeRecordedPage() {
  return `${shellBack()}<section class="completion-state"><span>${icon('tasks')}</span><h1>換貨已記錄</h1><p>信義店 → 大安店・伊比利火腿 2 包</p></section><section class="shell-card completion-card"><strong>等待換回</strong></section>${actionButton('查看未結清', 'transfer-open')}`;
}

function transferHistoryPage(businessType) {
  const transferCopy = businessType === 'CHAIN_RESTAURANT' ? '一店 → 二店' : '一店 → 二店・參考單價 NT$ 680';
  return `${shellBack('返回借貸')}${pageIntro('借貸紀錄', '', '2026 年 9 月')}<div class="shell-card timeline-list"><article><i></i><div><strong>借入・火腿 2 包</strong><small>借出門市：信義店・王小明・09/03</small></div></article><article><i></i><div><strong>調撥・伊比利火腿 2 包</strong><small>${transferCopy}</small></div></article><article><i></i><div><strong>換貨結清・起司 1 塊</strong><small>原借入：火腿 2 包・09/02</small></div></article><article><i></i><div><strong>借出已歸還・檸檬 3 公斤</strong><small>借入門市：中山店・09/01</small></div></article></div>`;
}

function transferOpenPage(role, businessType) {
  const canAct = role === 'STAFF' || role === 'SUPERVISOR';
  return `${shellBack('返回借貸')}${pageIntro('待處理', '', '2 筆')}
    <section class="shell-section">${sectionHeading('借入')}<div class="transfer-status-list">${transferStatusCard({ route: 'transfer-loan-detail', title: '借入', copy: '信義店提供・火腿 2 包・預計 09/08', status: '待還 2 包', tone: 'warning', iconName: 'warning' })}</div></section>
    <section class="shell-section">${sectionHeading('借出')}<div class="transfer-status-list">${transferStatusCard({ route: 'transfer-loan-out-detail', title: '借出', copy: '板橋店・檸檬 5 公斤', status: '待還 2 公斤', iconName: 'arrowRight' })}</div></section>`;
}

function transferExchangeDetailPage(role, businessType) {
  const canAct = role === 'STAFF' || role === 'SUPERVISOR';
  const note = businessType === 'CHAIN_RESTAURANT' ? '價格由公司 ERP 管理；序只保存實際換回的品項與數量。' : '序只保存實際換出與換回的品項及數量。';
  return `${shellBack()}${pageIntro('等待換回品項', '這筆換貨尚未結清。', '提供給信義店')}<section class="shell-card result-list transfer-loan-summary"><div><span>換出</span><strong>伊比利火腿 2 包</strong></div><div><span>目前換回</span><strong>帕瑪森起司 1 塊</strong></div><div><span>狀態</span><strong>尚未結清</strong></div></section>${canAct ? actionButton('記錄換回品項', 'transfer-exchange-return') : ''}<p class="shell-note">${note}</p>`;
}

function transferExchangeReturnPage() {
  return `${shellBack()}${pageIntro('記錄換回品項', '實際收到後只記錄品項與數量。', '連鎖餐飲')}<section class="shell-card transfer-form"><label><span>換回品項</span><input type="text" value="帕瑪森起司" aria-label="換回品項"></label><label><span>實際數量</span><div class="transfer-quantity"><input type="number" value="1" min="0" step="1" aria-label="實際數量"><select aria-label="單位"><option>塊</option><option>包</option></select></div></label></section>${actionButton('完成換回記錄', 'transfer-exchange-returned')}`;
}

function transferExchangeReturnedPage() {
  return `${shellBack()}<section class="completion-state"><span>${icon('tasks')}</span><h1>換回已記錄</h1><p>帕瑪森起司 1 塊</p></section><section class="shell-card completion-card"><strong>換貨已結清</strong><p>換出：伊比利火腿 2 包<br>換回：帕瑪森起司 1 塊</p></section>${actionButton('返回借貸', 'transfers')}`;
}

function transferMonthlyPage(businessType) {
  const priceSummary = businessType === 'INDEPENDENT_RESTAURANT' ? '<div><span>參考總額</span><strong>NT$ 5,240</strong></div><div><span>正式金額</span><strong>待財務確認</strong></div>' : '';
  const firstPrice = businessType === 'INDEPENDENT_RESTAURANT' ? '・參考單價 NT$ 680' : '';
  const secondPrice = businessType === 'INDEPENDENT_RESTAURANT' ? '・參考單價 NT$ 180' : '';
  const note = businessType === 'INDEPENDENT_RESTAURANT' ? '<p class="shell-note">價格依最近一筆已發布進貨紀錄顯示；正式金額仍由財務確認。</p>' : '';
  return `${shellBack('返回借貸')}${pageIntro('本月調撥', '品項、數量與門市。', '2026 年 9 月')}<section class="shell-card result-list"><div><span>調撥筆數</span><strong>8 筆</strong></div><div><span>品項數</span><strong>12 項</strong></div>${priceSummary}</section><section class="shell-section">${sectionHeading('品項')}<div class="shell-card timeline-list"><article><i></i><div><strong>伊比利火腿 2 包</strong><small>一店 → 二店${firstPrice}</small></div></article><article><i></i><div><strong>鮮奶油 6 瓶</strong><small>二店 → 一店${secondPrice}</small></div></article></div></section>${note}`;
}

function transferLoanOutDetailPage(role) {
  const canAct = role === 'STAFF' || role === 'SUPERVISOR';
  return `${shellBack('返回待處理')}${pageIntro('借出', '', '待歸還')}<section class="shell-card result-list transfer-loan-summary"><div><span>借入門市</span><strong>BeApe 板橋店</strong></div><div><span>品項</span><strong>檸檬</strong></div><div><span>借貸數量</span><strong>5 公斤</strong></div><div><span>剩餘數量</span><strong>2 公斤</strong></div><div><span>預計歸還</span><strong>09/08</strong></div><div><span>經手人</span><strong>王小明・09/03 10:28</strong></div></section>${canAct ? actionButton('登記收到歸還', 'transfer-receive-return') : ''}`;
}

function transferReceiveReturnPage() {
  return `${shellBack()}${pageIntro('記錄收到歸還', '實際收到後，再記錄本次數量。', '借出・檸檬')}<section class="shell-card transfer-form"><label><span>歸還門市</span><input type="text" value="BeApe 板橋店" readonly aria-label="歸還門市"></label><label><span>本次收到數量</span><div class="transfer-quantity"><input type="number" value="2" min="0" max="2" step="1" aria-label="收到數量"><select aria-label="收到單位"><option>公斤</option></select></div></label></section>${actionButton('完成收到歸還記錄', 'transfer-receive-returned')}<p class="shell-note">完成後，這筆借出會結清並移至歷史紀錄。</p>`;
}

function transferReceiveReturnedPage() {
  return `${shellBack()}<section class="completion-state"><span>${icon('tasks')}</span><h1>收到歸還已記錄</h1><p>板橋店歸還・檸檬 2 公斤</p></section><section class="shell-card completion-card"><strong>借出已結清</strong></section>${actionButton('返回借貸', 'transfers')}`;
}

function transferLoanDetailPage(role) {
  const canAct = role === 'STAFF' || role === 'SUPERVISOR';
  return `${shellBack('返回待處理')}${pageIntro('借入', '', '待歸還')}<section class="shell-card result-list transfer-loan-summary"><div><span>借出門市</span><strong>BeApe 信義店</strong></div><div><span>品項</span><strong>火腿</strong></div><div><span>借貸數量</span><strong>2 包</strong></div><div><span>剩餘數量</span><strong>2 包</strong></div><div><span>預計歸還</span><strong>09/08</strong></div><div><span>經手人</span><strong>王小明・09/03 10:28</strong></div></section>${canAct ? `<div class="shell-button-stack">${actionButton('登記歸還', 'transfer-return')}${actionButton('改以其他品項換貨', 'transfer-exchange-return', 'secondary')}</div>` : ''}`;
}

function transferReturnPage() {
  return `${shellBack()}${pageIntro('記錄已歸還', '實際交還後，再記錄本次數量。', '火腿')}<section class="shell-card transfer-form"><label><span>歸還門市</span><input type="text" value="BeApe 信義店" readonly aria-label="歸還門市"></label><label><span>本次歸還數量</span><div class="transfer-quantity"><input type="number" value="2" min="0" max="2" step="1" aria-label="歸還數量"><select aria-label="歸還單位"><option>包</option></select></div></label></section>${actionButton('完成歸還記錄', 'transfer-return-sent')}<p class="shell-note">歸還完成後，提供門市會收到紀錄通知；資料有誤時再回報。</p>`;
}

function transferReturnSentPage() {
  return `${shellBack()}<section class="completion-state"><span>${icon('tasks')}</span><h1>歸還已記錄</h1><p>火腿 2 包・大安店 → 信義店</p></section><section class="shell-card completion-card"><strong>借貸已結清</strong></section>${actionButton('返回借貸', 'transfers')}`;
}

function wasteHomePage() {
  return `${shellBack()}${pageIntro('廢棄', '', 'BeApe 大安店')}<div class="transfer-entry-grid">${transferStatusCard({ route: 'waste-new', title: '新增廢棄', copy: '品項、數量與原因', status: '新增', iconName: 'trash' })}${transferStatusCard({ route: 'waste-history', title: '廢棄紀錄', copy: '今天 6 筆', status: '紀錄', iconName: 'activity' })}</div>`;
}

function wasteNewPage() {
  return `${shellBack('返回廢棄')}${pageIntro('新增廢棄', '', 'BeApe 大安店')}<section class="shell-card transfer-form"><label><span>品項</span><input type="text" value="鮮奶油" list="waste-item-options" aria-label="品項" data-waste-item-input><datalist id="waste-item-options"><option value="鮮奶油"><option value="火腿"><option value="牛菲力"></datalist></label><label><span>數量</span><div class="transfer-quantity"><input type="number" value="2" min="0" step="1" aria-label="數量"><select aria-label="單位" data-waste-unit-select><option>瓶</option><option>包</option><option>公斤</option><option>盒</option></select></div></label><label><span>廢棄原因</span><select aria-label="廢棄原因"><option>效期到期</option><option>品質異常</option><option>製作或操作損耗</option><option>保存或設備異常</option><option>供應商問題</option><option>其他</option></select></label><label><span>補充說明（選填）</span><textarea aria-label="補充說明（選填）" placeholder="需要時再填寫"></textarea></label></section><p class="shell-note">門市、經手人與時間會自動保存。</p><p class="shell-note" data-waste-duplicate-warning hidden>鮮奶油今天 16:24 已登記 2 瓶，仍要新增嗎？</p><button class="shell-primary" type="button" data-waste-submit>完成廢棄紀錄</button>`;
}

function wasteHistoryPage(businessType) {
  const showPrice = businessType === 'INDEPENDENT_RESTAURANT';
  const toggle = showPrice ? '<button class="shell-secondary" type="button" data-waste-amount-toggle>顯示金額</button>' : '';
  const amount = value => showPrice ? `<b data-waste-amount hidden>參考金額 NT$${value}</b>` : '';
  const price = showPrice ? '<div data-waste-amount hidden><span>今日參考金額</span><strong>NT$1,180</strong></div>' : '';
  return `${shellBack('返回廢棄')}${pageIntro('廢棄紀錄', '', '今天')}<div class="filter-chips"><button class="active">今天</button><button>本月</button><button>選擇月份</button></div>${toggle}<section class="shell-card result-list"><div><span>今日筆數</span><strong>6 筆</strong></div><div><span>主要原因</span><strong>效期到期</strong></div>${price}</section><section class="shell-section">${sectionHeading('今天')}<div class="shell-card timeline-list"><article><i></i><div><strong>鮮奶油 2 瓶</strong><small>大安店・效期到期・王小明・16:24</small>${amount('360')}</div></article><article><i></i><div><strong>牛菲力 0.8 公斤</strong><small>大安店・品質異常・陳怡安・14:10</small>${amount('720')}</div></article><article><i></i><div><strong>奶油醬 1 盒</strong><small>大安店・製作或操作損耗・王小明・11:32</small>${amount('100')}</div></article></div></section>${showPrice ? '<p class="shell-note">參考金額依最近一筆已發布的進貨單價估算。</p>' : ''}`;
}

function wasteCompletePage(businessType) {
  const erp = businessType === 'CHAIN_RESTAURANT' ? '<section class="shell-card completion-card erp"><strong>已加入今日 ERP 廢棄彙整</strong><p>21:30 提醒負責人登入 ERP 輸入。</p></section>' : '';
  return `${shellBack()}<section class="completion-state"><span>${icon('trash')}</span><h1>廢棄已記錄</h1><p>鮮奶油 2 瓶・王小明・16:24</p></section>${erp}${actionButton('返回廢棄', 'waste')}`;
}

const simplePages = {
  incidents: ['異常回報', '快速留下事件；門市、時間與回報者由系統帶入。', [['新增異常', '庫存、收貨、效期、設備或其他', 'warning'], ['處理中', '追蹤責任人與下一步', 'tasks'], ['已完成', '保留完整歷程', 'shield']]],
  handover: ['交接', '事情發生時記一次；沒完成就自動留到下一班。', [['本班待交接', '未到貨、異常、效期與借貸', 'activity'], ['接手確認', '確認已閱讀與負責事項', 'tasks'], ['歷史交接', '完成後保留追溯紀錄', 'fileText']]],
  catalog: ['商品與編碼', '建立正式名稱、別名、單位、安全庫存與漸進式照片。', [['商品主檔', '正式名稱、別名、分類與單位', 'package'], ['待對應編碼', 'OCR 品名對應商品主檔', 'fileText'], ['Excel 匯入', '先預覽與驗證再建立', 'download']]],
  suppliers: ['供應商', '管理供應品項、單位換算與到貨資訊。', [['供應商清單', '聯絡與配送資料', 'truck'], ['品項對應', '供應商品名與正式商品', 'package'], ['到貨紀錄', '查看已發布資料', 'activity']]],
  recipes: ['配方', '未來選配模組，不會成為導入「序」的使用門檻。', [['配方主檔', '菜色、食材與使用量', 'book'], ['版本紀錄', '變更保留歷史', 'activity'], ['權限範圍', 'Owner 決定誰可查看', 'shield']]],
  costs: ['成本分析', '使用已發布的進貨、廢棄與庫存資料呈現營運趨勢。', [['食材成本', '依分類與期間查看', 'chart'], ['價格變化', '最新與平均進貨單價', 'activity'], ['廢棄影響', '只呈現可追溯資料', 'trash']]],
  reports: ['報表中心', '整理已發布的盤點、進貨、廢棄與異常資料。', [['營運摘要', '門市與期間比較', 'chart'], ['盤點報表', '差異與完成率', 'clipboard'], ['進貨報表', '供應商與品項趨勢', 'truck']]],
  members: ['成員與權限', '帳號屬於人，角色屬於門市，責任可以交接。', [['成員清單', '新增、停用與調整門市角色', 'users'], ['代理主管', '設定代理期間與必要權限', 'shield'], ['離職交接', '保留歷史並轉移未完成事項', 'activity']]],
  business: ['商家與門市設定', '分層管理作業模式、門市結構與各店作業設定。', [['商家資料', '名稱與基本資料', 'building'], ['門市管理', '新增與停用門市', 'home'], ['作業模式', '獨立餐飲或連鎖餐飲', 'settings']]],
  permissions: ['角色與權限', '依餐廳類型、角色與管理範圍顯示適用操作。', [['角色權限', '連鎖與獨立餐廳使用不同角色名稱', 'shield'], ['管理範圍', '門市、儲物區或跨店', 'building'], ['代理權限', '期間到期後自動收回', 'calendarClock']]],
  exports: ['資料匯出', '匯出不取代原始資料；成果可由正式紀錄重新產生。', [['盤點回填版', '保持來源位置，新品另表', 'download'], ['完整稽核明細', '來源、操作者、時間與事件', 'fileText'], ['營運摘要', '只包含已發布資料', 'chart']]],
  audit: ['Audit Log', '查看原始資料、修正事件、發布者與時間。', [['盤點事件', '原始實盤與追加更正', 'clipboard'], ['進貨證據鏈', '原圖、OCR、修正與發布', 'fileText'], ['權限異動', '角色、代理與停用紀錄', 'shield']]],
  settings: ['設定', '集中管理盤點、進貨、登入裝置與提醒政策。', [['登入與裝置', '個人／共用裝置與重新驗證', 'lock'], ['營運提醒', '公司流程或異常通知', 'bell'], ['盤點政策', '區域、範本與完成方式', 'clipboard']]],
};

function businessWorkspace(businessType) {
  const chain = businessType === 'CHAIN_RESTAURANT';
  return `${shellBack()}${pageIntro('商家與門市設定', '餐廳類型決定角色名稱與工作承接方式；基本功能不刪減。', '老闆設定')}
    <section class="shell-card business-setting-card active"><header><span>${icon('settings')}</span><div><small>餐廳類型</small><strong>${chain ? '連鎖餐飲' : '獨立餐廳'}</strong></div><button type="button" data-shell-action="調整餐廳類型">修改</button></header><p>${chain ? '現場由員工與店長執行，區主管追蹤跨店進度；ERP 承接公司正式後勤流程。' : '現場、行政與資料維護集中在序；不同儲物區沿用同一套作業。'}</p></section>
    <section class="shell-card business-setting-card"><header><span>${icon('users')}</span><div><small>角色架構</small><strong>${chain ? '員工・店長・區主管・老闆' : '員工・主管・行政／後勤・老闆'}</strong></div><button type="button" data-route="members">管理</button></header><div class="module-chip-list">${chain ? '<span>員工</span><span>店長</span><span>區主管</span><span>老闆</span>' : '<span>員工</span><span>主管・各自帳號</span><span>行政／後勤</span><span>老闆</span><span>財務・未來</span>'}</div>${chain ? '' : '<p>可建立多位主管帳號，再分別指定負責門市與儲物區；不另建內場、外場角色。</p>'}</section>
    ${chain ? `<section class="shell-card business-setting-card"><header><span>${icon('bell')}</span><div><small>公司流程提醒</small><strong>依功能顯示</strong></div><button type="button" data-route="company-reminders">設定</button></header><div class="module-chip-list"><span>ERP 驗收</span><span>ERP 入廢棄</span><span>盤點表回填</span><span>調撥登記</span></div></section>` : ''}
    <section class="shell-card business-setting-card"><header><span>${icon('building')}</span><div><small>門市結構</small><strong>多家門市</strong></div><button type="button" data-shell-action="調整門市結構">修改</button></header><p>門市數量與作業模式分開管理；獨立餐廳也可以有多店。</p></section>
    <section class="shell-card business-setting-card"><header><span>${icon('clipboard')}</span><div><small>基本功能</small><strong>完整啟用</strong></div><b class="setting-fixed-label">固定</b></header><div class="module-chip-list"><span>盤點</span><span>進貨</span><span>商品</span><span>供應商</span><span>效期</span><span>廢棄</span><span>交接</span><span>異常</span></div></section>
    <section class="shell-card store-operation-card"><header><div><small>門市作業設定</small><strong>BeApe 大安店</strong></div><button type="button" data-shell-action="調整大安店設定">修改</button></header><div class="store-setting-list"><span>盤點方式<b>${chain ? '每日自動建立' : '每月月底'}</b></span><span>${chain ? '紙本謄寫' : '盤點備存'}<b>${chain ? '需要' : '列印／匯出可選'}</b></span><span>員工識別<b>姓名／暱稱</b></span></div></section>
    <p class="shell-note">所有商家都有完整基本功能。${chain ? '序只提醒 ERP 或公司制度的下一步，不連線、不讀取也不寫回。' : '財務先保留為未來角色，不會出現在目前正式操作入口。'}</p>`;
}

function independentCountCompletion() {
  return `${shellBack('返回盤點任務')}<section class="completion-state"><span>${icon('tasks')}</span><h1>本次盤點完成</h1><p>4 個區域・320 項已保存</p></section><section class="shell-card completion-card"><strong>盤點紀錄已保存</strong><p>盤點完成後直接結束<br>需要留存時再列印或匯出</p></section><div class="shell-button-stack">${actionButton('查看本次盤點明細', 'count-entry', 'secondary')}${shellActionButton('列印／另存 PDF', '列印／另存 PDF', 'secondary')}${shellActionButton('匯出 Excel／CSV', '匯出 Excel／CSV', 'secondary')}${actionButton('返回首頁', 'home')}</div><p class="shell-note">列印與匯出只供備存，不是完成盤點的必做步驟。</p>`;
}

function simpleWorkspace(route, businessType) {
  if (route === 'business') return businessWorkspace(businessType);
  const chainPages = {
    catalog: ['公司品項資料', '依公司提供的檔案建立現場可用清單；不取代或回寫 ERP 商品主檔。', [['現場品項清單', '公司品名、單位與盤點位置', 'package'], ['公司檔案版本', '顯示最近匯入時間與來源', 'fileText'], ['待確認差異', '只回報缺漏，不修改 ERP', 'warning']]],
    suppliers: ['公司供應商資料', '顯示公司提供的供應商與到貨資訊，供門市核對。', [['供應商清單', '公司提供的聯絡與配送資料', 'truck'], ['門市到貨紀錄', '依已完成進貨紀錄查看', 'activity'], ['資料差異回報', '送交公司既有流程處理', 'warning']]],
    recipes: ['公司配方資料', '若公司提供可查看版本，序只作現場提示，不取代公司主檔。', [['配方檢視', '依公司核准版本呈現', 'book'], ['版本來源', '保留檔案與匯入日期', 'activity'], ['權限範圍', '由公司角色決定可見內容', 'shield']]],
    costs: ['營運趨勢', '依序內已完成紀錄呈現輔助趨勢；正式成本仍以公司系統為準。', [['現場差異', '進貨、盤點與廢棄趨勢', 'chart'], ['公司資料提醒', '缺漏時提醒回到既有流程', 'bell'], ['資料來源', '標示序內紀錄與公司檔案', 'fileText']]],
  };
  const [title, copy, rows] = businessType === 'CHAIN_RESTAURANT' && chainPages[route] ? chainPages[route] : simplePages[route];
  return `${shellBack()}${pageIntro(title, copy)}<section class="shell-section">${sectionHeading('功能外殼')}<div class="shell-card shell-list">${rows.map(([rowTitle, rowCopy, iconName]) => listRow({ route, iconName, title: rowTitle, copy: rowCopy })).join('')}</div></section><p class="shell-note">目前按鍵已定位到對應抽屜；資料寫入與業務規則會在下一階段逐一接入。</p>`;
}

function activityPage(previewState = {}) {
  const discarded = new Set(Array.isArray(previewState.expiryDiscardedKeys) ? previewState.expiryDiscardedKeys : []);
  const used = new Set(Array.isArray(previewState.expiryUsedKeys) ? previewState.expiryUsedKeys : []);
  const expiryRecords = EXPIRY_URGENT_ITEMS.filter(item => discarded.has(item.key) || used.has(item.key)).map(item => `<article><i></i><div><strong>${escapeHtml(item.item)}${discarded.has(item.key) ? '已登記廢棄' : '已使用完'}</strong><small>今天 16:24・王小明・${escapeHtml(item.zone)}</small></div></article>`).join('');
  const transferRecord = hasLinkedStores(previewState) ? '<article><i></i><div><strong>借入已記錄</strong><small>昨天 18:30・李店長</small></div></article>' : '';
  return `${pageIntro('作業紀錄', '依時間查看自己或權限範圍內的正式操作。')}<div class="filter-chips"><button class="active">全部</button><button>盤點</button><button>進貨</button><button>廢棄</button><button>異常</button></div><div class="shell-card timeline-list">${expiryRecords}<article><i></i><div><strong>完成工作冰箱盤點</strong><small>今天 09:42・王小明</small></div></article><article><i></i><div><strong>上傳大森食品貨單</strong><small>今天 09:12・王小明</small></div></article>${transferRecord}</div>`;
}

function tasksPage(role, businessType) {
  const logisticsCopy = businessType === 'CHAIN_RESTAURANT' ? '跨店待追蹤、門市異常與公司流程提醒。' : '行政／後勤待核對、待整理與待發布資料。';
  const copy = { STAFF: '今天必須完成、被交接或需要補充說明的工作。', SUPERVISOR: '需要店長確認、判斷或追蹤的事項。', LOGISTICS: logisticsCopy, OWNER: '需要決策的重大異常與管理事項。' }[role];
  if (role === 'STAFF') {
    const daily = businessType === 'CHAIN_RESTAURANT' ? listRow({ route: 'count', iconName: 'clipboard', title: '完成今日每日盤點', copy: '系統自動建立・剩餘 2 個區域', count: '今天' }) : listRow({ route: 'count', iconName: 'clipboard', title: '完成本次盤點', copy: '主管已建立・剩餘 2 個區域', count: '今天' });
    return `${pageIntro('待辦', copy)}<section class="shell-section">${sectionHeading('今天必須完成')}<div class="shell-card shell-list">${daily}${listRow({ route: 'receiving', iconName: 'truck', title: '核對實收數量', copy: '大森食品・1 批', count: '1' })}</div></section><section class="shell-section">${sectionHeading('等待補充說明')}<div class="shell-card shell-list">${listRow({ route: 'incidents', iconName: 'warning', title: '補充盤點異常原因', copy: '牛菲力數量差異・請選擇原因', count: '1 項', tone: 'warning' })}</div></section><p class="shell-note">待辦不是專門用來回報異常。只有盤點或收貨出現差異時，才會追加「補充異常原因」。</p>`;
  }
  const managerRows = role === 'SUPERVISOR' ? `${listRow({ route: 'count', iconName: 'clipboard', title: '追蹤今日盤點', copy: businessType === 'CHAIN_RESTAURANT' ? '系統已自動建立・尚未開始' : '本次盤點尚未完成', count: '待完成' })}${listRow({ route: 'receiving-issues', iconName: 'warning', title: '確認進貨異常', copy: '缺貨、少到、多到與品質異常', count: '6 項', tone: 'danger' })}${listRow({ route: 'count-review', iconName: 'tasks', title: '確認盤點差異原因', copy: '員工已補充 2／3 項', count: '3 項' })}` : `${listRow({ route: role === 'LOGISTICS' && businessType === 'CHAIN_RESTAURANT' ? 'company-reminders' : 'incidents', iconName: 'warning', title: '待追蹤事項', copy, count: '3 項' })}`;
  return `${pageIntro('待辦', copy)}<div class="shell-card shell-list">${managerRows}</div>`;
}

function notificationsPage(role, businessType, previewState = {}) {
  const urgentCount = unresolvedExpiryItems(previewState).length;
  const expiryNotice = urgentCount ? listRow({ route: 'expiry', iconName: 'calendarClock', title: `${urgentCount} 項商品今日到期`, copy: '請立即登記廢棄或確認已使用完', count: '剛剛' }) : '';
  const countNotice = businessType === 'CHAIN_RESTAURANT' ? listRow({ route: 'count', iconName: 'clipboard', title: '今日盤點尚未開始', copy: '系統每日自動建立・距閉店 2 小時', count: '16:00', tone: 'warning' }) : listRow({ route: 'count', iconName: 'clipboard', title: '本月盤點已建立', copy: '2026/09/30 月底盤點', count: '09:00' });
  if (role === 'SUPERVISOR' && businessType === 'CHAIN_RESTAURANT') {
    return `${pageIntro('通知', '查看員工完成的公司流程與需要處理的門市事項。', '店長')}<section class="shell-section">${sectionHeading('今天', '1 則未讀')}<div class="shell-card shell-list">${listRow({ route: 'receiving-erp-complete', iconName: 'tasks', title: 'ERP 驗收已完成', copy: '大森食品・王小明・今天 10:05', count: '已驗收' })}${countNotice}${expiryNotice}</div></section><p class="shell-note">員工回序登記 ERP 驗收完成後，立即通知該門市店長；通知保留貨單、員工與完成時間。</p>`;
  }
  const transferNotice = hasLinkedStores(previewState) ? listRow({ route: 'transfers', iconName: 'arrowRight', title: '借入待確認', copy: 'BeApe 信義店・鮮奶油 2 瓶', count: '昨天' }) : '';
  return `${pageIntro('通知', '只提醒需要行動的事情；正常資料不主動干擾。')}<div class="shell-card shell-list">${countNotice}${expiryNotice}${transferNotice}</div>`;
}

function bulletinBoardPage() {
  return `${shellBack()}${pageIntro('公佈欄', '查看目前門市仍在顯示期間內的公告。')}
    <div class="shell-card shell-list">${listRow({ route: 'bulletin-board', iconName: 'bell', title: '本週末訂位較多', copy: '請各站提前確認備料・店長 09:20', count: '未讀' })}${listRow({ route: 'bulletin-board', iconName: 'activity', title: '冷藏庫清潔完成', copy: '設備已復位・王小明 昨天', count: '已讀' })}</div>`;
}

function bulletinManagementPage() {
  return `${shellBack()}${pageIntro('公佈欄管理', '發布門市公告，並追蹤員工是否已讀。', '主管設定')}
    <button class="shell-primary" type="button" data-shell-action="新增公告">＋ 新增公告</button>
    <section class="shell-section">${sectionHeading('公告設定')}<div class="shell-card settings-form"><label>顯示範圍<span>BeApe 大安店</span></label><label>通知對象<span>全體現場人員</span></label><label>顯示期間<span>9/1 09:00－9/3 23:59</span></label><label>已讀確認<span>開啟</span></label></div></section>
    <section class="shell-section">${sectionHeading('目前公告', '2 則')}<div class="shell-card shell-list">${listRow({ route: 'bulletins', iconName: 'bell', title: '本週末訂位較多', copy: '已讀 8／12 人', count: '顯示中' })}${listRow({ route: 'bulletins', iconName: 'activity', title: '冷藏庫清潔完成', copy: '已讀 12／12 人', count: '明日到期' })}</div></section>`;
}

function companyReminderPage() {
  return `${shellBack()}${pageIntro('公司流程提醒', '序內作業完成後，提醒現場回到公司 ERP 或既有制度完成下一步。', '連鎖餐飲設定')}
    <section class="shell-section">${sectionHeading('提醒設定')}<div class="shell-card settings-form"><label>進貨完成後<span>提醒 ERP 驗收・開啟</span></label><label>廢棄 ERP 輸入方式<span>每日集中一次</span></label><label>每日統一輸入時間<span>21:30</span></label><label>負責角色<span>店長</span></label><label>追蹤角色<span>區主管</span></label><label>未完成提醒<span>到設定時間提醒＋逾時通知店長</span></label></div></section>
    <section class="shell-section">${sectionHeading('兩種狀態預覽', '一起驗收')}
      <div class="company-state-preview">
        <article class="shell-card company-state-card pending"><header><span class="status-pill">待完成公司流程</span><small>序內作業已完成</small></header><div><span>${icon('truck')}</span><p><strong>進貨・ERP 驗收</strong><small>實際進貨數量已確認無誤</small></p><b>待完成</b></div><button type="button" data-shell-action="已完成 ERP 驗收">已完成 ERP 驗收</button><div><span>${icon('trash')}</span><p><strong>今日 ERP 廢棄彙整</strong><small>6 筆・統一輸入時間 21:30</small></p><b>待完成</b></div><button type="button" data-route="expiry-erp-waste-summary">查看今日彙整</button></article>
        <article class="shell-card company-state-card complete"><header><span class="status-pill">公司流程已完成</span><small>保留人員、門市與時間</small></header><div><span>${icon('truck')}</span><p><strong>進貨・ERP 驗收</strong><small>王小明・2026/09/01 15:40</small></p><b>已完成</b></div><div><span>${icon('trash')}</span><p><strong>今日 ERP 廢棄彙整</strong><small>6 筆・李店長・2026/09/01 21:36</small></p><b>已完成</b></div></article>
      </div>
    </section><p class="shell-note">序不連線、不讀取也不寫回 ERP；按下完成只保存確認人、門市與時間，並結束提醒。</p>`;
}

function storeCompanyTasksPage(role) {
  const label = role === 'SUPERVISOR' ? '店長' : '員工';
  return `${shellBack()}${pageIntro('公司流程待辦', '序內作業已完成；門市可在較有空時統一回公司 ERP 處理。', label)}
    <div class="shell-metric-grid">${metric('全部待辦', '3', 'warning')}${metric('ERP 驗收', '2')}${metric('今日廢棄彙整', '1')}</div>
    <section class="shell-section">${sectionHeading('待完成', '依門市設定時間提醒')}<div class="company-task-list">
      <article class="shell-card company-task-item"><header><span>${icon('truck')}</span><div><strong>進貨・ERP 驗收</strong><small>大森食品・3 張貨單・09:12</small></div><b>2 筆</b></header><p>貨單照片已保存，OCR 正在背景統計進貨量。</p>${actionButton('回報已完成 ERP 驗收', 'receiving-erp-complete')}</article>
      <article class="shell-card company-task-item"><header><span>${icon('trash')}</span><div><strong>登入 ERP 輸入今日廢棄</strong><small>6 筆・21:30</small></div><b>待輸入</b></header>${actionButton('查看今日彙整', 'expiry-erp-waste-summary')}</article>
    </div></section><p class="shell-note">序不會讀取、查驗或寫回 ERP。回報完成只保存人員、門市與時間，並通知店長及停止提醒。</p>`;
}

function profilePage(role, businessType) {
  const meta = roleMeta(role, businessType);
  const management = visibleItems(MANAGEMENT, role, businessType);
  return `${pageIntro('我的', '個人身分、目前門市與可使用的設定入口。')}<section class="shell-card profile-card"><span>${icon('user')}</span><div><strong>王小明</strong><small>${escapeHtml(meta.label)}・BeApe 大安店</small></div></section><section class="shell-section">${sectionHeading('設定與管理')}<div class="shell-card shell-list">${management.slice(0, 5).map(item => listRow({ route: item.id, iconName: item.icon, title: item.label, copy: item.future ? '未來選配' : '依目前角色權限顯示' })).join('') || listRow({ route: 'settings', iconName: 'lock', title: '登入與裝置', copy: '重新驗證由主管政策決定' })}</div></section><button class="shell-secondary full" type="button" data-shell-action="登出">登出</button>`;
}

function otherPage(role, businessType, previewState = {}) {
  const operations = visibleItems(OPERATIONS, role, businessType).filter(item => hasLinkedStores(previewState) || item.id !== 'transfers');
  return `${shellBack()}${pageIntro('所有作業', '只顯示目前角色可使用的功能。')}<div class="shell-tile-grid">${operations.map(item => iconTile(item)).join('')}</div>`;
}

function restrictedPage(role, businessType) {
  return `${shellBack()}${emptyPanel('此角色沒有操作權限', `${roleMeta(role, businessType).label}不會看到這個功能入口。`)}`;
}

export function appShellPage(role, route, businessType = 'CHAIN_RESTAURANT', previewState = {}) {
  if (!roleCanOpen(role, route, businessType)) return restrictedPage(role, businessType);
  if ((route === 'transfers' || route.startsWith('transfer-')) && !hasLinkedStores(previewState)) return `${shellBack()}${emptyPanel('目前沒有借貸功能', '連結第二家門市後自動顯示。')}`;
  if (route === 'home') return homePage(role, businessType, previewState);
  if (route === 'shortage-items') return shortageItemsPage(previewState);
  if (route === 'activity') return activityPage(previewState);
  if (route === 'tasks') return tasksPage(role, businessType);
  if (route === 'notifications') return notificationsPage(role, businessType, previewState);
  if (route === 'profile') return profilePage(role, businessType);
  if (route === 'bulletin-board') return bulletinBoardPage();
  if (route === 'bulletins') return bulletinManagementPage();
  if (route === 'company-reminders') return companyReminderPage();
  if (route === 'store-company-tasks') return storeCompanyTasksPage(role);
  if (route === 'other') return otherPage(role, businessType, previewState);
  if (route === 'count') return countPage(role, businessType);
  if (route.startsWith('count-')) return countFlowPage(route, businessType);
  if (route === 'receiving') return receivingPage(role, businessType);
  if (route.startsWith('receiving-')) return receivingFlowPage(route, businessType);
  if (route === 'expiry') return expiryPage(role, businessType, previewState);
  if (route === 'expiry-urgent') return expiryUrgentPage(role, previewState);
  if (route === 'expiry-upcoming') return expiryUpcomingPage();
  if (route === 'expiry-risk-zones') return expiryRiskZonesPage(role);
  if (route === 'expiry-risk-settings') return expiryRiskSettingsPage(role);
  if (route === 'expiry-risk-new' || route.startsWith('expiry-risk-edit-')) return expiryRiskFormPage(route);
  if (route.startsWith('expiry-risk-saved-') || route.startsWith('expiry-risk-paused-')) return expiryRiskResultPage(route);
  if (route === 'expiry-special') return expirySpecialPage();
  if (route === 'expiry-inspection') return expiryInspectionPage();
  if (route === 'expiry-inbound') return expiryInboundPage();
  if (route === 'expiry-edge' || route === 'expiry-watchlist') return expiryEdgePage();
  if (route === 'expiry-alerts') return expiryAlertsPage();
  if (route === 'expiry-suggest') return expirySuggestPage();
  if (route === 'expiry-inspection-record') return expiryInspectionRecordPage();
  if (route === 'expiry-issue') return expiryIssuePage();
  if (route === 'expiry-expired') return expiryExpiredPage();
  if (route === 'expiry-used-confirm' || route.startsWith('expiry-used-confirm-')) return expiryUsedConfirmPage(route);
  if (route === 'expiry-discard' || /^expiry-discard-(?:overdue-)?(work|cold|sauce)$/.test(route)) return expiryDiscardPage(route);
  if (route === 'expiry-discard-complete' || route.startsWith('expiry-discard-complete-')) return expiryDiscardCompletePage(businessType, route);
  if (route.startsWith('expiry-zone-')) return expiryZonePage(route);
  if (route.startsWith('expiry-lot-')) return expiryLotPage(route, businessType);
  if (route === 'expiry-quantity-reason') return expiryQuantityReasonPage();
  if (route === 'expiry-erp-waste-summary') return expiryErpWasteSummaryPage();
  if (route.startsWith('expiry-result-') || route === 'expiry-erp-waste-complete') return expiryResultPage(route, businessType);
  if (route === 'transfers') return transferHomePage(role, businessType);
  if (route === 'transfer-search') return transferSearchPage();
  if (route === 'transfer-record') return transferRecordPage(businessType, 'new');
  if (route === 'transfer-loan-record') return transferRecordPage(businessType, 'loan');
  if (route === 'transfer-move-record') return transferRecordPage(businessType, 'move');
  if (route === 'transfer-recorded') return transferRecordedPage(businessType);
  if (route === 'transfer-move-recorded') return transferMoveRecordedPage(businessType);
  if (route === 'transfer-exchange-recorded') return transferExchangeRecordedPage();
  if (route === 'transfer-history') return transferHistoryPage(businessType);
  if (route === 'transfer-open') return transferOpenPage(role, businessType);
  if (route === 'transfer-loan-detail') return transferLoanDetailPage(role);
  if (route === 'transfer-loan-out-detail') return transferLoanOutDetailPage(role);
  if (route === 'transfer-receive-return') return transferReceiveReturnPage();
  if (route === 'transfer-receive-returned') return transferReceiveReturnedPage();
  if (route === 'transfer-exchange-detail') return transferExchangeDetailPage(role, businessType);
  if (route === 'transfer-exchange-return') return transferExchangeReturnPage();
  if (route === 'transfer-exchange-returned') return transferExchangeReturnedPage();
  if (route === 'transfer-monthly') return transferMonthlyPage(businessType);
  if (route === 'transfer-return') return transferReturnPage();
  if (route === 'transfer-return-sent') return transferReturnSentPage();
  if (route === 'waste') return wasteHomePage();
  if (route === 'waste-new') return wasteNewPage();
  if (route === 'waste-today') return wasteHistoryPage(businessType);
  if (route === 'waste-history') return wasteHistoryPage(businessType);
  if (route === 'waste-complete') return wasteCompletePage(businessType);
  if (simplePages[route]) return simpleWorkspace(route, businessType);
  return `${shellBack()}${emptyPanel('頁面外殼已預留', '這個路由會在對應功能抽屜接入時完成內容。')}`;
}
