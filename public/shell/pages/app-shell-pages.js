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

function pageIntro(title, copy, tag = 'APP 外殼') {
  return `<div class="shell-page-intro"><span class="page-kicker">${escapeHtml(tag)}</span><h1>${escapeHtml(title)}</h1><p>${escapeHtml(copy)}</p></div>`;
}

function metric(label, value, tone = '') {
  return `<div class="shell-metric ${tone}"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`;
}

function actionButton(label, route, style = 'primary') {
  return `<button class="shell-${style}" type="button" data-route="${route}">${escapeHtml(label)}</button>`;
}

function shellActionButton(label, action, style = 'secondary') {
  return `<button class="shell-${style}" type="button" data-shell-action="${escapeHtml(action)}">${escapeHtml(label)}</button>`;
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

function staffHome(businessType) {
  const operations = visibleItems(OPERATIONS, 'STAFF', businessType).filter(item => ['count', 'receiving', 'waste', 'expiry', 'handover'].includes(item.id));
  const companyQueue = businessType === 'CHAIN_RESTAURANT' ? `<section class="shell-section">${sectionHeading('公司流程待辦', '可稍後統一處理')}<div class="shell-card shell-list">${listRow({ route: 'store-company-tasks', iconName: 'tasks', title: 'ERP 待完成', copy: '進貨驗收 2・入廢棄 1', count: '3 項', tone: 'warning' })}</div></section>` : '';
  return `${roleHeader('歡迎回來', '先完成今天的工作')}
    <section class="shell-section">${sectionHeading('今天先看')}
      <div class="home-metrics">${metric('缺貨風險', '3', 'danger')}${metric('即期提醒', '2', 'warning')}${metric('待確認', '1', 'info')}</div>
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

function managerHome(businessType) {
  const operations = visibleItems(OPERATIONS, 'SUPERVISOR', businessType).filter(item => ['count', 'receiving', 'waste', 'expiry'].includes(item.id));
  const independent = businessType === 'INDEPENDENT_RESTAURANT';
  return `${roleHeader('今日營運重點', independent ? '依負責門市與儲物區處理營運事項' : '處理門市異常，確認營運順暢')}
    <section class="shell-section">${sectionHeading('今日重點', '查看全部')}
      <div class="shell-card shell-list">
        ${!independent ? listRow({ route: 'count', iconName: 'clipboard', title: '今日盤點尚未完成', copy: '員工尚未開始・店長可接手', count: '可接手', tone: 'warning' }) : ''}
        ${listRow({ route: 'receiving-issues', iconName: 'warning', title: '進貨異常', copy: '缺貨、少到、多到與品質異常', count: '3 項', tone: 'danger' })}
        ${listRow({ route: 'expiry', iconName: 'calendarClock', title: '即期風險', count: '2 項', tone: 'warning' })}
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

function homePage(role, businessType) {
  if (role === 'SUPERVISOR') return managerHome(businessType);
  if (role === 'LOGISTICS') return logisticsHome(businessType);
  if (role === 'OWNER') return ownerHome(businessType);
  return staffHome(businessType);
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
        <article><header><strong>牛菲力</strong><span>-1.5 kg</span></header><p>2026/08/31：4.0 kg・2026/09/01：2.5 kg</p><select><option>請選擇原因</option></select><div class="reason-chips"><span>漏盤／錯區</span><span>進貨未登</span><span>報廢未登</span><span>其他</span></div></article>
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

function expiryPage(role, businessType) {
  const manager = role === 'SUPERVISOR';
  const chain = businessType === 'CHAIN_RESTAURANT';
  const intro = pageIntro(manager ? '效期巡檢管理' : '效期管理', manager ? '只追蹤未巡檢、逾時與需要介入的例外。' : '正常作業快速完成，只有需要注意的食材才另外追蹤。', manager ? (chain ? '店長' : '主管') : '員工');
  if (!manager) return `${shellBack()}${intro}
    <section class="shell-card expiry-overview-card">
      <div><small>今天的效期工作</small><strong>3 區需巡檢</strong><span>已完成 1／3</span></div>
      <div class="expiry-progress" aria-label="巡檢完成三分之一"><i style="width:33%"></i></div>
      <button type="button" data-route="expiry-inspection">繼續巡檢</button>
    </section>
    <button class="expiry-alert-strip" type="button" data-route="expiry-alerts"><span>${icon('warning')}</span><span><strong>明日到期 1 項</strong><small>雞高湯・工作冰箱</small></span><b>查看 ›</b></button>
    <section class="shell-section">${sectionHeading('效期工作')}<div class="shell-card shell-list">
      ${listRow({ route: 'expiry-inspection', iconName: 'clipboard', title: '今日儲放區巡檢', copy: '未完成不會自動視為正常', count: '1／3', tone: 'warning' })}
      ${listRow({ route: 'expiry-watchlist', iconName: 'calendarClock', title: '特別注意品項', copy: '只追蹤容易變質、短效期或經常廢棄的品項', count: '3 項' })}
      ${listRow({ route: 'expiry-alerts', iconName: 'warning', title: '到期警報', copy: '依原包裝、現場標籤與已確認規則提醒', count: '1 項', tone: 'warning' })}
      ${listRow({ route: 'expiry-suggest', iconName: 'help', title: '建議加入注意品項', copy: '員工可以提出，店長只需確認一次規則' })}
    </div></section>
    <p class="shell-note">一般食材不逐一拿手機登記；紙本與容器標籤仍是現場日期依據，App 負責確認是否真的完成巡檢、留下人員與時間。</p>`;
  return `${shellBack()}${intro}
    <div class="home-metrics">${metric('尚未巡檢', '2 區', 'warning')}${metric('明日到期', '1', 'info')}${metric('逾時未完成', '0', 'danger')}</div>
    <section class="shell-section">${sectionHeading('今日巡檢進度', '18:00 前完成')}<div class="shell-card shell-list">
      ${listRow({ route: 'expiry-inspection', iconName: 'warning', title: '工作冰箱', copy: '2 項需要確認・尚未巡檢', count: '未完成', tone: 'warning' })}
      ${listRow({ route: 'expiry-inspection', iconName: 'calendarClock', title: '冷藏庫', copy: '1 項需要確認・尚未巡檢', count: '未完成', tone: 'warning' })}
      ${listRow({ route: 'expiry-inspection-record', iconName: 'tasks', title: '冷凍庫', copy: '陳怡安・今天 15:42', count: '已巡檢' })}
    </div></section>
    <section class="shell-section">${sectionHeading('需要店長處理')}<div class="shell-card shell-list">
      ${listRow({ route: 'expiry-alerts', iconName: 'warning', title: '雞高湯明日到期', copy: '工作冰箱・請確認處理安排', count: '1 項', tone: 'warning' })}
      ${listRow({ route: 'expiry-watchlist', iconName: 'calendarClock', title: '特別注意品項規則', copy: '員工提出 1 項建議，等待一次性確認', count: '待確認' })}
    </div></section>
    <section class="shell-card expiry-usage-audit"><strong>App 使用追蹤</strong><span>當班員工最後登入：王小明・今天 15:36</span><small>超過巡檢期限仍未完成，才通知店長；未使用 App 不會被視為已巡檢。</small></section>
    ${chain ? '<p class="shell-note">連鎖門市的序內廢棄紀錄與 ERP 入廢棄維持分開；公司流程可稍後集中完成。</p>' : ''}`;
}

function expiryZonePage(route) {
  if (route === 'expiry-zone-freezer') return expiryInspectionRecordPage();
  const work = route === 'expiry-zone-work';
  const zone = work ? '工作冰箱' : '冷藏庫';
  const item = work ? '雞高湯' : '鮮奶油 1L';
  const alert = work ? '現場標籤顯示明日到期' : '原包裝效期需要確認';
  return `${shellBack('返回巡檢進度')}${pageIntro(zone, '只確認今天必要的重點，不列出區域內全部食材。', '開始巡檢')}
    <section class="shell-card expiry-check-card">
      <header><span>${icon('calendarClock')}</span><div><small>必要確認 1</small><strong>${item}</strong><p>${alert}</p></div><b>必填</b></header>
      <fieldset data-expiry-choice-group><legend>目前現場狀態</legend><div class="expiry-choice-grid">
        <button type="button" data-expiry-choice>仍在現場</button><button type="button" data-expiry-choice>已使用完</button><button type="button" data-expiry-choice>找不到</button><button type="button" data-expiry-choice>發現異常</button>
      </div></fieldset>
    </section>
    <section class="shell-card expiry-check-card">
      <header><span>${icon('warning')}</span><div><small>必要確認 2</small><strong>是否發現未標示品項？</strong><p>查看開封或解凍食材是否有日期標示</p></div><b>必填</b></header>
      <fieldset data-expiry-choice-group><legend>巡檢結果</legend><div class="expiry-choice-grid two"><button type="button" data-expiry-choice>沒有發現</button><button type="button" data-expiry-choice>有，回報異常</button></div></fieldset>
    </section>
    <button class="shell-primary" type="button" data-route="expiry-result-inspected" data-expiry-complete disabled>完成本區巡檢</button>
    <p class="shell-note">完成後才會留下巡檢人員、區域與時間；沒有進入此流程，狀態會一直保持「尚未巡檢」。</p>`;
}

function expiryInspectionPage() {
  return `${shellBack('返回效期管理')}${pageIntro('儲放區巡檢', '未完成不會自動視為正常。', '員工作業')}
    <section class="shell-card expiry-inspection-summary"><div><strong>今天 3 區需巡檢</strong><span>已完成 1／3</span></div><div class="expiry-progress"><i style="width:33%"></i></div><small>18:00 前完成</small></section>
    <button class="expiry-alert-strip" type="button" data-route="expiry-alerts"><span>${icon('warning')}</span><span><strong>明日到期 1 項</strong><small>雞高湯・工作冰箱</small></span><b>查看 ›</b></button>
    <section class="shell-section">${sectionHeading('巡檢進度')}<div class="expiry-area-list">
      ${expiryAreaCard('工作冰箱', '2 項需要確認', '上次完成：昨天 22:18', 'expiry-zone-work')}
      ${expiryAreaCard('冷藏庫', '1 項需要確認', '上次完成：昨天 22:25', 'expiry-zone-cold')}
      ${expiryAreaCard('冷凍庫', '無到期警報', '陳怡安・今天 15:42', 'expiry-inspection-record', true)}
    </div></section>
    <button class="expiry-suggest-link" type="button" data-route="expiry-suggest">＋ 建議加入注意品項 <b>›</b></button>`;
}

function expiryAreaCard(title, copy, meta, route, complete = false) {
  return `<article class="shell-card expiry-area-card ${complete ? 'is-complete' : ''}"><span class="expiry-area-icon">${icon(complete ? 'tasks' : 'calendarClock')}</span><div><h2>${title}</h2><strong>${copy}</strong><small>${meta}</small></div><aside><b>${complete ? '已巡檢' : '尚未巡檢'}</b><button type="button" data-route="${route}">${complete ? '檢視紀錄' : '開始巡檢'}</button></aside></article>`;
}

function expiryWatchlistPage() {
  return `${shellBack('返回效期管理')}${pageIntro('特別注意品項', '只收容易變質、短效期、單價高或曾多次廢棄的品項。', '效期規則')}
    <section class="shell-card shell-list">
      ${listRow({ route: 'expiry-alerts', iconName: 'calendarClock', title: '雞高湯', copy: '開封／製作後依現場標籤巡檢', count: '工作冰箱', tone: 'warning' })}
      ${listRow({ route: 'expiry-alerts', iconName: 'calendarClock', title: '鮮奶油 1L', copy: '依原包裝效期與開封標籤，以較早者優先', count: '冷藏庫' })}
      ${listRow({ route: 'expiry-alerts', iconName: 'calendarClock', title: '解凍牛菲力', copy: '依現場解凍標籤巡檢', count: '冷藏庫' })}
    </section>${actionButton('建議加入注意品項', 'expiry-suggest', 'secondary')}
    <p class="shell-note">不是所有食材都要設定；員工提出建議後，店長只需第一次確認規則，後續全店共用。</p>`;
}

function expiryAlertsPage() {
  return `${shellBack('返回效期管理')}${pageIntro('到期警報', '到期前一日提出提醒，只顯示需要行動的品項。', '今日提醒')}
    <section class="shell-card expiry-due-card"><header><span>${icon('warning')}</span><div><small>明日到期</small><strong>雞高湯</strong></div><b>09/03</b></header><div><span>儲放區</span><strong>工作冰箱</strong></div><div><span>日期依據</span><strong>現場標籤</strong></div><div><span>目前狀態</span><strong>等待巡檢確認</strong></div></section>
    ${actionButton('前往工作冰箱巡檢', 'expiry-zone-work')}
    <p class="shell-note">App 不自行猜測未登記的開封或解凍日期；原包裝、現場標籤與已確認的門市規則，取較早需要處理的日期提醒。</p>`;
}

function expirySuggestPage() {
  return `${shellBack('返回效期管理')}${pageIntro('建議加入注意品項', '員工只提出需要注意的原因，店長再確認一次規則。', '快速建議')}
    <section class="shell-card expiry-suggest-form"><label><span>品項名稱</span><input value="自製奶油醬" aria-label="品項名稱"></label><label><span>為什麼需要注意</span><select aria-label="注意原因"><option>開封後容易變質</option><option>解凍後期限短</option><option>經常忘記使用</option><option>單價高</option><option>曾多次廢棄</option></select></label><label><span>目前儲放區</span><select aria-label="目前儲放區"><option>工作冰箱</option><option>冷藏庫</option><option>冷凍庫</option></select></label></section>
    ${shellActionButton('送出建議', '注意品項建議已送出，等待店長確認', 'primary')}
    <p class="shell-note">不要求員工自行決定保存天數；店長確認原廠說明或門市規範後，才成為正式提醒規則。</p>`;
}

function expiryInspectionRecordPage() {
  return `${shellBack('返回巡檢進度')}<section class="completion-state compact"><span>${icon('tasks')}</span><h1>冷凍庫已巡檢</h1><p>陳怡安・今天 15:42</p></section><section class="shell-card result-list"><div><span>必要確認</span><strong>1 項</strong></div><div><span>未標示品項</span><strong>未發現</strong></div><div><span>異常回報</span><strong>0 項</strong></div></section>${actionButton('返回巡檢進度', 'expiry-inspection')}`;
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
  if (route === 'expiry-result-label') return `${shellBack()}<section class="completion-state"><span>${icon('warning')}</span><h1>標籤異常已回報</h1><p>火腿・冷藏庫・2026/09/01 16:20</p></section><section class="shell-card completion-card"><strong>請現場補貼或更正紙本標籤</strong><p>已通知店長；工作冰箱仍有同品項，巡檢提醒不會消失。</p></section>${actionButton('返回效期巡檢', 'expiry')}`;
  if (route === 'expiry-result-waste-chain') return `${shellBack()}<section class="completion-state"><span>${icon('trash')}</span><h1>序內報廢已記錄</h1><p>鮮奶油 1L・4 瓶・2026/09/01 16:20</p></section><section class="shell-card completion-card erp"><strong>已加入門市公司流程待辦</strong><p>ERP 入廢棄不必現在執行，可由門市稍後統一完成。</p>${actionButton('查看公司流程待辦', 'store-company-tasks')}<small>只保存回報人員、門市與時間，不會查驗或寫回 ERP。</small></section>${actionButton('返回效期巡檢', 'expiry', 'secondary')}`;
  if (route === 'expiry-erp-waste-complete') return `${shellBack()}<section class="completion-state"><span>${icon('tasks')}</span><h1>ERP 入廢棄已登記</h1><p>王小明・2026/09/01 16:28</p></section><section class="shell-card completion-card"><strong>效期例外已完成</strong><p>✓ 序內報廢已記錄<br>✓ ERP 入廢棄已回報<br>✓ 已通知店長</p></section>${actionButton('返回效期巡檢', 'expiry')}`;
  const copy = route === 'expiry-result-used' ? '已用完・批次追蹤結束' : route === 'expiry-result-quantity' ? '數量不符・員工已回報原因' : '報廢已記錄・已銜接庫存與廢棄';
  const detail = route === 'expiry-result-quantity' ? '<strong>主管收到的內容</strong><p>系統 4 瓶／現場 3 瓶<br>原因：使用未登記<br>補充：午餐尖峰使用 1 瓶，尚未登記<br>王小明・2026/09/01 16:24</p>' : `<strong>${chain ? '現場紀錄完成' : '序內資料已串連'}</strong><p>保留原始效期、處理人員、門市與 2026/09/01 16:20。</p>`;
  return `${shellBack()}<section class="completion-state"><span>${icon('tasks')}</span><h1>效期例外已記錄</h1><p>${copy}</p></section><section class="shell-card completion-card">${detail}</section>${actionButton('返回效期巡檢', 'expiry')}`;
}

const simplePages = {
  waste: ['廢棄管理', '第一線只記錄一次，系統接續扣庫存並保存原因。', [['新增廢棄', '商品、數量與原因', 'trash'], ['待確認紀錄', '設備或供應商責任', 'warning'], ['廢棄趨勢', '只顯示已發布營運資料', 'chart']]],
  transfers: ['跨店借貸與調撥', '借出、借入、還貨、永久調撥與不同品項互換。', [['建立跨店異動', '選擇來源店與目的店', 'arrowRight'], ['待對方確認', '實收不同時建立差異', 'tasks'], ['未結清借貸', '自動進入待辦與交接', 'warning']]],
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

function activityPage() {
  return `${pageIntro('作業紀錄', '依時間查看自己或權限範圍內的正式操作。')}<div class="filter-chips"><button class="active">全部</button><button>盤點</button><button>進貨</button><button>異常</button></div><div class="shell-card timeline-list"><article><i></i><div><strong>完成工作冰箱盤點</strong><small>今天 09:42・王小明</small></div></article><article><i></i><div><strong>上傳大森食品貨單</strong><small>今天 09:12・王小明</small></div></article><article><i></i><div><strong>確認跨店借入</strong><small>昨天 18:30・李店長</small></div></article></div>`;
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

function notificationsPage(role, businessType) {
  const countNotice = businessType === 'CHAIN_RESTAURANT' ? listRow({ route: 'count', iconName: 'clipboard', title: '今日盤點尚未開始', copy: '系統每日自動建立・距閉店 2 小時', count: '16:00', tone: 'warning' }) : listRow({ route: 'count', iconName: 'clipboard', title: '本月盤點已建立', copy: '2026/09/30 月底盤點', count: '09:00' });
  if (role === 'SUPERVISOR' && businessType === 'CHAIN_RESTAURANT') {
    return `${pageIntro('通知', '查看員工完成的公司流程與需要處理的門市事項。', '店長')}<section class="shell-section">${sectionHeading('今天', '1 則未讀')}<div class="shell-card shell-list">${listRow({ route: 'receiving-erp-complete', iconName: 'tasks', title: 'ERP 驗收已完成', copy: '大森食品・王小明・今天 10:05', count: '已驗收' })}${countNotice}${listRow({ route: 'expiry', iconName: 'calendarClock', title: '2 項商品今日到期', copy: '請確認是否仍在現場', count: '剛剛' })}</div></section><p class="shell-note">員工回序登記 ERP 驗收完成後，立即通知該門市店長；通知保留貨單、員工與完成時間。</p>`;
  }
  return `${pageIntro('通知', '只提醒需要行動的事情；正常資料不主動干擾。')}<div class="shell-card shell-list">${countNotice}${listRow({ route: 'expiry', iconName: 'calendarClock', title: '2 項商品今日到期', copy: '請確認是否仍在現場', count: '剛剛' })}${listRow({ route: 'transfers', iconName: 'arrowRight', title: '跨店借入等待確認', copy: 'BeApe 信義店・鮮奶油 2 瓶', count: '昨天' })}</div>`;
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
    <section class="shell-section">${sectionHeading('提醒設定')}<div class="shell-card settings-form"><label>進貨完成後<span>提醒 ERP 驗收・開啟</span></label><label>廢棄完成後<span>提醒 ERP 入廢棄・開啟</span></label><label>負責角色<span>店長</span></label><label>追蹤角色<span>區主管</span></label><label>未完成提醒<span>立即進待辦＋閉店前提醒</span></label></div></section>
    <section class="shell-section">${sectionHeading('兩種狀態預覽', '一起驗收')}
      <div class="company-state-preview">
        <article class="shell-card company-state-card pending"><header><span class="status-pill">待完成公司流程</span><small>序內作業已完成</small></header><div><span>${icon('truck')}</span><p><strong>進貨・ERP 驗收</strong><small>實際進貨數量已確認無誤</small></p><b>待完成</b></div><button type="button" data-shell-action="已完成 ERP 驗收">已完成 ERP 驗收</button><div><span>${icon('trash')}</span><p><strong>廢棄・ERP 入廢棄</strong><small>序內廢棄紀錄已完成</small></p><b>待完成</b></div><button type="button" data-shell-action="已完成 ERP 入廢棄">已完成 ERP 入廢棄</button></article>
        <article class="shell-card company-state-card complete"><header><span class="status-pill">公司流程已完成</span><small>保留人員、門市與時間</small></header><div><span>${icon('truck')}</span><p><strong>進貨・ERP 驗收</strong><small>王小明・2026/09/01 15:40</small></p><b>已完成</b></div><div><span>${icon('trash')}</span><p><strong>廢棄・ERP 入廢棄</strong><small>李店長・2026/09/01 16:05</small></p><b>已完成</b></div></article>
      </div>
    </section><p class="shell-note">序不連線、不讀取也不寫回 ERP；按下完成只保存確認人、門市與時間，並結束提醒。</p>`;
}

function storeCompanyTasksPage(role) {
  const label = role === 'SUPERVISOR' ? '店長' : '員工';
  return `${shellBack()}${pageIntro('公司流程待辦', '序內作業已完成；門市可在較有空時統一回公司 ERP 處理。', label)}
    <div class="shell-metric-grid">${metric('全部待辦', '3', 'warning')}${metric('ERP 驗收', '2')}${metric('ERP 入廢棄', '1')}</div>
    <section class="shell-section">${sectionHeading('待完成', '閉店前提醒店長')}<div class="company-task-list">
      <article class="shell-card company-task-item"><header><span>${icon('truck')}</span><div><strong>進貨・ERP 驗收</strong><small>大森食品・3 張貨單・09:12</small></div><b>2 筆</b></header><p>貨單照片已保存，OCR 正在背景統計進貨量。</p>${actionButton('回報已完成 ERP 驗收', 'receiving-erp-complete')}</article>
      <article class="shell-card company-task-item"><header><span>${icon('trash')}</span><div><strong>廢棄・ERP 入廢棄</strong><small>鮮奶油 1L・4 瓶・16:20</small></div><b>1 筆</b></header><p>序內報廢已記錄，等待回公司 ERP 入廢棄。</p>${actionButton('回報已完成 ERP 入廢棄', 'expiry-erp-waste-complete')}</article>
    </div></section><p class="shell-note">序不會讀取、查驗或寫回 ERP。回報完成只保存人員、門市與時間，並通知店長及停止提醒。</p>`;
}

function profilePage(role, businessType) {
  const meta = roleMeta(role, businessType);
  const management = visibleItems(MANAGEMENT, role, businessType);
  return `${pageIntro('我的', '個人身分、目前門市與可使用的設定入口。')}<section class="shell-card profile-card"><span>${icon('user')}</span><div><strong>王小明</strong><small>${escapeHtml(meta.label)}・BeApe 大安店</small></div></section><section class="shell-section">${sectionHeading('設定與管理')}<div class="shell-card shell-list">${management.slice(0, 5).map(item => listRow({ route: item.id, iconName: item.icon, title: item.label, copy: item.future ? '未來選配' : '依目前角色權限顯示' })).join('') || listRow({ route: 'settings', iconName: 'lock', title: '登入與裝置', copy: '重新驗證由主管政策決定' })}</div></section><button class="shell-secondary full" type="button" data-shell-action="登出">登出</button>`;
}

function otherPage(role, businessType) {
  const operations = visibleItems(OPERATIONS, role, businessType);
  return `${shellBack()}${pageIntro('所有作業', '只顯示目前角色可使用的功能。')}<div class="shell-tile-grid">${operations.map(item => iconTile(item)).join('')}</div>`;
}

function restrictedPage(role, businessType) {
  return `${shellBack()}${emptyPanel('此角色沒有操作權限', `${roleMeta(role, businessType).label}不會看到這個功能入口。`)}`;
}

export function appShellPage(role, route, businessType = 'CHAIN_RESTAURANT') {
  if (!roleCanOpen(role, route, businessType)) return restrictedPage(role, businessType);
  if (route === 'home') return homePage(role, businessType);
  if (route === 'activity') return activityPage();
  if (route === 'tasks') return tasksPage(role, businessType);
  if (route === 'notifications') return notificationsPage(role, businessType);
  if (route === 'profile') return profilePage(role, businessType);
  if (route === 'bulletin-board') return bulletinBoardPage();
  if (route === 'bulletins') return bulletinManagementPage();
  if (route === 'company-reminders') return companyReminderPage();
  if (route === 'store-company-tasks') return storeCompanyTasksPage(role);
  if (route === 'other') return otherPage(role, businessType);
  if (route === 'count') return countPage(role, businessType);
  if (route.startsWith('count-')) return countFlowPage(route, businessType);
  if (route === 'receiving') return receivingPage(role, businessType);
  if (route.startsWith('receiving-')) return receivingFlowPage(route, businessType);
  if (route === 'expiry') return expiryPage(role, businessType);
  if (route === 'expiry-inspection') return expiryInspectionPage();
  if (route === 'expiry-watchlist') return expiryWatchlistPage();
  if (route === 'expiry-alerts') return expiryAlertsPage();
  if (route === 'expiry-suggest') return expirySuggestPage();
  if (route === 'expiry-inspection-record') return expiryInspectionRecordPage();
  if (route.startsWith('expiry-zone-')) return expiryZonePage(route);
  if (route.startsWith('expiry-lot-')) return expiryLotPage(route, businessType);
  if (route === 'expiry-quantity-reason') return expiryQuantityReasonPage();
  if (route.startsWith('expiry-result-') || route === 'expiry-erp-waste-complete') return expiryResultPage(route, businessType);
  if (simplePages[route]) return simpleWorkspace(route, businessType);
  return `${shellBack()}${emptyPanel('頁面外殼已預留', '這個路由會在對應功能抽屜接入時完成內容。')}`;
}
