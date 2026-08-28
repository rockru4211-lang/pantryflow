import{escapeHtml}from'../components/layout.js';
import{icon}from'../components/icons.js';
import{roleHomeKind}from'../services/roles.js';

const reviewItems=[['收貨待核對',2,'張','purple'],['編碼待確認',1,'筆','blue'],['貨單差異',2,'張','orange'],['盤點異常',3,'筆','green']];
const managementItems=[['商品／編碼','catalog','package'],['供應商','suppliers','truck'],['配方','recipes','book'],['成本分析','costs','chart'],['報表中心','reports','fileText'],['設定','profile','settings']];
const ownerItems=[['成員與權限','members','users'],['商家設定','business','building'],['模組開關','modules','sliders'],['配方機密權限','recipe-access','lock'],['資料匯出','export','download'],['Audit Log','audit','fileText']];
function titleRow(title,action=''){return `<div class="home-title-row"><h2>${escapeHtml(title)}</h2>${action?`<span>${escapeHtml(action)}</span>`:''}</div>`}
function countFirstAction(role){const manager=role==='ADMIN'||role==='SUPERVISOR';return `<section class="count-first-card"><span>${icon('clipboard')}</span><div><small>${manager?'只需設定一次':'今天唯一要做的事'}</small><h1>${manager?'開始設定盤點':'今日盤點'}</h1><p>${manager?'匯入 Excel 或建立區域後，系統每天自動準備盤點。':'選擇區域、輸入數量、完成。系統會自動保存。'}</p></div><button class="primary" data-feature="count" type="button">${manager?'開始設定':'開始盤點'}</button></section>`}
function receivingShortcut(){return `<button class="count-first-secondary" data-feature="receiving" type="button"><span>${icon('truck')}</span><span><strong>進貨驗收</strong><small>有到貨時拍貨單、確認實收與差異</small></span><b>›</b></button>`}
function rowList(items,emptyCopy,{icons=false}={}){const tones=['danger','warning','info','purple','green'];return `<div class="card home-list">${items.length?items.map(([label,itemValue,unit='項',tone=''],index)=>`<button type="button">${icons?`<i class="row-status tone-${tone||tones[index%tones.length]}">•</i>`:''}<span>${escapeHtml(label)}</span><b>${escapeHtml(itemValue)} <small>${escapeHtml(unit)}</small></b></button>`).join(''):`<p class="home-empty">${escapeHtml(emptyCopy)}</p>`}</div>`}
function adminGrid(items){return `<div class="admin-grid">${items.map(([label,route,iconName])=>`<button class="admin-card" data-feature="${route}" type="button"><span>${icon(iconName)}</span><strong>${escapeHtml(label)}</strong></button>`).join('')}</div>`}
function resultsList(items,period){return `<div class="card results-card"><div class="results-period">${escapeHtml(period)}⌄</div>${items.map(([label,amount])=>`<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(amount)}</strong></div>`).join('')}</div>`}

function employeeHome(){return `<main class="home-page employee-home count-first-home" data-home-kind="employee">${countFirstAction('STAFF')}${receivingShortcut()}<p class="count-first-principle">不看歷史數字、不算差異；現場只負責把實際數量輸入完成。</p></main>`}
function managerHome(){return `<main class="home-page manager-home count-first-home" data-home-kind="manager">${countFirstAction('ADMIN')}${receivingShortcut()}<p class="count-first-principle">先把盤點跑順。廢棄與效期功能暫時不放進主要流程。</p></main>`}
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
