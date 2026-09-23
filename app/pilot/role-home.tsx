'use client';
import {useEffect,useState,type ReactNode} from 'react';
import {Bell,CalendarClock,Trash2,Truck,ClipboardList,Users,Settings,Package,ChartNoAxesCombined,ArrowLeftRight,Ellipsis,MessagesSquare,ShieldCheck,Building2,Download,FileClock,TriangleAlert,Warehouse,Wrench,FileText,UtensilsCrossed,TrendingUp} from 'lucide-react';
import {useWorkFeed} from './work-feed';
import {localMonth} from '@/lib/app-workspace';
import {useUiState} from './workspace-memory';
import {supabase} from '@/lib/supabase-browser';
import {hasCrossStore,canManageBusiness,canViewReports,canExportData,type AppStore} from '@/lib/app-workspace';
import type {ShellView} from './app-shell';
import {displayTime} from './inventory-catalog';
export type Dashboard={reminder_priorities?:Record<string,string[]>;expiry_upcoming?:number;thaw_due?:number;count:{id:string;status:string;completed_at:string|null;paper_required:boolean;paper_completed_at:string|null}|null;count_items:number;count_completed:number;receipt_pending:number;receipt_issues:number;expiry_urgent:number;incidents:number;handover:number;erp_pending:number;receipt_erp_pending:number;month_receipt_amount:number|null;month_waste_amount:number|null;bulletins:{id:string;title:string;actor_name:string;created_at:string}[];shortages:{id:string;name:string;updated_at:string;remaining?:number;unit?:string;available?:number;total?:number}[]};
type DataIntegrity={day:string;generated_at:string;totals:{receipts:number;count_records:number;movements:number;waste:number;anomalies:number};stores:{id:string;name:string;receipts:number;count_records:number;movements:number;waste:number}[];anomalies:{type:string;store_name:string;title:string;detail:string;entity_id:string;created_at:string}[]};
const icons:Partial<Record<ShellView,typeof Bell>>={count:ClipboardList,receiving:Truck,procurement:ClipboardList,'receiving-issue':TriangleAlert,expiry:CalendarClock,waste:Trash2,handover:MessagesSquare,other:Ellipsis,bulletins:Bell,members:Users,catalog:Package,suppliers:Truck,reports:ChartNoAxesCombined,costs:ChartNoAxesCombined,preferences:Settings,permissions:ShieldCheck,business:Building2,exports:Download,audit:FileClock,incidents:TriangleAlert,transfers:ArrowLeftRight,stock:Warehouse};
export const viewTitles:Partial<Record<ShellView,string>>={stock:'分區與解凍',home:'首頁',procurement:'請購',activity:'作業紀錄',tasks:'待辦',notifications:'通知',settings:'設定',count:'盤點','receiving-inbox':'貨單收件箱',receiving:'進貨明細','receiving-issue':'進貨異常回報',expiry:'效期提醒',waste:'廢棄',handover:'交接',other:'其他作業',bulletins:'公佈欄',members:'夥伴與權限',catalog:'品項與編碼',suppliers:'供應商',reports:'報表中心',costs:'成本分析',preferences:'個人設定',permissions:'夥伴與權限',business:'夥伴與門市',exports:'資料匯出',audit:'操作稽核',incidents:'異常回報',transfers:'跨店調撥／借貸','company-tasks':'公司流程待辦'};
export function useDashboard(store:AppStore,stores:AppStore[]=[store]){
 const[data,setData]=useState<Record<string,Dashboard>>({});const[error,setError]=useState('');const[reload,setReload]=useState(0);
 const ids=stores.map(s=>s.id).sort().join(',');
 useEffect(()=>{let alive=true;async function run(){
  if(store.settings.count_cadence==='DAILY'&&['STAFF','SUPERVISOR'].includes(store.role)){const result=await supabase.rpc('ensure_pilot_daily_count',{p_store_id:store.id});if(result.error){if(alive)setError('每日盤點未能載入，請稍後重試。');return;}}
  const entries=await Promise.all(ids.split(',').map(async id=>{const{data,error}=await supabase.rpc('get_app_dashboard',{p_store_id:id});if(error)throw error;return[id,data as Dashboard] as const;}));
  if(alive){setData(Object.fromEntries(entries));setError('');}
 }void run().catch(()=>{if(alive)setError('無法讀取營運資料，請重新載入。');});
 const focus=()=>void run().catch(()=>{if(alive)setError('無法讀取營運資料，請重新載入。');});window.addEventListener('focus',focus);const timer=setInterval(focus,30000);return()=>{alive=false;clearInterval(timer);window.removeEventListener('focus',focus);};},[ids,store.id,store.role,store.business_type,store.settings.count_cadence,reload]);
 return{data,error,refresh:()=>setReload(v=>v+1)};
}
export default function RoleHome({store,stores,onNavigate,onStore,versionPanel,onCountRecords,onUrgentExpiry}:{onCountRecords?:()=>void;onUrgentExpiry?:()=>void;store:AppStore;stores:AppStore[];onNavigate:(v:ShellView)=>void;onStore:(id:string)=>void;versionPanel:ReactNode}){
 const work=useWorkFeed(store,localMonth());
 const management=store.role==='LOGISTICS'||store.role==='OWNER';
 const[integrity,setIntegrity]=useState<DataIntegrity|null>(null);
 const[integrityError,setIntegrityError]=useState('');
 useEffect(()=>{let alive=true;if(store.role!=='LOGISTICS')return;async function run(){const{data,error}=await supabase.rpc('get_baihuayuan_data_integrity',{p_store_id:store.id});if(!alive)return;if(error){setIntegrityError('資料完整性檢查暫時無法讀取。');return;}setIntegrity(data as unknown as DataIntegrity);setIntegrityError('');}void run();const timer=setInterval(()=>void run(),60000);return()=>{alive=false;clearInterval(timer);};},[store.id,store.role]);
 const dashboardStores=store.role==='LOGISTICS'?stores.filter(s=>s.is_active!==false):[store];
 const{data,error,refresh}=useDashboard(store,dashboardStores);const d=data[store.id];
 const adminDashboards=dashboardStores.map(s=>data[s.id]).filter(Boolean) as Dashboard[];
 const adminReceiptPending=adminDashboards.reduce((sum,item)=>sum+(item.receipt_pending||0),0);
 const adminCountDone=adminDashboards.reduce((sum,item)=>sum+(item.count_completed||0),0);
 const title=store.role==='OWNER'?'百花猿 營運整合':store.role==='LOGISTICS'?'百花猿 資料整合':store.role==='SUPERVISOR'?'今日現場作業':'歡迎回來';
 const subtitle=store.role==='OWNER'?'先測試盤點、進貨、跨店調撥／借貸與廢棄四項核心流程':store.role==='LOGISTICS'?'集中核對 BeApe、Gras 的四項核心營運資料':store.role==='SUPERVISOR'?'用手機確認現場作業與需要處理的事項':'用手機完成今天的盤點、進貨與廢棄';
 const totals=(key:'receipt_pending'|'receipt_issues'|'expiry_urgent'|'incidents'|'erp_pending'|'receipt_erp_pending'|'count_completed')=>d?.[key]??0;
 const amount=(key:'month_receipt_amount'|'month_waste_amount')=>{const value=d?.[key];return value!==null&&value!==undefined?`NT$ ${Number(value).toLocaleString()}`:'未提供';};
 const tile=(view:ShellView,label?:string)=>{if(['business','permissions','audit'].includes(view)&&!canManageBusiness(store))return null;if(view==='members'&&store.role!=='SUPERVISOR'&&!canManageBusiness(store))return null;const Icon=icons[view]||ClipboardList;return <button type="button" key={view} className="shell-icon-tile" onClick={()=>onNavigate(view)}><span><Icon className="ui-icon"/></span><strong>{label||viewTitles[view]}</strong></button>;};
 const row=(view:ShellView,label:string,count?:number,copy?:string,action?:()=>void)=><button type="button" className="shell-list-row" onClick={action||(()=>onNavigate(view))}><span><strong>{label}</strong>{copy&&<small>{copy}</small>}</span>{count!==undefined&&<b>{count} 項</b>}<b>›</b></button>;
 if(store.role==='LOGISTICS')return <div className="admin-office-home">
   <div className="admin-office-heading"><div><span>{new Date().toLocaleDateString('zh-TW')}</span><h1>今天的行政重點</h1><p>整理餐廳營運資料，需要處理時再進入各功能。</p></div></div>
   {error&&<p role="alert" className="pilot-message">{error}<button className="text-button" onClick={refresh}>重新載入</button></p>}
   {!adminDashboards.length&&!error?<p role="status">正在讀取門市資料…</p>:<>
     <section className={`admin-integrity-strip ${integrity?.totals.anomalies?'has-alert':'is-ok'}`}>
       <div><strong>今日資料收件</strong><span>{integrityError||(!integrity?'檢查中…':integrity.totals.anomalies>0?`發現 ${integrity.totals.anomalies} 項需要核對`:'目前未發現資料遺漏')}</span></div>
       {integrity&&<div className="admin-integrity-counts"><span>進貨 <b>{integrity.totals.receipts}</b></span><span>盤點 <b>{integrity.totals.count_records}</b></span><span>調撥／借貸 <b>{integrity.totals.movements}</b></span><span>廢棄 <b>{integrity.totals.waste}</b></span></div>}
       {integrity&&integrity.totals.anomalies>0&&<details><summary>查看資料異常</summary><div className="admin-integrity-anomalies">{integrity.anomalies.slice(0,8).map(a=><article key={`${a.type}:${a.entity_id}`}><strong>{a.store_name}・{a.title}</strong><small>{a.detail}</small></article>)}</div></details>}
     </section>
     <section className="admin-office-focus"><div className="shell-section-head"><h2>待處理重點</h2><small>BeApe・Gras</small></div><div className="admin-office-focus-grid">
       <button type="button" onClick={()=>onNavigate('receiving')}><span className="admin-office-icon"><Truck/></span><span><small>進貨待整理</small><strong>{adminReceiptPending}</strong></span><b>›</b></button>
       <button type="button" onClick={()=>onNavigate('transfers')}><span className="admin-office-icon warning"><ArrowLeftRight/></span><span><small>調撥待建檔</small><strong>查看</strong></span><b>›</b></button>
       <button type="button" onClick={()=>onNavigate('waste')}><span className="admin-office-icon danger"><Trash2/></span><span><small>廢棄待確認</small><strong>查看</strong></span><b>›</b></button>
       <button type="button" onClick={()=>onNavigate('count')}><span className="admin-office-icon blue"><ClipboardList/></span><span><small>本月抽盤</small><strong>{adminCountDone} 次</strong></span><b>›</b></button>
     </div></section>
     <section className="admin-office-actions"><div className="shell-section-head"><div><h2>行政作業入口</h2><small>進入後以目前門市資料為主，避免兩店資料混用。</small></div></div><div className="admin-office-action-grid">
       <button type="button" onClick={()=>onNavigate('receiving')}><Truck/><span><strong>進貨貨單</strong><small>整理與核對貨單資料</small></span><b>›</b></button>
       <button type="button" onClick={()=>onNavigate('transfers')}><ArrowLeftRight/><span><strong>調撥建檔</strong><small>核對數量、單位與進價</small></span><b>›</b></button>
       <button type="button" onClick={()=>onNavigate('waste')}><Trash2/><span><strong>廢棄</strong><small>確認廢棄紀錄與金額</small></span><b>›</b></button>
       <button type="button" onClick={()=>onNavigate('costs')}><UtensilsCrossed/><span><strong>配方表</strong><small>整理配方與成本資料</small></span><b>›</b></button>
       <button type="button" onClick={()=>onNavigate('reports')}><TrendingUp/><span><strong>進價波動</strong><small>查看食材價格變化</small></span><b>›</b></button>
       <button type="button" onClick={()=>onNavigate('incidents')}><Wrench/><span><strong>設備報修</strong><small>追蹤報修與處理進度</small></span><b>›</b></button>
       <button type="button" onClick={()=>onNavigate('company-tasks')}><FileText/><span><strong>合約管理</strong><small>整理合約與到期事項</small></span><b>›</b></button>
       <button type="button" onClick={()=>onNavigate('count')}><ClipboardList/><span><strong>每月抽盤</strong><small>建立抽盤表與查看結果</small></span><b>›</b></button>
     </div></section>
   </>}
   {versionPanel}
 </div>;
 return <><div className="role-home-title"><div><span>{new Date().toLocaleDateString('zh-TW')}</span><h1>{title}</h1><p>{subtitle}</p></div></div>{store.role==='OWNER'&&stores.length>1&&<section className="owner-store-choice"><div className="shell-section-head"><h2>選擇門市</h2><small>首頁直接切換，不另外進管理頁</small></div><div className="owner-store-tabs">{stores.filter(s=>s.is_active!==false).map(s=><button type="button" key={s.id} className={s.id===store.id?'active':''} onClick={()=>onStore(s.id)}><strong>{s.name}</strong><small>門市代號 {s.store_code}</small></button>)}</div></section>}{error&&<p role="alert" className="pilot-message">{error}<button className="text-button" onClick={refresh}>重新載入</button></p>}{work.error&&<p role="alert">待辦{work.error}<button className="text-button" onClick={work.refresh}>重試</button></p>}{!d&&!error?<p role="status">正在讀取門市資料…</p>:d&&<>
 {management&&<section className="shell-section"><div className="shell-section-head"><h2>百花猿 核心作業</h2><small>BeApe・Gras 共用資料</small></div><div className="shell-tile-grid">{tile('count','盤點')}{tile('receiving','進貨')}{hasCrossStore(store)&&tile('transfers','跨店調撥／借貸')}{tile('waste','廢棄')}</div></section>}{management&&<section className="shell-section"><h2>{store.role==='OWNER'?'營運摘要／重大異常':'今日待核對'}</h2><div className="shell-card shell-list">{row('receiving','收貨待核對',totals('receipt_pending'))}{row('expiry','即期風險',totals('expiry_urgent'),undefined,onUrgentExpiry)}{row('incidents','門市異常待處理',totals('incidents'))}{canViewReports(store)&&row('reports','盤點紀錄',totals('count_completed'),undefined,onCountRecords)}</div></section>}
 {!management&&<><section className="shell-section"><h2>現場作業</h2><div className="shell-tile-grid">{tile('count','盤點')}{tile('receiving','進貨上傳')}{hasCrossStore(store)&&tile('transfers','調撥／借貸')}{tile('waste','廢棄')}</div></section><section className="shell-section"><h2>需要處理</h2>{d.receipt_issues+d.expiry_urgent+d.incidents>0?<div className="shell-card shell-list">{d.receipt_issues>0&&row('receiving-issue','進貨異常',d.receipt_issues,'有問題時才處理')}{d.expiry_urgent>0&&row('expiry','即期風險',d.expiry_urgent,undefined,onUrgentExpiry)}{d.incidents>0&&row('incidents','其他異常',d.incidents)}</div>:<div className="shell-card completion-card"><strong>目前沒有待處理事項</strong><p>有異常時才會顯示在這裡。</p></div>}</section></>}
 {management&&<section className="shell-section"><h2>營運成果</h2><div className="shell-card result-list"><div><span>本月進貨總額</span><strong>{amount('month_receipt_amount')}</strong></div><div><span>本月食材成本</span><strong>未提供</strong></div>{store.role==='OWNER'&&<div><span>本月毛利率</span><strong>未提供</strong></div>}<div><span>本月盤點次數</span><strong>{totals('count_completed')} 次</strong></div><div><span>本月廢棄參考金額</span><strong>{amount('month_waste_amount')}</strong></div></div></section>}
 {store.role==='STAFF'&&<section className="shell-section"><h2>商家留言板</h2><div className="shell-card shell-list">{d.bulletins.length?d.bulletins.map(b=><button className="shell-list-row" key={b.id} onClick={()=>onNavigate('bulletins')}><span><strong>{b.title}</strong><small>{b.actor_name}・{displayTime(b.created_at)}</small></span><b>›</b></button>):row('bulletins','目前沒有新公告')}</div></section>}
 </>}{versionPanel}</>;
}
export function OtherWorkspace({store,onNavigate,onBack}:{store:AppStore;onNavigate:(view:ShellView)=>void;onBack:()=>void}){
 const views:ShellView[]=store.role==='STAFF'?['incidents','handover','bulletins']:store.role==='SUPERVISOR'?['incidents','handover','bulletins']:store.role==='LOGISTICS'?['count','receiving','expiry','waste','incidents','handover','reports','bulletins','preferences']:['count','receiving','expiry','waste','catalog','suppliers','costs','reports','incidents','handover','bulletins','preferences'];
 if(store.role!=='STAFF'){views.push('stock');if(hasCrossStore(store))views.push('transfers');}
 if(canManageBusiness(store)){for(const v of ['members','business','audit'] as ShellView[])if(!views.includes(v))views.push(v);}if(canViewReports(store)&&!views.includes('reports'))views.push('reports');if(canExportData(store)&&!views.includes('exports'))views.push('exports');
 return <><button className="shell-back" onClick={onBack}>‹ 返回首頁</button><h1>其他作業</h1><div className="shell-card shell-list">{views.map(v=>{const Icon=icons[v]||ClipboardList;return <button className="shell-list-row" key={v} onClick={()=>onNavigate(v)}><Icon/><span><strong>{viewTitles[v]}</strong></span><b>›</b></button>;})}</div></>;
}
export function ShortagesWorkspace({store,onNavigate,onBack,onProduct}:{store:AppStore;onNavigate:(view:ShellView)=>void;onBack:()=>void;onProduct?:(id:string)=>void}){
 const{data,error,refresh}=useDashboard(store);const[search,setSearch]=useUiState('shortage-search','');const rows=data[store.id]?.shortages;const visible=rows?.filter(r=>r.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
 return <><button className="shell-back" onClick={onBack}>‹ 返回首頁</button><h1>缺貨品項</h1><label className="field">搜尋品項<input type="search" value={search} onChange={e=>setSearch(e.target.value)}/></label>{error&&<p role="alert">{error}<button onClick={refresh}>重新載入</button></p>}<div className="shell-card shell-list">{visible?.map(r=><div key={r.id}><button className="shell-list-row" onClick={()=>onNavigate(hasCrossStore(store)?'transfers':'receiving')}><span><strong>{r.name}</strong><small>尚缺 {r.remaining??'未提供'} {r.unit}・可用 {r.available??'未提供'} {r.unit}</small><small>安全庫存設定 {r.remaining!==undefined&&r.available!==undefined?Number(r.remaining)+Number(r.available):'未提供'} {r.unit}</small></span><b>›</b></button>{onProduct&&<button className="text-button" onClick={()=>onProduct(r.id)}>調整安全庫存</button>}</div>)}</div>{rows&&!visible?.length&&<p>{rows.length?'沒有符合搜尋的品項。':'目前沒有已確認的缺貨提醒。'}</p>}</>;
}
