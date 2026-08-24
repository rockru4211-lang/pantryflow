import{escapeHtml}from'../components/layout.js';
import{roleHomeKind}from'../services/roles.js';

const workItems=[
  ['盤點','count','▣'],['進貨','receiving','▤'],['廢棄','waste','♲'],['效期巡檢','expiry','◷'],['其他作業','other','•••']
];
function count(value){return Number.isFinite(Number(value))?Number(value):0}
function operationGrid(){return `<div class="operation-grid">${workItems.map(([label,route,icon])=>`<button class="operation-card" data-feature="${route}"><span>${icon}</span><strong>${label}</strong></button>`).join('')}</div>`}
function metricCards(items){return `<div class="metric-grid">${items.map(([label,value,tone])=>`<button class="metric-card tone-${tone}" type="button"><span>${escapeHtml(label)}</span><strong>${count(value)}</strong><small>項</small></button>`).join('')}</div>`}
function rowList(items,emptyCopy){return `<div class="card home-list">${items.length?items.map(([label,value,unit='項'])=>`<button type="button"><span>${escapeHtml(label)}</span><b>${escapeHtml(value)} <small>${escapeHtml(unit)}</small></b></button>`).join(''):`<p class="home-empty">${escapeHtml(emptyCopy)}</p>`}</div>`}

function employeeHome(data){
  const alerts=data.alerts||{};
  return `<main class="home-page employee-home" data-home-kind="employee">
    <section class="home-section"><h1>今天先看</h1>${metricCards([['缺貨風險',alerts.stockRisk,'danger'],['即期提醒',alerts.expiry,'warning'],['待確認',alerts.pending,'info']])}</section>
    <section class="home-section"><h2>每日作業</h2>${operationGrid()}</section>
    <section class="home-section"><div class="home-title-row"><h2>今日建議</h2><span>適用</span></div>${rowList(data.suggestions||[],'目前沒有需要優先處理的建議。')}</section>
    <section class="home-section"><div class="home-title-row"><h2>商家留言板</h2><span>適用</span></div>${rowList(data.messages||[],'目前沒有商家留言。')}</section>
  </main>`;
}
function managerHome(data){
  const focus=data.focus||{};
  return `<main class="home-page manager-home" data-home-kind="manager">
    <section class="home-section"><div class="home-title-row"><h1>今日重點</h1><span>查看全部</span></div>${rowList([
      ['缺貨風險',count(focus.stockRisk)],['即期風險',count(focus.expiryRisk)],['待確認異常',count(focus.pending)],['收貨待核對',count(focus.receiving)],['盤點差異',count(focus.countDifference)]
    ],'目前沒有需要優先處理的重點。')}</section>
    <section class="home-section"><h2>每日作業</h2>${operationGrid()}</section>
    <section class="home-section"><div class="home-title-row"><h2>需要處理</h2><span>查看全部</span></div>${rowList(data.actions||[],'目前沒有待處理事項。')}</section>
  </main>`;
}
export function homePage({role,data={}}={}){const kind=roleHomeKind(role);if(kind==='employee')return employeeHome(data);if(kind==='manager')return managerHome(data);throw new Error('ROLE_HOME_NOT_AVAILABLE')}
