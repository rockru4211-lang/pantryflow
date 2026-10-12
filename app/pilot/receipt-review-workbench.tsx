'use client';
import {useEffect,useRef,useState,type CSSProperties} from 'react';
import {supabase} from '@/lib/supabase-browser';
import {receiptRead,receiptReadError} from '@/lib/receipt-read';
import {readScopedReceiptAccounts,saveReceiptReview,beginReceiptManualReview,addReceiptDraftRow,addReceiptItems} from '@/lib/receipt-accounting-api';
import {accountMoney} from '@/lib/receipt-accounting';
import {useCustodyReminders,ReceiptReminderBadge} from './custody-reminder-badge';
import ReceiptHandlingFields from './receipt-handling-fields';
import {receiptHandling,changeReviewLine,reviewDraft,reviewError,reviewNet,reviewPayload,reviewTotal,enteredSubtotal,taxExclusivePrice,type ReviewAccount,type ReviewDraft} from '@/lib/receipt-review';
import ReceiptSourceViewer from './receipt-source-viewer';
import type {ReceiptField} from '@/lib/receipt-workflow';
import {supplierItems,applySupplierItem,matchSupplierItems,matchReceiptSuppliers,itemsForSupplier,receiptItemQuery,type ReceiptSupplierChoice,type SupplierItem} from '@/lib/receipt-supplier-items';
import './receipt-review-workbench.css';
type Props={storeId:string;batchId:string;nextId:string|null;manualEntry?:boolean;onClose:()=>void;onSaved:(row:ReviewAccount,next:boolean)=>void};
export default function ReceiptReviewWorkbench({storeId,batchId,nextId,manualEntry=false,onClose,onSaved}:Props){
 const reminders=useCustodyReminders(storeId);
 const [row,setRow]=useState<ReviewAccount|null>(null),[draft,setDraft]=useState<ReviewDraft|null>(null),[original,setOriginal]=useState('');
 const [urls,setUrls]=useState<Record<string,string>>({}),[error,setError]=useState(''),[imageError,setImageError]=useState(''),[saving,setSaving]=useState(false),[reload,setReload]=useState(0);
 const dialog=useRef<HTMLDialogElement>(null),lock=useRef(false),retry=useRef<{key:string;id:string}|null>(null),alive=useRef(true);
 const [sourceVisible,setSourceVisible]=useState(true);
 const [suggestions,setSuggestions]=useState<{supplier:string;items:SupplierItem[]}>({supplier:'',items:[]}),[itemPicker,setItemPicker]=useState<number|null>(null),[historyError,setHistoryError]=useState('');
 const [uncertainFields,setUncertainFields]=useState<ReceiptField[]>([]);
 const historyRequest=useRef(0);
 const addRequest=useRef<string|null>(null);
 const [sourceWidth,setSourceWidth]=useState(40);
 const split=useRef<HTMLDivElement>(null);
 const [historyLoading,setHistoryLoading]=useState(false);
 const [extraColumns,setExtraColumns]=useState(false);
 const [suppliers,setSuppliers]=useState<{store:string;rows:ReceiptSupplierChoice[]}>({store:storeId,rows:[]});
 const [supplierOpen,setSupplierOpen]=useState(false),[supplierError,setSupplierError]=useState('');
 const historyCache=useRef<SupplierItem[]|null>(null);
 useEffect(()=>{const controller=new AbortController();historyCache.current=null;
  void receiptRead(signal=>supabase.rpc('app_workspace',{p_store_id:storeId,p_section:'suppliers',p_filter:{}}).abortSignal(signal),controller.signal).then(result=>{
   if(controller.signal.aborted)return;if(result.error)throw result.error;
   const data=result.data as unknown as {suppliers?:ReceiptSupplierChoice[]};if(!Array.isArray(data?.suppliers))throw Error('INVALID_RESPONSE');setSuppliers({store:storeId,rows:data.suppliers});setSupplierError('');
  }).catch(()=>{if(!controller.signal.aborted)setSupplierError('供應商清單暫時無法讀取，可先直接填寫。');});
  return()=>controller.abort();
 },[storeId]);
 const [quickOpen,setQuickOpen]=useState(false),[quickSearch,setQuickSearch]=useState(''),[quickSelected,setQuickSelected]=useState<SupplierItem[]>([]);
 const quickRetry=useRef<{key:string;id:string}|null>(null);
 const [taxLine,setTaxLine]=useState(0),[grossPrice,setGrossPrice]=useState(''),[taxRate,setTaxRate]=useState('');
 async function loadHistory(supplier:string){
  const sequence=++historyRequest.current;setHistoryLoading(true);setHistoryError('');
  try{const items=historyCache.current??supplierItems(await readScopedReceiptAccounts(storeId,new AbortController().signal,'','',''),'',batchId);if(alive.current&&sequence===historyRequest.current){historyCache.current=items;setSuggestions({supplier,items:itemsForSupplier(items,supplier)});}}
  catch{if(alive.current&&sequence===historyRequest.current)setHistoryError('歷史品項暫時無法讀取，仍可直接輸入。');}
  finally{if(alive.current&&sequence===historyRequest.current)setHistoryLoading(false);}
 }
 function openQuick(supplier:string){setQuickOpen(true);setItemPicker(null);setSupplierOpen(false);setQuickSearch('');setQuickSelected([]);void loadHistory(supplier);}
 async function addSelected(){
  if(!row||!draft||!quickSelected.length||lock.current)return;lock.current=true;setSaving(true);setError('');
  try{const data=reviewPayload(row,draft,false);const key=JSON.stringify({data,items:quickSelected});if(quickRetry.current?.key!==key)quickRetry.current={key,id:crypto.randomUUID()};
   const saved=await addReceiptItems(storeId,batchId,data,quickSelected,quickRetry.current.id);if(!alive.current)return;
   quickRetry.current=null;setRow(saved);const d=reviewDraft(saved);setDraft(d);setOriginal(JSON.stringify(d));setQuickSelected([]);setQuickOpen(false);
  }catch(e){if(alive.current)setError(reviewError(e));}finally{lock.current=false;if(alive.current)setSaving(false);}
 }
 function convertPrice(){if(!draft)return;try{if(!draft.lines[taxLine]||receiptHandling(draft.lines[taxLine])!=='NORMAL')throw Error('請選擇一般進貨明細。');const price=taxExclusivePrice(grossPrice,taxRate);setDraft(changeReviewLine(draft,taxLine,'unit_price',String(price)));setError('');}catch(e){setError(e instanceof Error?e.message:'請檢查單價與稅率。');}}
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
 async function save(checked:boolean,next:boolean,finished=false){if(!row||!draft||lock.current)return;let data:ReturnType<typeof reviewPayload>&{entry_completed?:boolean};try{data=reviewPayload(row,draft,checked);if(finished)data={...data,entry_completed:true};}catch(e){setError(e instanceof Error?e.message:'請檢查輸入');return;}
  const key=JSON.stringify({storeId,batchId,data});if(retry.current?.key!==key)retry.current={key,id:crypto.randomUUID()};lock.current=true;setSaving(true);setError('');
  try{const saved=await saveReceiptReview(storeId,batchId,data,retry.current.id);if(!alive.current)return;retry.current=null;onSaved(saved,next);}catch(e){if(alive.current)setError(reviewError(e));}finally{lock.current=false;if(alive.current)setSaving(false);}
 }
 async function showItems(index:number){
  setSupplierOpen(false);setItemPicker(index);if(!draft)return;
  const supplier=draft.supplier.trim();if(suggestions.supplier===supplier&&suggestions.items.length)return;
  await loadHistory(supplier);

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
 function update(key:keyof Omit<ReviewDraft,'lines'>,value:string){if(key==='supplier'){historyRequest.current++;setItemPicker(null);setHistoryLoading(false);setQuickOpen(false);setQuickSelected([]);}setDraft(d=>d?{...d,[key]:value}:d);}
 let net:number|null=null,computed:number|null=null;try{if(draft){net=reviewNet(draft);computed=reviewTotal(draft);}}catch{/* Invalid input remains in the draft, never coerced to zero. */}
 const readOnly=!!row&&(!row.can_edit||row.record_state!=='LIVE');
 return <dialog ref={dialog} className={`receipt-review-workbench receipt-account-dialog${manualEntry?" receipt-manual-workbench":""}${extraColumns?" extra-columns":""}`} aria-label={manualEntry?"貨單建檔／修改":"原單與明細核對"} onCancel={e=>{e.preventDefault();close();}}>
  <header><div><h2>{manualEntry?"貨單建檔／修改":"原單與明細核對"}</h2><small>{manualEntry&&row?`${(row.entry_completed||row.reviewed)?'已建檔':row.edit_revision?'部分建檔':'未建檔'} · `:''}{row?.supplier_name||'讀取貨單…'} · {row?.document_number||row?.batch_number||''}</small></div><button type="button" className="shell-secondary" disabled={saving} onClick={close}>關閉</button></header>
  {error&&<p className="sheet-error" role="alert">{error} <button type="button" className="text-button" disabled={saving} onClick={reloadData}>重新讀取</button></p>}
  {!draft&&!error&&<p role="status">正在讀取這張貨單…</p>}
  {row&&draft&&<div ref={split} style={{"--source-width":`${sourceWidth}%`} as CSSProperties} className={`receipt-review-split${sourceVisible?'':' source-hidden'}`}>
   {sourceVisible&&<aside aria-label="原始貨單">{imageError&&<p role="alert">{imageError}</p>}<ReceiptSourceViewer documents={row.documents||[]} imageUrls={urls}/></aside>}
   {sourceVisible&&<div className="receipt-split-handle" role="separator" tabIndex={0} aria-label="調整貨單與明細寬度" aria-orientation="vertical" aria-valuemin={25} aria-valuemax={55} aria-valuenow={sourceWidth} onKeyDown={e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();setSourceWidth(v=>Math.max(25,Math.min(55,v+(e.key==='ArrowLeft'?-2:2))));}}} onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);}} onPointerMove={e=>{if(!e.currentTarget.hasPointerCapture(e.pointerId)||!split.current)return;const rect=split.current.getBoundingClientRect();setSourceWidth(Math.max(25,Math.min(55,100*(e.clientX-rect.left)/rect.width)));}} onPointerUp={e=>{if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}}/>}
   <section className="receipt-review-edit" aria-label="可更正進貨明細">
    <p className="receipt-account-help">原圖已保存。輸入關鍵字選歷史品項，未填完可儲存，下次續填。</p>
    {row.source_changed&&<p className="receipt-account-warning">原始資料已有新修正，請重新核對原單與本次明細。</p>}
    {row.pending&&<p className="receipt-account-warning">照片已保存，可新增明細並先儲存，核對完成後再送對帳。</p>}
    <div className="receipt-review-actions">{manualEntry&&row.receipt_status!=='COMPLETED'&&<button type="button" className="shell-secondary" disabled={saving||readOnly} onClick={()=>quickOpen?setQuickOpen(false):openQuick(draft.supplier.trim())}>{quickOpen?'收起快選':'快選多個品項'}</button>}{manualEntry&&<button type="button" className="shell-secondary" onClick={()=>setExtraColumns(v=>!v)}>{extraColumns?"收起其他欄位":"其他欄位"}</button>}<button type="button" className="shell-secondary" disabled={saving} onClick={()=>setSourceVisible(v=>!v)}>{sourceVisible?'收起原單':'顯示原單'}</button>{manualEntry&&row.receipt_status!=='COMPLETED'&&<button type="button" className="shell-secondary" disabled={saving||readOnly} onClick={()=>void addRow()}>＋ 新增一列</button>}</div>
    <fieldset disabled={saving||readOnly}>
     <div className="receipt-review-head"><label className="receipt-supplier-field">供應商<input aria-label="貨單供應商" autoComplete="off" placeholder="輸入關鍵字選供應商" value={draft.supplier} maxLength={160} onFocus={()=>{setSupplierOpen(true);setItemPicker(null);}} onKeyDown={e=>{if(e.key==='Escape')setSupplierOpen(false);}} onChange={e=>{update('supplier',e.target.value);setSupplierOpen(true);}}/>{supplierOpen&&<div className="receipt-supplier-picker" aria-label="供應商快選">{supplierError?<small>{supplierError}</small>:matchReceiptSuppliers(suppliers.store===storeId?suppliers.rows:[],draft.supplier).map(s=><button type="button" key={s.id} onClick={()=>{update('supplier',s.name);setSupplierOpen(false);}}>{s.name}</button>)}<button type="button" onClick={()=>setSupplierOpen(false)}>使用目前名稱／收起</button></div>}</label><label>到貨日期<input aria-label="貨單到貨日期" type="date" value={draft.date} onChange={e=>update('date',e.target.value)}/></label><label hidden={manualEntry&&!extraColumns&&!draft.number}>貨單號碼<input aria-label="貨單號碼" value={draft.number} maxLength={160} onChange={e=>update('number',e.target.value)}/></label></div>
     {manualEntry&&quickOpen&&row.receipt_status!=='COMPLETED'&&<section className="receipt-quick-section"><div className="receipt-quick-heading"><strong>{draft.supplier||'供應商'}常用品項</strong><button type="button" className="shell-secondary" onClick={()=>quickOpen?setQuickOpen(false):openQuick(draft.supplier.trim())}>{quickOpen?'收起':'＋ 快選品項'}</button></div>{quickOpen&&<><input aria-label="搜尋供應商常用品項" placeholder="輸入關鍵字篩選品項" value={quickSearch} onChange={e=>setQuickSearch(e.target.value)}/>{historyLoading?<p role="status">讀取歷史品項…</p>:historyError?<p>{historyError}<button type="button" onClick={()=>void loadHistory(draft.supplier.trim())}>重試</button></p>:<div className="receipt-quick-list">{matchSupplierItems(suggestions.supplier===draft.supplier.trim()?suggestions.items:[],quickSearch,100).map(item=><label key={JSON.stringify(item)}><input type="checkbox" checked={quickSelected.includes(item)} onChange={e=>setQuickSelected(items=>e.target.checked?[...items,item]:items.filter(i=>i!==item))}/><span><strong>{item.name}</strong><small>{item.specification} · {item.unit} · {item.date}</small></span><span>{accountMoney(item.price)}<small>最近未稅進價</small></span></label>)}{!matchSupplierItems(suggestions.supplier===draft.supplier.trim()?suggestions.items:[],quickSearch,100).length&&<p>目前沒有符合的歷史品項，可直接新增一列。</p>}</div>}<div className="receipt-quick-heading"><span>已選 {quickSelected.length} 項</span><button type="button" className="shell-primary" disabled={saving||!quickSelected.length||historyLoading} onClick={()=>void addSelected()}>加入明細（{quickSelected.length}）</button></div></>}</section>}
     <div className="receipt-review-lines"><table><thead><tr>{['品名','規格','數量','單位','單價（未稅）','金額（未稅）','分類','備註'].map(v=><th hidden={manualEntry&&!extraColumns&&["規格","分類","備註"].includes(v)} key={v}>{v}</th>)}</tr></thead><tbody>{draft.lines.map((line,index)=><tr key={line.row_key}>
      {(['product_name','specification','quantity','unit','unit_price','subtotal'] as const).map((key,i)=><td hidden={manualEntry&&!extraColumns&&key==='specification'} key={key}>{receiptHandling(line)==='CUSTODY_RELEASE'&&['unit_price','subtotal'].includes(key)?<span className="receipt-nonbilling">{key==='subtotal'?'本次不計款':'—'}</span>:<input disabled={!!line.custody_posted&&['quantity','unit'].includes(key)} aria-label={`第 ${index+1} 筆 ${['品名','規格','數量','單位','未稅單價','未稅金額'][i]}`} inputMode={['quantity','unit_price','subtotal'].includes(key)?'decimal':undefined} className={needsCheck(index,key)?'receipt-needs-check':undefined} title={needsCheck(index,key)?'待核對，可先儲存':undefined} autoComplete="off" placeholder={key==='product_name'?'輸入品名關鍵字':undefined} onFocus={key==='product_name'?e=>{e.currentTarget.select();setQuickOpen(false);void showItems(index);}:()=>{setItemPicker(null);setSupplierOpen(false);}} onKeyDown={key==='product_name'?e=>{if(e.key==='Escape')setItemPicker(null);}:undefined} value={key==='product_name'?receiptItemQuery(line[key]):line[key]} onChange={e=>setDraft(d=>d?changeReviewLine(d,index,key,e.target.value):d)}/ >}{key==='product_name'&&itemPicker===index&&<div className="receipt-item-picker" aria-label="歷史品項"><small>歷史品項 · {draft.supplier.trim()||'所有供應商'}</small>{historyLoading?<small role="status">讀取歷史資料…</small>:historyError?<small>{historyError}</small>:matchSupplierItems(suggestions.supplier===draft.supplier.trim()?suggestions.items:[],receiptItemQuery(line.product_name)).map(item=><button type="button" key={`${item.supplier}:${item.name}:${item.unit}:${item.specification}`} disabled={!!line.custody_posted} onClick={()=>{setDraft(d=>d?applySupplierItem(d,index,item):d);setItemPicker(null);}}><strong>{item.name}</strong><small>{item.supplier} · {item.unit} {item.specification}{item.price!==null?` · 最近進價 ${accountMoney(item.price)}`:''}</small><small>{item.date}</small></button>)}<button type="button" className="text-button" onClick={()=>setItemPicker(null)}>{receiptItemQuery(line.product_name)?`使用「${receiptItemQuery(line.product_name)}」繼續輸入`:'自行輸入新品項'}</button><small>帶入空白的單價；已有價格與數量保留，請依貨單核對。</small><button type="button" className="text-button" onClick={()=>setItemPicker(null)}>收起</button></div>}

      {key==='product_name'&&<ReceiptReminderBadge rows={reminders.rows} line={line} supplier={draft.supplier} editable={!readOnly} disabled={saving} onChange={id=>setDraft(d=>d?changeReviewLine(d,index,'custody_reminder_id',id):d)}/>}
      {key==='product_name'&&(!manualEntry||extraColumns||receiptHandling(line)!=='NORMAL')&&<ReceiptHandlingFields storeId={storeId} line={line} editing={!readOnly} disabled={saving} onChange={(key,val)=>setDraft(d=>d?changeReviewLine(d,index,key,val):d)}/>}</td>)}
      <td hidden={manualEntry&&!extraColumns}><select aria-label={`第 ${index+1} 筆 分類`} value={line.category} onChange={e=>setDraft(d=>d?changeReviewLine(d,index,'category',e.target.value):d)}>{['食材','耗材','調料','酒水','待分類'].map(c=><option key={c}>{c}</option>)}</select></td><td hidden={manualEntry&&!extraColumns}><input aria-label={`第 ${index+1} 筆 備註`} value={line.note} maxLength={2000} onChange={e=>setDraft(d=>d?changeReviewLine(d,index,'note',e.target.value):d)}/></td>
     </tr>)}</tbody></table></div>
     <div className="receipt-review-head" hidden={manualEntry&&!extraColumns&&!Number(draft.adjustment)&&!draft.adjustmentNote}><label>調整金額<input aria-label="貨單調整金額" inputMode="decimal" value={draft.adjustment} onChange={e=>update('adjustment',e.target.value)}/></label><label className="wide">調整說明（可後補）<input aria-label="貨單調整說明" placeholder="折讓、運費或尾差，可之後補充" value={draft.adjustmentNote} maxLength={2000} onChange={e=>update('adjustmentNote',e.target.value)}/></label></div>
     <div className="receipt-review-head"><div><span>{manualEntry?"已填未稅小計":"未稅合計"}</span><strong>{accountMoney(manualEntry?enteredSubtotal(draft).subtotal:net)}</strong></div><label>稅額<input aria-label="貨單稅額" inputMode="decimal" placeholder="選填，未註明可留空" value={draft.tax} onChange={e=>update('tax',e.target.value)}/></label><label>原單總額<input aria-label="貨單含稅金額" inputMode="decimal" value={draft.total} onChange={e=>update('total',e.target.value)}/></label></div>
     <p className="receipt-account-help">{manualEntry&&enteredSubtotal(draft).missing>0&&<span>尚有 {enteredSubtotal(draft).missing} 筆金額未填，小計僅計已填項目。 </span>}{computed!==null&&draft.total.trim()&&Number.isFinite(Number(draft.total))&&Math.abs(computed-Number(draft.total))>0.01&&<span>與原單差額：{accountMoney(computed-Number(draft.total))}，仍可先儲存。 </span>}未稅＋稅額：{accountMoney(computed)} <button type="button" className="text-button" disabled={computed===null} onClick={()=>update('total',String(computed))}>帶入含稅金額</button>（稅額依貨單填寫，未註明可留空，不自動加稅）</p>
     <details className="receipt-tax-converter"><summary>含稅價換算</summary><div className="receipt-review-head"><label>換算明細<select aria-label="換算明細" value={taxLine} onChange={e=>setTaxLine(Number(e.target.value))}>{draft.lines.map((line,i)=><option key={line.row_key} value={i}>{i+1}. {line.product_name||'未命名'}</option>)}</select></label><label>含稅單價<input aria-label="含稅單價" inputMode="decimal" value={grossPrice} onChange={e=>setGrossPrice(e.target.value)}/></label><label>稅率（%）<input aria-label="換算稅率" inputMode="decimal" placeholder="自行填寫" value={taxRate} onChange={e=>setTaxRate(e.target.value)}/></label></div><button type="button" className="shell-secondary" onClick={convertPrice}>換算並套用未稅單價</button><small>僅修改所選明細單價；整張貨單稅額依原單填寫。</small></details>
     <label hidden={manualEntry&&!extraColumns&&!draft.note}>對帳備註<textarea aria-label="貨單對帳備註" value={draft.note} maxLength={2000} onChange={e=>update('note',e.target.value)}/></label>
    </fieldset>
   </section>
  </div>}
  {draft&&<footer><span>{saving?'儲存中，請勿重複送出':dirty?'有未儲存修正':'資料可後補，不影響建檔'}</span><div><button type="button" className="shell-secondary" disabled={saving||readOnly} onClick={()=>void save(false,false)}>{manualEntry?'儲存，下次續填':'先儲存，保留待對帳'}</button>{manualEntry&&<button type="button" className="shell-primary" disabled={saving||readOnly} onClick={()=>void save(false,!!nextId,true)}>{nextId?"完成建檔，下一張":"完成建檔"}</button>}<button hidden={manualEntry} type="button" className="shell-primary" disabled={saving||readOnly||!!row?.pending} onClick={()=>void save(true,true)}>{nextId?'儲存並對帳下一張':'儲存並完成對帳'}</button></div></footer>}
 </dialog>;
}
