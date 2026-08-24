import{session}from'./services/supabase.js';
import{signIn,signOut,profile,createStore,createStaff,resetStaffPin,disableStaff}from'./services/auth.js';
import{stores,countWorkspace,receiptWorkbench,uploadReceipts,correctReceiptField,storeStaff,catalogWorkspace,zoneWorkspace,createPilotProduct,createPilotZone,assignPilotProduct,createPilotCountSession,saveCountDraft,completePilotCountZone,resolvePilotCountDiscrepancy}from'./services/data.js';
import{layout}from'./components/layout.js';
import{loginPage,storePickerPage,unassignedStorePage}from'./pages/login.js';
import{homePage}from'./pages/home.js';
import{countPage}from'./pages/count.js';
import{receivingPage}from'./pages/receiving.js';
import{consignmentPage}from'./pages/consignment.js';
import{utilityPage}from'./pages/utility.js';
import{catalogPage,zonesPage}from'./pages/setup.js';

const root=document.querySelector('#app');
const state={session:null,profile:null,stores:[],store:null,page:'home',context:{}};
const build=window.PILOT_BUILD||{branch:'unknown',sha:'unknown',deployedAt:'unknown'};
document.querySelector('#build-banner').textContent=`封閉 Pilot｜${build.branch}｜${String(build.sha).slice(0,7)}`;
document.querySelector('#build-version').textContent=`Branch: ${build.branch}｜Git SHA: ${build.sha}｜部署時間: ${build.deployedAt}`;

function message(error){const raw=String(error?.message||'');if(/invalid login credentials/i.test(raw))return'Email 或密碼不正確。';if(/INVALID_STAFF|INVALID_LOGIN/i.test(raw))return'門市、員工識別或 PIN 不正確。';if(/PIN_LOCKED/i.test(raw))return'PIN 已鎖定 15 分鐘，請稍後再試或請主管重設。';if(/OWNER_EMAIL_NOT_VERIFIED/i.test(raw))return'請先完成 Email 驗證。';if(/STORE_ALREADY|23505/i.test(raw))return'門市代碼或商品編碼已存在。';if(/COUNT_ZONE_REQUIRED/i.test(raw))return'請先建立至少一個盤點區域。';if(/ZONE_PRODUCTS_REQUIRED/i.test(raw))return'每個啟用區域都必須先加入商品。';if(/OPENING_BALANCE_REQUIRED/i.test(raw))return'商品缺少正式期初數量。';if(/ACTIVE_COUNT_SESSION_EXISTS/i.test(raw))return'已有進行中的盤點任務。';if(/COUNT_ZONE_INCOMPLETE/i.test(raw))return'請輸入此區域全部商品的數量後再完成。';return'目前無法寫入正式資料，請確認內容與網路後重試。'}
function bindError(form,work){form.addEventListener('submit',async event=>{event.preventDefault();const node=form.querySelector('[data-error]');node.textContent='';try{await work(new FormData(form))}catch(error){console.error(error);node.textContent=message(error)}})}

function renderLogin(){document.body.classList.add('admin-auth-view');root.innerHTML=loginPage();bindError(document.querySelector('#management-login'),async form=>{await signIn(form.get('email'),form.get('password'));await boot()})}
function renderStorePicker(){document.body.classList.add('admin-auth-view');root.innerHTML=storePickerPage(state.stores);root.querySelectorAll('[data-store]').forEach(button=>button.onclick=()=>{state.store=state.stores.find(x=>x.id===button.dataset.store);renderPage('home')})}

