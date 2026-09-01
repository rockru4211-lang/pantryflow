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

function staffHome() {
  const operations = visibleItems(OPERATIONS, 'STAFF').filter(item => ['count', 'receiving', 'waste', 'expiry', 'handover'].includes(item.id));
  return `${roleHeader('歡迎回來', '先完成今天的工作')}
    <section class="shell-section">${sectionHeading('今天先看')}
      <div class="home-metrics">${metric('缺貨風險', '3', 'danger')}${metric('即期提醒', '2', 'warning')}${metric('待確認', '1', 'info')}</div>
    </section>
    <section class="shell-section">${sectionHeading('每日作業')}
      <div class="shell-tile-grid">${operations.map(item => iconTile(item)).join('')}${iconTile({ id: 'other', label: '其他作業', icon: 'more' })}</div>
    </section>
    <section class="shell-section">${sectionHeading('今日建議', '適用')}
      <div class="shell-card suggestion-card"><span>${icon('help')}</span><div><strong>明日午餐訂位較多</strong><p>建議提前確認備料</p></div><b>›</b></div>
    </section>
    <section class="shell-section">${sectionHeading('商家留言板', '適用')}
      ${listRow({ route: 'handover', iconName: 'activity', title: '午餐訂位較多，請提早備料。', copy: '店長・今天 09:20' })}
    </section>`;
}

function managerHome() {
  const operations = visibleItems(OPERATIONS, 'SUPERVISOR').filter(item => ['count', 'receiving', 'waste', 'expiry', 'handover'].includes(item.id));
  return `${roleHeader('今日營運重點', '處理異常，確認營運順暢')}
    <section class="shell-section">${sectionHeading('今日重點', '查看全部')}
      <div class="shell-card shell-list">
        ${listRow({ route: 'ordering', iconName: 'warning', title: '缺貨風險', count: '3 項', tone: 'danger' })}
        ${listRow({ route: 'expiry', iconName: 'calendarClock', title: '即期風險', count: '2 項', tone: 'warning' })}
        ${listRow({ route: 'incidents', iconName: 'help', title: '待確認異常', count: '1 項', tone: 'info' })}
        ${listRow({ route: 'receiving', iconName: 'truck', title: '收貨待核對', count: '2 張' })}
        ${listRow({ route: 'count', iconName: 'clipboard', title: '盤點差異', count: '2 筆' })}
      </div>
    </section>
    <section class="shell-section">${sectionHeading('每日作業')}
      <div class="shell-tile-grid">${operations.map(item => iconTile(item)).join('')}${iconTile({ id: 'other', label: '其他作業', icon: 'more' })}</div>
    </section>
    <section class="shell-section">${sectionHeading('需要處理', '查看全部')}
      <div class="shell-card shell-list">
        ${listRow({ route: 'count-review', iconName: 'clipboard', title: '盤點差異待確認', count: '2 筆' })}
        ${listRow({ route: 'receiving', iconName: 'truck', title: '貨單待核對', count: '1 張' })}
        ${listRow({ route: 'expiry', iconName: 'warning', title: '效期異常', count: '3 項' })}
      </div>
    </section>`;
}

