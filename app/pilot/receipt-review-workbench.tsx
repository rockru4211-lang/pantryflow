'use client';
import {useEffect,useRef,useState,type CSSProperties} from 'react';
import {supabase} from '@/lib/supabase-browser';
import {receiptRead,receiptReadError} from '@/lib/receipt-read';
import {readScopedReceiptAccounts,saveReceiptReview,createReceiptSupplier,correctReceiptStore} from '@/lib/receipt-accounting-api';
import {accountMoney} from '@/lib/receipt-accounting';
import {useCustodyReminders,ReceiptReminderBadge} from './custody-reminder-badge';
import ReceiptHandlingFields from './receipt-handling-fields';
import {receiptCompletionError,receiptLineDifference,receiptHandling,receiptMissingPrices,changeReviewLine,changeReviewTax,reviewDraft,reviewError,reviewPayload,receiptEntryAmounts,enteredSubtotal,taxExclusivePrice,type ReviewAccount,type ReviewDraft} from '@/lib/receipt-review';
import ReceiptStoreField from './receipt-store-field';
import ReceiptEntryMore from './receipt-entry-more';
import ReceiptPackageInput from './receipt-package-input';
import ReceiptCategorySelect from './receipt-category-select';
import {receiptCategoryOptions,lastSupplierReceiptCategories} from '@/lib/receipt-categories';
import UnitSelect from './unit-select';
import {costingUnits} from '@/lib/operations-sheet';
import ReceiptSourceViewer from './receipt-source-viewer';
import type {ReceiptField} from '@/lib/receipt-workflow';
import {receiptSavedUnits,supplierItems,applySupplierItem,matchSupplierItems,matchReceiptSuppliers,exactReceiptSupplier,itemsForSupplier,receiptItemQuery,type ReceiptSupplierChoice,type SupplierItem} from '@/lib/receipt-supplier-items';
import './receipt-review-workbench.css';
type Props={storeId:string;batchId:string;nextId:string|null;previousId?:string|null;positionLabel?:string;onNavigate?:(id:string)=>void;manualEntry?:boolean;onClose:()=>void;onSaved:(row:ReviewAccount,next:boolean)=>void};
export default function ReceiptReviewWorkbench({storeId,batchId,nextId,previousId,positionLabel,onNavigate,manualEntry=false,onClose,onSaved}:Props){
 const reminders=useCustodyReminders(storeId);
 const [row,setRow]=useState<ReviewAccount|null>(null),[draft,setDraft]=useState<ReviewDraft|null>(null),[original,setOriginal]=useState('');
 const [urls,setUrls]=useState<Record<string,string>>({}),[error,setError]=useState(''),[imageError,setImageError]=useState(''),[saving,setSaving]=useState(false),[reload,setReload]=useState(0);
 const dialog=useRef<HTMLDialogElement>(null),lock=useRef(false),retry=useRef<{key:string;id:string}|null>(null),alive=useRef(true);
 const [sourceVisible,setSourceVisible]=useState(true);
 const [suggestions,setSuggestions]=useState<{supplier:string;items:SupplierItem[]}>({supplier:'',items:[]}),[itemPicker,setItemPicker]=useState<number|null>(null),[historyError,setHistoryError]=useState('');
 const [uncertainFields,setUncertainFields]=useState<ReceiptField[]>([]);
 const historyRequest=useRef(0);
 const [sourceWidth,setSourceWidth]=useState(40);
 const split=useRef<HTMLDivElement>(null);
 const [historyLoading,setHistoryLoading]=useState(false);
 const [extraColumns,setExtraColumns]=useState(false);
 const [suppliers,setSuppliers]=useState<{store:string;rows:ReceiptSupplierChoice[]}>({store:storeId,rows:[]});
 const [supplierOpen,setSupplierOpen]=useState(false),[supplierError,setSupplierError]=useState('');
 const historyCache=useRef<SupplierItem[]|null>(null);
 const [knownUnits,setKnownUnits]=useState<{store:string;units:string[]}>({store:storeId,units:[]});
 useEffect(()=>{const controller=new AbortController();
  void readScopedReceiptAccounts(storeId,controller.signal,'','','ALL').then(rows=>{if(controller.signal.aborted)return;setKnownUnits({store:storeId,units:receiptSavedUnits(rows)});setCategoryHistory({store:storeId,rows});categoryHistoryRef.current=rows;setDraft(d=>{const current=draftRef.current.row||rows.find(r=>r.batch_id===batchId);if(!d||!current||current.edit_revision>0||d.receiptCategories?.length||categoryTouched.current)return d;const categories=lastSupplierReceiptCategories(rows,d.supplier,batchId);return categories.length?{...d,receiptCategories:categories}:d;});historyCache.current=supplierItems(rows,'',batchId);}).catch(()=>{});
  return()=>controller.abort();
 },[storeId,batchId]);

 const [removed,setRemoved]=useState<{line:ReviewDraft['lines'][number];index:number}[]>([]);
 const [taxLine,setTaxLine]=useState(0),[grossPrice,setGrossPrice]=useState(''),[taxRate,setTaxRate]=useState('');
 const [supplierEditable,setSupplierEditable]=useState(false),[supplierNotice,setSupplierNotice]=useState('');
 const [candidate,setCandidate]=useState<ReviewAccount|null>(null);
 const [categoryHistory,setCategoryHistory]=useState<{store:string;rows:ReviewAccount[]}>({store:storeId,rows:[]});
 const [targetStore,setTargetStore]=useState(storeId);
 const categoryTouched=useRef(false),categoryHistoryRef=useRef<ReviewAccount[]>([]);

 const draftRef=useRef({dirty:false,row:null as ReviewAccount|null});
 const refreshLock=useRef(false),refreshEpoch=useRef(0);
 const supplierRetry=useRef<{key:string;id:string}|null>(null);
 useEffect(()=>{const controller=new AbortController();historyCache.current=null;
  void receiptRead(signal=>supabase.rpc('app_workspace',{p_store_id:storeId,p_section:'suppliers',p_filter:{}}).abortSignal(signal),controller.signal).then(result=>{
   if(controller.signal.aborted)return;if(result.error)throw result.error;
   const data=result.data as unknown as {suppliers?:ReceiptSupplierChoice[];editable?:boolean};if(!Array.isArray(data?.suppliers))throw Error('INVALID_RESPONSE');setSuppliers({store:storeId,rows:data.suppliers});setSupplierEditable(data.editable===true);setSupplierError('');
  }).catch(()=>{if(!controller.signal.aborted)setSupplierError('供應商清單暫時無法讀取，可先直接填寫。');});
  return()=>controller.abort();
 },[storeId]);
 async function createSupplier(){
  if(!draft||lock.current||!supplierEditable)return;const name=draft.supplier.trim();if(!name)return;
  const existing=exactReceiptSupplier(suppliers.rows,name);
  if(existing){if(existing.is_active===false||existing.is_removed){setSupplierError('已有同名停用或移除的供應商，請至供應商資料確認。');return;}update('supplier',existing.name);setSupplierOpen(false);return;}
  const key=JSON.stringify({storeId,name});if(supplierRetry.current?.key!==key)supplierRetry.current={key,id:crypto.randomUUID()};
  lock.current=true;setSaving(true);setSupplierError('');
  try{const saved=await createReceiptSupplier(storeId,name,supplierRetry.current.id);if(!alive.current)return;supplierRetry.current=null;setSuppliers(old=>({store:storeId,rows:[...old.rows.filter(s=>s.id!==saved.id),saved]}));update('supplier',saved.name);setSupplierOpen(false);setSupplierNotice('已建立供應商，聯絡資料可之後補。');}
  catch(e){if(alive.current){const m=e&&typeof e==='object'&&'message'in e?String(e.message):String(e);setSupplierError(/EXISTS|duplicate|23505/.test(m)?'已有同名或別名供應商，請重新讀取清單後選用。':'供應商尚未建立，名稱仍保留，可重試。');}}
  finally{lock.current=false;if(alive.current)setSaving(false);}
 }

 async function loadHistory(supplier:string){
  const sequence=++historyRequest.current;setHistoryLoading(true);setHistoryError('');
  try{const items=historyCache.current??supplierItems(await readScopedReceiptAccounts(storeId,new AbortController().signal,'','',''),'',batchId);if(alive.current&&sequence===historyRequest.current){historyCache.current=items;setSuggestions({supplier,items:itemsForSupplier(items,supplier)});}}
  catch{if(alive.current&&sequence===historyRequest.current)setHistoryError('歷史品項暫時無法讀取，仍可直接輸入。');}
  finally{if(alive.current&&sequence===historyRequest.current)setHistoryLoading(false);}
 }
 function convertPrice(){if(!draft)return;try{if(!draft.lines[taxLine]||receiptHandling(draft.lines[taxLine])!=='NORMAL')throw Error('請選擇一般進貨明細。');const price=taxExclusivePrice(grossPrice,taxRate);setDraft(changeReviewLine(draft,taxLine,'unit_price',String(price)));setError('');}catch(e){setError(e instanceof Error?e.message:'請檢查單價與稅率。');}}
 const dirty=targetStore!==storeId||!!draft&&JSON.stringify(draft)!==original;
 draftRef.current={dirty,row};
 async function readRecognition(){
  if(refreshLock.current||lock.current)return;refreshLock.current=true;const epoch=refreshEpoch.current;
  try{const rows=await readScopedReceiptAccounts(storeId,new AbortController().signal,'','','ALL',batchId);if(!alive.current||lock.current||epoch!==refreshEpoch.current)return;const fresh=rows.find(r=>r.batch_id===batchId);if(!fresh)throw Error('RECEIPT_ACCESS_DENIED');if(fresh.source_fingerprint===draftRef.current.row?.source_fingerprint){setError('');return;}
   if(draftRef.current.dirty){setCandidate(fresh);return;}applyRecognition(fresh);
  }catch(e){if(alive.current)setError(receiptReadError(e));}finally{refreshLock.current=false;}
 }

 function applyRecognition(fresh:ReviewAccount){void receiptRead(signal=>supabase.rpc('get_pilot_receipt',{p_batch_id:batchId}).abortSignal(signal),new AbortController().signal).then(result=>{if(alive.current&&!result.error)setUncertainFields(((result.data as unknown as {fields?:ReceiptField[]})?.fields||[]).filter(f=>!f.corrected&&f.review_status!=='TRUSTED'));}).catch(()=>{});setRow(fresh);const d=reviewDraft(fresh);if(!fresh.edit_revision&&!d.receiptCategories?.length&&!categoryTouched.current)d.receiptCategories=lastSupplierReceiptCategories(categoryHistoryRef.current,d.supplier,batchId);setDraft(d);setOriginal(JSON.stringify(d));setCandidate(null);setRemoved([]);setError('');retry.current=null;}
 useEffect(()=>{dialog.current?.showModal();const controller=new AbortController();alive.current=true;
  async function load(){try{const rows=await readScopedReceiptAccounts(storeId,controller.signal,'','','ALL',batchId);const current=rows.find(a=>a.batch_id===batchId);if(!current)throw Error('RECEIPT_ACCESS_DENIED');if(controller.signal.aborted)return;setTargetStore(storeId);setRow(current);const d=reviewDraft(current);if(!current.edit_revision&&!d.receiptCategories?.length&&!categoryTouched.current)d.receiptCategories=lastSupplierReceiptCategories(categoryHistoryRef.current,d.supplier,batchId);setDraft(d);setOriginal(JSON.stringify(d));setRemoved([]);setError('');retry.current=null;
   void receiptRead(signal=>supabase.rpc('get_pilot_receipt',{p_batch_id:batchId}).abortSignal(signal),controller.signal).then(detail=>{if(!controller.signal.aborted&&!detail.error){const fields=(detail.data as unknown as {fields?:ReceiptField[]})?.fields||[];setUncertainFields(fields.filter(f=>!f.corrected&&f.review_status!=='TRUSTED'));}}).catch(()=>{});
   if(current.documents?.length){const r=await supabase.storage.from('receipt-documents').createSignedUrls(current.documents.map(x=>x.path),3600);if(controller.signal.aborted)return;if(r.error)setImageError('原單暫時無法讀取；明細仍保留，可關閉後重開。');else setUrls(Object.fromEntries((r.data||[]).map(x=>[x.path||'',x.signedUrl||''])));}
  }catch(e){if(!controller.signal.aborted)setError(receiptReadError(e));}}
  void load();return()=>{alive.current=false;controller.abort();};
 },[storeId,batchId,reload,manualEntry]);
 useEffect(()=>{if(!dirty&&!saving)return;const warn=(e:BeforeUnloadEvent)=>e.preventDefault();window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirty,saving]);
 function close(){if(lock.current)return;if(dirty&&!window.confirm('還有未儲存修正。確定捨棄並關閉？'))return;onClose();}
 function navigate(id:string|null|undefined){if(!id||lock.current||!onNavigate)return;if(dirty){void save(false,false,false,id);return;}onNavigate(id);}
 function reloadData(){if(lock.current)return;if(row){void readRecognition();return;}setError('');setReload(n=>n+1);}
 async function save(checked:boolean,next:boolean,finished=false,targetId?:string){if(!row||!draft||lock.current)return;let data:ReturnType<typeof reviewPayload>&{entry_completed?:boolean;review_completed?:boolean};try{if(finished){const issue=receiptCompletionError(draft);if(issue)throw Error(issue);}data=reviewPayload(row,draft,checked);if(finished)data={...data,entry_completed:true,review_completed:true};}catch(e){setError(e instanceof Error?e.message:'請檢查輸入');return;}
  const key=JSON.stringify({storeId,batchId,targetStore,data});if(retry.current?.key!==key)retry.current={key,id:crypto.randomUUID()};lock.current=true;setSaving(true);setError('');refreshEpoch.current++;setCandidate(null);
  try{const saved=await (targetStore!==storeId?correctReceiptStore(storeId,batchId,targetStore,data,retry.current.id):saveReceiptReview(storeId,batchId,data,retry.current.id));if(!alive.current)return;retry.current=null;setRow(saved);const fresh=reviewDraft(saved);setDraft(fresh);setOriginal(JSON.stringify(fresh));setRemoved([]);onSaved(saved,false);if(targetStore!==storeId){window.dispatchEvent(new Event('receipt-store-change'));const destination=targetId||(next?nextId:null);if(destination&&onNavigate)onNavigate(destination);else onClose();return;}const destination=targetId||(next?nextId:null);if(destination&&onNavigate)onNavigate(destination);}catch(e){if(alive.current)setError(reviewError(e));}finally{lock.current=false;if(alive.current)setSaving(false);}
 }
 async function showItems(index:number){
  setSupplierOpen(false);setItemPicker(index);if(!draft)return;
  const supplier=draft.supplier.trim();if(suggestions.supplier===supplier&&suggestions.items.length)return;
  await loadHistory(supplier);

 }
 function addRow(){
  if(!draft||lock.current)return;
  const line={row_key:`local-${crypto.randomUUID()}`,product_name:'',specification:'',unit:'',quantity:'',unit_price:'',subtotal:'',category:'待分類',note:''};
  setDraft(d=>d?{...d,lines:[...d.lines,line]}:d);setItemPicker(null);setError('');
 }
 function removeRow(index:number){
  if(!draft||lock.current)return;
  const line=draft.lines[index];if(!line||line.custody_posted||line.custody_reminder_id||line.custody_event_id)return;
  setRemoved(items=>[...items,{line,index}]);setDraft(d=>d?{...d,lines:d.lines.filter(l=>l.row_key!==line.row_key)}:d);setItemPicker(null);
 }
 function undoRemove(){
  if(lock.current||!removed.length)return;
  const last=removed[removed.length-1];setDraft(d=>{if(!d)return d;const lines=[...d.lines];lines.splice(Math.min(last.index,lines.length),0,last.line);return {...d,lines};});setRemoved(items=>items.slice(0,-1));setItemPicker(null);
 }
 function needsCheck(index:number,key:string){
  const line=draft?.lines[index];if(!line)return false;
  if(['product_name','quantity','unit','unit_price'].includes(key)&&!line[key as keyof typeof line])return true;
  const fieldName=key==='product_name'?'product':key==='unit_price'?'unit_price_ex_tax':key;
  return uncertainFields.some(f=>f.row_key===line.row_key&&f.field_name===fieldName&&String(f.value??'')===String(line[key as keyof typeof line]??''))&&!(row?.edit_revision);
 }
 function update(key:keyof Omit<ReviewDraft,'lines'|'receiptCategories'>,value:string){if(key==='supplier'){historyRequest.current++;setItemPicker(null);setHistoryLoading(false);}setDraft(d=>d?(key==='tax'?changeReviewTax(d,value):{...d,[key]:value,...(key==='supplier'&&!row?.edit_revision&&!categoryTouched.current?{receiptCategories:lastSupplierReceiptCategories(categoryHistory.store===storeId?categoryHistory.rows:[],value,batchId)}:{})}):d);}
 let amounts:ReturnType<typeof receiptEntryAmounts>|null=null;try{if(draft)amounts=receiptEntryAmounts(draft);}catch{/* Invalid input remains in the draft, never coerced to zero. */}
 const missingPrices=draft?receiptMissingPrices(draft.lines):0;
 const receivingLocked=!!row?.received_at;
 const readOnly=!!row&&(!row.can_edit||row.record_state!=='LIVE');
 return <dialog ref={dialog} className={`receipt-review-workbench receipt-account-dialog receipt-manual-workbench receipt-unified-workbench${extraColumns?" extra-columns":""}`} aria-label="貨單核對" onCancel={e=>{e.preventDefault();close();}}>
  <header><div><h2>貨單建檔</h2><small>{manualEntry&&row?`${row.edit_revision?'已有明細':'待建檔'} · `:''}{row?(draft?.supplier||row.supplier_name||'供應商待填'):'讀取貨單…'} · {row?.document_number||row?.batch_number||''}</small></div><div className="receipt-entry-navigation">{onNavigate&&<><button type="button" className="shell-secondary" disabled={saving||!previousId} onClick={()=>navigate(previousId)}>上一張</button><small>{positionLabel}</small></>}<button type="button" className="shell-secondary" disabled={saving} onClick={close}>關閉</button></div></header>
  {supplierNotice&&<p className="receipt-account-help" role="status">{supplierNotice}</p>}
  {error&&<p className="sheet-error" role="alert">{error} <button type="button" className="text-button" disabled={saving} onClick={reloadData}>重新讀取</button></p>}
  {!draft&&!error&&<p role="status">正在讀取這張貨單…</p>}
  {row&&draft&&<fieldset className="receipt-entry-metadata" disabled={saving||readOnly}>     <div className="receipt-review-head"><label className="receipt-supplier-field">供應商<input disabled={receivingLocked} aria-label="貨單供應商" autoComplete="off" placeholder="輸入關鍵字選供應商" value={draft.supplier} maxLength={160} onFocus={()=>{setSupplierOpen(true);setItemPicker(null);}} onKeyDown={e=>{if(e.key==='Escape')setSupplierOpen(false);}} onChange={e=>{update('supplier',e.target.value);setSupplierOpen(true);}}/>{supplierOpen&&<div className="receipt-supplier-picker" aria-label="供應商快選">{supplierError?<small>{supplierError}</small>:matchReceiptSuppliers(suppliers.store===storeId?suppliers.rows:[],draft.supplier).map(s=><button type="button" key={s.id} onClick={()=>{update('supplier',s.name);setSupplierOpen(false);}}>{s.name}</button>)}{supplierEditable&&draft.supplier.trim()&&!exactReceiptSupplier(suppliers.rows,draft.supplier)&&<button type="button" disabled={saving||readOnly} onClick={()=>void createSupplier()}>＋ 建立供應商「{draft.supplier.trim()}」</button>}<button type="button" onClick={()=>setSupplierOpen(false)}>使用目前名稱／收起</button></div>}</label><ReceiptCategorySelect value={draft.receiptCategories||[]} options={receiptCategoryOptions(categoryHistory.store===storeId?categoryHistory.rows:[])} disabled={saving||readOnly} onChange={categories=>{categoryTouched.current=true;setDraft(d=>d?{...d,receiptCategories:categories}:d);setSupplierOpen(false);}}/><label>到貨日期<input disabled={receivingLocked} aria-label="貨單到貨日期" type="date" value={draft.date} onChange={e=>update('date',e.target.value)}/></label><label hidden={!extraColumns&&!draft.number}>貨單號碼<input disabled={receivingLocked} aria-label="貨單號碼" value={draft.number} maxLength={160} onChange={e=>update('number',e.target.value)}/></label></div></fieldset>}
  {row&&draft&&<div ref={split} style={{"--source-width":`${sourceWidth}%`} as CSSProperties} className={`receipt-review-split${sourceVisible?'':' source-hidden'}`}>
   {sourceVisible&&<aside aria-label="原始貨單">{imageError&&<p role="alert">{imageError}</p>}<ReceiptSourceViewer documents={row.documents||[]} imageUrls={urls}/></aside>}
   {sourceVisible&&<div className="receipt-split-handle" role="separator" tabIndex={0} aria-label="調整貨單與明細寬度" aria-orientation="vertical" aria-valuemin={25} aria-valuemax={55} aria-valuenow={sourceWidth} onKeyDown={e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();setSourceWidth(v=>Math.max(25,Math.min(55,v+(e.key==='ArrowLeft'?-2:2))));}}} onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);}} onPointerMove={e=>{if(!e.currentTarget.hasPointerCapture(e.pointerId)||!split.current)return;const rect=split.current.getBoundingClientRect();setSourceWidth(Math.max(25,Math.min(55,100*(e.clientX-rect.left)/rect.width)));}} onPointerUp={e=>{if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}}/>}
   <section className="receipt-review-edit" aria-label="可更正進貨明細">
    <div className="receipt-entry-sheet-heading"><h3>進貨明細 {missingPrices>0&&<small className="receipt-pending-price">待補價格・{missingPrices} 項</small>}</h3><button type="button" className="shell-secondary" disabled={saving||readOnly||row.receipt_status==='COMPLETED'} onClick={addRow}>＋ 新增一列</button></div>
    <ReceiptEntryMore key={batchId} storeId={storeId} batchId={batchId} disabled={saving||readOnly} hasSavedData={!!row.edit_revision||!!row.received_at||row.receipt_status==='COMPLETED'||row.lines.length>0} onResult={()=>void readRecognition()}><ReceiptStoreField storeId={storeId} value={targetStore} onChange={setTargetStore} disabled={saving||readOnly}/></ReceiptEntryMore>
    {candidate&&<div className="receipt-account-warning" role="status">新結果有 {candidate.lines.length} 筆明細，已保留目前輸入。<details><summary>比較辨識結果</summary><ul>{candidate.lines.map(l=><li key={l.row_key}>{l.product_name||'品名待確認'} · {l.quantity??'數量待確認'} {l.unit} · 單價 {accountMoney(l.unit_price)}</li>)}</ul></details><button type="button" className="text-button" disabled={saving} onClick={()=>{if(window.confirm('套用辨識結果會取代此視窗尚未儲存的輸入，確定套用？'))applyRecognition(candidate);}}>套用辨識結果</button><button type="button" className="text-button" onClick={()=>setCandidate(null)}>保留目前輸入</button></div>}
    {row.source_changed&&<p className="receipt-account-warning">原始資料已有新修正，請重新核對原單與本次明細。</p>}
    {row.pending&&<p className="receipt-account-warning">照片已保存，缺單價也能先儲存，補齊核對後再按完成。</p>}
    <div className="receipt-review-actions">{<button type="button" className="shell-secondary" onClick={()=>setExtraColumns(v=>!v)}>{extraColumns?"收起其他欄位":"其他欄位"}</button>}<button type="button" className="shell-secondary" disabled={saving} onClick={()=>setSourceVisible(v=>!v)}>{sourceVisible?'收起原單':'顯示原單'}</button></div>
    <fieldset disabled={saving||readOnly}>

     <div className="receipt-review-lines"><table><thead><tr>{['品名','數量','單位','包裝內容（選填）','單價（未稅）','金額（未稅）','分類','備註'].map(v=><th hidden={!extraColumns&&["分類","備註"].includes(v)} key={v}>{v}</th>)}<th className="receipt-delete-column" aria-label="刪除明細"/></tr></thead><tbody>{draft.lines.map((line,index)=><tr key={line.row_key}>
      {(['product_name','quantity','unit','specification','unit_price','subtotal'] as const).map((key,i)=><td key={key} className={key==='unit'&&needsCheck(index,key)?'receipt-needs-check':undefined} onBlur={key==='product_name'?e=>{if(!e.currentTarget.contains(e.relatedTarget as Node|null))setItemPicker(null);}:undefined}>{receiptHandling(line)==='CUSTODY_RELEASE'&&['unit_price','subtotal'].includes(key)?<span className="receipt-nonbilling">{key==='subtotal'?'本次不計款':'—'}</span>:key==='specification'?<ReceiptPackageInput label={`第 ${index+1} 筆 包裝內容`} value={line.specification} unit={line.unit} disabled={receivingLocked||!!line.custody_posted} onChange={value=>setDraft(d=>d?changeReviewLine(d,index,'specification',value):d)}/>:key==='unit'?<UnitSelect ariaLabel={`第 ${index+1} 筆 單位`} required={false} units={[...costingUnits,...(knownUnits.store===storeId?knownUnits.units:[]),...draft.lines.map(l=>l.unit)]} onUnitAdded={unit=>setKnownUnits(old=>({store:storeId,units:[...new Set([...(old.store===storeId?old.units:[]),unit])]}))} value={line.unit} disabled={!!line.custody_posted||receivingLocked} onChange={value=>{setItemPicker(null);setDraft(d=>d?changeReviewLine(d,index,'unit',value):d);}}/>:<input disabled={!!line.custody_posted&&['quantity','unit'].includes(key)||receivingLocked&&['product_name','specification','quantity','unit'].includes(key)} aria-label={`第 ${index+1} 筆 ${['品名','數量','單位','包裝內容','未稅單價','未稅金額'][i]}`} inputMode={['quantity','unit_price','subtotal'].includes(key)?'decimal':undefined} className={needsCheck(index,key)?'receipt-needs-check':undefined} title={needsCheck(index,key)?'待核對，可先儲存':undefined} autoFocus={key==='product_name'&&line.row_key.startsWith('local-')} autoComplete="off" placeholder={key==='product_name'?'輸入品名關鍵字':key==='unit_price'?'待補':key==='subtotal'?'—':undefined} onFocus={key==='product_name'?e=>{e.currentTarget.select();void showItems(index);}:()=>{setItemPicker(null);setSupplierOpen(false);}} onKeyDown={key==='product_name'?e=>{if(e.key==='Escape')setItemPicker(null);}:undefined} value={key==='product_name'?receiptItemQuery(line[key]):line[key]} onChange={e=>{setDraft(d=>d?changeReviewLine(d,index,key,e.target.value):d);if(key==='product_name')setItemPicker(index);}}/ >}{key==='product_name'&&itemPicker===index&&receiptItemQuery(line.product_name).trim().length>0&&<div className="receipt-item-picker" aria-label="歷史品項"><small>歷史品項 · {draft.supplier.trim()||'所有供應商'}</small>{historyLoading?<small role="status">讀取歷史資料…</small>:historyError?<small>{historyError}</small>:matchSupplierItems(suggestions.supplier===draft.supplier.trim()?suggestions.items:[],receiptItemQuery(line.product_name)).map(item=><button type="button" key={`${item.supplier}:${item.name}:${item.unit}:${item.specification}`} disabled={!!line.custody_posted||receivingLocked} onClick={()=>{setDraft(d=>d?applySupplierItem(d,index,item):d);setItemPicker(null);}}><strong>{item.name}</strong><small>{item.supplier} · {item.unit} {item.specification}{item.price!==null?` · 最近進價 ${accountMoney(item.price)}`:''}</small><small>{item.date}</small></button>)}<button type="button" className="receipt-picker-dismiss" onClick={()=>setItemPicker(null)}>保留目前品名</button></div>}

      {key==='subtotal'&&receiptLineDifference(line)!==null&&<small className="receipt-line-warning" title="保留原單金額，可先儲存後核對">與數量 × 單價差 {accountMoney(receiptLineDifference(line))}</small>}
      {key==='product_name'&&<ReceiptReminderBadge rows={reminders.rows} line={line} supplier={draft.supplier} editable={!readOnly&&!receivingLocked} disabled={saving||receivingLocked} onChange={id=>setDraft(d=>d?changeReviewLine(d,index,'custody_reminder_id',id):d)}/>}
      {key==='product_name'&&(extraColumns||receiptHandling(line)!=='NORMAL')&&<ReceiptHandlingFields storeId={storeId} line={line} editing={!readOnly} disabled={saving||receivingLocked} onChange={(key,val)=>setDraft(d=>d?changeReviewLine(d,index,key,val):d)}/>}</td>)}
      <td hidden={!extraColumns}><select aria-label={`第 ${index+1} 筆 分類`} value={line.category} onChange={e=>setDraft(d=>d?changeReviewLine(d,index,'category',e.target.value):d)}>{['食材','耗材','調料','酒水','待分類'].map(c=><option key={c}>{c}</option>)}</select></td><td hidden={!extraColumns}><input aria-label={`第 ${index+1} 筆 備註`} value={line.note} maxLength={2000} onChange={e=>setDraft(d=>d?changeReviewLine(d,index,'note',e.target.value):d)}/></td>
      <td className="receipt-delete-column"><button type="button" className="receipt-delete-line" aria-label={`刪除第 ${index+1} 筆`} disabled={row.receipt_status==='COMPLETED'||!!line.custody_posted||!!line.custody_reminder_id||!!line.custody_event_id} title={row.receipt_status==='COMPLETED'?'已入庫明細不可直接刪除':line.custody_posted||line.custody_reminder_id||line.custody_event_id?'已關聯寄庫紀錄，請先處理關聯':undefined} onClick={()=>removeRow(index)}><span aria-hidden="true">⊖</span> 刪除</button></td>
     </tr>)}</tbody></table></div>
     {row.receipt_status!=='COMPLETED'&&<button type="button" className="receipt-add-line" onClick={addRow}>＋ 輸入下一項</button>}
     {removed.length>0&&<div className="receipt-undo" role="status">已移除 {removed.length} 項，儲存後生效。<button type="button" className="text-button" onClick={undoRemove}>復原上一項</button></div>}
     <div className="receipt-review-head" hidden={!extraColumns&&!Number(draft.adjustment)&&!draft.adjustmentNote}><label>調整金額<input aria-label="貨單調整金額" inputMode="decimal" value={draft.adjustment} onChange={e=>update('adjustment',e.target.value)}/></label><label className="wide">調整說明（可後補）<input aria-label="貨單調整說明" placeholder="折讓、運費或尾差，可之後補充" value={draft.adjustmentNote} maxLength={2000} onChange={e=>update('adjustmentNote',e.target.value)}/></label></div>
     <div className="receipt-review-head"><div><span>明細小計</span><strong>{accountMoney(enteredSubtotal(draft).subtotal)}</strong></div><label>稅額（選填）<input aria-label="貨單稅額" inputMode="decimal" placeholder="選填，未註明可留空" value={draft.tax} onChange={e=>update('tax',e.target.value)}/></label><label>原單總額<input aria-label="貨單含稅金額" inputMode="decimal" placeholder={amounts?.suggested!==null&&amounts?.suggested!==undefined?`自動加總 ${amounts.suggested}`:'依原單填寫'} value={draft.total} onChange={e=>update('total',e.target.value)}/></label></div>
     <p className="receipt-account-help">{enteredSubtotal(draft).missing>0&&<span>尚有 {enteredSubtotal(draft).missing} 筆金額未填，小計僅計已填項目。 </span>}{amounts?.difference!==null&&amounts?.difference!==undefined&&Math.abs(amounts.difference)>0.00001&&<span>{amounts.roundedTotal?'四捨五入調整':amounts.roundedNet?'未稅進位':'原單差額'} {amounts.difference>0?'+':''}{accountMoney(amounts.difference)} · 依原單總額儲存。 </span>}稅額有列才填，未列可留空；輸入後自動加總。</p>
     <details hidden={!extraColumns} className="receipt-tax-converter"><summary>含稅價換算</summary><div className="receipt-review-head"><label>換算明細<select aria-label="換算明細" value={taxLine} onChange={e=>setTaxLine(Number(e.target.value))}>{draft.lines.map((line,i)=><option key={line.row_key} value={i}>{i+1}. {line.product_name||'未命名'}</option>)}</select></label><label>含稅單價<input aria-label="含稅單價" inputMode="decimal" value={grossPrice} onChange={e=>setGrossPrice(e.target.value)}/></label><label>稅率（%）<input aria-label="換算稅率" inputMode="decimal" placeholder="自行填寫" value={taxRate} onChange={e=>setTaxRate(e.target.value)}/></label></div><button type="button" className="shell-secondary" onClick={convertPrice}>換算並套用未稅單價</button><small>僅修改所選明細單價；整張貨單稅額依原單填寫。</small></details>
     <label >備註<textarea aria-label="貨單對帳備註" value={draft.note} maxLength={2000} onChange={e=>update('note',e.target.value)}/></label>
    </fieldset>
   </section>
  </div>}
  {draft&&<footer><div className="receipt-entry-totals"><span>{draft.lines.length} 項 · 未稅 {accountMoney(enteredSubtotal(draft).subtotal)}{draft.tax.trim()&&<> · 稅額 {accountMoney(Number(draft.tax))}</>}</span><strong>合計 {accountMoney(amounts?.total??null)}</strong><small role="status">{saving?'儲存中…':dirty?'未儲存':row?.review_completed?'已完成建檔':row?.edit_revision?'已儲存':'待建檔'}</small></div><div><button type="button" className="shell-secondary" disabled={saving||readOnly} onClick={()=>void save(false,false)}>儲存</button><button type="button" className="shell-primary" disabled={saving||readOnly} onClick={()=>void save(false,!!nextId&&!!onNavigate,true)}>{nextId&&onNavigate?'完成建檔並下一張 →':'完成建檔'}</button></div></footer>}

 </dialog>;
}