async function renderPage(page,context={}){document.body.classList.remove('admin-auth-view');state.page=page;state.context=context;const role=state.profile.is_owner?'OWNER':state.store.role;const canManage=state.profile.is_owner||['ADMIN','SUPERVISOR'].includes(state.store.role);let content;
  if(page==='home')content=homePage({role,storeName:state.store.name,erpEnabled:Boolean(state.store.erp_acceptance_enabled)});
  else if(page==='count')content=countPage(await countWorkspace(state.store.id,state.profile.id,canManage),{canManage,context});
  else if(page==='catalog')content=catalogPage(await catalogWorkspace(state.store.id));
  else if(page==='zones')content=zonesPage(await zoneWorkspace(state.store.id));
  else if(page==='receiving')content=receivingPage(await receiptWorkbench(state.store.id,context.batchId));
  else if(page==='consignment')content=consignmentPage();
  else content=utilityPage(page,{canManage,store:state.store,staff:page==='profile'&&canManage?await storeStaff(state.store.id):[],isOwner:state.profile.is_owner,currentUserId:state.profile.id});
  root.innerHTML=layout({storeName:state.store.name,role,page,content,displayName:state.profile.display_name});
  document.querySelectorAll('[data-route]').forEach(button=>button.onclick=()=>renderPage(button.dataset.route));document.querySelectorAll('[data-feature]').forEach(button=>button.onclick=()=>renderPage(button.dataset.feature));
  document.querySelectorAll('[data-open-count]').forEach(button=>button.onclick=()=>renderPage('count',{sessionId:button.dataset.session,zoneId:button.dataset.zone}));
  document.querySelectorAll('[data-open-receipt]').forEach(button=>button.onclick=()=>renderPage('receiving',{batchId:button.dataset.openReceipt}));
  document.querySelectorAll('[data-create-count]').forEach(button=>button.onclick=async()=>{const errorNode=document.querySelector('[data-action-error]');button.disabled=true;try{await createPilotCountSession(state.store.id);await renderPage('count')}catch(error){console.error(error);if(errorNode)errorNode.textContent=message(error);button.disabled=false}});
  const productForm=document.querySelector('#create-product');if(productForm)bindError(productForm,async form=>{await createPilotProduct(state.store.id,Object.fromEntries(form));await renderPage('catalog')});
  const zoneForm=document.querySelector('#create-zone');if(zoneForm)bindError(zoneForm,async form=>{await createPilotZone(state.store.id,form.get('name'));await renderPage('zones')});
  document.querySelectorAll('[data-assign-product]').forEach(form=>bindError(form,async values=>{await assignPilotProduct(form.dataset.assignProduct,values.get('productId'));await renderPage('zones')}));
  document.querySelector('[data-download-catalog-template]')?.addEventListener('click',()=>{const csv='商品名稱,商品編碼,分類,基本盤點單位,採購單位,換算率,供應商,啟用狀態,期初數量\n';const link=document.createElement('a');link.href=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}));link.download='PantryFlow_商品匯入固定範本.csv';link.click();URL.revokeObjectURL(link.href)});
  document.querySelector('[data-catalog-file]')?.addEventListener('change',event=>{const node=document.querySelector('[data-import-preview]'),file=event.target.files[0];node.innerHTML=file?`<div class="helper">已選擇 ${file.name}。目前只完成固定範本下載；Excel 預覽與正式批次寫入尚未通過，檔案不會被假裝匯入。</div>`:''});
  const countForm=document.querySelector('#blind-count');if(countForm){countForm.querySelectorAll('[data-count-product]').forEach(input=>input.addEventListener('change',async()=>{const saved=countForm.querySelector(`[data-save-state="${input.dataset.countProduct}"]`);if(input.value===''){saved.textContent='尚未輸入';return}saved.textContent='保存中…';try{await saveCountDraft(state.profile,countForm.dataset.session,countForm.dataset.zone,input.dataset.countProduct,input.value,input.dataset.unit);saved.textContent='已自動保存'}catch(error){console.error(error);saved.textContent='保存失敗，請重試'}}));bindError(countForm,async()=>{await completePilotCountZone(countForm.dataset.session,countForm.dataset.zone);await renderPage('count')})}
  document.querySelectorAll('[data-resolve-discrepancy]').forEach(form=>bindError(form,async values=>{await resolvePilotCountDiscrepancy(form.dataset.resolveDiscrepancy,Object.fromEntries(values));await renderPage('count')}));
  document.querySelectorAll('[data-correct-receipt-field]').forEach(form=>bindError(form,async values=>{let oldValue=null;try{oldValue=JSON.parse(values.get('oldValue'))}catch{}await correctReceiptField(state.profile,form.dataset.batch,form.dataset.correctReceiptField,oldValue,values.get('value'));await renderPage('receiving',{batchId:form.dataset.batch})}));
  document.querySelector('[data-store-switch]')?.addEventListener('click',()=>state.stores.length>1?renderStorePicker():renderPage('profile'));document.querySelector('[data-sign-out]')?.addEventListener('click',async()=>{await signOut();renderLogin()});const storeForm=document.querySelector('#create-store');if(storeForm)bindError(storeForm,async form=>{await createStore(Object.fromEntries(form));state.stores=await stores(state.profile.id);await renderPage('profile')});const staffForm=document.querySelector('#create-staff');if(staffForm)bindError(staffForm,async form=>{await createStaff(Object.fromEntries(form));await renderPage('profile')});document.querySelectorAll('[data-reset-pin]').forEach(form=>bindError(form,async values=>{await resetStaffPin(form.dataset.resetPin,values.get('pin'));await renderPage('profile')}));document.querySelectorAll('[data-disable-staff]').forEach(button=>button.onclick=async()=>{button.disabled=true;try{await disableStaff(button.dataset.disableStaff);await renderPage('profile')}catch(error){console.error(error);button.disabled=false;button.textContent=message(error)}});const upload=document.querySelector('#receipt-upload');if(upload)bindError(upload,async form=>{const files=[...form.getAll('files')].filter(file=>file.size);await uploadReceipts(state.store,state.profile,files);await renderPage('receiving')})}

function renderUnassignedStore(){document.body.classList.add('admin-auth-view');root.innerHTML=unassignedStorePage();document.querySelector('[data-sign-out]').onclick=async()=>{await signOut();renderLogin()}}

async function boot(preferredStoreId){state.session=await session();if(!state.session)return renderLogin();state.profile=await profile(state.session.user.id);if(!state.profile.organization_id)return renderUnassignedStore();state.stores=await stores(state.profile.id);if(!state.stores.length)return renderUnassignedStore();state.store=state.stores.find(x=>x.id===preferredStoreId)||state.stores[0];if(state.stores.length>1&&!preferredStoreId)return renderStorePicker();await renderPage('home')}

boot().catch(error=>{console.error(error);root.innerHTML=`<section class="center-card"><h1>正式資料載入失敗</h1><p class="error">${message(error)}</p><button class="secondary" onclick="location.reload()">重新載入</button></section>`});
