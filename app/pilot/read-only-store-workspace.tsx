'use client';

import {useCallback,useEffect,useRef,useState,type ReactNode} from 'react';
import SpotCheckWorkspace from './spot-check-workspace';
import {Eye,RefreshCw} from 'lucide-react';
import {supabase} from '@/lib/supabase-browser';
import {appError,canExportData,type AppStore} from '@/lib/app-workspace';
import {readOnlyMonthRange,readOnlyStorePolicy,visibleReviewedRows,type ReadOnlySection} from '@/lib/read-only-store';
import {inventoryMoney,inventoryNumber,taipeiMonth} from '@/lib/inventory-monthly';
import {monthRange,type ExpiryWorkspaceData} from '@/lib/expiry-waste';
import type {CountResult} from '@/lib/count-flow';
import {stockStateLabels} from '@/lib/stock-rules.mjs';
import {useWorkspace} from './operation-hooks';
import {displayTime} from './inventory-catalog';
import {WasteDetail,WasteHistoryRows} from './expiry-waste-cards';
import {exportRows} from './reports-workspace';
import type {Batch} from './receiving-workspace';
import type {Movement} from './transfers-workspace';

type ReadResult={data:unknown;error:unknown};
type Reader=(signal:AbortSignal)=>PromiseLike<ReadResult>;
type ReadState<T>={key:string;data?:T;error:string;loading:boolean};

// Queries are scoped to both the store and current filter. Changing stores, months,
// or detail records immediately hides the previous snapshot and cancels its read.
function useReadOnlyQuery<T>(key:string,reader:Reader) {
  const [snapshot,setSnapshot]=useState<ReadState<T>>({key,error:'',loading:true});
  const flight=useRef<AbortController|null>(null),sequence=useRef(0);
  const refresh=useCallback(async()=>{
    flight.current?.abort();
    const controller=new AbortController(),request=++sequence.current;
    flight.current=controller;
    setSnapshot(previous=>({key,data:previous.key===key?previous.data:undefined,error:'',loading:true}));
    const timeout=setTimeout(()=>controller.abort(),20000);
    try {
      const result=await reader(controller.signal);
      if(request!==sequence.current)return;
      if(result.error)throw result.error;
      setSnapshot({key,data:result.data as T,error:'',loading:false});
    } catch(error) {
      if(request===sequence.current)setSnapshot({key,error:controller.signal.aborted?'讀取逾時，請重新整理。':appError(error),loading:false});
    } finally {
      clearTimeout(timeout);
      if(flight.current===controller)flight.current=null;
    }
  },[key,reader]);
  useEffect(()=>{
    let active=true;const requests=sequence;
    queueMicrotask(()=>{if(active)void refresh();});
    return()=>{active=false;requests.current++;flight.current?.abort();};
  },[refresh]);
  return {data:snapshot.key===key?snapshot.data:undefined,error:snapshot.key===key?snapshot.error:'',loading:snapshot.key!==key||snapshot.loading,refresh};
}

type Props={store:AppStore;userId:string};
const labels:Record<ReadOnlySection,string>={spot:'抽盤',stock:'庫存',counts:'盤點',receipts:'進貨',transfers:'調撥／借貸',waste:'廢棄'};