function logisticsHome() {
  const management = visibleItems(MANAGEMENT, 'LOGISTICS').slice(0, 6);
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
      <div class="shell-tile-grid management-grid">${management.map(item => iconTile(item, { future: item.future })).join('')}</div>
    </section>`;
}

function ownerHome() {
  const management = visibleItems(MANAGEMENT, 'OWNER').filter(item => ['members', 'business', 'permissions', 'recipes', 'exports', 'audit'].includes(item.id));
  return `${roleHeader('營運總覽', '管理商家，掌握全局')}
    <section class="shell-section">${sectionHeading('營運摘要／重大異常', '查看全部')}
      <div class="shell-card shell-list">
        ${listRow({ route: 'receiving-published', iconName: 'fileText', title: '收貨待核對', count: '2 張' })}
        ${listRow({ route: 'catalog', iconName: 'package', title: '編碼待確認', count: '1 筆' })}
        ${listRow({ route: 'count-policy', iconName: 'clipboard', title: '貨單差異', count: '2 張' })}
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

function homePage(role) {
  if (role === 'SUPERVISOR') return managerHome();
  if (role === 'LOGISTICS') return logisticsHome();
  if (role === 'OWNER') return ownerHome();
  return staffHome();
}

function countPage(role) {
  if (role === 'SUPERVISOR') {
    return `${shellBack()}${pageIntro('盤點管理', '設定區域與品項、發布任務，盤後只看差異。', '主管抽屜')}
      <div class="shell-metric-grid">${metric('盤點區域', '4')}${metric('本次品項', '320')}${metric('待確認差異', '3', 'danger')}</div>
      <section class="shell-section">${sectionHeading('盤點設定')}
        <div class="shell-card shell-list">
          ${listRow({ route: 'count-setup', iconName: 'settings', title: '區域與商品', copy: '建立、排序與停用盤點區域' })}
          ${listRow({ route: 'count-import', iconName: 'fileText', title: '匯入原盤點表', copy: '先驗證再建立本次盤點品項' })}
          ${listRow({ route: 'count-scope', iconName: 'clipboard', title: '盤點範圍與頻率', copy: '按區域全選或勾選本次品項' })}
          ${listRow({ route: 'count-task', iconName: 'tasks', title: '發布盤點任務', copy: '套用每日、每週、月底或單次範本' })}
          ${listRow({ route: 'count-review', iconName: 'warning', title: '盤點差異稽查', copy: '只列需要主管判斷的項目' })}
        </div>
      </section>`;
  }
  if (role === 'LOGISTICS') {
    return `${shellBack()}${pageIntro('盤點整理與分析', '查看跨門市結果、資料完整度與異常趨勢。', '後勤抽屜')}
      <div class="shell-metric-grid">${metric('完成門市', '2 / 2')}${metric('異常品項', '6', 'warning')}${metric('資料完整度', '98%')}</div>
      <section class="shell-section">${sectionHeading('分析入口')}
        <div class="shell-card shell-list">${listRow({ route: 'count-analysis', iconName: 'chart', title: '盤點結果分析', copy: '門市、區域與品項趨勢' })}${listRow({ route: 'exports', iconName: 'download', title: '完整稽核明細', copy: '保留來源、操作者與時間' })}</div>
      </section>`;
  }
  if (role === 'OWNER') {
    return `${shellBack()}${pageIntro('盤點管理摘要', '只看結論、重大異常與盤點政策，不處理逐筆資料。', 'Owner 抽屜')}
      <div class="shell-metric-grid">${metric('本月盤點', '12 次')}${metric('重大異常', '2', 'danger')}${metric('完成率', '96%')}</div>
      <section class="shell-section">${sectionHeading('管理摘要')}<div class="shell-card shell-list">${listRow({ route: 'count-policy', iconName: 'shield', title: '盤點政策與完成率', copy: '依門市查看執行情況' })}${listRow({ route: 'reports', iconName: 'chart', title: '重大差異趨勢', copy: '查看已確認的營運結論' })}</div></section>`;
  }
  return `${shellBack()}${pageIntro('今日盤點', '依現場動線逐區完成；盤點時不顯示前次數量與差異。', '員工作業')}
    <section class="shell-card task-hero"><div><span class="status-pill">進行中</span><h2>2026/09/01 日常盤點</h2><p>2 / 4 區域已完成</p></div><div class="progress"><i style="width:50%"></i></div>${actionButton('繼續盤點', 'count-zones')}</section>
    <section class="shell-section">${sectionHeading('區域進度', '2 / 4 已完成')}${zoneProgressList()}</section>`;
}

function countFlowPage(route) {
  if (route === 'count-entry') {
    return `${shellBack('返回區域進度')}${pageIntro('冷藏庫盤點', '數量會自動儲存；完成前系統會檢查漏填項目。', '區域盤點・12 / 86')}
      <div class="progress"><i style="width:14%"></i></div>
      <div class="shell-card count-entry-list">
        ${[['鮮奶油 1L','聯馥食品','瓶'],['牛菲力','美福食集','kg'],['火腿（已解凍）','開元食品','包'],['帕瑪森起司','聯馥／開元','顆']].map(([name, supplier, unit], index) => `<label><span><strong>${name}</strong><small class="supplier-note">供應商：${supplier}${index === 2 ? '・效期提醒' : ''}</small></span><span class="fake-number">${['2', '3.25', '2', '1'][index]}</span><b>${unit}</b></label>`).join('')}
      </div>${actionButton('完成此區域', 'count-complete')}`;
  }
  if (route === 'count-complete') {
    return `${shellBack('返回盤點任務')}<section class="completion-state"><span>${icon('tasks')}</span><h1>冷藏庫盤點完成</h1><p>本區共 86 項・已盤 86 項</p></section><div class="shell-button-stack">${actionButton('查看已盤清單', 'count-entry')}${actionButton('繼續下一區', 'count-zones', 'secondary')}${actionButton('全部區域已完成', 'count-finished', 'ghost')}</div>`;
  }
  if (route === 'count-finished') {
    return `${shellBack('返回盤點任務')}<section class="completion-state compact"><span>${icon('tasks')}</span><h1>今日盤點完成</h1><p>4 個區域・320 項已完成</p></section><section class="shell-card chain-paper-card"><span class="status-pill">連鎖餐飲・下一步</span><h2>謄寫店內盤點表</h2><p>系統已依原工作表的位置與排序，產生本次紙本回填版。</p><div class="paper-meta"><span>原格式回填版</span><strong>320 項</strong></div>${actionButton('開啟紙本謄寫表', 'count-paper')}</section><div class="shell-button-stack">${actionButton('查看本次盤點明細', 'count-entry', 'secondary')}${actionButton('返回首頁', 'home', 'ghost')}</div><p class="shell-note">紙本謄寫完成後會留下經手人與時間，再交由主管確認／稽查。</p>`;
  }
  if (route === 'count-paper') {
    return `${shellBack('返回完成頁')}${pageIntro('紙本謄寫表', '依門市匯入表的工作表、列次與品項順序呈現。', '連鎖餐飲・必做')}
      <section class="paper-reference-toolbar"><span>門市匯入表｜9月食材</span><select aria-label="選擇原表段落"><option>原表第 1 段｜第 1–25 列</option><option>原表第 2 段｜第 26–50 列</option><option>原表第 3 段｜第 51–75 列</option></select><div><strong>第 1–25 項</strong><small>共 320 項</small></div></section>
      <section class="shell-card paper-reference-list">${[['001','鮮奶油 1L','聯馥食品','2 瓶'],['002','牛菲力','美福食集','3.25 kg'],['003','火腿（已解凍）','開元食品','2 包'],['004','帕瑪森起司','聯馥／開元','1 顆']].map(([position,name,supplier,value]) => `<div><span class="paper-position">${position}</span><span><strong>${name}</strong><small>供應商：${supplier}</small></span><b>${value}</b></div>`).join('')}</section>
      <div class="paper-step-actions">${actionButton('上一段', 'count-paper', 'ghost')}${actionButton('下一段 26–50', 'count-paper', 'secondary')}</div><button class="paper-export-link" type="button" data-shell-action="備用匯出 Excel／PDF">備用：匯出 Excel／PDF</button><p class="shell-note">盤點時依現場區域執行；謄寫時系統自動恢復成門市原表順序。完成整份後只送出一次紀錄。</p>${actionButton('完成紙本謄寫', 'count-paper-complete')}`;
  }
  if (route === 'count-paper-complete') {
    return `${shellBack('返回紙本謄寫表')}<section class="completion-state"><span>${icon('tasks')}</span><h1>紙本謄寫已完成</h1><p>經手人：王小明・2026/09/01 18:42</p></section><section class="shell-card completion-card"><strong>下一步</strong><p>等待門市主管確認／稽查<br>系統原始盤點數量不會被覆蓋</p></section>${actionButton('返回首頁', 'home')}`;
  }
  if (route === 'count-review') {
    return `${shellBack()}${pageIntro('盤點差異總覽', '全部區域完成後才產生；只顯示需要確認的項目。', '盤點 6 / 6')}
      <div class="shell-metric-grid">${metric('全部', '5')}${metric('待處理', '3', 'warning')}${metric('已處理', '2')}</div>
      <section class="shell-section"><div class="shell-card discrepancy-list">
        <article><header><strong>牛菲力</strong><span>-1.5 kg</span></header><p>上次 4.0 kg・本次 2.5 kg</p><select><option>請選擇原因</option></select><div class="reason-chips"><span>漏盤／錯區</span><span>進貨未登</span><span>報廢未登</span><span>其他</span></div></article>
        <article><header><strong>鮮奶油 1L</strong><span>-2 瓶</span></header><p>上次 6 瓶・本次 4 瓶</p><select><option>請選擇原因</option></select></article>
      </div></section><p class="shell-note">不可直接改寫原始數量；更正或重盤會新增事件。</p>`;
  }
  if (route === 'count-setup') {
    return `${shellBack()}${pageIntro('區域與商品', '依現場走動路線建立，商品可存在多個區域。', '主管盤點設定')}
      <div class="shell-card shell-list">${listRow({ route: 'count-setup', iconName: 'package', title: '冷藏庫', copy: '86 項・排序 1' })}${listRow({ route: 'count-setup', iconName: 'package', title: '工作冰箱', copy: '42 項・排序 2' })}${listRow({ route: 'count-setup', iconName: 'package', title: '冷凍庫', copy: '76 項・排序 3' })}${listRow({ route: 'count-setup', iconName: 'package', title: '乾貨區', copy: '116 項・排序 4' })}</div>${actionButton('新增盤點區域', 'count-setup')}`;
  }
  if (route === 'count-import') {
    return `${shellBack()}${pageIntro('匯入原盤點表', '保留來源工作表、欄位與列號；先驗證，不直接寫入。', '主管盤點設定')}
      <section class="shell-card upload-shell"><span>${icon('fileText')}</span><h2>選擇 Excel／CSV</h2><p>支援原盤點表與「序」固定範本</p>${actionButton('選擇檔案', 'count-import')}</section>
      <div class="shell-metric-grid">${metric('已對應', '286')}${metric('未對應', '8', 'warning')}${metric('重複', '2', 'danger')}${metric('缺單位', '3', 'warning')}</div>${actionButton('確認並建立本次品項', 'count-task')}`;
  }
  if (route === 'count-scope') {
    return `${shellBack()}${pageIntro('設定盤點範圍', '先選區域，再展開勾選該區品項；不一次顯示全部品項。', '主管盤點設定')}
      <div class="choice-grid"><button class="choice" type="button" data-shell-action="切換全品項"><strong>全品項</strong><small>320 項</small></button><button class="choice active" type="button" data-shell-action="切換分區指定"><strong>分區指定</strong><small>目前 293 項</small></button></div>
      <div class="scope-zone-grid">${[['冷藏庫','45／48'],['工作冰箱','38／42'],['冷凍庫','76／76'],['乾貨區','103／116'],['酒水區','18／22'],['醬料區','13／16']].map(([zone,count],index) => `<button class="scope-zone${index === 0 ? ' active' : ''}" type="button" data-shell-action="展開${zone}"><strong>${zone}</strong><small>已選 ${count} 項</small></button>`).join('')}</div>
      <div class="scope-zone-head"><strong>冷藏庫・48 項</strong><button type="button" data-shell-action="全選冷藏庫">全選此區</button></div>
      <section class="shell-card scope-item-list">${[['鮮奶油 1L','聯馥食品',true],['牛菲力','美福食集',true],['火腿（已解凍）','開元食品',true],['帕瑪森起司','多家供應商：聯馥／開元',false]].map(([name,supplier,checked]) => `<label><input type="checkbox" ${checked ? 'checked' : ''}><span><strong>${name}</strong><small>${supplier}</small></span></label>`).join('')}</section>
      <div class="scope-summary"><span>全部區域</span><strong>已選 293／320 項</strong></div>${actionButton('儲存盤點範圍', 'count-task')}`;
  }
  if (route === 'count-task') {
    return `${shellBack()}${pageIntro('發布盤點任務', '員工只有在主管發布後才會看到本次盤點。', '主管盤點設定')}
      <section class="shell-card settings-form"><label>盤點日期<span>2026/09/30</span></label><label>執行頻率<span>每月月底</span></label><label>盤點範本<span>月底全品項</span></label><label>本次範圍<span>6 區域・320 品項</span></label></section><div class="shell-button-stack">${actionButton('調整盤點範圍', 'count-scope', 'secondary')}${actionButton('發布盤點任務', 'count')}</div>`;
  }
  return `${shellBack()}${pageIntro('選擇盤點區域', '先完成進行中的區域，再依現場動線繼續。', '區域進度・2 / 4')}${zoneProgressList()}`;
}

function receivingPage(role) {
  if (role === 'LOGISTICS') {
    return `${shellBack()}${pageIntro('進貨資料核對', '整理、人工修正並發布；原始照片與 OCR 原值不可覆蓋。', '後勤抽屜')}
      <div class="shell-metric-grid">${metric('識別中', '1')}${metric('待核對', '2', 'warning')}${metric('已發布', '18')}</div>
      <section class="shell-section">${sectionHeading('待核對資料')}<div class="shell-card shell-list">${listRow({ route: 'receiving-review', iconName: 'fileText', title: '大森食品', copy: '3 張・今天 09:12', count: '需核對' })}${listRow({ route: 'receiving-review', iconName: 'fileText', title: '中央廚房', copy: '1 張・今天 08:47', count: '需核對' })}</div></section>`;
  }
  if (role === 'OWNER') {
    return `${shellBack()}${pageIntro('進貨管理摘要', '只看後勤發布後的總結、重大異常與稽查。', 'Owner 抽屜')}
      <div class="shell-metric-grid">${metric('本月進貨', 'NT$ 1.28M')}${metric('重大異常', '2', 'danger')}${metric('已發布批次', '18')}</div><section class="shell-section"><div class="shell-card shell-list">${listRow({ route: 'receiving-published', iconName: 'chart', title: '供應商與品項趨勢', copy: '最新／平均單價與進貨總額' })}${listRow({ route: 'receiving-published', iconName: 'warning', title: '少送／多送與重大異常', copy: '門市確認與後勤結論' })}${listRow({ route: 'audit', iconName: 'shield', title: '驗收稽查', copy: '原圖、修正、發布人與時間' })}</div></section>`;
  }
  return `${shellBack()}${pageIntro('進貨／收貨', '現場只要拍清楚並上傳；AI 與後勤負責後續整理。', role === 'SUPERVISOR' ? '主管抽屜' : '員工抽屜')}
    <section class="shell-card upload-shell"><span>${icon('truck')}</span><h2>上傳貨單</h2><p>可拍照或從相簿選擇，一次最多 10 張</p>${actionButton('開始上傳', 'receiving-upload')}</section>
    <section class="shell-section">${sectionHeading('今天的上傳', '3 批')}<div class="shell-card shell-list">${listRow({ route: 'receiving-status', iconName: 'fileText', title: '大森食品', copy: '3 張・識別中', count: '處理中' })}${listRow({ route: 'receiving-status', iconName: 'fileText', title: '市場採購', copy: '2 張・待後勤核對', count: '已上傳' })}</div></section>`;
}

function receivingFlowPage(route) {
  if (route === 'receiving-upload') {
    return `${shellBack()}${pageIntro('上傳貨單', '先選擇照片屬於同一張貨單，或是不同貨單。', '進貨 1 / 4')}
      <div class="choice-grid"><button class="choice active" type="button" data-shell-action="同一張貨單多頁"><strong>同一張貨單</strong><small>多頁或不同角度</small></button><button class="choice" type="button" data-shell-action="不同貨單"><strong>不同貨單</strong><small>系統分批建立</small></button></div>
      <section class="shell-card photo-grid">${[1,2,3].map(number => `<div><span>${icon('fileText')}</span><small>第 ${number} 張</small></div>`).join('')}<button type="button" data-shell-action="新增照片">＋<small>新增照片</small></button></section><p class="shell-note">系統會提醒疑似重複照片；原圖會完整保留。</p>${actionButton('確認上傳', 'receiving-status')}`;
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
    return `${shellBack()}<section class="completion-state"><span>${icon('tasks')}</span><h1>收貨核對完成</h1><p>資料已進入發布後摘要</p></section><section class="shell-card completion-card"><strong>一般餐廳</strong><p>✓ 完成「序」核對<br>✓ 收貨結案</p></section><section class="shell-card completion-card erp"><strong>連鎖餐飲・ERP 驗收</strong><p>✓ 完成「序」核對<br>◷ ERP 驗收：待處理<br>♢ 明日提醒主管</p></section>${actionButton('返回進貨首頁', 'receiving')}`;
  }
  return `${shellBack()}${pageIntro('貨單處理狀態', '上傳成功後即可繼續工作，辨識會在背景進行。', '進貨狀態')}
    <section class="shell-card status-timeline"><div class="done"><i></i><span><strong>原圖上傳完成</strong><small>今天 09:12</small></span></div><div class="current"><i></i><span><strong>AI 識別中</strong><small>原圖已保留，可稍後回來查看</small></span></div><div><i></i><span><strong>等待後勤核對</strong></span></div><div><i></i><span><strong>已發布</strong></span></div></section>${actionButton('返回今日工作', 'home')}`;
}

const simplePages = {
  ordering: ['叫貨與在途', '查看建議數量、供應商及每批預計到貨日。', [['建立叫貨單', '商品、建議數量與供應商', 'package'], ['在途商品', '每批訂單保留自己的 ETA', 'truck'], ['叫貨紀錄', '不自動送出訂單', 'activity']]],
  expiry: ['效期巡檢', '沿用盤點區域，只顯示今日到期、明日到期與待確認。', [['今日到期', '2 項需要現在確認', 'warning'], ['明日到期', '3 項建議先處理', 'calendarClock'], ['區域巡檢', '冷藏庫・工作冰箱・冷凍庫', 'clipboard']]],
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
  business: ['商家與門市設定', '管理單店／連鎖模式、門市與組織基本資料。', [['商家資料', '名稱、營運模式與模組', 'building'], ['門市管理', '新增與停用門市', 'home'], ['登入識別', '姓名／暱稱或員工編號', 'user']]],
  permissions: ['模組權限', '依角色與門市顯示功能；未啟用的模組完全隱藏。', [['角色權限', '員工、主管、後勤與 Owner', 'shield'], ['門市範圍', '角色可依門市不同', 'building'], ['代理權限', '期間到期後自動收回', 'calendarClock']]],
  exports: ['資料匯出', '匯出不取代原始資料；成果可由正式紀錄重新產生。', [['盤點回填版', '保持來源位置，新品另表', 'download'], ['完整稽核明細', '來源、操作者、時間與事件', 'fileText'], ['營運摘要', '只包含已發布資料', 'chart']]],
  audit: ['Audit Log', '查看原始資料、修正事件、發布者與時間。', [['盤點事件', '原始實盤與追加更正', 'clipboard'], ['進貨證據鏈', '原圖、OCR、修正與發布', 'fileText'], ['權限異動', '角色、代理與停用紀錄', 'shield']]],
  settings: ['設定', '集中管理盤點、進貨、登入裝置與提醒政策。', [['登入與裝置', '個人／共用裝置與重新驗證', 'lock'], ['營運提醒', 'ERP 驗收與異常通知', 'bell'], ['盤點政策', '區域、範本與完成方式', 'clipboard']]],
};

function simpleWorkspace(route) {
  const [title, copy, rows] = simplePages[route];
  return `${shellBack()}${pageIntro(title, copy)}<section class="shell-section">${sectionHeading('功能外殼')}<div class="shell-card shell-list">${rows.map(([rowTitle, rowCopy, iconName]) => listRow({ route, iconName, title: rowTitle, copy: rowCopy })).join('')}</div></section><p class="shell-note">目前按鍵已定位到對應抽屜；資料寫入與業務規則會在下一階段逐一接入。</p>`;
}

function activityPage() {
  return `${pageIntro('作業紀錄', '依時間查看自己或權限範圍內的正式操作。')}<div class="filter-chips"><button class="active">全部</button><button>盤點</button><button>進貨</button><button>異常</button></div><div class="shell-card timeline-list"><article><i></i><div><strong>完成工作冰箱盤點</strong><small>今天 09:42・王小明</small></div></article><article><i></i><div><strong>上傳大森食品貨單</strong><small>今天 09:12・王小明</small></div></article><article><i></i><div><strong>確認跨店借入</strong><small>昨天 18:30・李店長</small></div></article></div>`;
}

function tasksPage(role) {
  const copy = { STAFF: '尚未完成的今日工作與交接事項。', SUPERVISOR: '需要主管判斷的異常與確認事項。', LOGISTICS: '後勤待核對、待整理與待發布資料。', OWNER: '需要決策的重大異常與管理事項。' }[role];
  return `${pageIntro('待辦', copy)}<div class="shell-card shell-list">${listRow({ route: 'count', iconName: 'clipboard', title: '完成今日盤點', copy: '剩餘 2 個區域', count: '今天' })}${listRow({ route: 'receiving', iconName: 'truck', title: '確認收貨狀態', copy: '1 批仍在處理', count: '1' })}${listRow({ route: 'incidents', iconName: 'warning', title: '庫存異常待處理', copy: '牛菲力數量差異', count: '重要' })}</div>`;
}

function notificationsPage() {
  return `${pageIntro('通知', '只提醒需要行動的事情；正常資料不主動干擾。')}<div class="shell-card shell-list">${listRow({ route: 'expiry', iconName: 'calendarClock', title: '2 項商品今日到期', copy: '請確認是否仍在現場', count: '剛剛' })}${listRow({ route: 'count', iconName: 'clipboard', title: '盤點任務已發布', copy: '2026/09/01 日常盤點', count: '09:00' })}${listRow({ route: 'transfers', iconName: 'arrowRight', title: '跨店借入等待確認', copy: 'BeApe 信義店・鮮奶油 2 瓶', count: '昨天' })}</div>`;
}

function profilePage(role) {
  const meta = roleMeta(role);
  const management = visibleItems(MANAGEMENT, role);
  return `${pageIntro('我的', '個人身分、目前門市與可使用的設定入口。')}<section class="shell-card profile-card"><span>${icon('user')}</span><div><strong>王小明</strong><small>${escapeHtml(meta.label)}・BeApe 大安店</small></div></section><section class="shell-section">${sectionHeading('設定與管理')}<div class="shell-card shell-list">${management.slice(0, 5).map(item => listRow({ route: item.id, iconName: item.icon, title: item.label, copy: item.future ? '未來選配' : '依目前角色權限顯示' })).join('') || listRow({ route: 'settings', iconName: 'lock', title: '登入與裝置', copy: '重新驗證由主管政策決定' })}</div></section><button class="shell-secondary full" type="button" data-shell-action="登出">登出</button>`;
}

function otherPage(role) {
  const operations = visibleItems(OPERATIONS, role);
  return `${shellBack()}${pageIntro('所有作業', '只顯示目前角色可使用的功能。')}<div class="shell-tile-grid">${operations.map(item => iconTile(item)).join('')}</div>`;
}

function restrictedPage(role) {
  return `${shellBack()}${emptyPanel('此角色沒有操作權限', `${roleMeta(role).label}不會看到這個功能入口。`)}`;
}

export function appShellPage(role, route) {
  if (!roleCanOpen(role, route)) return restrictedPage(role);
  if (route === 'home') return homePage(role);
  if (route === 'activity') return activityPage();
  if (route === 'tasks') return tasksPage(role);
  if (route === 'notifications') return notificationsPage();
  if (route === 'profile') return profilePage(role);
  if (route === 'other') return otherPage(role);
  if (route === 'count') return countPage(role);
  if (route.startsWith('count-')) return countFlowPage(route);
  if (route === 'receiving') return receivingPage(role);
  if (route.startsWith('receiving-')) return receivingFlowPage(route);
  if (simplePages[route]) return simpleWorkspace(route);
  return `${shellBack()}${emptyPanel('頁面外殼已預留', '這個路由會在對應功能抽屜接入時完成內容。')}`;
}
