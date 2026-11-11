'use client';
import {useCallback,useEffect,useRef,useState,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {readIngredientMatching,readScopedReceiptAccounts} from '@/lib/receipt-accounting-api';
import {accountMoney,accountSummary,filterReceiptAccounts,type AccountFilters,type AccountLine,type ReceiptAccount} from '@/lib/receipt-accounting';
import {receiptCategoryOptions,matchesReceiptCategory} from '@/lib/receipt-categories';
import {type ReviewAccount} from '@/lib/receipt-review';
import {receiptReadError} from '@/lib/receipt-read';
import ReceiptReviewWorkbench from './receipt-review-workbench';
import ReceiptBulkReview from './receipt-bulk-review';
import {exportRows} from './reports-workspace';
import './receipt-accounting.css';
import './report-table.css';
type Props={filterTarget?:HTMLElement|null;externalTabs?:boolean;desktopMode?:boolean;onInbox?:()=>void;toolsTarget?:HTMLElement|null;registerLeave?:(handler:(()=>Promise<boolean>)|null)=>void;onSuppliersLoaded?:(names:string[])=>void;onFlag?:(id:string,state:'LIVE'|'TEST'|'REMOVED')=>Promise<boolean>|boolean|void;onConfirm?:(id:string)=>void;enabled?:boolean;storeId:string;userId:string;filters:AccountFilters;lines:AccountLine[];children:ReactNode;disabled:boolean;editing:boolean;onEditing:(key:string,active:boolean)=>void;onSource:(batchId:string)=>void;editBatchId?:string|null;onEditClosed?:()=>void;onCorrected?:(row:ReviewAccount)=>void};
export default function ReceiptAccounting(props:Props){return props.enabled===false?props.children:<ReceiptAccountingBody {...props}/>;}
function ReceiptAccountingBody(props:Props){
 const [accounts,setAccounts]=useState<ReviewAccount[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState(''),[loadedScope,setLoadedScope]=useState(''),[lastRead,setLastRead]=useState('');
 const [edit,setEdit]=useState<string|null>(null),[saveError,setSaveError]=useState('');
 const [onlyMissing,setOnlyMissing]=useState(false);
 const [queue,setQueue]=useState<ReceiptAccount[]>([]);
 const [category,setCategory]=useState('');
 const flight=useRef<AbortController|null>(null),sequence=useRef(0),paused=useRef(false);
 const {storeId,userId,onEditing}=props,{from,to,supplier}=props.filters;
 const editId=props.editBatchId||edit;
 const readScope=JSON.stringify([storeId,userId,from,to,supplier]);
 useEffect(()=>{paused.current=props.editing||props.disabled||!!editId;},[props.editing,props.disabled,editId]);
 useEffect(()=>{onEditing('receipt-account',!!editId);return()=>onEditing('receipt-account',false);},[editId,onEditing]);
 const load=useCallback(async(background=false)=>{
  if(background&&(paused.current||flight.current||document.visibilityState!=='visible'))return;
  flight.current?.abort();const controller=new AbortController(),version=++sequence.current;flight.current=controller;
  try{const rows=await readScopedReceiptAccounts(storeId,controller.signal,from,to,supplier);if(version===sequence.current&&!controller.signal.aborted&&(!background||!paused.current)){setAccounts(rows);setLoadedScope(readScope);setLastRead(new Date().toLocaleTimeString('zh-TW',{hour12:false}));setError('');}}
  catch(e){if(version===sequence.current&&!controller.signal.aborted)setError(receiptReadError(e));}
  finally{if(version===sequence.current&&!controller.signal.aborted){setLoading(false);flight.current=null;}}
 },[storeId,from,to,supplier,readScope]);
 useEffect(()=>{const counter=sequence,request=flight;const initial=setTimeout(()=>void load(),0);const timer=setInterval(()=>void load(true),30000);const resume=()=>void load(true);window.addEventListener('focus',resume);return()=>{counter.current++;request.current?.abort();clearTimeout(initial);clearInterval(timer);window.removeEventListener('focus',resume);};},[load]);
 const {onSuppliersLoaded}=props;
 useEffect(()=>{if(loadedScope===readScope)onSuppliersLoaded?.([...new Set(accounts.filter(row=>row.record_state==='LIVE').map(row=>row.supplier_name).filter(Boolean))]);},[accounts,loadedScope,readScope,onSuppliersLoaded]);
 const scoped=loadedScope===readScope?accounts.filter(row=>!row.receipt_entry_metadata?.equipment):[];
 const matching=filterReceiptAccounts(scoped,props.lines,props.filters,'ALL').filter(r=>matchesReceiptCategory((r as ReviewAccount).receipt_categories,category)) as ReviewAccount[];
 const missing=(r:ReceiptAccount)=>r.net===null||r.tax===null||r.total===null;
 const filtered=onlyMissing?matching.filter(missing):matching;
 const summary=accountSummary(filtered),unavailable=loadedScope!==readScope;
 function begin(row:ReceiptAccount){if(props.editing||!row.can_edit||row.record_state!=='LIVE'||!!error)return;setQueue(filtered.filter(r=>r.supplier_name===row.supplier_name));setEdit(row.batch_id);setSaveError('');}
 function openSource(id:string){const row=accounts.find(r=>r.batch_id===id);if(row?.can_edit&&row.record_state==='LIVE')begin(row);else props.onSource(id);}
 function close(){setEdit(null);props.onEditClosed?.();void load();}
 async function download(){try{const codeCatalog=await readIngredientMatching(storeId,new AbortController().signal);const rows=filtered.flatMap(a=>a.lines.map(l=>({'進貨日期':a.receipt_date||'','供應商':a.supplier_name,'貨單分類':(a.receipt_categories||[]).join('、'),'貨單號碼':a.document_number||'','食材編碼':codeCatalog?.ingredients.find(i=>i.id===l.ingredient_id)?.canonical_code||codeCatalog?.ingredients.find(i=>i.id===l.ingredient_id)?.ingredient_code||'','品名':l.product_name,'分類':l.category,'包裝規格':l.specification,'進貨單位':l.unit,'進貨數量':l.quantity??'','未稅單價':l.unit_price??'','未稅金額':l.subtotal??'','備註':l.note})));await exportRows(rows,'xlsx',`進貨明細_${from||'全部'}_${to||'全部'}`);}catch{setSaveError('匯出未完成，請重試。');}}
 const activeQueue=props.editBatchId?filtered.filter(a=>a.supplier_name===accounts.find(r=>r.batch_id===editId)?.supplier_name):queue;
 const queueIndex=activeQueue.findIndex(r=>r.batch_id===editId);
 const nextId=queueIndex>=0?activeQueue.slice(queueIndex+1).find(r=>r.record_state==='LIVE'&&r.can_edit)?.batch_id||null:null;
 const previousId=queueIndex>0?[...activeQueue.slice(0,queueIndex)].reverse().find(r=>r.record_state==='LIVE'&&r.can_edit)?.batch_id||null:null;
 function corrected(row:ReviewAccount,next:boolean){if(row.moved_to_store_id){setAccounts(old=>old.filter(a=>a.batch_id!==row.batch_id));setQueue(old=>old.filter(a=>a.batch_id!==row.batch_id));setNotice("已更改門市，原貨單與明細已一併移轉。");return;}setAccounts(old=>old.some(a=>a.batch_id===row.batch_id)?old.map(a=>a.batch_id===row.batch_id?row:a):[...old,row]);setQueue(activeQueue.map(a=>a.batch_id===row.batch_id?row:a));props.onCorrected?.(row);setNotice(row.status==='CHECKED'?'已儲存並完成對帳。':'修正已儲存，保留待對帳。');if(next&&nextId){props.onEditClosed?.();setEdit(nextId);}}
 const totals=<div className="report-summary" aria-label="目前篩選貨單金額彙總"><span>期間：{from} ～ {to}</span>{(['net','tax','total'] as const).map((key,index)=><span key={key}>{['未稅總金額','稅額','含稅總金額'][index]}：<strong>{unavailable?'':summary.count>0&&summary[key].missing===summary.count?'':accountMoney(summary[key].value)}</strong>{!unavailable&&summary[key].missing>0&&<small>（{summary[key].missing} 張待確認）</small>}</span>)}{!unavailable&&matching.some(missing)&&<button className="text-button report-missing" onClick={()=>setOnlyMissing(v=>!v)}>{onlyMissing?'返回全部明細':`金額未完整 ${matching.filter(missing).length} 張 ›`}</button>}</div>;
 return <section className="receipt-accounting" data-tab="items">
  {error&&<p className="receipt-account-stale" role="alert">{unavailable?'稅額與對帳資料未能讀取。':`尚未更新；保留 ${lastRead} 讀取的資料，暫不可完成對帳。`}{error}<button type="button" className="text-button" disabled={loading} onClick={()=>{setLoading(true);void load();}}>重新讀取</button></p>}
  {(()=>{const control=<select aria-label="篩選貨單分類" value={category} disabled={props.editing} onChange={e=>setCategory(e.target.value)}><option value="">全部分類</option>{receiptCategoryOptions(scoped).map(c=><option key={c}>{c}</option>)}<option value="__uncategorized">未分類</option></select>;return props.filterTarget?createPortal(control,props.filterTarget):<div className="receipt-category-filter">{control}</div>;})()}
  {notice&&<p className="shell-note" role="status">{notice}</p>}
  <div hidden={props.externalTabs} className="receipt-account-tabs" role="tablist" aria-label="進貨檢視"><button type="button" role="tab" aria-selected="true" disabled={props.editing}>進貨明細</button>{props.onInbox&&<button type="button" role="tab" aria-selected="false" disabled={props.editing} onClick={props.onInbox}>貨單管理</button>}</div>
  {saveError&&<p role="alert" className="sheet-error">{saveError}</p>}
  {totals}{unavailable&&<p className="shell-note" role="status">{error?'資料尚未載入，請按重新讀取。':'正在讀取進貨明細…'}</p>}{props.toolsTarget&&createPortal(<button data-receipt-action="export" type="button" className="shell-secondary" disabled={unavailable||!!error||props.editing||!filtered.length} onClick={()=>void download()}>匯出</button>,props.toolsTarget)}<ReceiptBulkReview onEditReceipt={id=>{const row=accounts.find(r=>r.batch_id===id);if(row)begin(row);}} desktopMode={props.desktopMode} toolsTarget={props.toolsTarget} registerLeave={props.registerLeave} onFlag={async(id,state)=>{const ok=await props.onFlag?.(id,state);if(ok===true)setAccounts(old=>old.map(row=>row.batch_id===id?{...row,record_state:state}:row));return ok===true;}} onConfirm={props.onConfirm} storeId={storeId} userId={userId} rows={filtered} disabled={props.disabled||unavailable||!!error} onSource={openSource} onEditing={onEditing} onSaved={row=>{setAccounts(old=>old.map(a=>a.batch_id===row.batch_id?row:a));props.onCorrected?.(row);}}/>
  {editId&&<ReceiptReviewWorkbench key={`${storeId}:${userId}:${editId}`} storeId={storeId} batchId={editId} nextId={nextId} previousId={previousId} positionLabel={queueIndex>=0?`${queueIndex+1} / ${activeQueue.length}`:undefined} onNavigate={(id,created)=>{
   setQueue(created&&!activeQueue.some(item=>item.batch_id===id)?[...activeQueue.slice(0,queueIndex+1),created,...activeQueue.slice(queueIndex+1)]:activeQueue);
   props.onEditClosed?.();setEdit(id);
  }} manualEntry onClose={close} onSaved={corrected}/>}
 </section>;
}