export default function ReadOnlyStoreWorkspace({store,userId}:Props) {
  const policy=readOnlyStorePolicy(store);
  const [section,setSection]=useState<ReadOnlySection>('counts');
  const [month,setMonth]=useState(taipeiMonth);
  const sections:ReadOnlySection[]=policy.blind?['counts','receipts','transfers','waste']:['stock','counts',...(['LOGISTICS','OWNER'].includes(store.role)?['spot' as const]:[]),'receipts','transfers','waste'];
  return <section key={`${userId}:${store.id}`} aria-label={`${store.name}僅查看資料`}>
    <div className="workspace-heading"><h1>{store.name}</h1><span className="shell-note"><Eye size={16} aria-hidden="true"/> 僅查看</span></div>
    <p className="shell-note">可查看這家門市已授權的資料。需要新增或修改時，請洽行政調整權限。</p>
    <div className="shell-button-stack" role="group" aria-label="查看資料類別" style={{display:'flex',flexWrap:'wrap',gap:8}}>
      {sections.map(value=><button key={value} type="button" className={value===section?'shell-primary':'shell-secondary'} aria-pressed={value===section} onClick={()=>setSection(value)}>{labels[value]}</button>)}
    </div>
    {section!=='stock'&&section!=='spot'&&<label className="field">月份<input type="month" value={month} onChange={event=>{if(event.target.value)setMonth(event.target.value);}}/></label>}
    {section==='spot'&&!policy.blind&&['LOGISTICS','OWNER'].includes(store.role)&&<SpotCheckWorkspace store={store} userId={userId}/>}
    {section==='stock'&&!policy.blind&&<StockReadView key={store.id} store={store}/>}
    {section==='counts'&&<CountReadView key={`${store.id}:${month}`} store={store} month={month}/>}
    {section==='receipts'&&(policy.reports?<ReceiptReadView key={`${store.id}:${month}`} store={store} month={month}/>:<ReceiptStatusReadView key={`${store.id}:${month}`} store={store} month={month}/>)}
    {section==='transfers'&&<TransferReadView key={`${store.id}:${month}`} store={store} month={month}/>}
    {section==='waste'&&<WasteReadView key={`${store.id}:${month}`} store={store} month={month}/>}
  </section>;
}

function ReadStatus({loading,error,onRefresh,children}:{loading:boolean;error:string;onRefresh:()=>Promise<unknown>;children:ReactNode}) {
  return <>
    <button type="button" className="text-button" disabled={loading} onClick={()=>void onRefresh()}><RefreshCw size={14} aria-hidden="true"/> {loading?'讀取中…':'重新整理'}</button>
    {error?<p className="pilot-message" role="alert">{error}</p>:loading?<p role="status">正在讀取門市資料…</p>:children}
  </>;
}

