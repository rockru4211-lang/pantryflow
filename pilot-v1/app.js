import{session}from'./services/supabase.js';
import{signIn,signUpOwner,staffPinLogin,signOut,profile,createOwnerBusiness,createStore}from'./services/auth.js';
import{stores,countOverview,receiptOverview,uploadReceipts}from'./services/data.js';
import{layout}from'./components/layout.js';
import{loginPage,onboardingPage,storePickerPage}from'./pages/login.js';
import{homePage}from'./pages/home.js';
import{countPage}from'./pages/count.js';
import{receivingPage}from'./pages/receiving.js';
import{consignmentPage}from'./pages/consignment.js';
import{utilityPage}from'./pages/utility.js';

const root=document.querySelector('#app');
const state={session:null,profile:null,stores:[],store:null,page:'home'};
const build=window.PILOT_BUILD||{branch:'unknown',sha:'unknown'};
document.querySelector('#build-banner').textContent=`封閉 Pilot｜${build.branch}｜${String(build.sha).slice(0,7)}`;

function message(error){const raw=String(error?.message||'');if(/invalid login credentials/i.test(raw))return'Email 或密碼不正確。';if(/INVALID_STAFF|INVALID_LOGIN/i.test(raw))return'門市、員工識別或 PIN 不正確。';if(/PIN_LOCKED/i.test(raw))return'PIN 已鎖定 15 分鐘，請稍後再試或請主管重設。';if(/OWNER_EMAIL_NOT_VERIFIED/i.test(raw))return'請先完成 Email 驗證。';if(/STORE_ALREADY|23505/i.test(raw))return'門市代碼已存在或帳號已完成建立。';return'目前無法讀取正式資料，請確認網路後重試。'}
function bindError(form,work){form.addEventListener('submit',async event=>{event.preventDefault();const node=form.querySelector('[data-error]');node.textContent='';try{await work(new FormData(form))}catch(error){console.error(error);node.textContent=message(error)}})}

function renderLogin(){root.innerHTML=loginPage();document.querySelectorAll('[data-auth-tab]').forEach(button=>button.onclick=()=>{document.querySelector('#management-login').classList.toggle('hidden',button.dataset.authTab!=='management');document.querySelector('#staff-login').classList.toggle('hidden',button.dataset.authTab!=='staff');document.querySelectorAll('[data-auth-tab]').forEach(x=>x.classList.toggle('active',x===button))});document.querySelector('[data-owner-signup]').onclick=()=>{document.querySelector('#management-login').classList.add('hidden');document.querySelector('#owner-signup').classList.remove('hidden');document.querySelector('.tabs').classList.add('hidden')};document.querySelector('[data-back-login]').onclick=renderLogin;bindError(document.querySelector('#management-login'),async form=>{await signIn(form.get('email'),form.get('password'));await boot()});bindError(document.querySelector('#staff-login'),async form=>{const storeId=await staffPinLogin(form.get('storeCode'),form.get('identifier'),form.get('pin'));await boot(storeId)});bindError(document.querySelector('#owner-signup'),async form=>{await signUpOwner(form.get('displayName'),form.get('email'),form.get('password'));form.querySelector('[data-error]').textContent='驗證信已寄出；完成 Email 驗證後回到此頁建立商家。'})}
function renderOnboarding(){root.innerHTML=onboardingPage();bindError(document.querySelector('#owner-onboarding'),async form=>{await createOwnerBusiness(Object.fromEntries(form));await boot()})}
function renderStorePicker(){root.innerHTML=storePickerPage(state.stores);root.querySelectorAll('[data-store]').forEach(button=>button.onclick=()=>{state.store=state.stores.find(x=>x.id===button.dataset.store);renderPage('home')})}

async function renderPage(page){state.page=page;let content;if(page==='home')content=homePage();else if(page==='count')content=countPage(await countOverview(state.store.id));else if(page==='receiving')content=receivingPage(await receiptOverview(state.store.id));else if(page==='consignment')content=consignmentPage();else content=utilityPage(page,state.profile.is_owner||['ADMIN','SUPERVISOR'].includes(state.store.role));root.innerHTML=layout({storeName:state.store.name,role:state.profile.is_owner?'OWNER':state.store.role,page,content});document.querySelectorAll('[data-route]').forEach(button=>button.onclick=()=>renderPage(button.dataset.route));document.querySelectorAll('[data-feature]').forEach(button=>button.onclick=()=>renderPage(button.dataset.feature));document.querySelector('[data-sign-out]')?.addEventListener('click',async()=>{await signOut();renderLogin()});const storeForm=document.querySelector('#create-store');if(storeForm)bindError(storeForm,async form=>{await createStore(Object.fromEntries(form));state.stores=await stores(state.profile.id);await renderPage('profile')});const upload=document.querySelector('#receipt-upload');if(upload)bindError(upload,async form=>{const files=[...form.getAll('files')].filter(file=>file.size);await uploadReceipts(state.store,state.profile,files);await renderPage('receiving')})}

async function boot(preferredStoreId){state.session=await session();if(!state.session)return renderLogin();state.profile=await profile(state.session.user.id);if(!state.profile.organization_id)return renderOnboarding();state.stores=await stores(state.profile.id);if(!state.stores.length){root.innerHTML='<section class="center-card"><h1>尚未指派門市</h1><p class="muted">正式模式不會載入 seed 或 Demo，請由 Owner 指派門市 membership。</p></section>';return}state.store=state.stores.find(x=>x.id===preferredStoreId)||state.stores[0];if(state.stores.length>1&&!preferredStoreId)return renderStorePicker();await renderPage('home')}

boot().catch(error=>{console.error(error);root.innerHTML=`<section class="center-card"><h1>正式資料載入失敗</h1><p class="error">${message(error)}</p><button class="secondary" onclick="location.reload()">重新載入</button></section>`});
