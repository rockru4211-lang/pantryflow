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
import type {RecipePurchase} from '@/lib/recipe-model';
import {formatPurchaseSpecification} from '@/lib/purchase-specification';
import type {SpotCheck,SpotList} from '@/lib/spot-checks';
import {overviewTasks,overviewSpotDifferences,overviewPriceRises,overviewContracts,prioritizeOverviewRows,OVERVIEW_LIMIT} from '@/lib/operations-overview';
import type {OperationalRecord} from './records-workspace';
import type {ShellView} from './app-shell';
import './operations-overview.css';
const categories=[
 {id:'prices',label:'價格上漲',title:'食材價格上漲',view:'ingredient-prices',link:'前往食材價格表',columns:['食材','門市','原進價 → 新進價','進價漲幅'],
  priorityNote:'漲幅較高優先',footer:'進價依採購單位顯示，漲幅僅比對相同規格。'},
 {id:'equipment',label:'待辦事項',title:'待辦事項',view:'equipment',link:'前往設備維修',columns:['類型','事項','門市','預計日期','目前狀態'],
  priorityNote:'逾期事項優先',footer:'已完成、已到貨與已取消事項不列入，紀錄保留於原功能。'},
 {id:'contracts',label:'合約到期',title:'合約到期提醒',view:'contracts',link:'前往合約管理',columns:['合約','門市','到期日','提醒'],
  priorityNote:'已到期、即將到期優先',footer:'到期前 3 個月提醒，含已到期且尚未封存的合約。'},
 {id:'counts',label:'盤點待追蹤',title:'盤點待追蹤',view:'count',link:'前往盤點',columns:['事項／品項','門市','開始日期／差異量','目前狀態'],
  priorityNote:'抽盤差異待補原因優先',footer:'顯示進行中的盤點與尚待補原因的抽盤差異。'},
] as const;
const taskFilters=[['all','全部'],['repair','維修'],['purchase','待購']] as const;
const taskActions={repair:'前往維修處理',purchase:'前往待購事項'};
type OverviewCategory=typeof categories[number];
type Category=OverviewCategory['id'];
const canReadCategory=(store:AppStore,category:OverviewCategory)=>(category.id!=='counts'||store.access_mode!=='VIEW')&&viewAccess(store,category.view);
type Row={id:string;name:string;storeId:string;storeName:string;detail:string;status:string;view:ShellView;priority?:number;order?:string;taskKind?:keyof typeof taskActions;recordId?:string};
type Result={storeId:string;category:Category;rows:Row[];error?:string};
function purchaseLabel(purchase:RecipePurchase|null){
 if(!purchase)return '未留存';
 const amount=purchase.amount.toLocaleString('zh-TW',{maximumFractionDigits:4});
 const quantity=purchase.quantity===1?'':String(purchase.quantity);
 const content=formatPurchaseSpecification(purchase.content_quantity,purchase.content_unit);
 return `$${amount}／${quantity}${purchase.unit}${content?`（${content}）`:''}`;
}
export default function OperationsOverview({store,stores,onOpen}:{store:AppStore;stores:AppStore[];onOpen:(storeId:string,view:ShellView,recordId?:string)=>void}){
 const [allStores,setAllStores]=useState(false),[active,setActive]=useState<Category>(categories[0].id),[revision,setRevision]=useState(0);
 const [expandedScope,setExpandedScope]=useState('');
 const [taskFilter,setTaskFilter]=useState<typeof taskFilters[number][0]>('all');
 const [snapshot,setSnapshot]=useState<{scope:string;results:Result[]}>();
 const permitted=stores.filter(s=>s.is_active!==false&&s.organization_id===store.organization_id&&officeAccess(s));
 const allowed=allStores?permitted:permitted.filter(s=>s.id===store.id);
 const filter=allStores?'all':store.id;
 const scope=JSON.stringify(allowed.map(s=>[s.id,s.role,s.access_mode,s.work_functions,s.data_access]));
 useEffect(()=>{let alive=true,running=false;const controller=new AbortController();
  async function run(){if(running)return;running=true;
   const month=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Taipei'}).slice(0,7);
   const readCategory=async(s:AppStore,c:OverviewCategory):Promise<Result>=>{
    const row=(id:string,name:string,detail:string,status:string,view:ShellView=c.view):Row=>({id,name,detail,status,view,storeId:s.id,storeName:s.name});
    try{
     const rpc=async(name:string,args:Record<string,unknown>)=>operationDeadline(async signal=>{const r=await supabase.rpc(name as never,args as never).abortSignal(signal);if(r.error)throw r.error;return r.data as unknown;});
     let rows:Row[]=[];
     if(c.id==='prices'){
      const data=await rpc('baihuayuan_ingredient_prices',{p_store_id:s.id,p_action:'read'}) as PriceSheetData;
      if(!Array.isArray(data?.ingredients)||!Array.isArray(data?.supply_states))throw Error('資料格式不符');
      rows=overviewPriceRises(data).map(r=>({...row(r.id,r.name,`${purchaseLabel(r.previous)} → ${purchaseLabel(r.current)}`,r.purchasePercent===null?r.purchaseStatus:`+${r.purchasePercent.toFixed(1)}%`),priority:-(r.purchasePercent??0)}));
     }else if(c.id==='contracts'){
      const data=await rpc('app_workspace',{p_store_id:s.id,p_section:'administrative',p_filter:{}}) as {rows:AdministrativeRow[]};
      if(!Array.isArray(data?.rows))throw Error('資料格式不符');
      rows=overviewContracts(data.rows).map(r=>({...row(r.id,r.name,r.contract_end!,r.days<0?`已到期 ${-r.days} 天`:r.days===0?'今日到期':`剩 ${r.days} 天`),order:r.contract_end!}));
     }else if(c.id==='counts'){
      const pendingCount=operationDeadline(async signal=>{
       const {data,error}=await supabase.from('inventory_count_sessions').select('id,status,started_at')
        .eq('store_id',s.id).in('status',['DRAFT','IN_PROGRESS']).order('started_at',{ascending:false}).limit(1).abortSignal(signal);
       if(error)throw error;
       return (data||[]).filter(count=>count.status==='IN_PROGRESS').map(count=>({...row(count.id,'盤點未送出',new Date(count.started_at).toLocaleDateString('sv-SE',{timeZone:'Asia/Taipei'}),'進行中'),priority:1,order:count.started_at}));
      });
      const spotDifferences=viewAccess(s,'spot-check')?rpc('baihuayuan_spot_check',{p_store_id:s.id,p_action:'list',p_data:{month,pending:true}}).then(async data=>{
       const list=data as SpotList;
       if(!Array.isArray(list?.checks))throw Error('資料格式不符');
       const checks=list.checks.filter(check=>check.store_id===s.id&&(check.status==='OPEN'||check.status==='REVIEWING'&&check.pending_review>0));
       const rows:Row[]=[];
       let error='';
       for(let start=0;start<checks.length&&alive;start+=4){
        const details=await Promise.allSettled(checks.slice(start,start+4).map(async check=>{
         const detail=await rpc('baihuayuan_spot_check',{p_store_id:s.id,p_action:'detail',p_data:{id:check.id}}) as SpotCheck;
         if(detail?.id!==check.id||detail.store_id!==s.id||!Array.isArray(detail.items))throw Error('資料格式不符');
         return overviewSpotDifferences(detail);
        }));
        for(const detail of details){
         if(detail.status==='fulfilled')rows.push(...detail.value.map(r=>({...r,storeId:s.id,storeName:s.name})));
         else error=appError(detail.reason);
        }
       }
       return {rows,error};
      }):Promise.resolve({rows:[],error:''});
      const [count,spots]=await Promise.allSettled([pendingCount,spotDifferences]);
      rows=[...(count.status==='fulfilled'?count.value:[]),...(spots.status==='fulfilled'?spots.value.rows:[])];
      const spotError=spots.status==='fulfilled'?spots.value.error:appError(spots.reason);
      const failures=[count.status==='rejected'?`盤點：${appError(count.reason)}`:'',spotError?`抽盤：${spotError}`:''].filter(Boolean);
      return {storeId:s.id,category:c.id,rows,...(failures.length?{error:`${s.name}：${failures.join('；')}`}:{})};
     }else{
      const sources=await Promise.allSettled([
       rpc('equipment_workflow',{p_store_id:s.id,p_action:'list'}).then(data=>{const r=data as RepairData;if(!Array.isArray(r?.jobs))throw Error('資料格式不符');return overviewTasks(r.jobs,[]);}),
       rpc('app_operation',{p_store_id:s.id,p_action:'purchase.notes',p_data:{operation:'list'},p_request_id:crypto.randomUUID()}).then(data=>{const r=data as {rows:PurchaseNote[]};if(!Array.isArray(r?.rows))throw Error('資料格式不符');return overviewTasks([],r.rows);}),
       rpc('app_workspace',{p_store_id:s.id,p_section:'incidents',p_filter:{}}).then(data=>{const r=data as {records:OperationalRecord[]};if(!Array.isArray(r?.records))throw Error('資料格式不符');return overviewTasks([],[],r.records);}),

      ]);
      rows=sources.flatMap(result=>result.status==='fulfilled'?result.value.map(r=>({...r,storeId:s.id,storeName:s.name})):[]);
      const failures=sources.flatMap((result,i)=>result.status==='rejected'?[`${['維修','待購','設備回報'][i]}：${appError(result.reason)}`]:[]);
      return {storeId:s.id,category:c.id,rows,...(failures.length?{error:`${s.name}：${failures.join('；')}`}:{})};
     }
     return {storeId:s.id,category:c.id,rows};
    }catch(e){return {storeId:s.id,category:c.id,rows:[],error:`${s.name}：${appError(e)}`};}
   };
   await Promise.all(allowed.flatMap(s=>categories.filter(c=>canReadCategory(s,c)).map(async c=>{
    const result=await readCategory(s,c);
    if(alive&&!controller.signal.aborted)setSnapshot(previous=>{
     const current=previous?.scope===scope?previous.results:[];
     return {scope,results:[...current.filter(r=>r.storeId!==result.storeId||r.category!==result.category),result]};
    });
   })));
   running=false;
  }
  void run();const focus=()=>{if(document.visibilityState==='visible')void run();};window.addEventListener('focus',focus);const timer=setInterval(focus,60000);
  return()=>{alive=false;controller.abort();clearInterval(timer);window.removeEventListener('focus',focus);};
 // Scope includes every permission and store identifier used by the read.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[scope,revision]);
 const available=categories.filter(c=>allowed.some(s=>canReadCategory(s,c)));
 const category=available.find(c=>c.id===active)||available[0];
 const results=snapshot?.scope===scope?snapshot.results:undefined;
 const selected=results?.filter(r=>(filter==='all'||r.storeId===filter)&&r.category===category?.id);
 const targets=category?allowed.filter(s=>canReadCategory(s,category)):[];
 const loaded=selected?.length===targets.length;
 const allRows=selected?.flatMap(r=>r.rows)||[];
 const rows=prioritizeOverviewRows(allRows.filter(r=>category?.id!=='equipment'||taskFilter==='all'||r.taskKind===taskFilter));
 const expansionKey=JSON.stringify([scope,filter,category?.id,taskFilter]);
 const expanded=expandedScope===expansionKey;
 const visibleRows=expanded?rows:rows.slice(0,OVERVIEW_LIMIT);
 const errors=selected?.filter(r=>r.error)||[];
 if(!category)return <p>目前沒有可查看的營運資料。</p>;
 return <section className="ops-overview"><header className="ops-heading"><div><h1>營運總覽</h1><p className="ops-priority-note">{allStores?'全部門市總覽':store.name}</p></div>{permitted.length>1&&<div className="ops-stores"><button type="button" aria-pressed={allStores} onClick={()=>{setAllStores(value=>!value);setExpandedScope('');}}>{allStores?`返回 ${store.name}`:'查看全部門市'}</button></div>}</header>
 <div className="ops-layout"><nav className="ops-categories" aria-label="營運總覽分類">{available.map(c=>{const data=results?.filter(r=>r.category===c.id&&(filter==='all'||r.storeId===filter));const complete=data?.length===allowed.filter(s=>canReadCategory(s,c)).length;return <button key={c.id} aria-pressed={category.id===c.id} onClick={()=>{setActive(c.id);setExpandedScope('');}}><span>{c.label}</span><small>{!data||!complete?'…':data.some(r=>r.error)?'—':data.reduce((n,r)=>n+r.rows.length,0)}</small></button>;})}</nav>
 <div className="ops-content"><header><div><h2>{category.title}</h2><p className="ops-priority-note">{category.priorityNote}</p></div>{category.id!=='equipment'&&targets.length===1&&<button className="text-button" onClick={()=>onOpen(targets[0].id,category.view)}>{category.link} ›</button>}</header>
 {category.id==='equipment'&&<nav className="ops-task-filters" aria-label="待辦類型">{taskFilters.map(([value,label])=><button key={value} aria-pressed={taskFilter===value} onClick={()=>{setTaskFilter(value);setExpandedScope('');}}>{label}<span>{!loaded?'…':allRows.filter(r=>value==='all'||r.taskKind===value).length}</span></button>)}</nav>}
 {!!errors.length&&<div role="alert" className="ops-message">{errors.map(e=><p key={e.storeId}>{e.error}</p>)}<button onClick={()=>setRevision(v=>v+1)}>重新讀取</button></div>}
 <div id="ops-priority-list" className={`ops-table-wrap${expanded?' ops-expanded':''}`}><table><thead><tr>{category.columns.map(c=><th key={c}>{c}</th>)}<th><span className="ops-sr">操作</span></th></tr></thead><tbody>{visibleRows.map(r=><tr key={`${r.storeId}:${r.id}`}>{category.id==='equipment'&&<td><span className={`ops-task-kind ${r.taskKind}`}>{taskFilters.find(([value])=>value===r.taskKind)?.[1]}</span></td>}<td>{r.name}</td><td>{r.storeName}</td><td>{r.detail}</td><td className={category.id==='prices'?'ops-rise':''}>{r.status}</td><td><button className="ops-open" aria-label={`${r.storeName} ${r.name}，${r.taskKind?taskActions[r.taskKind]:r.view==='spot-check'?'前往抽盤':category.link}`} onClick={()=>r.recordId?onOpen(r.storeId,r.view,r.recordId):onOpen(r.storeId,r.view)}>前往 ›</button></td></tr>)}</tbody></table></div>
 {rows.length>OVERVIEW_LIMIT&&<button className="ops-more" aria-expanded={expanded} aria-controls="ops-priority-list" onClick={()=>setExpandedScope(expanded?'':expansionKey)}>{expanded?'收合・只顯示前 5 筆':`⋯ 還有 ${rows.length-OVERVIEW_LIMIT} 筆・查看全部`}</button>}
 {!loaded?<p role="status" className="ops-empty">正在讀取營運資料…</p>:!rows.length&&!errors.length?<p className="ops-empty">{category.id==='equipment'?'目前沒有符合的未完成事項。':'目前沒有待處理事項。'}</p>:null}
 <footer>{category.footer}<button className="text-button" onClick={()=>setRevision(v=>v+1)}>重新讀取</button></footer>
 </div></div></section>;
}