type StockData={products:{id:string;name:string;unit:string;stock:{total:number|null;available:number|null}}[];positions:{id:string;product_id:string;zone_name:string;quantity:number;unit:string;state:string}[]};
function StockReadView({store}:{store:AppStore}) {
  const workspace=useWorkspace<StockData>(store.id,'stock');
  const [search,setSearch]=useState('');
  const rows=(workspace.data?.products||[]).filter(row=>row.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  return <><h2>庫存資料</h2><label className="field">搜尋品項<input type="search" value={search} onChange={event=>setSearch(event.target.value)}/></label>
    <ReadStatus {...workspace} onRefresh={workspace.refresh}>
      {!rows.length&&<p className="shell-note">目前沒有符合的庫存品項。</p>}
      {rows.map(row=><details key={row.id} className="shell-card store-archive-record"><summary><strong>{row.name}</strong><small>總庫存 {inventoryNumber(row.stock.total)} {row.unit}・可用 {inventoryNumber(row.stock.available)} {row.unit}</small></summary>
        {(workspace.data?.positions||[]).filter(position=>position.product_id===row.id).map(position=><p key={position.id}>{position.zone_name}・{inventoryNumber(position.quantity)} {position.unit}・{(stockStateLabels as Record<string,string>)[position.state]||'待確認'}</p>)}
      </details>)}
    </ReadStatus>
  </>;
}

type CountSession={id:string;status:string;started_at:string;completed_at:string|null};
type CountProgress={zone_id:string;status:string;completed_at:string|null};
type CountData={sessions:CountSession[];zones:{id:string;name:string}[];progress:Record<string,CountProgress[]>};
const countStatus:Record<string,string>={DRAFT:'未開始',IN_PROGRESS:'盤點中',REVIEWING:'待確認',CLOSED:'已完成',COMPLETED:'已完成',COMPLETE:'已完成',PENDING:'未開始'};

function CountReadView({store,month}:{store:AppStore;month:string}) {
  const policy=readOnlyStorePolicy(store),{from,to}=readOnlyMonthRange(month);
  const reader=useCallback(async(signal:AbortSignal)=>{
    let query=supabase.from('inventory_count_sessions').select('id,status,started_at,completed_at').eq('store_id',store.id).gte('started_at',from).lt('started_at',to).order('started_at',{ascending:false});
    if(policy.confirmedOnly)query=query.eq('status','CLOSED');
    const sessions=await query.abortSignal(signal);
    if(sessions.error)return {data:null,error:sessions.error};
    const zones=await supabase.from('count_zones').select('id,name').eq('store_id',store.id).order('sort_order').abortSignal(signal);
    if(zones.error)return {data:null,error:zones.error};
    const progress:Record<string,CountProgress[]>={};
    const responses=await Promise.all((sessions.data||[]).map(async session=>{
      const result=await supabase.from('count_zone_progress').select('zone_id,status,completed_at').eq('session_id',session.id).abortSignal(signal);
      progress[session.id]=result.data||[];return result;
    }));
    return {data:{sessions:sessions.data||[],zones:zones.data||[],progress},error:responses.find(result=>result.error)?.error||null};
  },[store.id,from,to,policy.confirmedOnly]);
  const workspace=useReadOnlyQuery<CountData>(`${store.id}:counts:${month}:${policy.confirmedOnly}`,reader);
  const [selected,setSelected]=useState('');
  return <><h2>盤點紀錄</h2>{policy.blind&&<p className="shell-note">顯示各區盤點進度；保留原本不顯示系統數量的設定。</p>}{policy.confirmedOnly&&<p className="shell-note">顯示已完成確認的盤點。</p>}
    <ReadStatus {...workspace} onRefresh={workspace.refresh}>
      {!workspace.data?.sessions.length&&<p className="shell-note">這個月份尚無可查看的盤點紀錄。</p>}
      {workspace.data?.sessions.map(session=><article key={session.id} className="shell-card store-archive-record">
        <strong>{displayTime(session.started_at)}・{countStatus[session.status]||'處理中'}</strong>
        {(workspace.data?.progress[session.id]||[]).map(progress=><p key={progress.zone_id}>{workspace.data?.zones.find(zone=>zone.id===progress.zone_id)?.name||'原儲物區'}：{countStatus[progress.status]||'盤點中'}{progress.completed_at?`・${displayTime(progress.completed_at)}`:''}</p>)}
        {!policy.blind&&['REVIEWING','CLOSED'].includes(session.status)&&<button type="button" className="text-button" aria-expanded={selected===session.id} onClick={()=>setSelected(selected===session.id?'':session.id)}>{selected===session.id?'收合明細':'查看已送出明細'}</button>}
        {selected===session.id&&!policy.blind&&<CountResultsReadView key={session.id} store={store} sessionId={session.id}/>}
      </article>)}
    </ReadStatus>
  </>;
}

function CountResultsReadView({store,sessionId}:{store:AppStore;sessionId:string}) {
  const reader=useCallback((signal:AbortSignal)=>supabase.rpc('get_pilot_count_results',{p_session_id:sessionId}).abortSignal(signal),[sessionId]);
  const workspace=useReadOnlyQuery<CountResult[]>(`${store.id}:count-results:${sessionId}`,reader);
  const [search,setSearch]=useState('');
  const rows=(workspace.data||[]).filter(row=>`${row.name} ${row.zone}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  return <><label className="field">搜尋品項／儲物區<input type="search" value={search} onChange={event=>setSearch(event.target.value)}/></label>
    <ReadStatus {...workspace} onRefresh={workspace.refresh}>
      {rows.map(row=><div key={row.id} className="store-archive-record"><strong>{row.name}・{inventoryNumber(row.quantity)} {row.unit}</strong><p>{row.zone}・{row.entered_by||'未提供'}・{displayTime(row.entered_at)}</p>{row.note&&<p style={{whiteSpace:'pre-wrap'}}>{row.note}</p>}</div>)}
      {!rows.length&&<p className="shell-note">沒有符合的盤點明細。</p>}
      <ReadOnlyExport store={store} name="盤點" rows={rows.map(row=>({品項:row.name,儲物區:row.zone,數量:row.quantity,單位:row.unit,盤點人:row.entered_by,時間:row.entered_at,備註:row.note}))}/>
    </ReadStatus>
  </>;
}

type ReceiptReport={receipts:{id:string;receipt_date:string|null;document_number:string;supplier_name:string;total_inc_tax:number|null}[];lines:{id:string;receipt_id:string;name:string;quantity:number|null;unit:string|null;unit_price:number|null;amount:number|null}[]};
function ReceiptReadView({store,month}:{store:AppStore;month:string}) {
  const workspace=useWorkspace<ReceiptReport>(store.id,'reports',readOnlyMonthRange(month));
  const [search,setSearch]=useState('');
  const rows=(workspace.data?.receipts||[]).filter(row=>`${row.supplier_name} ${row.document_number}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  return <><h2>已確認進貨</h2><label className="field">搜尋供應商／單號<input type="search" value={search} onChange={event=>setSearch(event.target.value)}/></label>
    <ReadStatus {...workspace} onRefresh={workspace.refresh}>
      {!rows.length&&<p className="shell-note">這個月份沒有符合的已確認進貨。</p>}
      {rows.map(row=><details key={row.id} className="shell-card store-archive-record"><summary><strong>{row.supplier_name||'未提供供應商'}</strong><small>{row.receipt_date||'未提供日期'}・{row.document_number||'未提供單號'}・{inventoryMoney(row.total_inc_tax)}</small></summary>
        {(workspace.data?.lines||[]).filter(line=>line.receipt_id===row.id).map(line=><p key={line.id}><strong>{line.name}</strong>・{inventoryNumber(line.quantity)} {line.unit||''}・單價 {inventoryMoney(line.unit_price)}・金額 {inventoryMoney(line.amount)}</p>)}
      </details>)}
      <ReadOnlyExport store={store} name={`進貨-${month}`} rows={rows.map(row=>({供應商:row.supplier_name,日期:row.receipt_date,單號:row.document_number,含稅總額:row.total_inc_tax}))}/>
    </ReadStatus>
  </>;
}

function ReceiptStatusReadView({store,month}:{store:AppStore;month:string}) {
  const reader=useCallback((signal:AbortSignal)=>supabase.rpc('get_pilot_receipts',{p_store_id:store.id}).abortSignal(signal),[store.id]);
  const workspace=useReadOnlyQuery<Batch[]>(`${store.id}:receipts`,reader);
  const rows=(workspace.data||[]).filter(row=>(row.work_date||row.uploaded_at)?.startsWith(month));
  const states:Record<string,string>={COMPLETED:'已完成',UPLOADED:'已上傳',OCR_DONE:'已辨識',FAILED:'辨識失敗',READY_FOR_REVIEW:'待核對',REVIEWING:'核對中'};
  return <><h2>貨單處理進度</h2><ReadStatus {...workspace} onRefresh={workspace.refresh}>
    {rows.map(row=><article className="shell-card store-archive-record" key={row.id}><strong>{row.supplier||'供應商待確認'}</strong><p>{row.work_date||'日期待確認'}・{row.pages} 張・{states[row.status]||'處理中'}</p></article>)}
    {!rows.length&&<p className="shell-note">這個月份沒有可查看的貨單。</p>}
  </ReadStatus></>;
}

function TransferReadView({store,month}:{store:AppStore;month:string}) {
  const workspace=useWorkspace<{records:Movement[]}>(store.id,'transfers',readOnlyMonthRange(month));
  const policy=readOnlyStorePolicy(store);
  const rows=visibleReviewedRows(workspace.data?.records||[],policy.confirmedOnly);
  const states:Record<string,string>={OPEN:'待歸還',RETURNED:'已歸還',EXCHANGED:'換貨結清',COMPLETE:'調撥完成'};
  return <><h2>調撥／借貸紀錄</h2><p className="shell-note">包含所選月份紀錄及尚未結清借貸。{policy.confirmedOnly?'財務僅顯示已確認紀錄。':''}</p>
    <ReadStatus {...workspace} onRefresh={workspace.refresh}>
      {rows.map(row=><details className="shell-card store-archive-record" key={row.id}><summary><strong>{row.name}・{inventoryNumber(row.quantity)} {row.unit}</strong><small>{row.from_name} → {row.to_name}・{states[row.status]||'處理中'}</small></summary>
        <p>{row.actor_name}・{displayTime(row.created_at)}</p><p>確認狀態：{row.review_status==='CONFIRMED'?'已確認':row.review_status==='PENDING'?'待確認':'未提供'}</p>
        {row.kind==='LOAN'&&<p>已歸還 {inventoryNumber(row.returned_quantity)} {row.unit}{row.expected_return_on?`・預計歸還 ${row.expected_return_on}`:''}</p>}
        {!policy.blind&&store.business_type!=='CHAIN_RESTAURANT'&&row.review_status==='CONFIRMED'&&<p>金額：{inventoryMoney(row.transfer_amount)}</p>}
        {row.note&&<p style={{whiteSpace:'pre-wrap'}}>{row.note}</p>}
        {row.events.map(event=><p key={event.id}>{event.name}・{inventoryNumber(event.quantity)} {event.unit}・{event.actor_name}・{displayTime(event.created_at)}</p>)}
      </details>)}
      {!rows.length&&<p className="shell-note">目前沒有可查看的調撥／借貸紀錄。</p>}
      <ReadOnlyExport store={store} name={`調撥-${month}`} rows={rows.map(row=>({品項:row.name,來源門市:row.from_name,接收門市:row.to_name,數量:row.quantity,單位:row.unit,狀態:states[row.status]||'處理中',經手人:row.actor_name,時間:row.created_at}))}/>
    </ReadStatus>
  </>;
}

function WasteReadView({store,month}:{store:AppStore;month:string}) {
  const [from,until]=monthRange(month),policy=readOnlyStorePolicy(store);
  const reader=useCallback((signal:AbortSignal)=>supabase.rpc('get_pilot_expiry_waste',{p_store_id:store.id,p_from:from,p_until:until}).abortSignal(signal),[store.id,from,until]);
  const workspace=useReadOnlyQuery<ExpiryWorkspaceData>(`${store.id}:waste:${month}`,reader);
  const [selected,setSelected]=useState('');
  const rows=visibleReviewedRows(workspace.data?.waste||[],policy.confirmedOnly);
  const current=rows.find(row=>row.id===selected);
  return <><h2>廢棄紀錄</h2>{policy.confirmedOnly&&<p className="shell-note">財務僅顯示已確認紀錄。</p>}
    <ReadStatus {...workspace} onRefresh={workspace.refresh}>
      {current?<><button type="button" className="shell-back" onClick={()=>setSelected('')}>‹ 返回廢棄紀錄</button><WasteDetail row={current} audit={workspace.data?.permissions.audit===true} showAmount={!policy.blind&&workspace.data?.can_view_amount===true}/></>:<WasteHistoryRows rows={rows} onOpen={row=>setSelected(row.id)}/>}
      {!rows.length&&<p className="shell-note">這個月份沒有可查看的廢棄紀錄。</p>}
      <ReadOnlyExport store={store} name={`廢棄-${month}`} rows={rows.map(row=>({品項:row.name,數量:row.quantity,單位:row.unit,原因:row.reason,經手人:row.actor_name,時間:row.created_at}))}/>
    </ReadStatus>
  </>;
}

function ReadOnlyExport({store,name,rows}:{store:AppStore;name:string;rows:Record<string,unknown>[]}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  if(!canExportData(store))return null;
  const download=async()=>{
    setBusy(true);setError('');
    try {
      const permission=await supabase.rpc('authorize_app_feature',{p_store_id:store.id,p_feature:'DATA_EXPORT'});
      if(permission.error)throw permission.error;
      await exportRows(rows,'xlsx',`百花猿-${store.name}-${name}`);
    } catch {setError('匯出未完成，請確認權限後重試。');}
    finally {setBusy(false);}
  };
  return <><button type="button" className="shell-secondary" disabled={busy||!rows.length} onClick={()=>void download()}>{busy?'匯出中…':'匯出 Excel'}</button>{error&&<p role="alert">{error}</p>}</>;
}
