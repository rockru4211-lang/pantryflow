'use client';
import {useEffect,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase-browser';
import {receiptRead,receiptReadError} from '@/lib/receipt-read';
import {readScopedReceiptAccounts,saveReceiptReview,beginReceiptManualReview,addReceiptDraftRow} from '@/lib/receipt-accounting-api';
import {accountMoney} from '@/lib/receipt-accounting';
import ReceiptHandlingFields from './receipt-handling-fields';
import {receiptHandling,changeReviewLine,reviewDraft,reviewError,reviewNet,reviewPayload,reviewTotal,type ReviewAccount,type ReviewDraft} from '@/lib/receipt-review';
import ReceiptSourceViewer from './receipt-source-viewer';
import type {ReceiptField} from '@/lib/receipt-workflow';
import {supplierItems,applySupplierItem,type SupplierItem} from '@/lib/receipt-supplier-items';
import './receipt-review-workbench.css';
type Props={storeId:string;batchId:string;nextId:string|null;manualEntry?:boolean;onClose:()=>void;onSaved:(row:ReviewAccount,next:boolean)=>void};
export default function ReceiptReviewWorkbench({storeId,batchId,nextId,manualEntry=false,onClose,onSaved}:Props){
 const [row,setRow]=useState<ReviewAccount|null>(null),[draft,setDraft]=useState<ReviewDraft|null>(null),[original,setOriginal]=useState('');
 const [urls,setUrls]=useState<Record<string,string>>({}),[error,setError]=useState(''),[imageError,setImageError]=useState(''),[saving,setSaving]=useState(false),[reload,setReload]=useState(0);
 const dialog=useRef<HTMLDialogElement>(null),lock=useRef(false),retry=useRef<{key:string;id:string}|null>(null),alive=useRef(true);
 const [sourceVisible,setSourceVisible]=useState(true);
 const [suggestions,setSuggestions]=useState<{supplier:string;items:SupplierItem[]}>({supplier:'',items:[]}),[itemPicker,setItemPicker]=useState<number|null>(null),[historyError,setHistoryError]=useState('');
 const [uncertainFields,setUncertainFields]=useState<ReceiptField[]>([]);
 const historyRequest=useRef(0);
 const addRequest=useRef<string|null>(null);
 const dirty=!!draft&&JSON.stringify(draft)!==original;
 useEffect(()=>{dialog.current?.showModal();const controller=new AbortController();alive.current=true;
  async function load(){try{if(manualEntry)await beginReceiptManualReview(storeId,batchId);if(controller.signal.aborted)return;const rows=await readScopedReceiptAccounts(storeId,controller.signal,'','','ALL',batchId);const current=rows.find(a=>a.batch_id===batchId);if(!current)throw Error('RECEIPT_ACCESS_DENIED');if(controller.signal.aborted)return;setRow(current);const d=reviewDraft(current);setDraft(d);setOriginal(JSON.stringify(d));setError('');retry.current=null;
   if(manualEntry)void receiptRead(signal=>supabase.rpc('get_pilot_receipt',{p_batch_id:batchId}).abortSignal(signal),controller.signal).then(detail=>{if(!controller.signal.aborted&&!detail.error){const fields=(detail.data as unknown as {fields?:ReceiptField[]})?.fields||[];setUncertainFields(fields.filter(f=>!f.corrected&&f.review_status!=='TRUSTED'));}}).catch(()=>{});
   if(current.documents?.length){const r=await supabase.storage.from('receipt-documents').createSignedUrls(current.documents.map(x=>x.path),3600);if(controller.signal.aborted)return;if(r.error)setImageError('原單暫時無法讀取；明細仍保留，可關閉後重開。');else setUrls(Object.fromEntries((r.data||[]).map(x=>[x.path||'',x.signedUrl||''])));}
  }catch(e){if(!controller.signal.aborted)setError(receiptReadError(e));}}
  void load();return()=>{alive.current=false;controller.abort();};
 },[storeId,batchId,reload,manualEntry]);
 useEffect(()=>{if(!dirty&&!saving)return;const warn=(e:BeforeUnloadEvent)=>e.preventDefault();window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirty,saving]);
 function close(){if(lock.current)return;if(dirty&&!window.confirm('還有未儲存修正。確定捨棄並關閉？'))return;onClose();}
 function reloadData(){if(lock.current||dirty&&!window.confirm('重新讀取將捨棄此視窗尚未儲存的修正，確定繼續？'))return;setError('');setReload(n=>n+1);}
 async function save(checked:boolean,next:boolean){if(!row||!draft||lock.current)return;let data:ReturnType<typeof reviewPayload>;try{data=reviewPayload(row,draft,checked);}catch(e){setError(e instanceof Error?e.message:'請檢查輸入');return;}
  const key=JSON.stringify({storeId,batchId,data});if(retry.current?.key!==key)retry.current={key,id:crypto.randomUUID()};lock.current=true;setSaving(true);setError('');
  try{const saved=await saveReceiptReview(storeId,batchId,data,retry.current.id);if(!alive.current)return;retry.current=null;onSaved(saved,next);}catch(e){if(alive.current)setError(reviewError(e));}finally{lock.current=false;if(alive.current)setSaving(false);}
 }
 async function showItems(index:number){
  setItemPicker(index);if(!draft?.supplier.trim())return;
  const supplier=draft.supplier.trim();if(suggestions.supplier===supplier)return;
  const sequence=++historyRequest.current;setHistoryError('');
  try{const from=new Date();from.setDate(from.getDate()-90);const rows=await readScopedReceiptAccounts(storeId,new AbortController().signal,from.toISOString().slice(0,10),'',supplier);if(alive.current&&sequence===historyRequest.current)setSuggestions({supplier,items:supplierItems(rows,supplier,batchId)});}
  catch{if(alive.current&&sequence===historyRequest.current)setHistoryError('常用品項暫時無法讀取，仍可直接輸入。');}
 }
 async function addRow(){
  if(!row||!draft||lock.current)return;
  lock.current=true;setSaving(true);setError('');
  try{
   if(dirty){const data=reviewPayload(row,draft,false);const key=JSON.stringify({storeId,batchId,data});if(retry.current?.key!==key)retry.current={key,id:crypto.randomUUID()};const saved=await saveReceiptReview(storeId,batchId,data,retry.current.id);retry.current=null;if(!alive.current)return;setRow(saved);const d=reviewDraft(saved);setDraft(d);setOriginal(JSON.stringify(d));}
   const run=await beginReceiptManualReview(storeId,batchId);
   if(!run)throw Error('OCR_VERSION_CHANGED');
   addRequest.current??=crypto.randomUUID();
   await addReceiptDraftRow(storeId,batchId,run,addRequest.current);
   addRequest.current=null;if(alive.current)setReload(n=>n+1);
  }catch(e){if(alive.current)setError(reviewError(e));}finally{lock.current=false;if(alive.current)setSaving(false);}
 }
 function needsCheck(index:number,key:string){
  const line=draft?.lines[index];if(!line)return false;
  if(['product_name','quantity','unit','unit_price'].includes(key)&&!line[key as keyof typeof line])return true;
  const fieldName=key==='product_name'?'product':key==='unit_price'?'unit_price_ex_tax':key;
  return uncertainFields.some(f=>f.row_key===line.row_key&&f.field_name===fieldName&&String(f.value??'')===String(line[key as keyof typeof line]??''))&&!(row?.edit_revision);
 }
 function update(key:keyof Omit<ReviewDraft,'lines'>,value:string){setDraft(d=>d?{...d,[key]:value}:d);}
 let net:number|null=null,computed:number|null=null;try{if(draft){net=reviewNet(draft);computed=reviewTotal(draft);}}catch{/* Invalid input remains in the draft, never coerced to zero. */}
 const readOnly=!!row&&(!row.can_edit||row.record_state!=='LIVE');
 return <dialog ref={dialog} className="receipt-review-workbench receipt-account-dialog" aria-label="原單與明細核對" onCancel={e=>{e.preventDefault();close();}}>
  <header><div><h2>原單與明細核對</h2><small>{row?.supplier_name||'讀取貨單…'} · {row?.document_number||row?.batch_number||''}</small></div><button type="button" className="shell-secondary" disabled={saving} onClick={close}>關閉</button></header>
  {error&&<p className="sheet-error" role="alert">{error} <button type="button" className="text-button" disabled={saving} onClick={reloadData}>重新讀取</button></p>}
  {!draft&&!error&&<p role="status">正在讀取這張貨單…</p>}
  {row&&draft&&<div className={`receipt-review-split${sourceVisible?'':' source-hidden'}`}>
   {sourceVisible&&<aside aria-label="原始貨單">{imageError&&<p role="alert">{imageError}</p>}<ReceiptSourceViewer documents={row.documents||[]} imageUrls={urls}/></aside>}
   <section className="receipt-review-edit" aria-label="可更正進貨明細">
    <p className="receipt-account-help">對照原單直接修改，未填資料可以後補。原始照片與修改紀錄保留。</p>
    {row.source_changed&&<p className="receipt-account-warning">原始資料已有新修正，請重新核對原單與本次明細。</p>}
    {row.pending&&<p className="receipt-account-warning">照片已保存，可新增明細並先儲存，核對完成後再送對帳。</p>}
    <div className="receipt-review-actions"><button type="button" className="shell-secondary" disabled={saving} onClick={()=>setSourceVisible(v=>!v)}>{sourceVisible?'收起原單':'顯示原單'}</button>{manualEntry&&row.receipt_status!=='COMPLETED'&&<button type="button" className="shell-secondary" disabled={saving||readOnly} onClick={()=>void addRow()}>＋ 新增一列</button>}</div>
    <fieldset disabled={saving||readOnly}>
     <div className="receipt-review-head"><label>供應商<input aria-label="貨單供應商" value={draft.supplier} maxLength={160} onChange={e=>update('supplier',e.target.value)}/></label><label>到貨日期<input aria-label="貨單到貨日期" type="date" value={draft.date} onChange={e=>update('date',e.target.value)}/></label><label>貨單號碼<input aria-label="貨單號碼" value={draft.number} maxLength={160} onChange={e=>update('number',e.target.value)}/></label></div>
     <div className="receipt-review-lines"><table><thead><tr>{['品名','規格','數量','單位','未稅單價','未稅金額','分類','備註'].map(v=><th key={v}>{v}</th>)}</tr></thead><tbody>{draft.lines.map((line,index)=><tr key={line.row_key}>
      {(['product_name','specification','quantity','unit','unit_price','subtotal'] as const).map((key,i)=><td key={key}>{receiptHandling(line)==='CUSTODY_RELEASE'&&['unit_price','subtotal'].includes(key)?<span className="receipt-nonbilling">{key==='subtotal'?'本次不計款':'—'}</span>:<input disabled={!!line.custody_posted&&['quantity','unit'].includes(key)} aria-label={`第 ${index+1} 筆 ${['品名','規格','數量','單位','未稅單價','未稅金額'][i]}`} inputMode={['quantity','unit_price','subtotal'].includes(key)?'decimal':undefined} className={needsCheck(index,key)?'receipt-needs-check':undefined} title={needsCheck(index,key)?'待核對，可先儲存':undefined} onFocus={key==='product_name'?()=>void showItems(index):undefined} value={line[key]} onChange={e=>setDraft(d=>d?changeReviewLine(d,index,key,e.target.value):d)}/ >}{key==='product_name'&&itemPicker===index&&<div className="receipt-item-picker"><small>此廠商近期品項</small>{!draft.supplier.trim()?<small>先填供應商，或直接輸入品名。</small>:historyError?<small>{historyError}</small>:(suggestions.supplier===draft.supplier.trim()?suggestions.items:[]).filter(item=>!line.product_name||item.name.includes(line.product_name)).slice(0,6).map(item=><button type="button" key={`${item.name}:${item.unit}:${item.specification}`} onClick={()=>{setDraft(d=>d?applySupplierItem(d,index,item):d);setItemPicker(null);}}>{item.name}<small>{item.unit} {item.specification}</small></button>)}<button type="button" className="text-button" onClick={()=>setItemPicker(null)}>收起</button></div>}
      {key==='unit_price'&&suggestions.supplier===draft.supplier.trim()&&receiptHandling(line)==='NORMAL'&&suggestions.items.filter(item=>item.name===line.product_name&&item.unit===line.unit&&item.specification===line.specification&&item.price!==null).slice(0,1).map(item=><button type="button" className="text-button receipt-last-price" key={item.name} title="確認後才套用上次進價" onClick={()=>setDraft(d=>d?changeReviewLine(d,index,'unit_price',String(item.price)):d)}>套用上次 {item.price}<small>{item.date}</small></button>)}
      {key==='product_name'&&<ReceiptHandlingFields storeId={storeId} line={line} editing={!readOnly} disabled={saving} onChange={(key,val)=>setDraft(d=>d?changeReviewLine(d,index,key,val):d)}/>}</td>)}
      <td><select aria-label={`第 ${index+1} 筆 分類`} value={line.category} onChange={e=>setDraft(d=>d?changeReviewLine(d,index,'category',e.target.value):d)}>{['食材','耗材','調料','酒水','待分類'].map(c=><option key={c}>{c}</option>)}</select></td><td><input aria-label={`第 ${index+1} 筆 備註`} value={line.note} maxLength={2000} onChange={e=>setDraft(d=>d?changeReviewLine(d,index,'note',e.target.value):d)}/></td>
     </tr>)}</tbody></table></div>
     <div className="receipt-review-head"><label>調整金額<input aria-label="貨單調整金額" inputMode="decimal" value={draft.adjustment} onChange={e=>update('adjustment',e.target.value)}/></label><label className="wide">調整說明（可後補）<input aria-label="貨單調整說明" placeholder="折讓、運費或尾差，可之後補充" value={draft.adjustmentNote} maxLength={2000} onChange={e=>update('adjustmentNote',e.target.value)}/></label></div>
     <div className="receipt-review-head"><div><span>未稅合計</span><strong>{accountMoney(net)}</strong></div><label>稅額<input aria-label="貨單稅額" inputMode="decimal" placeholder="不明請留空" value={draft.tax} onChange={e=>update('tax',e.target.value)}/></label><label>原單含稅金額<input aria-label="貨單含稅金額" inputMode="decimal" value={draft.total} onChange={e=>update('total',e.target.value)}/></label></div>
     <p className="receipt-account-help">未稅＋稅額：{accountMoney(computed)} <button type="button" className="text-button" disabled={computed===null} onClick={()=>update('total',String(computed))}>帶入含稅金額</button>（不自動套用稅率）</p>
     <label>對帳備註<textarea aria-label="貨單對帳備註" value={draft.note} maxLength={2000} onChange={e=>update('note',e.target.value)}/></label>
    </fieldset>
   </section>
  </div>}
  {draft&&<footer><span>{saving?'儲存中，請勿重複送出':dirty?'有未儲存修正':'原始貨單與更正紀錄均保留'}</span><div><button type="button" className="shell-secondary" disabled={saving||readOnly} onClick={()=>void save(false,false)}>先儲存，保留待對帳</button><button type="button" className="shell-primary" disabled={saving||readOnly||!!row?.pending} onClick={()=>void save(true,true)}>{nextId?'儲存並對帳下一張':'儲存並完成對帳'}</button></div></footer>}
 </dialog>;
}
