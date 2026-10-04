'use client';
import {useCallback,useEffect,useRef,useState,type ReactNode,type ChangeEvent} from 'react';
import {readScopedReceiptAccounts,saveReceiptAccount} from '@/lib/receipt-accounting-api';
import {accountDate,accountExportRows,accountMoney,accountPayload,accountStatusLabels,accountSummary,accountingError,filterReceiptAccounts,parseAccountInput,type AccountFilters,type AccountLine,type ReceiptAccount} from '@/lib/receipt-accounting';
import {nextReviewId,type ReviewAccount} from '@/lib/receipt-review';
import {receiptReadError} from '@/lib/receipt-read';
import ReceiptReviewWorkbench from './receipt-review-workbench';
import ReceiptBulkReview from './receipt-bulk-review';
import {exportRows} from './reports-workspace';
import './receipt-accounting.css';
type Props={onFlag?:(id:string,state:'LIVE'|'TEST'|'REMOVED')=>void;onConfirm?:(id:string)=>void;enabled?:boolean;storeId:string;userId:string;tab:'items'|'accounts';onTabChange:(tab:'items'|'accounts')=>void;filters:AccountFilters;lines:AccountLine[];children:ReactNode;disabled:boolean;editing:boolean;onEditing:(key:string,active:boolean)=>void;onSource:(batchId:string)=>void;editBatchId?:string|null;onEditClosed?:()=>void;onCorrected?:(row:ReviewAccount)=>void};
export default function ReceiptAccounting(props:Props){return props.enabled===false?props.children:<ReceiptAccountingBody {...props}/>;}
function ReceiptAccountingBody(props:Props){
 const [accounts,setAccounts]=useState<ReviewAccount[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState(''),[status,setStatus]=useState('ALL'),[loadedScope,setLoadedScope]=useState(''),[lastRead,setLastRead]=useState('');
 const [edit,setEdit]=useState<string|null>(null),[saving,setSaving]=useState(false),[saveError,setSaveError]=useState('');
 const [comparisons,setComparisons]=useState<Record<string,string>>({});
 const [queue,setQueue]=useState<ReceiptAccount[]>([]);
 const flight=useRef<AbortController|null>(null),sequence=useRef(0),paused=useRef(false),lock=useRef(false),alive=useRef(true);
 const retry=useRef<{key:string;id:string}|null>(null);
 const {storeId,userId,onEditing}=props,{from,to,supplier}=props.filters;
 const editId=props.editBatchId||edit;
 const readScope=JSON.stringify([storeId,userId,from,to,supplier]);
 useEffect(()=>{paused.current=props.editing||props.disabled||!!editId||saving;},[props.editing,props.disabled,editId,saving]);
 useEffect(()=>{onEditing('receipt-account',!!editId||saving);return()=>onEditing('receipt-account',false);},[editId,saving,onEditing]);
 const load=useCallback(async(background=false)=>{
  if(background&&(paused.current||flight.current||document.visibilityState!=='visible'))return;
  flight.current?.abort();const controller=new AbortController(),version=++sequence.current;flight.current=controller;
  try{const rows=await readScopedReceiptAccounts(storeId,controller.signal,from,to,supplier);if(version===sequence.current&&!controller.signal.aborted){setAccounts(rows);setLoadedScope(readScope);setLastRead(new Date().toLocaleTimeString('zh-TW',{hour12:false}));setError('');}}
  catch(e){if(version===sequence.current&&!controller.signal.aborted)setError(receiptReadError(e));}
  finally{if(version===sequence.current&&!controller.signal.aborted){setLoading(false);flight.current=null;}}
 },[storeId,from,to,supplier,readScope]);
 useEffect(()=>{alive.current=true;const counter=sequence,request=flight;const initial=setTimeout(()=>void load(),0);const timer=setInterval(()=>void load(true),30000);const resume=()=>void load(true);window.addEventListener('focus',resume);return()=>{alive.current=false;counter.current++;request.current?.abort();clearTimeout(initial);clearInterval(timer);window.removeEventListener('focus',resume);};},[load]);
 const scoped=loadedScope===readScope?accounts:[];
 const matching=filterReceiptAccounts(scoped,props.lines,props.filters,props.tab==='accounts'?status:'ALL') as ReviewAccount[];
 const filtered=props.tab==='accounts'?matching.filter(r=>r.reviewed||r.status==='CHECKED'):matching;
 const summary=accountSummary(filtered),unavailable=loadedScope!==readScope;
 const groups=new Map<string,ReceiptAccount[]>();for(const row of filtered){const name=row.supplier_name||'供應商待確認';groups.set(name,[...(groups.get(name)||[]),row]);}
 function begin(row:ReceiptAccount){if(lock.current||props.editing||!row.can_edit||row.record_state!=='LIVE'||!!error)return;setQueue(filtered.filter(r=>r.supplier_name===row.supplier_name));setEdit(row.batch_id);setSaveError('');retry.current=null;}
 function close(){setEdit(null);props.onEditClosed?.();}
 async function save(row:ReceiptAccount,checked:boolean){
  if(lock.current||props.editing||!!error||!row.can_edit||row.record_state!=='LIVE')return;
  let data:ReturnType<typeof accountPayload>;try{data=accountPayload(row,row.amount_override,row.note,checked);}catch(e){setSaveError(e instanceof Error?e.message:'請核對金額。');return;}
  const key=JSON.stringify({storeId,batchId:row.batch_id,data});if(retry.current?.key!==key)retry.current={key,id:crypto.randomUUID()};
  lock.current=true;setSaving(true);setSaveError('');setNotice('');
  try{await saveReceiptAccount(storeId,row.batch_id,data,retry.current.id);if(!alive.current)return;retry.current=null;setEdit(null);setNotice(checked?'已完成對帳；不代表已付款或再次收貨。':'已取消對帳。');const updated=await readScopedReceiptAccounts(storeId,new AbortController().signal,'','','ALL',row.batch_id);if(alive.current&&updated[0])setAccounts(old=>old.map(a=>a.batch_id===row.batch_id?updated[0]:a));}
  catch(e){if(alive.current)setSaveError(accountingError(e));}
  finally{lock.current=false;if(alive.current)setSaving(false);}
 }
 async function download(){try{await exportRows(accountExportRows(filtered),'xlsx',`貨單對帳_${from||'全部'}_${to||'全部'}`);}catch{setSaveError('匯出未完成，請重試。');}}
 function changeChecked(event:ChangeEvent<HTMLInputElement>){const row=accounts.find(a=>a.batch_id===event.currentTarget.dataset.accountId);if(row)void save(row,event.currentTarget.checked);}
 const canCompare=!props.filters.batchId&&status==='ALL'&&props.filters.category==='ALL'&&props.filters.scope==='ALL'&&!props.filters.query.trim();
 const activeQueue=props.editBatchId?filtered.filter(a=>a.supplier_name===accounts.find(r=>r.batch_id===editId)?.supplier_name):queue;
 const nextId=editId?nextReviewId(activeQueue,editId):null;
 function corrected(row:ReviewAccount,next:boolean){setAccounts(old=>old.some(a=>a.batch_id===row.batch_id)?old.map(a=>a.batch_id===row.batch_id?row:a):[...old,row]);setQueue(activeQueue.map(a=>a.batch_id===row.batch_id?row:a));props.onCorrected?.(row);setNotice(row.status==='CHECKED'?'已儲存並完成對帳。':'修正已儲存，保留待對帳。');props.onEditClosed?.();setEdit(next?nextId:null);}
 return <section className="receipt-accounting" data-tab={props.tab}>
  <div className="receipt-account-tabs" role="tablist" aria-label="進貨檢視"><button type="button" role="tab" aria-selected={props.tab==='items'} disabled={props.editing||saving} onClick={()=>props.onTabChange('items')}>進貨明細</button><button type="button" role="tab" aria-selected={props.tab==='accounts'} disabled={props.editing||saving} onClick={()=>props.onTabChange('accounts')}>貨單對帳</button></div>
  <div className="receipt-account-metrics" aria-label="貨單金額彙總">{(['net','tax','total'] as const).map((key,index)=><div key={key}><span>{['貨單未稅合計','稅額合計','含稅合計'][index]}</span><strong>{unavailable?'—':summary.count>0&&summary[key].missing===summary.count?'待確認':accountMoney(summary[key].value)}</strong><small>{unavailable?(error?'讀取失敗':'讀取中…'):summary[key].missing?`已知金額；${summary[key].missing} 張待確認`:'依整張貨單計算，不重複加稅'}</small></div>)}<div><span>待對帳</span><strong>{unavailable?'—':`${summary.count-summary.checked} 張`}</strong><small>{unavailable?'':`已對帳 ${summary.checked}／共 ${summary.count} 張`}</small></div></div>
  {error&&<p className="receipt-account-stale" role="alert">{unavailable?'稅額與對帳資料未能讀取。':`尚未更新；保留 ${lastRead} 讀取的資料，暫不可完成對帳。`}{error}<button type="button" className="text-button" disabled={saving||loading} onClick={()=>{setLoading(true);void load();}}>重新讀取</button></p>}
  {notice&&<p className="shell-note" role="status">{notice}</p>}
  {!unavailable&&(summary.pending>0||summary.tax.missing>0)&&<p className="receipt-account-warning">{summary.pending>0?`尚有 ${summary.pending} 張貨單待建檔／辨識。`:''}{summary.tax.missing>0?` ${summary.tax.missing} 張稅額待確認。`:''}目前顯示已知金額，並非完整對帳總額。</p>}
  {props.tab==='items'?<><p className="receipt-account-help">按「編輯所有明細」可一次修改並儲存。勾選以整張貨單為單位，核對後送入對帳。</p><ReceiptBulkReview onFlag={props.onFlag} onConfirm={props.onConfirm} storeId={storeId} userId={userId} rows={matching} disabled={props.disabled||unavailable||!!error} onSource={props.onSource} onEditing={onEditing} onSaved={row=>{setAccounts(old=>old.map(a=>a.batch_id===row.batch_id?row:a));props.onCorrected?.(row);}} onSubmitted={()=>{setNotice('核對完成，已送入貨單對帳；尚未標記已對帳。');props.onTabChange('accounts');}}/></>:<>
   <div className="receipt-account-actions"><label>對帳狀態<select value={status} disabled={saving||!!editId} onChange={e=>setStatus(e.target.value)}><option value="ALL">全部對帳狀態</option>{Object.entries(accountStatusLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><div><button type="button" className="shell-secondary" disabled={unavailable||!!error||saving||!filtered.length} onClick={()=>void download()}>匯出對帳清單</button><button type="button" className="shell-secondary" disabled={unavailable||!!error||saving||!filtered.length} onClick={()=>window.print()}>列印</button></div></div>
   <p className="receipt-account-help">每張貨單一列。點「核對／更正」直接看原單及修改品項，完成後接下一張。勾選代表已對帳，不等於收貨或付款。</p>
   {saveError&&<p role="alert" className="sheet-error">{saveError}</p>}
   {!unavailable&&!filtered.length&&<p className="shell-note">目前沒有符合條件的貨單。</p>}
   {!unavailable&&[...groups].map(([name,rows])=>{const subtotal=accountSummary(rows),comparisonKey=JSON.stringify([storeId,from,to,name]),input=comparisons[comparisonKey]||'';let comparison:number|null=null;try{comparison=parseAccountInput(input);}catch{/* Not zero. */}const difference=comparison!==null&&!subtotal.total.missing?Math.round((comparison-subtotal.total.value)*10000)/10000:null;return <article className="receipt-account-group" key={name}>
    <header><div><h3>{name}</h3><small>共 {subtotal.count} 張 · 已對帳 {subtotal.checked} 張 · 待對帳 {subtotal.count-subtotal.checked} 張</small></div><strong>含稅{subtotal.total.missing?'已知小計':'小計'} {accountMoney(subtotal.total.value)}</strong></header>
    <div className="receipt-account-scroll"><table><thead><tr>{['對帳','到貨日期','貨單號碼','未稅金額','稅額','含稅金額','狀態／備註','原單','操作'].map(s=><th key={s}>{s}</th>)}</tr></thead><tbody>{rows.map(row=><tr key={row.batch_id}>
     <td><input type="checkbox" aria-label={`對帳 ${row.document_number||row.batch_number||row.batch_id}`} checked={row.status==='CHECKED'} disabled={saving||!!error||props.disabled||props.editing||!row.can_edit||row.record_state!=='LIVE'||!['UNCHECKED','CHECKED'].includes(row.status)||!accountDate(row.receipt_date)} data-account-id={row.batch_id} onChange={changeChecked}/></td>
     <td>{accountDate(row.receipt_date)||'日期待確認'}</td><td>{row.document_number||'單號未提供'}<small>{row.batch_number||''}</small></td>
     <td className="numeric">{row.net===null?'待確認':row.net.toLocaleString('zh-TW',{maximumFractionDigits:4})}</td><td className="numeric">{row.tax===null?'稅額待確認':row.tax.toLocaleString('zh-TW',{maximumFractionDigits:4})}</td><td className="numeric">{row.total===null?'待確認':row.total.toLocaleString('zh-TW',{maximumFractionDigits:4})}</td>
     <td><span className={`receipt-account-status ${row.status.toLowerCase()}`}>{accountStatusLabels[row.status]}</span>{row.amount_conflict&&<small>金額不一致</small>}{row.note&&<small className="receipt-account-note">{row.note}</small>}</td>
     <td><button type="button" className="text-button" disabled={saving} onClick={()=>props.onSource(row.batch_id)}>查看</button></td><td><button type="button" className="text-button" disabled={saving||!!error||props.editing||props.disabled||!row.can_edit||row.record_state!=='LIVE'} onClick={()=>begin(row)}>核對／更正</button></td>
    </tr>)}</tbody></table></div>
    {canCompare&&<div className="receipt-account-comparison"><label>廠商對帳單金額<input inputMode="decimal" aria-label={`${name} 廠商對帳單金額`} value={input} onChange={e=>setComparisons(old=>({...old,[comparisonKey]:e.target.value}))} placeholder="輸入本期含稅金額"/></label><span>差異：{!!error?'資料尚未更新':!input?'尚未輸入':subtotal.total.missing?'貨單金額未完整':difference===null?'請輸入有效金額':accountMoney(difference)}</span><small>本次比對試算；不儲存付款紀錄。</small></div>}
   </article>;})}
  </>}
  {editId&&<ReceiptReviewWorkbench key={`${storeId}:${userId}:${editId}`} storeId={storeId} batchId={editId} nextId={nextId} onClose={close} onSaved={corrected}/>}
 </section>;
}
