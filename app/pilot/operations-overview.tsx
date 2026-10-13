'use client';
import {repairStates,type RepairData} from '@/lib/equipment-workflow';
import {useEffect,useState} from 'react';
import {supabase} from '@/lib/supabase-browser';
import {officeAccess,viewAccess} from '@/lib/data-access';
import {appError,type AppStore} from '@/lib/app-workspace';
import {operationDeadline} from '@/lib/operation-deadline';
import type {PriceSheetData} from '@/lib/ingredient-price-sheet';
import type {AdministrativeRow} from '@/lib/administrative-directory';
import {pendingOverviewReceipts,overviewPriceRises,overviewContracts} from '@/lib/operations-overview';
import type {OperationalRecord} from './records-workspace';
import type {ShellView} from './app-shell';
import './operations-overview.css';
const categories=[{id:'receipts',label:'進貨建檔',title:'待建檔／核對貨單',view:'receiving-inbox',link:'前往貨單管理',columns:['供應商／貨單','門市','日期','狀態']},{id:'prices',label:'價格上漲',title:'食材價格上漲',view:'ingredient-prices',link:'前往食材價格表',columns:['食材','門市','原價 → 新價','漲幅']},{id:'equipment',label:'設備維修',title:'設備維修與回報',view:'equipment',link:'前往設備維修',columns:['設備／回報','門市','日期','最新進度']},{id:'contracts',label:'合約到期',title:'合約到期提醒',view:'contracts',link:'前往合約管理',columns:['合約','門市','到期日','提醒']}] as const;
type Category=typeof categories[number]['id'];
type Row={id:string;name:string;storeId:string;storeName:string;detail:string;status:string;view:ShellView};
type Result={storeId:string;category:Category;rows:Row[];error?:string};
const money=(n:number)=>`$${n.toLocaleString('zh-TW',{maximumFractionDigits:4})}`;
export default function OperationsOverview({store,stores,onOpen}:{store:AppStore;stores:AppStore[];onOpen:(storeId:string,view:ShellView)=>void}){
 const [filter,setFilter]=useState('all'),[active,setActive]=useState<Category>('receipts'),[revision,setRevision]=useState(0);
 const [snapshot,setSnapshot]=useState<{scope:string;results:Result[]}>();
 const allowed=stores.filter(s=>s.is_active!==false&&s.organization_id===store.organization_id&&officeAccess(s));
 const scope=JSON.stringify(allowed.map(s=>[s.id,s.role,s.access_mode,s.work_functions,s.data_access]));
 useEffect(()=>{let alive=true,running=false;const controller=new AbortController();
  async function run(){if(running)return;running=true;
   const results=await Promise.all(allowed.flatMap(s=>categories.filter(c=>viewAccess(s,c.view)).map(async c=>{
    const row=(id:string,name:string,detail:string,status:string,view:ShellView=c.view):Row=>({id,name,detail,status,view,storeId:s.id,storeName:s.name});
    try{
     const rpc=async(name:string,args:Record<string,unknown>)=>operationDeadline(async signal=>{const r=await supabase.rpc(name as never,args as never).abortSignal(signal);if(r.error)throw r.error;return r.data as unknown;});
     let rows:Row[]=[];
     if(c.id==='receipts'){
      const [inbox,flags]=await Promise.all([rpc('get_baihuayuan_receipt_inbox',{p_store_id:s.id}),rpc('get_baihuayuan_record_flags',{p_store_id:s.id,p_entity_type:'RECEIPT_BATCH'})]);
      if(!Array.isArray(inbox)||!Array.isArray(flags))throw Error('資料格式不符');
      rows=pendingOverviewReceipts(inbox,flags).map(r=>row(r.batch_id,r.supplier_name||r.batch_number,r.receipt_date||r.work_date,r.state==='PROCESSING'?'辨識中':r.state==='OCR_FAILED'?'可人工建檔':r.state==='FILE_MISSING'?'原圖待補':'待建檔／核對'));
     }else if(c.id==='prices'){
      const data=await rpc('baihuayuan_ingredient_prices',{p_store_id:s.id,p_action:'read'}) as PriceSheetData;
      if(!Array.isArray(data?.ingredients)||!Array.isArray(data?.supply_states))throw Error('資料格式不符');
      rows=overviewPriceRises(data).map(r=>row(r.id,r.name,`${money(r.old)} → ${money(r.next)}／${r.unit}`,`+${r.percent.toFixed(1)}%`));
     }else if(c.id==='contracts'){
      const data=await rpc('app_workspace',{p_store_id:s.id,p_section:'administrative',p_filter:{}}) as {rows:AdministrativeRow[]};
      if(!Array.isArray(data?.rows))throw Error('資料格式不符');
      rows=overviewContracts(data.rows).map(r=>row(r.id,r.name,r.contract_end!,r.days<0?`已到期 ${-r.days} 天`:r.days===0?'今日到期':`剩 ${r.days} 天`));
     }else{
      const [equipment,activity,repairs]=await Promise.all([rpc('app_workspace',{p_store_id:s.id,p_section:'equipment',p_filter:{}}),rpc('app_workspace',{p_store_id:s.id,p_section:'incidents',p_filter:{}}),rpc('equipment_workflow',{p_store_id:s.id,p_action:'list'})]) as [{rows:AdministrativeRow[]},{records:OperationalRecord[]},RepairData];
      if(!Array.isArray(equipment?.rows)||!Array.isArray(activity?.records))throw Error('資料格式不符');
      rows=[...repairs.jobs.map(j=>row(j.id,j.name,j.report_date||j.created_at.slice(0,10),repairStates[j.status]+(j.last_report?`・${j.last_report}`:''))),...activity.records.filter(r=>r.category==='設備'&&r.status!=='COMPLETE').map(r=>row(r.id,r.title,r.created_at.slice(0,10),r.status==='IN_PROGRESS'?'處理中':'待處理','incidents')),...equipment.rows.filter(r=>!r.archived&&r.category==='維修紀錄').sort((a,b)=>(b.repair_date||'').localeCompare(a.repair_date||'')).map(r=>row(r.id,r.name,r.repair_date||'日期未填',r.repair_result||'尚未填寫處理結果'))];
     }
     return {storeId:s.id,category:c.id,rows};
    }catch(e){return {storeId:s.id,category:c.id,rows:[],error:`${s.name}：${appError(e)}`};}
   })));
   if(alive&&!controller.signal.aborted)setSnapshot({scope,results});running=false;
  }
  void run();const focus=()=>{if(document.visibilityState==='visible')void run();};window.addEventListener('focus',focus);const timer=setInterval(focus,60000);
  return()=>{alive=false;controller.abort();clearInterval(timer);window.removeEventListener('focus',focus);};
 // Scope includes every permission and store identifier used by the read.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[scope,revision]);
 const available=categories.filter(c=>allowed.some(s=>viewAccess(s,c.view)));
 const category=available.find(c=>c.id===active)||available[0];
 const results=snapshot?.scope===scope?snapshot.results:undefined;
 const selected=results?.filter(r=>(filter==='all'||r.storeId===filter)&&r.category===category?.id);
 const rows=selected?.flatMap(r=>r.rows)||[];const errors=selected?.filter(r=>r.error)||[];
 if(!category)return <p>目前沒有可查看的營運資料。</p>;
 const targets=allowed.filter(s=>(filter==='all'||s.id===filter)&&viewAccess(s,category.view));
 return <section className="ops-overview"><header className="ops-heading"><h1>營運總覽</h1><div className="ops-stores" aria-label="總覽門市篩選"><button aria-pressed={filter==='all'} onClick={()=>setFilter('all')}>全部門市</button>{allowed.map(s=><button key={s.id} aria-pressed={filter===s.id} onClick={()=>setFilter(s.id)}>{s.name}</button>)}</div></header>
 <div className="ops-layout"><nav className="ops-categories" aria-label="營運總覽分類">{available.map(c=>{const data=results?.filter(r=>r.category===c.id&&(filter==='all'||r.storeId===filter));return <button key={c.id} aria-pressed={category.id===c.id} onClick={()=>setActive(c.id)}><span>{c.label}</span><small>{!data?'…':data.some(r=>r.error)?'—':data.reduce((n,r)=>n+r.rows.length,0)}</small></button>;})}</nav>
 <div className="ops-content"><header><h2>{category.title}</h2>{targets.length===1&&<button className="text-button" onClick={()=>onOpen(targets[0].id,category.view)}>{category.link} ›</button>}</header>
 {!!errors.length&&<div role="alert" className="ops-message">{errors.map(e=><p key={e.storeId}>{e.error}</p>)}<button onClick={()=>setRevision(v=>v+1)}>重新讀取</button></div>}
 <div className="ops-table-wrap"><table><thead><tr>{category.columns.map(c=><th key={c}>{c}</th>)}<th><span className="ops-sr">操作</span></th></tr></thead><tbody>{rows.map(r=><tr key={`${r.storeId}:${r.id}`}><td>{r.name}</td><td>{r.storeName}</td><td>{r.detail}</td><td className={category.id==='prices'?'ops-rise':''}>{r.status}</td><td><button className="ops-open" aria-label={`${r.storeName} ${r.name}，${category.link}`} onClick={()=>onOpen(r.storeId,r.view)}>前往 ›</button></td></tr>)}</tbody></table></div>
 {!results?<p role="status" className="ops-empty">正在讀取營運資料…</p>:!rows.length&&!errors.length?<p className="ops-empty">{category.id==='equipment'?'目前沒有設備回報或維修紀錄。':'目前沒有待處理事項。'}</p>:null}
 <footer>{category.id==='prices'?'與食材價格表共用已確認新價；鎖定食譜成本不會自動更動。':category.id==='contracts'?'到期前 3 個月提醒，含已到期且尚未封存的合約。':category.id==='equipment'?'顯示未完成設備回報與已登記的維修結果。':'已建檔／核對完成、已移除與測試貨單不列入。'}<button className="text-button" onClick={()=>setRevision(v=>v+1)}>重新讀取</button></footer>
 </div></div></section>;
}
