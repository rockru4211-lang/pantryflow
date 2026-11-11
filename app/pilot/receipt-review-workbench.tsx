'use client';
import {Fragment,useCallback,useEffect,useLayoutEffect,useRef,useState,type CSSProperties} from 'react';
import {supabase} from '@/lib/supabase-browser';
import {receiptRead,receiptReadError} from '@/lib/receipt-read';
import {readIngredientMatching,readSharedReceiptProducts,readScopedReceiptAccounts,saveReceiptReview,createReceiptSupplier,correctReceiptStore,createReceiptSamePhoto} from '@/lib/receipt-accounting-api';
import {accountMoney} from '@/lib/receipt-accounting';
import {applyCustodyReminder,custodyReleaseChoices,searchCustodyReminders} from '@/lib/custody-reminders';
import {useCustodyReminders,ReceiptReminderBadge} from './custody-reminder-badge';
import ReceiptHandlingFields from './receipt-handling-fields';
import {applyReviewCategoryDefaults,receiptDocumentTypes,receiptDocumentDiscount,receiptEntryDraft,setReceiptDocumentDiscount,type ReceiptDocumentType,type ReceiptEquipmentDocument,canExcludeReceiptCatalogLine,receiptCompletionError,receiptFinanceSent,receiptLineDifference,receiptHandling,receiptMissingPrices,changeReviewLine,changeReviewTax,reviewDraft,reviewError,reviewPayload,receiptEntryAmounts,enteredSubtotal,taxExclusivePrice,type ReviewAccount,type ReviewDraft} from '@/lib/receipt-review';
import ReceiptStoreField from './receipt-store-field';
import ReceiptEntryMore from './receipt-entry-more';
import ReceiptPackageInput from './receipt-package-input';
import ReceiptCategorySelect from './receipt-category-select';
import {receiptCategories,receiptCategoryOptions} from '@/lib/receipt-categories';
import type {IngredientMatching} from '@/lib/receipt-ingredient-matching';
import UnitSelect from './unit-select';
import {costingUnits} from '@/lib/operations-sheet';
import ReceiptSourceViewer from './receipt-source-viewer';
import ReceiptRetakeDialog from './receipt-retake-dialog';
import {pendingReceiptPurchases,receiptError,receiptReviewFields,type ReceiptField} from '@/lib/receipt-workflow';
import {defaultSupplierReceiptCategories,supplierReceiptCategory,receiptSavedUnits,supplierItems,applySupplierItem,applySharedReceiptProduct,keepReceiptProductName,matchSharedReceiptProducts,sameReceiptProduct,matchSupplierItems,matchReceiptSuppliers,exactReceiptSupplier,itemsForSupplier,receiptItemQuery,type ReceiptSupplierChoice,type SharedReceiptProduct,type SupplierItem} from '@/lib/receipt-supplier-items';
import './receipt-review-workbench.css';
type Props={storeId:string;batchId:string;nextId:string|null;previousId?:string|null;positionLabel?:string;onNavigate?:(id:string,created?:ReviewAccount)=>void;manualEntry?:boolean;onClose:()=>void;onSaved:(row:ReviewAccount,next:boolean)=>void};
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
 const [sharedProducts,setSharedProducts]=useState<{store:string;rows:SharedReceiptProduct[];error?:true}>();
 const [extraColumns,setExtraColumns]=useState(false);

 const [suppliers,setSuppliers]=useState<{store:string;rows:ReceiptSupplierChoice[]}>({store:storeId,rows:[]});
 const [supplierOpen,setSupplierOpen]=useState(false),[supplierError,setSupplierError]=useState('');
 const historyCache=useRef<SupplierItem[]|null>(null);
 const [knownUnits,setKnownUnits]=useState<{store:string;units:string[]}>({store:storeId,units:[]});
 const [removed,setRemoved]=useState<{line:ReviewDraft['lines'][number];index:number}[]>([]);
 const [taxLine,setTaxLine]=useState(0),[grossPrice,setGrossPrice]=useState(''),[taxRate,setTaxRate]=useState('');
 const [retakePage,setRetakePage]=useState('');
 const [retakePending,setRetakePending]=useState<string[]>([]);
 const [retakeReadError,setRetakeReadError]=useState('');
 const [retakeNeedsSave,setRetakeNeedsSave]=useState(false);
 const [retakeAlreadyRequested,setRetakeAlreadyRequested]=useState(false);
 const [retakeRevision,setRetakeRevision]=useState(0);
 const [supplierEditable,setSupplierEditable]=useState(false),[supplierNotice,setSupplierNotice]=useState('');
 const [candidate,setCandidate]=useState<ReviewAccount|null>(null);
 const [categoryHistory,setCategoryHistory]=useState<{store:string;rows:ReviewAccount[]}>({store:storeId,rows:[]});
 const [targetStore,setTargetStore]=useState(storeId);
 const [discountOpen,setDiscountOpen]=useState(false),[discountKind,setDiscountKind]=useState<'PERCENT'|'AMOUNT'>('AMOUNT'),[discountValue,setDiscountValue]=useState('');
 const [lineDiscountOpen,setLineDiscountOpen]=useState(false);
 const [action,setAction]=useState<'save'|'move'|'same-photo'>('save');
 const [excludeKeys,setExcludeKeys]=useState<string[]|null>(null);
 const [pickerCatalog,setPickerCatalog]=useState<{store:string;catalog:IngredientMatching}>();
 const categoryTouched=useRef(false),categoryHistoryRef=useRef<ReviewAccount[]>([]);

 const draftRef=useRef({dirty:false,row:null as ReviewAccount|null});
 const refreshLock=useRef(false),refreshEpoch=useRef(0);
 const supplierRetry=useRef<{key:string;id:string}|null>(null);
 const suppliersRef=useRef<{store:string;rows:ReceiptSupplierChoice[]}>({store:storeId,rows:[]});
 const matchingRef=useRef<{store:string;catalog?:IngredientMatching}>({store:storeId});
 const categoryContext=useCallback((value:ReviewDraft,current:ReviewAccount|null=draftRef.current.row)=>({supplierCategory:supplierReceiptCategory(suppliersRef.current.store===storeId?suppliersRef.current.rows:[],value.supplier),catalog:matchingRef.current.store===storeId?matchingRef.current.catalog:undefined,original:current??undefined}),[storeId]);
 const withCategoryDefaults=useCallback((value:ReviewDraft,current:ReviewAccount|null=draftRef.current.row)=>{
  if(lock.current||current&&(current.can_edit===false||current.record_state!=='LIVE'))return value;const context=categoryContext(value,current);let next=value;
  if(current&&!current.edit_revision&&current.status!=='CHECKED'&&!current.received_at&&!receiptCategories(current.receipt_categories).length&&!categoryTouched.current){
   const categories=defaultSupplierReceiptCategories(categoryHistoryRef.current,suppliersRef.current.store===storeId?suppliersRef.current.rows:[],value.supplier,batchId);
   if(JSON.stringify(value.receiptCategories||[])!==JSON.stringify(categories))next={...value,receiptCategories:categories};
  }
  return applyReviewCategoryDefaults(next,context);
 },[batchId,categoryContext,storeId]);
 useEffect(()=>{const controller=new AbortController();
  void readScopedReceiptAccounts(storeId,controller.signal,'','','ALL').then(rows=>{if(controller.signal.aborted)return;setKnownUnits({store:storeId,units:receiptSavedUnits(rows)});setCategoryHistory({store:storeId,rows});categoryHistoryRef.current=rows;setDraft(d=>{const current=draftRef.current.row||rows.find(r=>r.batch_id===batchId);return d&&current?withCategoryDefaults(d,current):d;});historyCache.current=supplierItems(rows,'',batchId);}).catch(()=>{});
  return()=>controller.abort();
 },[storeId,batchId,withCategoryDefaults]);
 useEffect(()=>{const controller=new AbortController();historyCache.current=null;
  void receiptRead(signal=>supabase.rpc('app_workspace',{p_store_id:storeId,p_section:'suppliers',p_filter:{}}).abortSignal(signal),controller.signal).then(result=>{
   if(controller.signal.aborted)return;if(result.error)throw result.error;
   const data=result.data as unknown as {suppliers?:ReceiptSupplierChoice[];editable?:boolean};if(!Array.isArray(data?.suppliers))throw Error('INVALID_RESPONSE');suppliersRef.current={store:storeId,rows:data.suppliers};setSuppliers(suppliersRef.current);setSupplierEditable(data.editable===true);setSupplierError('');setDraft(d=>d&&draftRef.current.row?withCategoryDefaults(d,draftRef.current.row):d);
  }).catch(()=>{if(!controller.signal.aborted){setSupplierEditable(false);setSupplierError('供應商清單暫時無法讀取，可先直接填寫。');}});
  return()=>controller.abort();
 },[storeId,withCategoryDefaults]);
 useEffect(()=>{const controller=new AbortController();
  void readIngredientMatching(storeId,controller.signal).then(catalog=>{if(controller.signal.aborted||!Array.isArray(catalog?.ingredients)||!Array.isArray(catalog?.bindings))return;matchingRef.current={store:storeId,catalog};setPickerCatalog({store:storeId,catalog});setDraft(d=>d&&draftRef.current.row?withCategoryDefaults(d,draftRef.current.row):d);}).catch(()=>{});
  return()=>controller.abort();
 },[storeId,withCategoryDefaults]);
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
  try{const items=historyCache.current??supplierItems(await readScopedReceiptAccounts(storeId,new AbortController().signal,'','',''),'',batchId);if(alive.current&&sequence===historyRequest.current){historyCache.current=items;setSuggestions({supplier,items:itemsForSupplier(items,exactReceiptSupplier(suppliersRef.current.rows,supplier)?.name||supplier)});}}
  catch{if(alive.current&&sequence===historyRequest.current)setHistoryError('歷史品項暫時無法讀取，仍可直接輸入。');}
  finally{if(alive.current&&sequence===historyRequest.current)setHistoryLoading(false);}
 }
 function convertPrice(){if(!draft)return;try{if(!draft.lines[taxLine]||receiptHandling(draft.lines[taxLine])!=='NORMAL')throw Error('請選擇一般進貨明細。');const price=taxExclusivePrice(grossPrice,taxRate);setDraft(changeReviewLine(draft,taxLine,'unit_price',String(price)));setError('');}catch(e){setError(e instanceof Error?e.message:'請檢查單價與稅率。');}}
 const dirty=targetStore!==storeId||!!draft&&JSON.stringify(draft)!==original;
 useLayoutEffect(()=>{draftRef.current={dirty,row};},[dirty,row]);
 const readRecognitionFields=useCallback(async(signal:AbortSignal)=>{
  const result=await receiptRead(request=>supabase.rpc('get_pilot_receipt',{p_batch_id:batchId}).abortSignal(request),signal);
  if(signal.aborted||!alive.current||result.error)return;
  const data=result.data as {fields?:ReceiptField[];line_states?:{row_key:string;decision?:string|null}[]}|null;
  setUncertainFields(receiptReviewFields(data?.fields||[],data?.line_states||[]));
 },[batchId]);
 async function readRecognition(){
  if(refreshLock.current||lock.current)return;refreshLock.current=true;const epoch=refreshEpoch.current;
  setRetakeRevision(value=>value+1);
  try{const rows=await readScopedReceiptAccounts(storeId,new AbortController().signal,'','','ALL',batchId);if(!alive.current||lock.current||epoch!==refreshEpoch.current)return;const fresh=rows.find(r=>r.batch_id===batchId);if(!fresh)throw Error('RECEIPT_ACCESS_DENIED');
   setRow(current=>current?{...current,documents:fresh.documents}:current);
   if(fresh.source_fingerprint===draftRef.current.row?.source_fingerprint){await readRecognitionFields(new AbortController().signal);setError('');return;}
   if(draftRef.current.dirty){setCandidate(fresh);return;}applyRecognition(fresh);
  }catch(e){if(alive.current)setError(receiptReadError(e));}finally{refreshLock.current=false;}
 }

 function applyRecognition(fresh:ReviewAccount){void readRecognitionFields(new AbortController().signal).catch(()=>{});draftRef.current={dirty:false,row:fresh};setRow(fresh);const d=withCategoryDefaults(reviewDraft(fresh),fresh);setDraft(d);setOriginal(JSON.stringify(d));setCandidate(null);setRemoved([]);setExcludeKeys(null);setError('');retry.current=null;}
 useEffect(()=>{dialog.current?.showModal();const controller=new AbortController();alive.current=true;
  async function load(){try{const rows=await readScopedReceiptAccounts(storeId,controller.signal,'','','ALL',batchId);const current=rows.find(a=>a.batch_id===batchId);if(!current)throw Error('RECEIPT_ACCESS_DENIED');if(controller.signal.aborted)return;setDiscountOpen(false);setDiscountValue('');setTargetStore(storeId);draftRef.current={dirty:false,row:current};setRow(current);const d=withCategoryDefaults(reviewDraft(current),current);setDraft(d);setOriginal(JSON.stringify(d));setRemoved([]);setExcludeKeys(null);setError('');retry.current=null;
   void readRecognitionFields(controller.signal).catch(()=>{});
  }catch(e){if(!controller.signal.aborted)setError(receiptReadError(e));}}
  void load();return()=>{alive.current=false;controller.abort();};
 },[storeId,batchId,reload,manualEntry,withCategoryDefaults,readRecognitionFields]);
 const sourcePaths=JSON.stringify(row?.documents?.map(document=>document.path)||[]);
 const hasPhotos=!!row?.documents?.length;
 useEffect(()=>{
  const paths=JSON.parse(sourcePaths) as string[];
  if(!paths.length)return;
  const controller=new AbortController();
  void receiptRead(()=>supabase.storage.from('receipt-documents').createSignedUrls(paths,3600),controller.signal).then(result=>{
   if(controller.signal.aborted)return;
   if(result.error)throw result.error;
   setUrls(Object.fromEntries((result.data||[]).map(document=>[document.path||'',document.signedUrl||''])));
   setImageError('');
  }).catch(()=>{if(!controller.signal.aborted)setImageError('原單暫時無法讀取，明細仍保留。');});
  return()=>controller.abort();
 },[sourcePaths,retakeRevision]);
 useEffect(()=>{
  if(!hasPhotos)return;
  const controller=new AbortController();
  void receiptRead(signal=>supabase.rpc('baihuayuan_receipt_photo',{
   p_action:'list',p_store:storeId,p_data:{batch_id:batchId},
  }).abortSignal(signal),controller.signal).then(result=>{
   if(controller.signal.aborted)return;
   if(result.error||!Array.isArray(result.data))throw Error('PHOTO_RETAKE_READ_FAILED');
   const tasks=result.data as unknown as {batch_id:string;document_id:string}[];
   setRetakePending(tasks.filter(task=>task.batch_id===batchId).map(task=>task.document_id));
   setRetakeReadError('');
  }).catch(()=>{if(!controller.signal.aborted)setRetakeReadError('重拍狀態暫時無法讀取。');});
  return()=>controller.abort();
 },[storeId,batchId,hasPhotos,retakeRevision]);
 useEffect(()=>{if(!dirty&&!saving)return;const warn=(e:BeforeUnloadEvent)=>e.preventDefault();window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirty,saving]);
 useEffect(()=>{
  const controller=new AbortController();
  void readSharedReceiptProducts(storeId,controller.signal).then(rows=>{
   if(!controller.signal.aborted)setSharedProducts({store:storeId,rows});
  }).catch(()=>{
   if(!controller.signal.aborted)setSharedProducts({store:storeId,rows:[],error:true});
  });
  return()=>controller.abort();
 },[storeId,reload]);
 function close(){if(lock.current)return;if(dirty&&!window.confirm('還有未儲存修正。確定捨棄並關閉？'))return;onClose();}
 function navigate(id:string|null|undefined){if(!id||lock.current||!onNavigate)return;if(dirty){void save(false,false,false,id);return;}onNavigate(id);}
 function reloadData(){if(lock.current)return;if(row){void readRecognition();return;}setError('');setReload(n=>n+1);}
 async function save(checked:boolean,next:boolean,finished=false,targetId?:string){if(!row||!draft||lock.current)return;if(finished&&!draft.entryMetadata?.equipment&&pendingReceiptPurchases(uncertainFields).length){setError('請先核對待確認品項，逐筆加入明細或略過。');return;}if(finished&&retakePending.length){setError(receiptError('PHOTO_RETAKE_REQUIRED'));return;}let data:ReturnType<typeof reviewPayload>&{entry_completed?:boolean;review_completed?:boolean};try{const prepared=finished?receiptEntryDraft(draft):draft;if(finished){const issue=receiptCompletionError(prepared);if(issue)throw Error(issue);}data=reviewPayload(row,prepared,checked);if(finished)data={...data,entry_completed:true,review_completed:true};}catch(e){setError(e instanceof Error?e.message:'請檢查輸入');return;}
  const key=JSON.stringify({storeId,batchId,targetStore,data});if(retry.current?.key!==key)retry.current={key,id:crypto.randomUUID()};lock.current=true;setAction(targetStore!==storeId?'move':'save');setSaving(true);setError('');refreshEpoch.current++;setCandidate(null);
  try{const saved=await (targetStore!==storeId?correctReceiptStore(storeId,batchId,targetStore,data,retry.current.id):saveReceiptReview(storeId,batchId,data,retry.current.id));if(!alive.current)return;retry.current=null;draftRef.current={dirty:false,row:saved};setRow(saved);const fresh=reviewDraft(saved);setDraft(fresh);setOriginal(JSON.stringify(fresh));setRemoved([]);setRetakeNeedsSave(false);window.dispatchEvent(new Event('custody-reminder-change'));onSaved(saved,false);if(targetStore!==storeId){window.dispatchEvent(new Event('receipt-store-change'));const destination=targetId||(next?nextId:null);if(destination&&onNavigate)onNavigate(destination);else onClose();return;}const destination=targetId||(next?nextId:null);if(destination&&onNavigate)onNavigate(destination);}
  catch(e){
   if(alive.current){
    const message=e&&typeof e==='object'&&'message' in e?String(e.message):String(e);
    if(message.includes('PHOTO_RETAKE_REQUIRED')){
     setError(receiptError(e));
     setRetakeRevision(value=>value+1);
    }else setError(targetStore!==storeId?`門市移轉未完成。${reviewError(e)}`:reviewError(e));
   }
  }finally{lock.current=false;if(alive.current)setSaving(false);}
 }
 const samePhotoRetry=useRef<{key:string;id:string}|null>(null);
 async function samePhoto(){
  if(!row||!draft||lock.current||!onNavigate||!row.can_edit||row.record_state!=='LIVE')return;
  if(targetStore!==storeId){setError('請先儲存門市變更，再新增同照片貨單。');return;}
  let data:ReturnType<typeof reviewPayload>|null=null;try{if(dirty)data=reviewPayload(row,draft,false);}catch(e){setError(e instanceof Error?e.message:'請檢查輸入');return;}
  const key=JSON.stringify({storeId,batchId,data});if(samePhotoRetry.current?.key!==key)samePhotoRetry.current={key,id:crypto.randomUUID()};
  lock.current=true;setAction('same-photo');setSaving(true);setError('');refreshEpoch.current++;
  try{const result=await createReceiptSamePhoto(storeId,batchId,data,samePhotoRetry.current.id);if(!alive.current)return;samePhotoRetry.current=null;onSaved(result.source_account,false);onSaved(result.account,false);onNavigate(result.account.batch_id,result.account);}
  catch(e){if(alive.current)setError(`同照片新增未完成。${reviewError(e)}`);}finally{lock.current=false;if(alive.current)setSaving(false);}
 }
 async function showItems(index:number){
  setSupplierOpen(false);setItemPicker(index);if(!draft||targetStore!==storeId)return;
  const supplier=draft.supplier.trim();if(suggestions.supplier===supplier&&suggestions.items.length)return;
  await loadHistory(supplier);

 }
 function addRow(){
  if(!draft||lock.current)return;
  const line={row_key:`local-${crypto.randomUUID()}`,product_name:'',specification:'',unit:'',quantity:'',unit_price:'',subtotal:'',category:'待分類',note:''};
  setDraft(d=>d?withCategoryDefaults({...d,lines:[...d.lines,line]}):d);setItemPicker(null);setError('');
 }
 function removeRow(index:number){
  if(!draft||lock.current)return;
  const line=draft.lines[index];if(!line||line.custody_posted||line.custody_reminder_id||line.custody_event_id)return;
  setRemoved(items=>[...items,{line,index}]);setDraft(d=>d?{...d,lines:d.lines.filter(l=>l.row_key!==line.row_key)}:d);setItemPicker(null);
 }
 function excludeCatalogRows(){
  if(!draft||!row?.can_edit||row.record_state!=='LIVE'||row.received_at||row.receipt_status==='COMPLETED'||lock.current||!excludeKeys?.length)return;
  const keys=new Set(excludeKeys);
  const items=draft.lines.map((line,index)=>({line,index})).filter(({line})=>keys.has(line.row_key)&&canExcludeReceiptCatalogLine(line));
  const removedKeys=new Set(items.map(({line})=>line.row_key));
  setRemoved(previous=>[...previous,...items.reverse()]);
  setDraft({...draft,lines:draft.lines.filter(line=>!removedKeys.has(line.row_key))});
  setExcludeKeys(null);setItemPicker(null);
 }
 async function decidePurchase(rowKey:string,decision:'INCLUDE'|'IGNORE'){
  if(!row?.run_id||!row.can_edit||row.record_state!=='LIVE'||row.received_at||row.receipt_status==='COMPLETED'||lock.current)return;
  if(dirty){setError('請先儲存目前明細，再處理待核對品項。');return;}
  lock.current=true;setSaving(true);setError('');
  try{
   const result=await receiptRead(signal=>supabase.rpc('set_baihuayuan_receipt_line_decision',{p_store_id:storeId,p_batch_id:batchId,p_run_id:row.run_id!,p_row_key:rowKey,p_decision:decision}).abortSignal(signal),new AbortController().signal);
   if(result.error)throw result.error;
   const fresh=(await readScopedReceiptAccounts(storeId,new AbortController().signal,'','','ALL',batchId)).find(r=>r.batch_id===batchId);
   if(!fresh)throw Error('RECEIPT_ACCESS_DENIED');
   if(alive.current){setUncertainFields(fields=>fields.filter(field=>field.row_key!==rowKey));applyRecognition(fresh);}
  }catch{if(alive.current)setError('無法重新載入待核對品項，請重新讀取貨單後確認。');}
  finally{lock.current=false;if(alive.current)setSaving(false);}
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
 function update(key:keyof Omit<ReviewDraft,'lines'|'receiptCategories'|'entryMetadata'>,value:string){if(key==='supplier'){historyRequest.current++;setItemPicker(null);setHistoryLoading(false);}setDraft(d=>d?(key==='tax'?changeReviewTax(d,value,row?.source_total!=null||row?.amount_override?.total!=null):key==='supplier'?withCategoryDefaults({...d,supplier:value}):{...d,[key]:value}):d);}
 let amounts:ReturnType<typeof receiptEntryAmounts>|null=null;try{if(draft)amounts=receiptEntryAmounts(draft);}catch{/* Invalid input remains in the draft, never coerced to zero. */}
 const custodySupplier=draft?exactReceiptSupplier(suppliers.rows,draft.supplier):undefined;
 const custodySupplierNames=draft?[draft.supplier,...(custodySupplier?[custodySupplier.name,...custodySupplier.aliases||[]]:[])]:[];
 const equipment=draft?.entryMetadata?.equipment;
 const documentType=equipment?.kind||'PURCHASE';
 const documentDiscount=draft?.entryMetadata?.discount;
 let discountAmount:number|undefined;
 try{if(draft)discountAmount=receiptDocumentDiscount(draft)?.amount;}catch{/* Show the validation message when saving. */}
 function changeDocumentType(kind:ReceiptDocumentType){
  setDraft(current=>{
   if(!current)return current;
   const entryMetadata={...current.entryMetadata};
   if(kind==='PURCHASE')delete entryMetadata.equipment;
   else entryMetadata.equipment={name:'',date:'',model:'',warranty_until:'',...entryMetadata.equipment,kind};
   return {...current,entryMetadata};
  });
  setError('');
 }
 function updateEquipment(key:Exclude<keyof ReceiptEquipmentDocument,'kind'>,value:string){
  setDraft(current=>current?.entryMetadata?.equipment?{...current,entryMetadata:{...current.entryMetadata,equipment:{...current.entryMetadata.equipment,[key]:value}}}:current);
 }
 function toggleDiscount(){
  if(!discountOpen){setDiscountKind(documentDiscount?.kind||'AMOUNT');setDiscountValue(documentDiscount?String(documentDiscount.value):'');}
  if(discountOpen)setLineDiscountOpen(false);
  setDiscountOpen(!discountOpen);
 }
 function applyDiscount(value:string){
  if(!draft)return;
  try{
   setDraft(setReceiptDocumentDiscount(draft,discountKind,value,row?.source_total!=null));
   setDiscountValue(value);
   setError('');
  }catch(e){setError(e instanceof Error?e.message:'請檢查折扣。');}
 }
 const missingPrices=draft?receiptMissingPrices(draft.lines):0;
 const receivingLocked=!!row?.received_at;
 const readOnly=!!row&&(!row.can_edit||row.record_state!=='LIVE');
 const natureLocked=receivingLocked||row?.receipt_status==='COMPLETED'||(!row?.receipt_entry_metadata?.equipment&&(!!row?.finance_sent_at||!!row?.review_completed||!!row?.checked_at));
 const localStore=targetStore===storeId;
 const supplierName=draft?.supplier.trim()||'';
 const canonicalSupplier=exactReceiptSupplier(suppliers.rows,supplierName)?.name||supplierName;
 const historyItems=localStore&&suggestions.supplier===supplierName?suggestions.items:[];
 const retakeAllowed=!!row&&!readOnly&&!receivingLocked&&row.receipt_status!=='COMPLETED'&&!row.checked_at&&!receiptFinanceSent(row);
 const retakeDocuments=row?.documents?.filter(document=>!retakePending.includes(document.id))||[];
 const pendingRetake=retakePending.length>0;
 const catalogRows=draft?.lines.filter(canExcludeReceiptCatalogLine)||[];
 const pendingPurchases=pendingReceiptPurchases(uncertainFields);
 const canTidyLines=!!row&&!readOnly&&!receivingLocked&&row.receipt_status!=='COMPLETED'&&targetStore===storeId;
 const reconciliationAvailable=!!row&&(row.status==='CHECKED'||receiptFinanceSent(row)||row.review_completed===true);
 function openRetake(documentId:string){
  if(lock.current||!retakeAllowed||retakePending.includes(documentId))return;
  setRetakeNeedsSave(dirty);
  if(!dirty)setRetakePage(documentId);
 }
 return <dialog ref={dialog} className={`receipt-review-workbench receipt-account-dialog receipt-manual-workbench receipt-unified-workbench${extraColumns?" extra-columns":""}`} aria-label="貨單核對" onCancel={e=>{e.preventDefault();close();}}>
  <header><div><h2>貨單建檔</h2><small>{manualEntry&&row?`${row.edit_revision?'已有明細':'待建檔'} · `:''}{row?(draft?.supplier||row.supplier_name||'供應商待填'):'讀取貨單…'} · {row?.document_number||row?.batch_number||''}</small></div><div className="receipt-entry-navigation">{onNavigate&&<><button type="button" className="shell-secondary" disabled={saving||!previousId} onClick={()=>navigate(previousId)}>上一張</button><small>{positionLabel}</small></>}<button type="button" className="shell-secondary" disabled={saving} onClick={close}>關閉</button></div></header>
  {supplierNotice&&<p className="receipt-account-help" role="status">{supplierNotice}</p>}
  {error&&!draft&&<p className="sheet-error" role="alert">{error} <button type="button" className="text-button" disabled={saving} onClick={reloadData}>重新讀取</button></p>}
  {!draft&&!error&&<p role="status">正在讀取這張貨單…</p>}
  {row&&draft&&<fieldset className="receipt-entry-metadata" disabled={saving||readOnly}>     <div className="receipt-review-head"><label className="receipt-supplier-field">供應商<input disabled={receivingLocked} aria-label="貨單供應商" autoComplete="off" placeholder="輸入關鍵字選供應商" value={draft.supplier} maxLength={160} onFocus={()=>{setSupplierOpen(true);setItemPicker(null);}} onKeyDown={e=>{if(e.key==='Escape')setSupplierOpen(false);}} onChange={e=>{update('supplier',e.target.value);setSupplierOpen(true);}}/>{supplierOpen&&<div className="receipt-supplier-picker" aria-label="供應商快選">{supplierError?<small>{supplierError}</small>:matchReceiptSuppliers(suppliers.store===storeId?suppliers.rows:[],draft.supplier).map(s=><button type="button" key={s.id} onClick={()=>{update('supplier',s.name);setSupplierOpen(false);}}>{s.name}</button>)}{supplierEditable&&suppliers.store===storeId&&draft.supplier.trim()&&!exactReceiptSupplier(suppliers.rows,draft.supplier)&&matchReceiptSuppliers(suppliers.rows,draft.supplier).length===0&&<button type="button" disabled={saving||readOnly} onClick={()=>void createSupplier()}>＋ 建立供應商「{draft.supplier.trim()}」</button>}<button type="button" onClick={()=>setSupplierOpen(false)}>收起</button></div>}</label><ReceiptCategorySelect value={draft.receiptCategories||[]} options={receiptCategoryOptions(categoryHistory.store===storeId?categoryHistory.rows:[])} disabled={saving||readOnly} onChange={categories=>{categoryTouched.current=true;setDraft(d=>d?withCategoryDefaults({...d,receiptCategories:categories}):d);setSupplierOpen(false);}}/>
     <label>單據性質<select aria-label="單據性質" value={documentType} disabled={natureLocked||!row.documents?.length} onChange={e=>changeDocumentType(e.target.value as ReceiptDocumentType)}>{Object.entries(receiptDocumentTypes).map(([id,label])=><option key={id} value={id} disabled={id==='PURCHASE'&&!!row.receipt_entry_metadata?.equipment&&!!row.checked_at}>{label}</option>)}</select></label>
     <ReceiptStoreField storeId={storeId} storeName={row.store_name} value={targetStore} onChange={id=>{setTargetStore(id);setError('');}} disabled={saving||readOnly}/>
     <label>{equipment?'單據日期':'到貨日期'}<input disabled={receivingLocked} aria-label="貨單到貨日期" type="date" value={draft.date} onChange={e=>update('date',e.target.value)}/></label><label hidden={!extraColumns&&!draft.number}>貨單號碼<input disabled={receivingLocked} aria-label="貨單號碼" value={draft.number} maxLength={160} onChange={e=>update('number',e.target.value)}/></label></div></fieldset>}
  {row&&draft&&<div ref={split} style={{"--source-width":`${sourceWidth}%`} as CSSProperties} className={`receipt-review-split${sourceVisible?'':' source-hidden'}`}>
   {sourceVisible&&<aside aria-label="原始貨單">
    {imageError&&<p role="alert">{imageError}</p>}
    {dirty&&retakeNeedsSave&&<p className="receipt-retake-status" role="status">請先儲存目前明細，再退回重拍。</p>}
    {(pendingRetake||retakeReadError)&&<div className="receipt-retake-status" role="status">
     {pendingRetake&&<strong>已退回，待門市重拍（{retakePending.length} 張）</strong>}
     {pendingRetake&&retakeAlreadyRequested&&<small>這張照片已有重拍要求，原先的原因與說明已保留。</small>}
     {retakeReadError&&<small>{retakeReadError}</small>}
     <button type="button" className="text-button" disabled={saving} onClick={()=>void readRecognition()}>重新讀取</button>
    </div>}
    <ReceiptSourceViewer documents={row.documents||[]} imageUrls={urls} documentAction={retakeAllowed?document=>
     <button type="button" className="shell-secondary receipt-retake-button" disabled={saving||retakePending.includes(document.id)}
      onClick={()=>openRetake(document.id)}>{retakePending.includes(document.id)?'待重拍':'退回重拍'}</button>:undefined}/>
   </aside>}
   {sourceVisible&&<div className="receipt-split-handle" role="separator" tabIndex={0} aria-label="調整貨單與明細寬度" aria-orientation="vertical" aria-valuemin={25} aria-valuemax={55} aria-valuenow={sourceWidth} onKeyDown={e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();setSourceWidth(v=>Math.max(25,Math.min(55,v+(e.key==='ArrowLeft'?-2:2))));}}} onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);}} onPointerMove={e=>{if(!e.currentTarget.hasPointerCapture(e.pointerId)||!split.current)return;const rect=split.current.getBoundingClientRect();setSourceWidth(Math.max(25,Math.min(55,100*(e.clientX-rect.left)/rect.width)));}} onPointerUp={e=>{if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}}/>}
   <section className="receipt-review-edit" aria-label={equipment?receiptDocumentTypes[documentType]:'可更正進貨明細'}>
    <div className="receipt-entry-sheet-heading"><h3>{equipment?receiptDocumentTypes[documentType]:'進貨明細'} {!equipment&&missingPrices>0&&<small className="receipt-pending-price">待補價格・{missingPrices} 項</small>}</h3>{!equipment&&<button type="button" className="shell-secondary" disabled={saving||readOnly||row.receipt_status==='COMPLETED'} onClick={addRow}>＋ 新增一列</button>}</div>
    <ReceiptEntryMore key={batchId} storeId={storeId} batchId={batchId} disabled={saving||readOnly} hasSavedData={!!row.edit_revision||!!row.received_at||row.receipt_status==='COMPLETED'||row.lines.length>0} showPhotoRequest={false} onResult={()=>void readRecognition()}>{!equipment&&<button type="button" className="receipt-same-photo" disabled={saving||readOnly} onClick={toggleDiscount}>{discountOpen?'收起折扣':'折扣設定'}</button>}{!readOnly&&onNavigate&&!!row.documents?.length&&<button type="button" className="receipt-same-photo" disabled={saving} onClick={()=>void samePhoto()}>同照片新增貨單</button>}</ReceiptEntryMore>
    {candidate&&<div className="receipt-account-warning" role="status">新結果有 {candidate.lines.length} 筆明細，已保留目前輸入。<details><summary>比較辨識結果</summary><ul>{candidate.lines.map(l=><li key={l.row_key}>{l.product_name||'品名待確認'} · {l.quantity??'數量待確認'} {l.unit} · 單價 {accountMoney(l.unit_price)}</li>)}</ul></details><button type="button" className="text-button" disabled={saving} onClick={()=>{if(window.confirm('套用辨識結果會取代此視窗尚未儲存的輸入，確定套用？'))applyRecognition(candidate);}}>套用辨識結果</button><button type="button" className="text-button" onClick={()=>setCandidate(null)}>保留目前輸入</button></div>}
    {row.source_changed&&<p className="receipt-account-warning">原始資料已有新修正，請重新核對原單與本次明細。</p>}
    {!equipment&&row.pending&&<p className="receipt-account-warning">照片已保存，缺單價也能先儲存，補齊核對後再按完成。</p>}
    <div className="receipt-review-actions">{!equipment&&<button type="button" className="shell-secondary" onClick={()=>setExtraColumns(v=>!v)}>{extraColumns?"收起其他欄位":"其他欄位"}</button>}<button type="button" className="shell-secondary" disabled={saving} onClick={()=>setSourceVisible(v=>!v)}>{sourceVisible?'收起原單':'顯示原單'}</button></div>
    {equipment?<fieldset className="receipt-equipment-entry" disabled={saving||readOnly}>
     <div className="receipt-review-head">
      <label>設備名稱<input value={equipment.name} maxLength={160} onChange={e=>updateEquipment('name',e.target.value)}/></label>
      <label>{equipment.kind==='MAINTENANCE'?'處理日期':'採購日期'}<input type="date" value={equipment.date||draft.date} onChange={e=>updateEquipment('date',e.target.value)}/></label>
      <label>金額（NT$）<input aria-label="設備單據金額" inputMode="decimal" value={draft.total} onChange={e=>update('total',e.target.value)}/></label>
     </div>
     {equipment.kind==='EQUIPMENT_PURCHASE'&&<div className="receipt-review-head">
      <label>型號（選填）<input value={equipment.model} maxLength={160} onChange={e=>updateEquipment('model',e.target.value)}/></label>
      <label>保固到期日（選填）<input type="date" value={equipment.warranty_until} onChange={e=>updateEquipment('warranty_until',e.target.value)}/></label>
     </div>}
     <label>{equipment.kind==='MAINTENANCE'?'處理內容':'備註'}<textarea aria-label="設備單據備註" value={draft.note} maxLength={2000} onChange={e=>update('note',e.target.value)}/></label>
    </fieldset>:<fieldset disabled={saving||readOnly}>
     {pendingPurchases.length>0&&<details className="receipt-account-warning">
      <summary>待核對品項 · {pendingPurchases.length} 項</summary>
      <ul>{pendingPurchases.map(item=><li key={item.key}>{item.name||'品名待確認'}{item.quantity&&` · 數量 ${item.quantity}`}{item.amount&&` · 金額 ${item.amount}`}
       {canTidyLines&&<><button type="button" className="text-button" onClick={()=>void decidePurchase(item.key,'INCLUDE')}>加入明細</button><button type="button" className="text-button" onClick={()=>void decidePurchase(item.key,'IGNORE')}>略過</button></>}
      </li>)}</ul>
     </details>}
     {canTidyLines&&catalogRows.length>0&&<div className="receipt-review-actions">
      {excludeKeys===null?<button type="button" className="shell-secondary" onClick={()=>setExcludeKeys([])}>批次排除未採購列</button>:<section className="receipt-account-warning" aria-label="預覽排除未採購列">
       <strong>核對原單後，勾選本次未採購的列</strong> <button type="button" className="text-button" onClick={()=>setExcludeKeys(catalogRows.map(line=>line.row_key))}>全選建議排除列</button>
       <ul>{catalogRows.map(line=><li key={line.row_key}><label><input type="checkbox" checked={excludeKeys.includes(line.row_key)} onChange={e=>setExcludeKeys(keys=>e.target.checked?[...(keys||[]),line.row_key]:(keys||[]).filter(key=>key!==line.row_key))}/>{line.product_name}{line.unit&&` · ${line.unit}`}</label></li>)}</ul>
       <button type="button" className="shell-secondary" disabled={!excludeKeys.length} onClick={excludeCatalogRows}>排除已勾選 {excludeKeys.length} 列</button><button type="button" className="text-button" onClick={()=>setExcludeKeys(null)}>取消</button>
      </section>}
     </div>}
     {discountOpen&&<div className="receipt-discount-toolbar">
      <label>整張貨單折扣<select aria-label="整張折扣方式" value={discountKind} onChange={e=>{setDiscountKind(e.target.value as 'PERCENT'|'AMOUNT');setDiscountValue('');}}><option value="AMOUNT">金額折抵</option><option value="PERCENT">百分比優惠</option></select></label>
      <label>{discountKind==='AMOUNT'?'NT$':'%'}<input aria-label="整張折扣" inputMode="decimal" placeholder={discountKind==='AMOUNT'?'例如 100':'例如 5'} value={discountValue} onChange={e=>setDiscountValue(e.target.value)}/></label>
      <button type="button" className="shell-secondary" onClick={()=>applyDiscount(discountValue)}>套用折扣</button>
      {documentDiscount&&<button type="button" className="text-button" onClick={()=>applyDiscount('')}>移除整單折扣</button>}
      <button type="button" className="text-button" aria-expanded={lineDiscountOpen} onClick={()=>setLineDiscountOpen(value=>!value)}>{lineDiscountOpen?'收起逐項折扣':'逐項折扣'}</button>
      {discountKind==='PERCENT'&&<small>輸入 5 代表折抵 5%</small>}
     </div>}


     <div className="receipt-review-lines"><table><thead><tr>{['品名','數量','單位','包裝內容（選填）','單價（未稅）',...(lineDiscountOpen?['逐項折扣']:[]),'金額（未稅）','分類','備註'].map(v=><th hidden={!extraColumns&&["分類","備註"].includes(v)} key={v}>{v}</th>)}<th className="receipt-delete-column" aria-label="刪除明細"/></tr></thead><tbody>{draft.lines.map((line,index)=>{
      const custodyChoices=custodyReleaseChoices(reminders.rows,line,custodySupplierNames);
      const sharedCatalog=sharedProducts?.store===storeId?sharedProducts:undefined;
      const query=receiptItemQuery(line.product_name);
      const sharedMatches=itemPicker===index&&receiptHandling(line)==='NORMAL'
       ?matchSharedReceiptProducts(sharedCatalog?.rows||[],query,line,8,{
        catalog:localStore&&pickerCatalog?.store===storeId?pickerCatalog.catalog:undefined,
        supplier:localStore?canonicalSupplier:undefined,history:historyItems,
       })
       :[];
      const historyMatches=itemPicker===index?matchSupplierItems(historyItems.filter(item=>!sharedMatches.some(product=>sameReceiptProduct(item,product))),query):[];
      const keepOriginal=receiptHandling(line)==='NORMAL'&&!receivingLocked&&!row.review_completed&&row.receipt_status!=='COMPLETED';

      return <tr key={line.row_key}>
      {(['product_name','quantity','unit','specification','unit_price','subtotal'] as const).map((key,i)=><Fragment key={key}>{key==='subtotal'&&lineDiscountOpen&&<td className="receipt-discount-cell">{receiptHandling(line)==='CUSTODY_RELEASE'?<span>—</span>:<div><input aria-label={`第 ${index+1} 筆 折讓`} inputMode="decimal" placeholder="—" value={line.discountValue||''} onChange={e=>setDraft(d=>d?changeReviewLine(d,index,'discountValue',e.target.value):d)}/><select aria-label={`第 ${index+1} 筆 折讓方式`} value={line.discountKind||'PERCENT'} onChange={e=>setDraft(d=>d?changeReviewLine(d,index,'discountKind',e.target.value):d)}><option value="PERCENT">%</option><option value="AMOUNT">金額</option></select></div>}</td>}<td className={key==='unit'&&needsCheck(index,key)?'receipt-needs-check':undefined} onBlur={key==='product_name'?e=>{if(!e.currentTarget.contains(e.relatedTarget as Node|null))setItemPicker(null);}:undefined}>{receiptHandling(line)==='CUSTODY_RELEASE'&&['unit_price','subtotal'].includes(key)?<span className="receipt-nonbilling">{key==='subtotal'?'本次不計款':'—'}</span>:key==='specification'?<ReceiptPackageInput label={`第 ${index+1} 筆 包裝內容`} value={line.specification} unit={line.unit} disabled={receivingLocked||!!line.custody_posted} onChange={value=>setDraft(d=>d?withCategoryDefaults(changeReviewLine(d,index,'specification',value)):d)}/>:key==='unit'?<UnitSelect ariaLabel={`第 ${index+1} 筆 單位`} required={false} units={[...costingUnits,...(knownUnits.store===storeId?knownUnits.units:[]),...draft.lines.map(l=>l.unit)]} onUnitAdded={unit=>setKnownUnits(old=>({store:storeId,units:[...new Set([...(old.store===storeId?old.units:[]),unit])]}))} value={line.unit} disabled={!!line.custody_posted||receivingLocked} onChange={value=>{setItemPicker(null);setDraft(d=>d?withCategoryDefaults(changeReviewLine(d,index,'unit',value)):d);}}/>:<input readOnly={key==='subtotal'&&!!line.discountValue?.trim()} disabled={!!line.custody_posted&&['quantity','unit'].includes(key)||receivingLocked&&['product_name','specification','quantity','unit'].includes(key)} aria-label={`第 ${index+1} 筆 ${['品名','數量','單位','包裝內容','未稅單價','未稅金額'][i]}`} inputMode={['quantity','unit_price','subtotal'].includes(key)?'decimal':undefined} className={needsCheck(index,key)?'receipt-needs-check':undefined} title={needsCheck(index,key)?'待核對，可先儲存':undefined} autoFocus={key==='product_name'&&line.row_key.startsWith('local-')} autoComplete="off" placeholder={key==='product_name'?'輸入品名關鍵字':key==='unit_price'?'待補':key==='subtotal'?'—':undefined} onFocus={key==='product_name'?e=>{e.currentTarget.select();void showItems(index);}:()=>{setItemPicker(null);setSupplierOpen(false);}} onKeyDown={key==='product_name'?e=>{if(e.key==='Escape')setItemPicker(null);}:undefined} value={key==='product_name'?receiptItemQuery(line[key]):line[key]} onChange={e=>{setDraft(d=>d?withCategoryDefaults(changeReviewLine(d,index,key,e.target.value)):d);if(key==='product_name')setItemPicker(index);}}/ >}{key==='product_name'&&itemPicker===index&&receiptItemQuery(line.product_name).trim().length>0&&<div className="receipt-item-picker" aria-label="品項快選">{searchCustodyReminders(reminders.rows,receiptItemQuery(line.product_name),draft.supplier).length>0&&<><small>已建立的寄庫品項</small>{searchCustodyReminders(reminders.rows,receiptItemQuery(line.product_name),draft.supplier).map(item=><button type="button" className="receipt-custody-choice" key={item.id} disabled={!!line.custody_posted||receivingLocked||item.remaining<=0} onClick={()=>{setDraft(d=>d?withCategoryDefaults(applyCustodyReminder(d,index,item)):d);setItemPicker(null);}}><strong>{item.name}<span>寄庫 {item.remaining} {item.unit}</span></strong><small>{item.supplier} · {item.code} · {item.unit}{item.remaining<=0?' · 已用完':''}</small></button>)}</>}{receiptHandling(line)==='NORMAL'&&<>
       {!sharedCatalog?<small role="status">讀取共用品項…</small>:sharedCatalog.error?<small>共用品項暫時無法讀取。</small>:sharedMatches.length===0?<><small>兩店共用品項</small><small>沒有符合的共用品項。</small></>:sharedMatches.map((item,position)=><Fragment key={item.id}>
        {(position===0||sharedMatches[position-1].supplierConfirmed!==item.supplierConfirmed)&&<small>{item.supplierConfirmed?'本供應商已核對':'兩店共用品項'}</small>}
        <button type="button" disabled={!!line.custody_posted||receivingLocked} onClick={()=>{
         setDraft(d=>d?applySharedReceiptProduct(d,index,item,localStore?categoryContext(d,row):{}):d);setItemPicker(null);
        }}><strong>{item.name}</strong><small>{[item.specification,item.base_unit,item.product_code].filter(Boolean).join(' · ')}</small></button>
       </Fragment>)}
      </>}{localStore&&(historyLoading||historyError||historyMatches.length>0)&&<><small>本店歷史品項 · {draft.supplier.trim()||'所有供應商'}</small>{historyLoading?<small role="status">讀取歷史資料…</small>:historyError?<small>{historyError}</small>:historyMatches.map(item=><button type="button" key={`${item.supplier}:${item.name}:${item.unit}:${item.specification}`} disabled={!!line.custody_posted||receivingLocked} onClick={()=>{setDraft(d=>d?applySupplierItem(d,index,item,categoryContext(d)):d);setItemPicker(null);}}><strong>{item.name}</strong><small>{item.supplier} · {item.unit} {item.specification}{item.price!==null?` · 最近進價 ${accountMoney(item.price)}`:''}</small><small>{item.date}</small></button>)}</>}
      <button type="button" className="receipt-picker-dismiss" onClick={()=>{
       if(keepOriginal){
        const originalLine=row.lines.find(saved=>saved.row_key===line.row_key);
        setDraft(d=>d?keepReceiptProductName(d,index,originalLine?.supplier_item_name||originalLine?.source_product):d);
       }
       setItemPicker(null);
      }}>{keepOriginal?'保留原單品名，稍後核對':'保留目前品名'}</button></div>}


      {key==='subtotal'&&receiptLineDifference(line)!==null&&<small className="receipt-line-warning" title="保留原單金額，可先儲存後核對">與數量 × 單價差 {accountMoney(receiptLineDifference(line))}</small>}
      {key==='product_name'&&!!line.discountValue?.trim()&&<small className="receipt-discount-hint">折讓 {line.discountValue}{line.discountKind==='AMOUNT'?' 元（未稅）':'%'}</small>}
      {key==='product_name'&&receiptHandling(line)!=='CUSTODY_RELEASE'&&<ReceiptReminderBadge rows={reminders.rows} line={line} supplier={draft.supplier} editable={!readOnly&&!receivingLocked} disabled={saving||receivingLocked} onChange={id=>setDraft(d=>d?changeReviewLine(d,index,'custody_reminder_id',id):d)}/>}
      {key==='product_name'&&!readOnly&&!receivingLocked&&receiptHandling(line)==='NORMAL'&&custodyChoices.length>0&&!line.unit_price.trim()&&<button type="button" className="text-button" disabled={saving||targetStore!==storeId} onClick={()=>setDraft(d=>d?changeReviewLine(d,index,'handling','CUSTODY_RELEASE'):d)}>寄庫領回</button>}
      {key==='product_name'&&(extraColumns||receiptHandling(line)!=='NORMAL')&&<ReceiptHandlingFields storeId={storeId} line={line} reminders={custodyChoices} reminderError={reminders.error} completed={!!row.review_completed&&!dirty} editing={!readOnly} disabled={saving||receivingLocked||targetStore!==storeId} onChange={(key,val)=>setDraft(d=>d?changeReviewLine(d,index,key,val):d)}/>}</td></Fragment>)}
      <td hidden={!extraColumns}><select aria-label={`第 ${index+1} 筆 分類`} value={line.category} onChange={e=>setDraft(d=>d?changeReviewLine(d,index,'category',e.target.value):d)}>{[...new Set(['食材','酒水','耗材',line.category,'待分類'].filter(Boolean))].map(c=><option key={c}>{c}</option>)}</select></td><td hidden={!extraColumns}><input aria-label={`第 ${index+1} 筆 備註`} value={line.note} maxLength={2000} onChange={e=>setDraft(d=>d?changeReviewLine(d,index,'note',e.target.value):d)}/></td>
      <td className="receipt-delete-column"><button type="button" className="receipt-delete-line" aria-label={`刪除第 ${index+1} 筆`} disabled={row.receipt_status==='COMPLETED'||!!line.custody_posted||!!line.custody_reminder_id||!!line.custody_event_id} title={row.receipt_status==='COMPLETED'?'已入庫明細不可直接刪除':line.custody_posted||line.custody_reminder_id||line.custody_event_id?'已關聯寄庫紀錄，請先處理關聯':undefined} onClick={()=>removeRow(index)}><span aria-hidden="true">⊖</span> 刪除</button></td>
     </tr>;})}</tbody></table></div>
     {row.receipt_status!=='COMPLETED'&&<button type="button" className="receipt-add-line" onClick={addRow}>＋ 輸入下一項</button>}
     {removed.length>0&&<div className="receipt-undo" role="status">已移除 {removed.length} 項，儲存後生效。<button type="button" className="text-button" onClick={undoRemove}>復原上一項</button></div>}
     <div className="receipt-review-head" hidden={!extraColumns&&!Number(draft.adjustment)&&!draft.adjustmentNote}><label>其他金額調整<input aria-label="貨單調整金額" inputMode="decimal" value={draft.adjustment} onChange={e=>update('adjustment',e.target.value)}/></label><label className="wide">調整說明（可後補）<input aria-label="貨單調整說明" placeholder="折讓、運費或尾差，可之後補充" value={draft.adjustmentNote} maxLength={2000} onChange={e=>update('adjustmentNote',e.target.value)}/></label></div>
     <div className="receipt-review-head"><div><span>明細小計</span><strong>{accountMoney(enteredSubtotal(draft).subtotal)}</strong>{documentDiscount&&<small>整單折抵 {discountAmount===undefined?'待確認':accountMoney(discountAmount)}</small>}</div><label>稅額（選填）<input aria-label="貨單稅額" inputMode="decimal" placeholder="月底才有可留空，確認免稅填 0" value={draft.tax} onChange={e=>update('tax',e.target.value)}/></label><label>原單總額<input aria-label="貨單含稅金額" inputMode="decimal" placeholder={amounts?.suggested!==null&&amounts?.suggested!==undefined?`自動加總 ${amounts.suggested}`:'依原單填寫'} value={draft.total} onChange={e=>update('total',e.target.value)}/></label></div>
     {(enteredSubtotal(draft).missing>0||Math.abs(amounts?.difference??0)>0.00001)&&<p className="receipt-account-help">{enteredSubtotal(draft).missing>0&&<span>尚有 {enteredSubtotal(draft).missing} 筆金額未填，小計僅計已填項目。 </span>}{amounts?.difference!==null&&amounts?.difference!==undefined&&Math.abs(amounts.difference)>0.00001&&<span>{amounts.roundedTotal?'四捨五入調整':amounts.roundedNet?'未稅進位':'原單差額'} {amounts.difference>0?'+':''}{accountMoney(amounts.difference)} · 依原單總額儲存。 </span>}</p>}
     {reconciliationAvailable&&<div className="receipt-review-actions"><small>{row.status==='CHECKED'?'已完成對帳':draft.tax.trim()===''?'待補稅額':'待對帳'}</small>{!readOnly&&<button type="button" className="shell-secondary" disabled={saving||dirty||pendingRetake||targetStore!==storeId||!['UNCHECKED','CHECKED'].includes(row.status)} onClick={()=>void save(row.status!=='CHECKED',false)}>{row.status==='CHECKED'?'取消對帳':'完成對帳'}</button>}</div>}
     <details hidden={!extraColumns} className="receipt-tax-converter"><summary>含稅價換算</summary><div className="receipt-review-head"><label>換算明細<select aria-label="換算明細" value={taxLine} onChange={e=>setTaxLine(Number(e.target.value))}>{draft.lines.map((line,i)=><option key={line.row_key} value={i}>{i+1}. {line.product_name||'未命名'}</option>)}</select></label><label>含稅單價<input aria-label="含稅單價" inputMode="decimal" value={grossPrice} onChange={e=>setGrossPrice(e.target.value)}/></label><label>稅率（%）<input aria-label="換算稅率" inputMode="decimal" placeholder="自行填寫" value={taxRate} onChange={e=>setTaxRate(e.target.value)}/></label></div><button type="button" className="shell-secondary" onClick={convertPrice}>換算並套用未稅單價</button><small>僅修改所選明細單價；整張貨單稅額依原單填寫。</small></details>
     <details className="receipt-tax-converter"><summary>{draft.note.trim()?'備註（已有內容）':'備註'}</summary><label>貨單備註<textarea aria-label="貨單對帳備註" rows={2} value={draft.note} maxLength={2000} onChange={e=>update('note',e.target.value)}/></label></details>
    </fieldset>}
   </section>
  </div>}
  {draft&&<footer>
   {error&&<p className="sheet-error receipt-entry-error" role="alert">{error} {/重新讀取/.test(error)&&<button type="button" className="text-button" disabled={saving} onClick={reloadData}>重新讀取</button>}</p>}
   <div className="receipt-entry-totals">
    {!equipment&&<span>{draft.lines.length} 項 · 未稅 {accountMoney(enteredSubtotal(draft).subtotal)}{draft.tax.trim()&&<> · 稅額 {accountMoney(Number(draft.tax))}</>}</span>}
    <strong>合計 {accountMoney(amounts?.total??null)}</strong>
    <small role="status">{saving?(action==='move'?'移轉門市中…':action==='same-photo'?'使用同一張原單新增中…':'儲存中…'):dirty?'未儲存':pendingRetake?'待重拍':row?.review_completed?'已完成建檔':row?.edit_revision?'已儲存':'待建檔'}</small>
   </div>
   <div>
    <button type="button" className="shell-secondary" disabled={saving||readOnly} onClick={()=>void save(false,false)}>儲存</button>
    {pendingRetake&&nextId&&onNavigate
     ?<button type="button" className="shell-secondary" disabled={saving} onClick={()=>navigate(nextId)}>下一張 →</button>
     :<button type="button" className="shell-primary" disabled={saving||readOnly||pendingRetake} onClick={()=>void save(false,!!nextId&&!!onNavigate,true)}>{nextId&&onNavigate?'完成建檔並下一張 →':'完成建檔'}</button>}
   </div>
  </footer>}
  {retakePage&&<ReceiptRetakeDialog key={retakePage} storeId={storeId} documentId={retakePage} documents={retakeDocuments}
   imageUrls={urls} blocked={dirty?'請先儲存目前明細，再退回重拍。':!retakeAllowed?'貨單狀態已變更，請重新讀取。':''}
   onClose={()=>setRetakePage('')} onRequested={(documentId,alreadyRequested)=>{
    setRetakePage('');
    setRetakeAlreadyRequested(alreadyRequested);
    setRetakePending(current=>[...new Set([...current,documentId])]);
    setRetakeRevision(value=>value+1);
   }}/>}

 </dialog>;
}
