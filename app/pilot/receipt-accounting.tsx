'use client';
import {useCallback,useEffect,useRef,useState,type ReactNode,type ChangeEvent} from 'react';
import {readReceiptAccounts,saveReceiptAccount} from '@/lib/receipt-accounting-api';
import {accountDate,accountExportRows,accountMoney,accountPayload,accountStatusLabels,accountSummary,accountingError,filterReceiptAccounts,parseAccountInput,type AccountAmounts,type AccountFilters,type AccountLine,type ReceiptAccount} from '@/lib/receipt-accounting';
import {receiptReadError} from '@/lib/receipt-read';
import {exportRows} from './reports-workspace';
import './receipt-accounting.css';
type Props={enabled?:boolean;storeId:string;userId:string;tab:'items'|'accounts';onTabChange:(tab:'items'|'accounts')=>void;filters:AccountFilters;lines:AccountLine[];children:ReactNode;disabled:boolean;editing:boolean;onEditing:(key:string,active:boolean)=>void;onSource:(batchId:string)=>void};
export default function ReceiptAccounting(props:Props){return props.enabled===false?props.children:<ReceiptAccountingBody {...props}/>;}
function ReceiptAccountingBody(props:Props){
 const [accounts,setAccounts]=useState<ReceiptAccount[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState(''),[status,setStatus]=useState('ALL');
 const [edit,setEdit]=useState<ReceiptAccount|null>(null),[saving,setSaving]=useState(false),[saveError,setSaveError]=useState('');
 const [draft,setDraft]=useState({net:'',tax:'',total:'',note:''});
 const [resetAmounts,setResetAmounts]=useState(false);
 const [comparisons,setComparisons]=useState<Record<string,string>>({});
 const flight=useRef<AbortController|null>(null),sequence=useRef(0),paused=useRef(false),lock=useRef(false),alive=useRef(true);
 const retry=useRef<{key:string;id:string}|null>(null),dialog=useRef<HTMLDialogElement>(null);
 const {storeId,userId,onEditing}=props;
 useEffect(()=>{paused.current=props.editing||props.disabled||!!edit||saving;},[props.editing,props.disabled,edit,saving]);
 useEffect(()=>{onEditing('receipt-account',!!edit||saving);return()=>onEditing('receipt-account',false);},[edit,saving,onEditing]);
 useEffect(()=>{if(edit)dialog.current?.showModal();},[edit]);
 const load=useCallback(async(background=false)=>{
  if(background&&(paused.current||flight.current||document.visibilityState!=='visible'))return;
  flight.current?.abort();const controller=new AbortController(),version=++sequence.current;flight.current=controller;
  try{const rows=await readReceiptAccounts(storeId,controller.signal);if(version===sequence.current&&!controller.signal.aborted){setAccounts(rows);setError('');}}
  catch(e){if(version===sequence.current&&!controller.signal.aborted){setAccounts([]);setError(receiptReadError(e));}}
  finally{if(version===sequence.current&&!controller.signal.aborted){setLoading(false);flight.current=null;}}
 },[storeId]);
 useEffect(()=>{alive.current=true;const counter=sequence,request=flight;const initial=setTimeout(()=>void load(),0);const timer=setInterval(()=>void load(true),15000);const resume=()=>void load(true);window.addEventListener('focus',resume);return()=>{alive.current=false;counter.current++;request.current?.abort();clearTimeout(initial);clearInterval(timer);window.removeEventListener('focus',resume);};},[load,userId]);
 useEffect(()=>{if(!edit&&!saving)return;const warn=(e:BeforeUnloadEvent)=>e.preventDefault();window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[edit,saving]);
 const filtered=filterReceiptAccounts(accounts,props.lines,props.filters,props.tab==='accounts'?status:'ALL');
 const summary=accountSummary(filtered),unavailable=loading||!!error||props.disabled;
 const groups=new Map<string,ReceiptAccount[]>();for(const row of filtered){const name=row.supplier_name||'供應商待確認';groups.set(name,[...(groups.get(name)||[]),row]);}
 function begin(row:ReceiptAccount){if(lock.current||props.editing||!row.can_edit||row.record_state!=='LIVE')return;setEdit(row);setDraft({net:String(row.net??''),tax:String(row.tax??''),total:String(row.total??''),note:row.note});setResetAmounts(false);setSaveError('');retry.current=null;}
 function close(){if(lock.current)return;setEdit(null);setSaveError('');retry.current=null;}
 async function save(row:ReceiptAccount,amounts:AccountAmounts|null,note:string,checked:boolean){
  if(lock.current||!row.can_edit||row.record_state!=='LIVE')return;
  let data:ReturnType<typeof accountPayload>;try{data=accountPayload(row,amounts,note,checked);}catch(e){setSaveError(e instanceof Error?e.message:'請核對金額。');return;}
  const key=JSON.stringify({storeId,batchId:row.batch_id,data});if(retry.current?.key!==key)retry.current={key,id:crypto.randomUUID()};
  lock.current=true;setSaving(true);setSaveError('');setNotice('');
  try{await saveReceiptAccount(storeId,row.batch_id,data,retry.current.id);if(!alive.current)return;retry.current=null;setEdit(null);setNotice(checked?'已完成對帳；不代表已付款或再次收貨。':'變更已儲存，貨單保留待對帳。');await load();}
  catch(e){if(alive.current)setSaveError(accountingError(e));}
  finally{lock.current=false;if(alive.current)setSaving(false);}
 }
 function saveDraft(checked:boolean){if(!edit)return;try{const changed=resetAmounts||draft.net!==String(edit.net??'')||draft.tax!==String(edit.tax??'')||draft.total!==String(edit.total??'');const amounts=resetAmounts?null:changed?{net:parseAccountInput(draft.net),tax:parseAccountInput(draft.tax),total:parseAccountInput(draft.total)}:edit.amount_override;void save(edit,amounts,draft.note,checked);}catch(e){setSaveError(e instanceof Error?e.message:'請核對金額。');}}
 async function download(){try{await exportRows(accountExportRows(filtered),'xlsx',`貨單對帳_${props.filters.from||'全部'}_${props.filters.to||'全部'}`);}catch{setSaveError('匯出未完成，請重試。');}}
 function changeChecked(event:ChangeEvent<HTMLInputElement>){const row=accounts.find(a=>a.batch_id===event.currentTarget.dataset.accountId);if(row)void save(row,row.amount_override,row.note,event.currentTarget.checked);}
 const canCompare=!props.filters.batchId&&status==='ALL'&&props.filters.category==='ALL'&&props.filters.scope==='ALL'&&!props.filters.query.trim();
 return <section className="receipt-accounting" data-tab={props.tab}>
  <div className="receipt-account-tabs" role="tablist" aria-label="進貨檢視">
   <button type="button" role="tab" aria-selected={props.tab==='items'} disabled={props.editing||saving} onClick={()=>props.onTabChange('items')}>進貨明細</button>
   <button type="button" role="tab" aria-selected={props.tab==='accounts'} disabled={props.editing||saving} onClick={()=>props.onTabChange('accounts')}>貨單對帳</button>
  </div>
  <div className="receipt-account-metrics" aria-label="貨單金額彙總">
   {(['net','tax','total'] as const).map((key,index)=><div key={key}><span>{['貨單未稅合計','稅額合計','含稅合計'][index]}</span><strong>{unavailable?'—':summary.count>0&&summary[key].missing===summary.count?'待確認':accountMoney(summary[key].value)}</strong><small>{unavailable?'讀取完成後顯示':summary[key].missing?`已知金額；${summary[key].missing} 張待確認`:'依整張貨單計算，不重複加稅'}</small></div>)}
   <div><span>待對帳</span><strong>{unavailable?'—':`${summary.count-summary.checked} 張`}</strong><small>{unavailable?'':`已對帳 ${summary.checked}／共 ${summary.count} 張`}</small></div>
  </div>
  {error&&<p className="shell-note" role="alert">稅額與對帳資料未能讀取。{error}<button type="button" className="text-button" disabled={saving} onClick={()=>{setLoading(true);void load();}}>重新讀取</button></p>}
  {notice&&<p className="shell-note" role="status">{notice}</p>}
  {!unavailable&&(summary.pending>0||summary.tax.missing>0)&&<p className="receipt-account-warning">{summary.pending>0?`尚有 ${summary.pending} 張貨單待建檔／辨識。`:''}{summary.tax.missing>0?` ${summary.tax.missing} 張稅額待確認。`:''}目前顯示已知金額，並非完整對帳總額。</p>}
  {props.tab==='items'?<>{!unavailable&&<p className="receipt-account-help">上方彙總符合篩選條件的整張貨單；下方保留品項明細與未稅小計。</p>}{props.children}</>:<>
   <div className="receipt-account-actions"><label>對帳狀態<select value={status} disabled={saving||!!edit} onChange={e=>setStatus(e.target.value)}><option value="ALL">全部對帳狀態</option>{Object.entries(accountStatusLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><div><button type="button" className="shell-secondary" disabled={unavailable||saving||!filtered.length} onClick={()=>void download()}>匯出對帳清單</button><button type="button" className="shell-secondary" disabled={unavailable||saving||!filtered.length} onClick={()=>window.print()}>列印</button></div></div>
   <p className="receipt-account-help">每張貨單一列。勾選代表「已對帳」，不等於收貨或付款；原單金額變更後會要求重新對帳。沒有到貨日期的貨單仍列出待確認。</p>
   {saveError&&!edit&&<p role="alert" className="sheet-error">{saveError}</p>}
   {!unavailable&&!filtered.length&&<p className="shell-note">目前沒有符合條件的貨單。</p>}
   {!unavailable&&[...groups].map(([supplier,rows])=>{const subtotal=accountSummary(rows),comparisonKey=JSON.stringify([storeId,props.filters.from,props.filters.to,supplier]),input=comparisons[comparisonKey]||'';let comparison:number|null=null;try{comparison=parseAccountInput(input);}catch{/* Invalid comparison is not a zero amount. */}const difference=comparison!==null&&!subtotal.total.missing?Math.round((comparison-subtotal.total.value)*10000)/10000:null;return <article className="receipt-account-group" key={supplier}>
    <header><div><h3>{supplier}</h3><small>共 {subtotal.count} 張 · 已對帳 {subtotal.checked} 張 · 待對帳 {subtotal.count-subtotal.checked} 張</small></div><strong>含稅{ subtotal.total.missing?'已知小計':'小計'} {accountMoney(subtotal.total.value)}</strong></header>
    <div className="receipt-account-scroll"><table><thead><tr>{['對帳','到貨日期','貨單號碼','未稅金額','稅額','含稅金額','狀態／備註','原單','操作'].map(s=><th key={s}>{s}</th>)}</tr></thead><tbody>{rows.map(row=><tr key={row.batch_id}>
     <td><input type="checkbox" aria-label={`對帳 ${row.document_number||row.batch_number||row.batch_id}`} checked={row.status==='CHECKED'} disabled={saving||props.disabled||props.editing||!row.can_edit||row.record_state!=='LIVE'||!['UNCHECKED','CHECKED'].includes(row.status)||!accountDate(row.receipt_date)} data-account-id={row.batch_id} onChange={changeChecked}/></td>
     <td>{accountDate(row.receipt_date)||'日期待確認'}</td><td>{row.document_number||'單號未提供'}<small>{row.batch_number||''}</small></td>
     <td className="numeric">{row.net===null?'待確認':row.net.toLocaleString('zh-TW',{maximumFractionDigits:4})}</td><td className="numeric">{row.tax===null?'稅額待確認':row.tax.toLocaleString('zh-TW',{maximumFractionDigits:4})}</td><td className="numeric">{row.total===null?'待確認':row.total.toLocaleString('zh-TW',{maximumFractionDigits:4})}</td>
     <td><span className={`receipt-account-status ${row.status.toLowerCase()}`}>{accountStatusLabels[row.status]}</span>{row.amount_conflict&&<small>金額不一致</small>}{row.amount_override&&<small>行政確認金額</small>}{row.note&&<small className="receipt-account-note">{row.note}</small>}</td>
     <td><button type="button" className="text-button" disabled={saving} onClick={()=>props.onSource(row.batch_id)}>查看</button></td><td><button type="button" className="text-button" disabled={saving||props.editing||props.disabled||!row.can_edit||row.record_state!=='LIVE'} onClick={()=>begin(row)}>核對／備註</button></td>
    </tr>)}</tbody></table></div>
    {canCompare&&<div className="receipt-account-comparison"><label>廠商對帳單金額<input inputMode="decimal" aria-label={`${supplier} 廠商對帳單金額`} value={input} onChange={e=>setComparisons(old=>({...old,[comparisonKey]:e.target.value}))} placeholder="輸入本期含稅金額"/></label><span>差異：{!input?'尚未輸入':subtotal.total.missing?'貨單金額未完整':difference===null?'請輸入有效金額':accountMoney(difference)}</span><small>本次比對試算；不儲存付款紀錄。</small></div>}
   </article>;})}
  </>}
  {edit&&<dialog ref={dialog} className="receipt-account-dialog" aria-label="核對貨單金額與備註" onCancel={e=>{e.preventDefault();close();}}>
   <header><h2>核對貨單</h2><button type="button" className="shell-secondary" disabled={saving} onClick={close}>關閉</button></header>
   <p>{edit.supplier_name||'供應商待確認'} · {accountDate(edit.receipt_date)||'日期待確認'} · {edit.document_number||edit.batch_number||'單號未提供'}</p>
   <p className="receipt-account-help">金額按整張貨單保存；原始貨單、進貨品項與庫存不會被改寫。稅額不明請留空，不會自動套用稅率。</p>
   <div className="receipt-account-fields">{(['net','tax','total'] as const).map((key,index)=><label key={key}>{['未稅金額','稅額','含稅金額'][index]}<input inputMode="decimal" disabled={saving} value={draft[key]} onChange={e=>{setResetAmounts(false);setDraft(old=>({...old,[key]:e.target.value}));}} placeholder="待確認"/></label>)}</div>
   <div className="receipt-account-tools"><button type="button" className="text-button" disabled={saving} onClick={()=>{try{const net=parseAccountInput(draft.net),tax=parseAccountInput(draft.tax);if(net===null||tax===null)throw Error('請先填寫未稅金額與稅額。');setResetAmounts(false);setDraft(old=>({...old,total:String(Math.round((net+tax)*10000)/10000)}));setSaveError('');}catch(e){setSaveError(e instanceof Error?e.message:'請核對金額。');}}}>以未稅＋稅額計算含稅</button><button type="button" className="text-button" disabled={saving} onClick={()=>{setResetAmounts(true);setDraft(old=>({...old,net:String(edit.source_net??''),tax:String(edit.source_tax??''),total:String(edit.source_total??'')}));}}>使用原單金額</button><button type="button" className="text-button" disabled={saving} onClick={()=>props.onSource(edit.batch_id)}>查看原單</button></div>
   <label className="receipt-account-note-field">備註<textarea value={draft.note} disabled={saving} maxLength={2000} rows={3} onChange={e=>setDraft(old=>({...old,note:e.target.value}))} placeholder="例如金額差異、缺單或待廠商確認事項"/></label>
   {saveError&&<p role="alert" className="sheet-error">{saveError}</p>}
   {edit.checked_at&&<p className="receipt-account-help">修改金額後，儲存為待對帳；確認無誤可選「儲存並完成對帳」。</p>}
   <footer><button type="button" className="shell-secondary" disabled={saving} onClick={()=>saveDraft(false)}>儲存為待對帳</button><button type="button" className="shell-primary" disabled={saving||edit.pending} onClick={()=>saveDraft(true)}>{saving?'儲存中…':'儲存並完成對帳'}</button></footer>
  </dialog>}
 </section>;
}
