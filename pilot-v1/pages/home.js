import{escapeHtml}from'../components/layout.js';
import{icon}from'../components/icons.js';
import{roleHomeKind}from'../services/roles.js';

const workItems=[['盤點','count','clipboard'],['進貨','receiving','truck'],['廢棄','waste','trash'],['效期巡檢','expiry','calendarClock'],['其他作業','other','more']];
const reviewItems=[['收貨待核對',2,'張','purple'],['編碼待確認',1,'筆','blue'],['貨單差異',2,'張','orange'],['盤點異常',3,'筆','green']];
const managementItems=[['商品／編碼','catalog','package'],['供應商','suppliers','truck'],['配方','recipes','book'],['成本分析','costs','chart'],['報表中心','reports','fileText'],['設定','profile','settings']];
const ownerItems=[['成員與權限','members','users'],['商家設定','business','building'],['模組開關','modules','sliders'],['配方機密權限','recipe-access','lock'],['資料匯出','export','download'],['Audit Log','audit','fileText']];
function count(value){return Number.isFinite(Number(value))?Number(value):0}
function value(value,fallback){return value===undefined||value===null?fallback:value}
function titleRow(title,action=''){return `<div class="home-title-row"><h2>${escapeHtml(title)}</h2>${action?`<span>${escapeHtml(action)}</span>`:''}</div>`}
function operationGrid(){return `<div class="operation-grid">${workItems.map(([label,route,iconName])=>`<button class="operation-card" data-feature="${route}"><span>${icon(iconName)}</span><strong>${label}</strong></button>`).join('')}</div>`}
function metricCards(items){return `<div class="metric-grid">${items.map(([label,itemValue,tone,iconName])=>`<button class="metric-card tone-${tone}" type="button"><i>${icon(iconName)}</i><span>${escapeHtml(label)}</span><strong>${count(itemValue)}</strong><small>項</small></button>`).join('')}</div>`}
function rowList(items,emptyCopy,{icons=false}={}){const tones=['danger','warning','info','purple','green'];return `<div class="card home-list">${items.length?items.map(([label,itemValue,unit='項',tone=''],index)=>`<button type="button">${icons?`<i class="row-status tone-${tone||tones[index%tones.length]}">•</i>`:''}<span>${escapeHtml(label)}</span><b>${escapeHtml(itemValue)} <small>${escapeHtml(unit)}</small></b></button>`).join(''):`<p class="home-empty">${escapeHtml(emptyCopy)}</p>`}</div>`}
function adminGrid(items){return `<div class="admin-grid">${items.map(([label,route,iconName])=>`<button class="admin-card" data-feature="${route}" type="button"><span>${icon(iconName)}</span><strong>${escapeHtml(label)}</strong></button>`).join('')}</div>`}
function resultsList(items,period){return `<div class="card results-card"><div class="results-period">${escapeHtml(period)}⌄</div>${items.map(([label,amount])=>`<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(amount)}</strong></div>`).join('')}</div>`}

function employeeHome(data){const alerts=data.alerts||{};return `<main class="home-page employee-home" data-home-kind="employee">
  <section class="home-section"><h1>今天先看</h1>${metricCards([['缺貨風險',value(alerts.stockRisk,3),'danger','warning'],['即期提醒',value(alerts.expiry,2),'warning','calendarClock'],['待確認',value(alerts.pending,1),'info','help']])}</section>
  <section class="home-section"><h2>每日作業</h2>${operationGrid()}</section>
  <section class="home-section">${titleRow('今日建議','適用')}${rowList(data.suggestions||[['明日午餐訂位較多','建議提前確認備料','']],'目前沒有需要優先處理的建議。')}</section>
  <section class="home-section">${titleRow('商家留言板','適用')}${rowList(data.messages||[['明日午餐訂位較多，請提早備料','›','']],'目前沒有商家留言。')}</section>
</main>`}
function managerHome(data){const focus=data.focus||{};return `<main class="home-page manager-home" data-home-kind="manager">
  <section class="home-section">${titleRow('今日重點','查看全部')}${rowList([['缺貨風險',value(focus.stockRisk,3)],['即期風險',value(focus.expiryRisk,2)],['待確認異常',value(focus.pending,1)],['收貨待核對',value(focus.receiving,2),'張'],['盤點差異',value(focus.countDifference,2),'筆']],'目前沒有需要優先處理的重點。',{icons:true})}</section>
  <section class="home-section"><h2>每日作業</h2>${operationGrid()}</section>
  <section class="home-section">${titleRow('需要處理','查看全部')}${rowList(data.actions||[['盤點差異待確認',2,'筆'],['貨單待核對',1,'張'],['效期異常',3,'項']],'目前沒有待處理事項。',{icons:true})}</section>
</main>`}
function logisticsHome(data){return `<main class="home-page logistics-home" data-home-kind="logistics">
  <section class="home-section">${titleRow('今日待核對','查看全部')}${rowList(data.reviews||reviewItems,'目前沒有待核對事項。',{icons:true})}</section>
  <section class="home-section">${titleRow('營運成果')}${resultsList(data.results||[['今日進貨總額','$ 68,540'],['本月進貨總額','$ 1,285,230'],['本月食材成本','$ 892,100'],['本月盤點次數','12 次'],['本月廢棄金額','$ 12,450']],'今日')}</section>
  <section class="home-section"><h2>管理功能</h2>${adminGrid(managementItems)}</section>
</main>`}
function ownerHome(data){return `<main class="home-page owner-home" data-home-kind="owner">
  <section class="home-section">${titleRow('營運摘要','查看報告')}${rowList(data.executiveSummary||[['重大進貨異常',2,'項','purple'],['門市盤點待稽查',1,'店','orange']],'目前沒有重大營運異常。',{icons:true})}</section>
  <section class="home-section">${titleRow('營運成果')}${resultsList(data.results||[['本月進貨總額','$ 1,285,230'],['本月食材成本','$ 892,100'],['本月毛利率','58.3 %'],['本月盤點次數','12 次'],['本月廢棄金額','$ 12,450']],'本月')}</section>
  <section class="home-section"><h2>管理設定</h2>${adminGrid(ownerItems)}</section>
</main>`}
export function homePage({role,data={}}={}){const kind=roleHomeKind(role);if(kind==='employee')return employeeHome(data);if(kind==='manager')return managerHome(data);if(kind==='logistics')return logisticsHome(data);if(kind==='owner')return ownerHome(data);throw new Error('ROLE_HOME_NOT_AVAILABLE')}
