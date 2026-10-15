'use client';
import {type RepairData} from '@/lib/equipment-workflow';
import {useEffect,useState} from 'react';
import {supabase} from '@/lib/supabase-browser';
import {officeAccess,viewAccess} from '@/lib/data-access';
import {appError,type AppStore} from '@/lib/app-workspace';
import {operationDeadline} from '@/lib/operation-deadline';
import type {PriceSheetData} from '@/lib/ingredient-price-sheet';
import type {AdministrativeRow} from '@/lib/administrative-directory';
import type {PurchaseNote} from '@/lib/purchase-notes';
import {overviewTasks,pendingOverviewReceipts,overviewPriceRises,overviewContracts,prioritizeOverviewRows,OVERVIEW_LIMIT} from '@/lib/operations-overview';
import type {OperationalRecord} from './records-workspace';
import type {ShellView} from './app-shell';
import './operations-overview.css';
const categories=[{id:'receipts',label:'進貨建檔',title:'待建檔／核對貨單',view:'receiving-inbox',link:'前往貨單管理',columns:['供應商／貨單','門市','日期','狀態']},{id:'prices',label:'價格上漲',title:'食材價格上漲',view:'ingredient-prices',link:'前往食材價格表',columns:['食材','門市','原價 → 新價','漲幅']},{id:'equipment',label:'待辦事項',title:'待辦事項',view:'equipment',link:'前往設備維修',columns:['類型','事項','門市','預計日期','目前狀態']},{id:'contracts',label:'合約到期',title:'合約到期提醒',view:'contracts',link:'前往合約管理',columns:['合約','門市','到期日','提醒']}] as const;
type Category=typeof categories[number]['id'];
type Row={id:string;name:string;storeId:string;storeName:string;detail:string;status:string;view:ShellView;priority?:number;order?:string;taskKind?:'repair'|'purchase'};
type Result={storeId:string;category:Category;rows:Row[];error?:string};
const money=(n:number)=>`$${n.toLocaleString('zh-TW',{maximumFractionDigits:4})}`;
export default function OperationsOverview({store,stores,onOpen}:{store:AppStore;stores:AppStore[];onOpen:(storeId:string,view:ShellView,receiptBatchId?:string)=>void}){
 const [filter,setFilter]=useState('all'),[active,setActive]=useState<Category>('receipts'),[revision,setRevision]=useState(0);
 const [expandedScope,setExpandedScope]=useState('');
 const [taskFilter,setTaskFilter]=useState<'all'|'repair'|'purchase'>('all');
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
      rows=pendingOverviewReceipts(inbox,flags).map(r=>({...row(r.batch_id,r.supplier_name||r.batch_number,r.receipt_date||r.work_date,r.state==='PROCESSING'?'辨識中':r.state==='OCR_FAILED'?'可人工建檔':r.state==='FILE_MISSING'?'原圖待補':'待建檔／核對'),priority:r.state==='OCR_FAILED'||r.state==='FILE_MISSING'?0:r.state==='PROCESSING'?2:1,order:r.receipt_date||r.work_date}));
     }else if(c.id==='prices'){
      const data=await rpc('baihuayuan_ingredient_prices',{p_store_id:s.id,p_action:'read'}) as PriceSheetData;
      if(!Array.isArray(data?.ingredients)||!Array.isArray(data?.supply_states))throw Error('資料格式不符');
      rows=overviewPriceRises(data).map(r=>({...row(r.id,r.name,`${money(r.old)} → ${money(r.next)}／${r.unit}`,`+${r.percent.toFixed(1)}%`),priority:-r.percent}));
     }else if(c.id==='contracts'){
      const data=await rpc('app_workspace',{p_store_id:s.id,p_section:'administrative',p_filter:{}}) as {rows:AdministrativeRow[]};
      if(!Array.isArray(data?.rows))throw Error('資料格式不符');
      rows=overviewContracts(data.rows).map(r=>({...row(r.id,r.name,r.contract_end!,r.days<0?`已到期 ${-r.days} 天`:r.days===0?'今日到期':`剩 ${r.days} 天`),order:r.contract_end!}));
     }else{
      const sources=await Promise.allSettled([
       rpc('equipment_workflow',{p_store_id:s.id,p_action:'list'}).then(data=>{const r=data as RepairData;if(!Array.isArray(r?.jobs))throw Error('資料格式不符');return overviewTasks(r.jobs,[]);}),
       rpc('app_operation',{p_store_id:s.id,p_action:'purchase.notes',p_data:{operation:'list'},p_request_id:crypto.randomUUID()}).then(data=>{const r=data as {rows:PurchaseNote[]};if(!Array.isArray(r?.rows))throw Error('資料格式不符');return overviewTasks([],r.rows);}),
       rpc('app_workspace',{p_store_id:s.id,p_section:'incidents',p_filter:{}}).then(data=>{const r=data as {records:OperationalRecord[]};if(!Array.isArray(r?.records))throw Error('資料格式不符');return overviewTasks([],[],r.records);})
      ]);
      rows=sources.flatMap(result=>result.status==='fulfilled'?result.value.map(r=>({...r,storeId:s.id,storeName:s.name})):[]);
      const failures=sources.flatMap((result,i)=>result.status==='rejected'?[`${['維修','待購','設備回報'][i]}：${appError(result.reason)}`]:[]);
      return {storeId:s.id,category:c.id,rows,...(failures.length?{error:`${s.name}：${failures.join('；')}`}:{})};
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
 const allRows=selected?.flatMap(r=>r.rows)||[];
 const rows=prioritizeOverviewRows(allRows.filter(r=>category?.id!=='equipment'||taskFilter==='all'||r.taskKind===taskFilter));
 const expansionKey=JSON.stringify([scope,filter,category?.id,taskFilter]);
 const expanded=expandedScope===expansionKey;
 const visibleRows=expanded?rows:rows.slice(0,OVERVIEW_LIMIT);
 const errors=selected?.filter(r=>r.error)||[];
 if(!category)return <p>目前沒有可查看的營運資料。</p>;
 const targets=allowed.filter(s=>(filter==='all'||s.id===filter)&&viewAccess(s,category.view));
 return <section className="ops-overview"><header className="ops-heading"><h1>營運總覽</h1><div className="ops-stores" aria-label="總覽門市篩選"><button aria-pressed={filter==='all'} onClick={()=>{setFilter('all');setExpandedScope('');}}>全部門市</button>{allowed.map(s=><button key={s.id} aria-pressed={filter===s.id} onClick={()=>{setFilter(s.id);setExpandedScope('');}}>{s.name}</button>)}</div></header>
 <div className="ops-layout"><nav className="ops-categories" aria-label="營運總覽分類">{available.map(c=>{const data=results?.filter(r=>r.category===c.id&&(filter==='all'||r.storeId===filter));return <button key={c.id} aria-pressed={category.id===c.id} onClick={()=>{setActive(c.id);setExpandedScope('');}}><span>{c.label}</span><small>{!data?'…':data.some(r=>r.error)?'—':data.reduce((n,r)=>n+r.rows.length,0)}</small></button>;})}</nav>
 <div className="ops-content"><header><div><h2>{category.title}</h2><p className="ops-priority-note">{category.id==='prices'?'漲幅較高優先':category.id==='contracts'?'已到期、即將到期優先':category.id==='equipment'?'維修、待購進度，一起追蹤；逾期事項優先':'異常、久未建檔優先'}</p></div>{category.id!=='equipment'&&targets.length===1&&<button className="text-button" onClick={()=>onOpen(targets[0].id,category.view)}>{category.link} ›</button>}</header>
 {category.id==='equipment'&&<nav className="ops-task-filters" aria-label="待辦類型">{([['all','全部'],['repair','維修'],['purchase','待購']] as const).map(([value,label])=><button key={value} aria-pressed={taskFilter===value} onClick={()=>{setTaskFilter(value);setExpandedScope('');}}>{label}<span>{!results?'…':allRows.filter(r=>value==='all'||r.taskKind===value).length}</span></button>)}</nav>}
 {!!errors.length&&<div role="alert" className="ops-message">{errors.map(e=><p key={e.storeId}>{e.error}</p>)}<button onClick={()=>setRevision(v=>v+1)}>重新讀取</button></div>}
 <div id="ops-priority-list" className={`ops-table-wrap${expanded?' ops-expanded':''}`}><table><thead><tr>{category.columns.map(c=><th key={c}>{c}</th>)}<th><span className="ops-sr">操作</span></th></tr></thead><tbody>{visibleRows.map(r=><tr key={`${r.storeId}:${r.id}`}>{category.id==='equipment'&&<td><span className={`ops-task-kind ${r.taskKind}`}>{r.taskKind==='purchase'?'待購':'維修'}</span></td>}<td>{r.name}</td><td>{r.storeName}</td><td>{r.detail}</td><td className={category.id==='prices'?'ops-rise':''}>{r.status}</td><td><button className="ops-open" aria-label={`${r.storeName} ${r.name}，${category.id==='equipment'?(r.taskKind==='purchase'?'前往待購事項':'前往維修處理'):category.link}`} onClick={()=>onOpen(r.storeId,r.view,category.id==='receipts'?r.id:undefined)}>前往 ›</button></td></tr>)}</tbody></table></div>
 {rows.length>OVERVIEW_LIMIT&&<button className="ops-more" aria-expanded={expanded} aria-controls="ops-priority-list" onClick={()=>setExpandedScope(expanded?'':expansionKey)}>{expanded?'收合・只顯示前 5 筆':`⋯ 還有 ${rows.length-OVERVIEW_LIMIT} 筆・查看全部`}</button>}
 {!results?<p role="status" className="ops-empty">正在讀取營運資料…</p>:!rows.length&&!errors.length?<p className="ops-empty">{category.id==='equipment'?'目前沒有符合的未完成事項。':'目前沒有待處理事項。'}</p>:null}
 <footer>{category.id==='prices'?'與食材價格表共用已確認新價；鎖定食譜成本不會自動更動。':category.id==='contracts'?'到期前 3 個月提醒，含已到期且尚未封存的合約。':category.id==='equipment'?'已完成、已到貨與已取消事項不列入，紀錄保留於原功能。':'已建檔／核對完成、已移除與測試貨單不列入。'}<button className="text-button" onClick={()=>setRevision(v=>v+1)}>重新讀取</button></footer>
 </div></div></section>;
}
