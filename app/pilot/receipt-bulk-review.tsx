'use client';
import {Fragment,useEffect,useId,useRef,useState} from 'react';
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
 const supplierListId=useId(),productListId=useId(),unitListId=useId();
 const [selected,setSelected]=useState<string[]>([]),[saving,setSaving]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[operationId,setOperationId]=useState('');
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
  const targets=submit?picked.map(row=>drafts[row.batch_id]||{row,value:reviewDraft(row)}):dirty;
  if(!targets.length)return;
  // Validate each complete invoice; invalid selections must not block valid invoices.
  const blocked:typeof targets=[],issues:string[]=[];
  const jobs=targets.flatMap(d=>{try{const data={...reviewPayload(d.row,d.value,submit),checked:false,reviewed:submit};const signature=JSON.stringify(data),old=requests[d.row.batch_id];return [{...d,data,signature,id:old?.signature===signature?old.id:crypto.randomUUID()}];}catch(e){blocked.push(d);issues.push(`${d.value.date||'日期未填'}・${d.value.supplier||'供應商未填'}${d.value.number?'・'+d.value.number:''}：${e&&typeof e==='object'&&'message' in e?String(e.message):'請檢查輸入'}`);return [];}});
  if(!jobs.length||!submit&&issues.length){setError(issues.join('\n'));return;}
  setRequests(old=>({...old,...Object.fromEntries(jobs.map(j=>[j.row.batch_id,{signature:j.signature,id:j.id}]))}));
  lock.current=true;setSaving(true);setError(issues.join('\n'));setNotice('');let done=0;
  try{for(const job of jobs){const saved=await saveReceiptReview(props.storeId,job.row.batch_id,job.data,job.id);if(!alive.current)return;done++;props.onSaved(saved);setDrafts(old=>{const next={...old};delete next[job.row.batch_id];return next;});setRequests(old=>{const next={...old};delete next[job.row.batch_id];return next;});setSelected(old=>old.filter(id=>id!==job.row.batch_id));setNotice(`已${submit?'送入對帳':'儲存'} ${done}／${jobs.length} 張貨單`);}
   if(submit){const remaining=[...new Map([...dirty.filter(d=>!jobs.some(j=>j.row.batch_id===d.row.batch_id)),...blocked].map(d=>[d.row.batch_id,d])).values()];setDrafts(Object.fromEntries(remaining.map(d=>[d.row.batch_id,d])));if(remaining.length)setNotice(`已送入對帳 ${done} 張貨單；其餘 ${remaining.length} 張資料與修改已保留，可繼續核對。`);else props.onSubmitted();}else setDrafts({});
  }catch(e){if(alive.current)setError(`已完成 ${done} 張，其餘保留待重試。${reviewError(e)}`);}finally{lock.current=false;if(alive.current)setSaving(false);}
 }
 function amount(v:ReviewDraft,kind:'net'|'total'){try{return accountMoney(kind==='net'?reviewNet(v):reviewTotal(v));}catch{return '請檢查金額';}}
 const columns=12;
 const target=rows.find(r=>r.batch_id===operationId);
 const supplierOptions=[...new Set(rows.map(r=>r.supplier_name).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'zh-Hant'));
 const productOptions=[...new Set(rows.flatMap(r=>r.lines.map(l=>l.product_name)).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'zh-Hant'));
 const unitOptions=[...new Set(rows.flatMap(r=>r.lines.map(l=>l.unit)).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'zh-Hant'));
 const categories=['食材','耗材','包材','清潔用品','運費','設備','其他費用','待分類'];
 return <section className="receipt-sheet receipt-bulk-review">
  <datalist id={supplierListId}>{supplierOptions.map(v=><option key={v} value={v}/>)}</datalist>
  <datalist id={productListId}>{productOptions.map(v=><option key={v} value={v}/>)}</datalist>
  <datalist id={unitListId}>{unitOptions.map(v=><option key={v} value={v}/>)}</datalist>
  <div className="sheet-options"><label>歸屬<select aria-label="依歸屬篩選" value={handlingFilter} disabled={active||saving} onChange={e=>{setHandlingFilter(e.target.value);setSelected([]);}}><option value="ALL">全部歸屬</option><option value="NORMAL">一般進貨</option><option value="FREIGHT">運費／其他費用</option><option value="CUSTODY_RELEASE">寄庫領回</option></select></label><span className="receipt-inline-hint">條列逐筆核對 · 下拉／快搜直接修改</span><div className="receipt-bulk-tools">{props.onFlag&&<details><summary>其他操作</summary><div><select aria-label="選擇操作貨單" value={operationId} disabled={active||saving} onChange={e=>setOperationId(e.target.value)}><option value="">選擇貨單</option>{rows.map(r=><option key={r.batch_id} value={r.batch_id}>{r.receipt_date}・{r.supplier_name}</option>)}</select>{target&&<><button disabled={active||saving||props.disabled||!target.can_edit||target.receipt_status==='COMPLETED'} onClick={()=>props.onConfirm?.(target.batch_id)}>確認貨單</button><button disabled={active||saving||props.disabled} onClick={()=>props.onFlag?.(target.batch_id,target.record_state==='LIVE'?'TEST':'LIVE')}>{target.record_state==='LIVE'?'標記測試':'恢復正式資料'}</button><button disabled={active||saving||props.disabled} onClick={()=>props.onFlag?.(target.batch_id,'REMOVED')}>移出正式資料</button></>}</div></details>}<button type="button" className="shell-primary" disabled={saving||props.disabled||!editable.length||active} onClick={begin}>編輯所有明細</button></div></div>
  <div className="receipt-flat-wrap"><table className="receipt-flat-table receipt-bulk-grid"><colgroup><col style={{width:38}}/><col style={{width:116}}/><col style={{width:160}}/><col style={{width:230}}/><col style={{width:112}}/><col style={{width:82}}/><col style={{width:82}}/><col style={{width:108}}/><col style={{width:108}}/><col style={{width:170}}/><col style={{width:126}}/><col style={{width:170}}/></colgroup><thead><tr><th><input type="checkbox" aria-label="勾選全部貨單" checked={!!eligible.length&&picked.length===eligible.length} disabled={saving||props.disabled||!eligible.length} onChange={e=>setSelected(e.target.checked?eligible.map(r=>r.batch_id):[])}/></th>{['日期 ↑','供應商','品名','分類','數量','單位','未稅單價','未稅金額','規格','備註','原貨單'].map(s=><th key={s}>{s}</th>)}</tr></thead><tbody>
  {rows.map(row=>{const id=row.batch_id,d=drafts[id]||(active&&row.can_edit&&row.record_state==='LIVE'?{row,value:reviewDraft(row)}:undefined),value=d?.value||reviewDraft(row);return <Fragment key={id}>{value.lines.map((line,index)=><tr key={`${id}:${line.row_key}`}>
   <td className="receipt-select"><input type="checkbox" aria-label={`勾選整張貨單 ${value.supplier} ${value.date} ${index+1}`} checked={selected.includes(id)} disabled={saving||props.disabled||!eligible.some(r=>r.batch_id===id)} onChange={e=>toggle(id,e.target.checked)}/></td>
   <td>{d?<input type="date" aria-label={`第 ${index+1} 筆 日期`} value={value.date} disabled={saving||value.lines.some(l=>l.custody_posted)} onChange={e=>update(id,v=>({...v,date:e.target.value}))}/>:<span>{value.date||'待確認'}</span>}</td>
   <td>{d?<input type="text" list={supplierListId} aria-label={`第 ${index+1} 筆 供應商`} value={value.supplier} disabled={saving} onChange={e=>update(id,v=>({...v,supplier:e.target.value}))}/>:<span>{value.supplier||'待確認'}</span>}</td>
   <td>{d?<input type="text" list={productListId} aria-label={`${line.product_name} 品名`} value={line.product_name} disabled={saving} onChange={e=>update(id,v=>changeReviewLine(v,index,'product_name',e.target.value))}/>:<span title={line.product_name}>{line.product_name||'—'}</span>}<ReceiptHandlingFields storeId={props.storeId} line={line} editing={!!d} disabled={saving} onChange={(key,val)=>update(id,v=>changeReviewLine(v,index,key,val))}/></td>
   <td>{d?<select aria-label={`${line.product_name} 分類`} value={line.category} disabled={saving} onChange={e=>update(id,v=>changeReviewLine(v,index,'category',e.target.value))}>{categories.map(c=><option key={c}>{c}</option>)}</select>:<span>{line.category||'待分類'}</span>}</td>
   <td className="numeric">{d?<input aria-label={`${line.product_name} 數量`} inputMode="decimal" value={line.quantity} disabled={saving||!!line.custody_posted} onChange={e=>update(id,v=>changeReviewLine(v,index,'quantity',e.target.value))}/>:<span>{line.quantity||'—'}</span>}</td>
   <td>{d?<input type="text" list={unitListId} aria-label={`${line.product_name} 單位`} value={line.unit} disabled={saving||!!line.custody_posted} onChange={e=>update(id,v=>changeReviewLine(v,index,'unit',e.target.value))}/>:<span>{line.unit||'—'}</span>}</td>
   <td className="numeric">{receiptHandling(line)==='CUSTODY_RELEASE'?<span className="receipt-nonbilling">—</span>:d?<input aria-label={`${line.product_name} 未稅單價`} inputMode="decimal" value={line.unit_price} disabled={saving} onChange={e=>update(id,v=>changeReviewLine(v,index,'unit_price',e.target.value))}/>:<span>{line.unit_price||'—'}</span>}</td>
   <td className="numeric">{receiptHandling(line)==='CUSTODY_RELEASE'?<span className="receipt-nonbilling">本次不計款</span>:d?<input aria-label={`${line.product_name} 未稅金額`} inputMode="decimal" value={line.subtotal} disabled={saving} onChange={e=>update(id,v=>changeReviewLine(v,index,'subtotal',e.target.value))}/>:<span>{line.subtotal||'—'}</span>}</td>
   <td>{d?<input aria-label={`${line.product_name} 規格`} value={line.specification} disabled={saving} onChange={e=>update(id,v=>changeReviewLine(v,index,'specification',e.target.value))}/>:<span title={line.specification}>{line.specification||'—'}</span>}</td>
   <td>{d?<input aria-label={`${line.product_name} 備註`} value={line.note} disabled={saving} onChange={e=>update(id,v=>changeReviewLine(v,index,'note',e.target.value))}/>:<span title={line.note}>{line.note||'—'}</span>}</td>
   <td><button type="button" className="text-button" onClick={()=>props.onSource(id)}>查看原貨單 ↗</button></td>
  </tr>)}{d&&<tr className="receipt-bulk-tax"><td colSpan={columns}><div><strong>本張貨單</strong><span>未稅合計 {amount(value,'net')}</span>{(['tax','total'] as const).map(k=><label key={k}>{k==='tax'?'稅額':'原單含稅金額'}<input aria-label={`${value.supplier} ${value.date} ${k==='tax'?'稅額':'含稅金額'}`} inputMode="decimal" value={value[k]} disabled={saving} onChange={e=>update(id,v=>({...v,[k]:e.target.value}))}/></label>)}<button type="button" className="text-button" disabled={saving} onClick={()=>{try{const total=reviewTotal(value);if(total!==null)update(id,v=>({...v,total:String(total)}));}catch{setError('請檢查數量、單價與稅額。');}}}>帶入含稅金額</button><details><summary>調整與貨單備註</summary>{(['adjustment','adjustmentNote','note'] as const).map((k,i)=><label key={k}>{['調整金額','調整說明','貨單備註'][i]}<input value={value[k]} disabled={saving} onChange={e=>update(id,v=>({...v,[k]:e.target.value}))}/></label>)}</details></div></td></tr>}</Fragment>;})}
  </tbody></table></div>
  {!rows.length&&<p className="shell-note">目前沒有符合條件的明細。</p>}
  {active&&<p className="sheet-notice">直接在列內修改，供應商、品名與單位可輸入快搜既有資料，分類直接下拉。Tab 可連續跳下一格。可先勾選正確貨單送入對帳；有疑慮的資料與未送出的修改會保留，不會卡住其他貨單。</p>}
  {error&&<p role="alert" className="sheet-error" style={{whiteSpace:'pre-line'}}>{error}</p>}
  {notice&&<p role="status" className="sheet-notice">{notice}</p>}
  <div className={`sheet-savebar${active?' is-editing':''}`}><span>已勾選 {picked.length} 張貨單{dirty.length?` · ${dirty.length} 張有修改（含篩選外）`:''}</span><div>{active&&<button className="sheet-cancel" disabled={saving} onClick={cancel}>取消</button>}<button className="sheet-cancel" disabled={saving||props.disabled||!dirty.length} onClick={()=>void save(false)}>{saving?'處理中…':'儲存修改'}</button><button className="sheet-save" disabled={saving||props.disabled||!picked.length} onClick={()=>void save(true)}>確認無誤，送入對帳</button></div></div>
 </section>;
}
