'use client';
import {Fragment,useEffect,useRef,useState} from 'react';
import {saveReceiptReview} from '@/lib/receipt-accounting-api';
import {accountMoney} from '@/lib/receipt-accounting';
import ReceiptHandlingFields from './receipt-handling-fields';
import {receiptHandling,changeReviewLine,reviewDraft,reviewError,reviewNet,reviewPayload,reviewTotal,type ReviewAccount,type ReviewDraft} from '@/lib/receipt-review';
import {useOperationDraft} from './operation-hooks';
import './receipt-ledger-table.css';
import './receipt-bulk-layout.css';
type Draft={row:ReviewAccount;value:ReviewDraft};
type Props={storeId:string;userId:string;rows:ReviewAccount[];disabled:boolean;onSource:(id:string)=>void;onEditing:(key:string,active:boolean)=>void;onSaved:(row:ReviewAccount)=>void;onSubmitted:()=>void;onFlag?:(id:string,state:'LIVE'|'TEST'|'REMOVED')=>void;onConfirm?:(id:string)=>void};
export default function ReceiptBulkReview(props:Props){
 const [drafts,setDrafts]=useOperationDraft<Record<string,Draft>>(props.userId,props.storeId,'receipt-bulk-review-v1',{});
 const [handlingFilter,setHandlingFilter]=useState('ALL');
 const [selected,setSelected]=useState<string[]>([]),[extra,setExtra]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[operationId,setOperationId]=useState('');
 const lock=useRef(false),alive=useRef(true);
 const [requests,setRequests]=useOperationDraft<Record<string,{signature:string;id:string}>>(props.userId,props.storeId,'receipt-bulk-review-requests',{});
 const active=Object.keys(drafts).length>0,{onEditing}=props;
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{onEditing('bulk-review',active);return()=>onEditing('bulk-review',false);},[active,onEditing]);
 useEffect(()=>{onEditing('bulk-saving',saving);return()=>onEditing('bulk-saving',false);},[saving,onEditing]);
 useEffect(()=>{if(!active)return;const warn=(e:BeforeUnloadEvent)=>e.preventDefault();window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[active]);
 // Keep the saved snapshot for conflict checks, even when a background refresh arrives.
 const rows=props.rows.map(row=>drafts[row.batch_id]?.row||row).filter(r=>active||handlingFilter==='ALL'||r.lines.some(l=>receiptHandling(l)===handlingFilter)).sort((a,b)=>(a.receipt_date||'9999').localeCompare(b.receipt_date||'9999')||a.batch_id.localeCompare(b.batch_id));
 const editable=rows.filter(r=>r.can_edit&&r.record_state==='LIVE'&&r.lines.length>0);
 const eligible=editable.filter(r=>!r.reviewed&&r.status!=='CHECKED');
 const picked=eligible.filter(r=>selected.includes(r.batch_id));
 const dirty=Object.values(drafts).filter(d=>JSON.stringify(d.value)!==JSON.stringify(reviewDraft(d.row)));
 function begin(){setError('');setNotice('');setDrafts(old=>({...Object.fromEntries(editable.map(row=>[row.batch_id,{row,value:reviewDraft(row)}])),...old}));}
 function update(id:string,change:(v:ReviewDraft)=>ReviewDraft){setDrafts(old=>({...old,[id]:{row:old[id]?.row||props.rows.find(row=>row.batch_id===id)!,value:change(old[id]?.value||reviewDraft(props.rows.find(row=>row.batch_id===id)!))}}));}
 function toggle(id:string,checked:boolean){setSelected(old=>checked?[...new Set([...old,id])]:old.filter(v=>v!==id));}
 function cancel(){if(lock.current)return;if(dirty.length&&!window.confirm('捨棄尚未儲存的修改？'))return;setDrafts({});setError('');}
 async function save(submit:boolean){
  if(lock.current||props.disabled)return;
  if(submit&&dirty.length){setError('請先儲存修改，再勾選核對完成的貨單。');return;}
  const targets=submit?picked.map(row=>({row,value:reviewDraft(row)})):dirty;
  if(!targets.length)return;
  // Validate the complete selection before the first write; never send only the filtered lines.
  let jobs;try{jobs=targets.map(d=>{const data={...reviewPayload(d.row,d.value,submit),checked:false,reviewed:submit};const signature=JSON.stringify(data),old=requests[d.row.batch_id];return {...d,data,signature,id:old?.signature===signature?old.id:crypto.randomUUID()};});}catch(e){setError(e instanceof Error?e.message:'請檢查輸入');return;}
  setRequests(old=>({...old,...Object.fromEntries(jobs.map(j=>[j.row.batch_id,{signature:j.signature,id:j.id}]))}));
  lock.current=true;setSaving(true);setError('');setNotice('');let done=0;
  try{for(const job of jobs){const saved=await saveReceiptReview(props.storeId,job.row.batch_id,job.data,job.id);if(!alive.current)return;done++;props.onSaved(saved);setDrafts(old=>{const next={...old};delete next[job.row.batch_id];return next;});setRequests(old=>{const next={...old};delete next[job.row.batch_id];return next;});setSelected(old=>old.filter(id=>id!==job.row.batch_id));setNotice(`已${submit?'送入對帳':'儲存'} ${done}／${jobs.length} 張貨單`);}
   setDrafts({});if(submit)props.onSubmitted();
  }catch(e){if(alive.current)setError(`已完成 ${done} 張，其餘保留待重試。${reviewError(e)}`);}finally{lock.current=false;if(alive.current)setSaving(false);}
 }
 function amount(v:ReviewDraft,kind:'net'|'total'){try{return accountMoney(kind==='net'?reviewNet(v):reviewTotal(v));}catch{return '請檢查金額';}}
 const columns=extra?12:10;
 const target=rows.find(r=>r.batch_id===operationId);
 return <section className="receipt-sheet receipt-bulk-review">
  <div className="sheet-options"><label>歸屬<select aria-label="依歸屬篩選" value={handlingFilter} disabled={active||saving} onChange={e=>{setHandlingFilter(e.target.value);setSelected([]);}}><option value="ALL">全部歸屬</option><option value="NORMAL">一般進貨</option><option value="FREIGHT">運費／其他費用</option><option value="CUSTODY_RELEASE">寄庫領回</option></select></label><label><input type="checkbox" checked={extra} onChange={e=>setExtra(e.target.checked)}/>分類與備註</label><div className="receipt-bulk-tools">{props.onFlag&&<details><summary>其他操作</summary><div><select aria-label="選擇操作貨單" value={operationId} disabled={active||saving} onChange={e=>setOperationId(e.target.value)}><option value="">選擇貨單</option>{rows.map(r=><option key={r.batch_id} value={r.batch_id}>{r.receipt_date}・{r.supplier_name}</option>)}</select>{target&&<><button disabled={active||saving||props.disabled||!target.can_edit||target.receipt_status==='COMPLETED'} onClick={()=>props.onConfirm?.(target.batch_id)}>確認貨單</button><button disabled={active||saving||props.disabled} onClick={()=>props.onFlag?.(target.batch_id,target.record_state==='LIVE'?'TEST':'LIVE')}>{target.record_state==='LIVE'?'標記測試':'恢復正式資料'}</button><button disabled={active||saving||props.disabled} onClick={()=>props.onFlag?.(target.batch_id,'REMOVED')}>移出正式資料</button></>}</div></details>}<button type="button" className="shell-primary" disabled={saving||props.disabled||!editable.length||active} onClick={begin}>編輯所有明細</button></div></div>
  <div className="receipt-flat-wrap"><table className={`receipt-flat-table${extra?' sheet-extra':''}`}><colgroup><col style={{width:36}}/><col style={{width:112}}/><col style={{width:145}}/><col/><col style={{width:110}}/><col style={{width:68}}/><col style={{width:62}}/><col style={{width:88}}/><col style={{width:94}}/><col style={{width:110}}/>{extra&&<><col style={{width:85}}/><col style={{width:150}}/></>}</colgroup><thead><tr><th><input type="checkbox" aria-label="勾選全部貨單" checked={!!eligible.length&&picked.length===eligible.length} disabled={saving||props.disabled||!eligible.length} onChange={e=>setSelected(e.target.checked?eligible.map(r=>r.batch_id):[])}/></th>{['日期 ↑','供應商','品名','規格','數量','單位','未稅單價','未稅金額','原貨單',...(extra?['分類','備註']:[])].map(s=><th key={s}>{s}</th>)}</tr></thead><tbody>
  {rows.map(row=>{const id=row.batch_id,d=drafts[id]||(active&&row.can_edit&&row.record_state==='LIVE'?{row,value:reviewDraft(row)}:undefined),value=d?.value||reviewDraft(row);return <Fragment key={id}>{value.lines.map((line,index)=><tr key={`${id}:${line.row_key}`}>
   <td className="receipt-select"><input type="checkbox" aria-label={`勾選整張貨單 ${value.supplier} ${value.date} ${index+1}`} checked={selected.includes(id)} disabled={saving||props.disabled||!eligible.some(r=>r.batch_id===id)} onChange={e=>toggle(id,e.target.checked)}/></td>
   {(['date','supplier'] as const).map(k=><td key={k}>{d?<input type={k==='date'?'date':'text'} aria-label={`第 ${index+1} 筆 ${k==='date'?'日期':'供應商'}`} value={value[k]} disabled={saving||k==='date'&&value.lines.some(l=>l.custody_posted)} onChange={e=>update(id,v=>({...v,[k]:e.target.value}))}/>:<span>{value[k]||'待確認'}</span>}</td>)}
   {(['product_name','specification','quantity','unit','unit_price','subtotal'] as const).map((k,i)=><td key={k} className={['quantity','unit_price','subtotal'].includes(k)?'numeric':''}>{receiptHandling(line)==='CUSTODY_RELEASE'&&['unit_price','subtotal'].includes(k)?<span className="receipt-nonbilling">{k==='subtotal'?'本次不計款':'—'}</span>:d&&(k==='product_name'||k==='specification')?<textarea rows={2} aria-label={`${line.product_name} ${k==='product_name'?'品名':'規格'}`} value={line[k]} disabled={saving||!!line.custody_posted&&['quantity','unit'].includes(k)} onChange={e=>update(id,v=>changeReviewLine(v,index,k,e.target.value))}/>:d?<input aria-label={`${line.product_name} ${['品名','規格','數量','單位','未稅單價','未稅金額'][i]}`} inputMode={['quantity','unit_price','subtotal'].includes(k)?'decimal':undefined} value={line[k]} disabled={saving||!!line.custody_posted&&['quantity','unit'].includes(k)} onChange={e=>update(id,v=>changeReviewLine(v,index,k,e.target.value))}/>:<span title={line[k]}>{line[k]||'—'}</span>}{k==='product_name'&&<ReceiptHandlingFields storeId={props.storeId} line={line} editing={!!d} disabled={saving} onChange={(key,val)=>update(id,v=>changeReviewLine(v,index,key,val))}/>}</td>)}
   <td><button type="button" className="text-button" onClick={()=>props.onSource(id)}>查看原貨單 ↗</button></td>
   {extra&&<><td>{d?<select aria-label={`${line.product_name} 分類`} value={line.category} disabled={saving} onChange={e=>update(id,v=>changeReviewLine(v,index,'category',e.target.value))}>{['食材','耗材','調料','酒水','待分類'].map(c=><option key={c}>{c}</option>)}</select>:<span>{line.category}</span>}</td><td>{d?<input aria-label={`${line.product_name} 備註`} value={line.note} disabled={saving} onChange={e=>update(id,v=>changeReviewLine(v,index,'note',e.target.value))}/>:<span title={line.note}>{line.note||'—'}</span>}</td></>}
  </tr>)}{d&&<tr className="receipt-bulk-tax"><td colSpan={columns}><div><strong>本張貨單</strong><span>未稅合計 {amount(value,'net')}</span>{(['tax','total'] as const).map(k=><label key={k}>{k==='tax'?'稅額':'原單含稅金額'}<input aria-label={`${value.supplier} ${value.date} ${k==='tax'?'稅額':'含稅金額'}`} inputMode="decimal" value={value[k]} disabled={saving} onChange={e=>update(id,v=>({...v,[k]:e.target.value}))}/></label>)}<button type="button" className="text-button" disabled={saving} onClick={()=>{try{const total=reviewTotal(value);if(total!==null)update(id,v=>({...v,total:String(total)}));}catch{setError('請檢查數量、單價與稅額。');}}}>帶入含稅金額</button><details><summary>調整與貨單備註</summary>{(['adjustment','adjustmentNote','note'] as const).map((k,i)=><label key={k}>{['調整金額','調整說明','貨單備註'][i]}<input value={value[k]} disabled={saving} onChange={e=>update(id,v=>({...v,[k]:e.target.value}))}/></label>)}</details></div></td></tr>}</Fragment>;})}
  </tbody></table></div>
  {!rows.length&&<p className="shell-note">目前沒有符合條件的明細。</p>}
  {active&&<p className="sheet-notice">切換上方日期或供應商會保留修改；儲存修改會儲存所有已修改貨單（含篩選外）。日期與供應商套用同張貨單；稅額每張只填一次。修改已送入對帳的貨單後，需重新核對。</p>}
  {error&&<p role="alert" className="sheet-error">{error}</p>}
  {notice&&<p role="status" className="sheet-notice">{notice}</p>}
  <div className={`sheet-savebar${active?' is-editing':''}`}><span>已勾選 {picked.length} 張貨單{dirty.length?` · ${dirty.length} 張有修改（含篩選外）`:''}</span><div>{active&&<button className="sheet-cancel" disabled={saving} onClick={cancel}>取消</button>}<button className="sheet-cancel" disabled={saving||props.disabled||!dirty.length} onClick={()=>void save(false)}>{saving?'處理中…':'儲存修改'}</button><button className="sheet-save" disabled={saving||props.disabled||!picked.length||!!dirty.length} onClick={()=>void save(true)}>確認無誤，送入對帳</button></div></div>
 </section>;
}
