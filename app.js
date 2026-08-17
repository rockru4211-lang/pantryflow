const products = [
  {id:'001',name:'牛菲力',area:'冷藏庫 A',unit:'kg',qty:6.2,safe:5,status:'normal'},
  {id:'002',name:'鮮奶油',area:'冷藏庫 A',unit:'盒',qty:2,safe:4,status:'expiry',expiry:'明日到期'},
  {id:'003',name:'帕瑪森起司',area:'冷藏庫 B',unit:'包',qty:7,safe:3,status:'normal'},
  {id:'004',name:'雞高湯',area:'冷藏庫 B',unit:'盒',qty:2,safe:4,status:'expiry',expiry:'今日到期'},
  {id:'005',name:'法國奶油',area:'冷藏庫 A',unit:'塊',qty:3,safe:5,status:'low'},
  {id:'006',name:'紅酒醬',area:'工作冰箱',unit:'盒',qty:4,safe:2,status:'normal'},
  {id:'007',name:'蘑菇',area:'冷藏庫 A',unit:'kg',qty:1.5,safe:3,status:'low'},
  {id:'008',name:'雞蛋',area:'冷藏庫 B',unit:'盒',qty:2,safe:3,status:'low'}
];
const tasks=[
  {tone:'purple',icon:'⌛',title:'雞高湯 2 盒今日到期',detail:'請優先使用或登記報廢'},
  {tone:'',icon:'↓',title:'3 項低於安全庫存',detail:'法國奶油、蘑菇、雞蛋'},
  {tone:'',icon:'✓',title:'冷藏區盤點尚未完成',detail:'共 8 項・約需 3 分鐘'},
  {tone:'red',icon:'!',title:'1 件異常等待處理',detail:'昨日鮮奶油少到 2 盒'}
];
const state={filter:'all'};
const $=s=>document.querySelector(s); const $$=s=>document.querySelectorAll(s);
function renderTasks(){ $('#task-list').innerHTML=tasks.map(t=>`<div class="task ${t.tone}"><div class="task-icon">${t.icon}</div><div class="task-copy"><strong>${t.title}</strong><small>${t.detail}</small></div><span class="task-arrow">›</span></div>`).join('') }
function renderCount(){
  $('#count-total').textContent=products.length;
  $('#count-list').innerHTML=products.map(p=>`<label class="count-item"><div><strong>${p.name}</strong><small>${p.id}・${p.area}</small></div><div class="quantity"><input type="number" min="0" step="0.1" inputmode="decimal" data-id="${p.id}" aria-label="${p.name}數量"><span>${p.unit}</span></div></label>`).join('');
  $$('#count-list input').forEach(i=>i.addEventListener('input',updateProgress));
}
function updateProgress(){const filled=[...$$('#count-list input')].filter(i=>i.value!=='').length;const pct=Math.round(filled/products.length*100);$('#count-progress').textContent=filled;$('#progress-ring').textContent=pct+'%';$('#progress-ring').style.background=`conic-gradient(#4f9678 ${pct}%, #dcece5 0)`;$('#finish-count').disabled=filled!==products.length}
function renderInventory(){
  const q=$('#inventory-search').value.toLowerCase();
  const filtered=products.filter(p=>(state.filter==='all'||p.status===state.filter)&&p.name.toLowerCase().includes(q));
  $('#inventory-list').innerHTML=filtered.map(p=>`<article class="inventory-item ${p.status}"><i class="item-status"></i><div class="inventory-copy"><strong>${p.name}</strong><small>${p.expiry||p.area}${p.status==='low'?'・安全庫存 '+p.safe+p.unit:''}</small></div><div class="inventory-qty"><strong>${p.qty}</strong> <span>${p.unit}</span></div></article>`).join('')||'<div class="notice">找不到符合的商品</div>';
  $('#inventory-total').textContent=products.length;$('#low-total').textContent=products.filter(p=>p.status==='low').length;$('#expiry-total').textContent=products.filter(p=>p.status==='expiry').length;
}
function go(page){$$('.page').forEach(p=>p.classList.toggle('active',p.dataset.page===page));$$('.bottom-nav button').forEach(b=>b.classList.toggle('active',b.dataset.go===page));const titles={home:'今日秘書',count:'快速盤點',inventory:'庫存狀態',summary:'盤點完成'};$('#page-title').textContent=titles[page];scrollTo(0,0)}
function showToast(message){const toast=$('#toast');toast.textContent=message;toast.classList.add('show');setTimeout(()=>toast.classList.remove('show'),2200)}
function finishCount(){
  $$('#count-list input').forEach(i=>{const p=products.find(p=>p.id===i.dataset.id);p.qty=Number(i.value)});
  $('#summary-table').innerHTML=products.map(p=>`<div class="summary-row"><span>${p.id}</span><b>${p.name}</b><strong>${p.qty} ${p.unit}</strong></div>`).join('');go('summary');
}
renderTasks();renderCount();renderInventory();
$$('[data-go]').forEach(b=>b.addEventListener('click',()=>go(b.dataset.go)));
$('#finish-count').addEventListener('click',finishCount);
$('#inventory-search').addEventListener('input',renderInventory);
$$('[data-filter]').forEach(b=>b.addEventListener('click',()=>{state.filter=b.dataset.filter;$$('[data-filter]').forEach(x=>x.classList.toggle('active',x===b));renderInventory()}));
const dialog=$('#issue-dialog');$('#quick-issue').addEventListener('click',()=>dialog.showModal());
$('#issue-form').addEventListener('submit',e=>{if(!$('#issue-note').value.trim()){e.preventDefault();return}tasks.unshift({tone:'red',icon:'!',title:$('#issue-note').value.trim(),detail:$('#issue-type').value+'・剛剛回報'});renderTasks();setTimeout(()=>showToast('異常已記錄，並加入待辦'),0)});
$('#copy-summary').addEventListener('click',async()=>{const text=products.map(p=>`${p.id}\t${p.name}\t${p.qty} ${p.unit}`).join('\n');try{await navigator.clipboard.writeText(text);showToast('總表已複製')}catch{showToast('瀏覽器未允許複製')}});
$('#nav-more').addEventListener('click',()=>showToast('效期、異常與設定將在下一版開放'));
