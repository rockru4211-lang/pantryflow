'use client';

import {useEffect,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase-browser';
import {receiptRead,receiptReadError,receiptReadRows} from '@/lib/receipt-read';
import {inboxMonth,inboxNameKey} from '@/lib/receipt-supplier-inbox';
import {operationDeadline} from '@/lib/operation-deadline';
import {ReceiptOriginalContent} from './receipt-original-dialog';

type DuplicateAction='exclude'|'restore';
type DuplicateStatus='EXCLUDED'|'SUSPECTED'|'POSTED_REVIEW';
type DuplicateReason='EXACT_PHOTO'|'MATCHED_OCR'|'DOCUMENT_NUMBER'|'MANUAL';
type DuplicateReceipt={
 id:string;
 status:DuplicateStatus;
 reason:DuplicateReason;
 batch_id:string|null;
 original_batch_id:string;
 supplier_name:string|null;
 receipt_date:string|null;
 document_number:string|null;
 total:number|null;
 occurred_at:string;
 can_restore:boolean;
 can_exclude:boolean;
};

const statusLabels:Record<DuplicateStatus,string>={
 EXCLUDED:'已排除',
 SUSPECTED:'疑似重複',
 POSTED_REVIEW:'已入帳待核對',
};
const reasonLabels:Record<DuplicateReason,string>={
 EXACT_PHOTO:'照片相同',
 MATCHED_OCR:'辨識內容相同',
 DOCUMENT_NUMBER:'單號相同',
 MANUAL:'已人工確認',
};
const taipeiTime=new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',hour:'2-digit',minute:'2-digit',hour12:false});

function ReceiptDuplicateComparison({row,busy,error,onClose,onExclude,onOpenDetails}:{
 row:DuplicateReceipt;
 busy:boolean;
 error:string;
 onClose:()=>void;
 onExclude:()=>void;
 onOpenDetails:(id:string)=>void;
}){
 const dialog=useRef<HTMLDialogElement>(null);
 const [originalReady,setOriginalReady]=useState(false);
 const [candidateReady,setCandidateReady]=useState(false);
 const candidateId=row.batch_id;

 useEffect(()=>{dialog.current?.showModal();},[]);

 return <dialog ref={dialog} className="receipt-line-dialog receipt-duplicate-comparison" aria-label="比對貨單"
  onCancel={event=>{event.preventDefault();if(!busy)onClose();}}>
  <header>
   <div>
    <h2>比對貨單</h2>
    <p>{row.supplier_name||'供應商待補'}{row.document_number&&` · 單號 ${row.document_number}`}</p>
   </div>
   <button type="button" className="shell-secondary" disabled={busy} onClick={onClose}>關閉</button>
  </header>
  <div className="receipt-duplicate-sources">
   <section aria-label="保留原單">
    <h3>原單</h3>
    <ReceiptOriginalContent batchId={row.original_batch_id} onReady={setOriginalReady}/>
    {row.status==='POSTED_REVIEW'&&<button type="button" className="text-button" onClick={()=>onOpenDetails(row.original_batch_id)}>查看原單明細</button>}
   </section>
   {candidateId&&<section aria-label="疑似重複貨單">
    <h3>疑似重複貨單</h3>
    <ReceiptOriginalContent batchId={candidateId} onReady={setCandidateReady}/>
    {row.status==='POSTED_REVIEW'&&<button type="button" className="text-button" onClick={()=>onOpenDetails(candidateId)}>查看此筆明細</button>}
   </section>}
  </div>
  {row.status==='POSTED_REVIEW'&&<p className="shell-note">此筆已有入帳紀錄，請先核對進貨明細。</p>}
  {row.status==='SUSPECTED'&&row.can_exclude&&<footer className="receipt-duplicate-footer">
   <small>確認是同一張貨單後，保留原單並移出重複的貨單。</small>
   <button type="button" className="shell-primary" disabled={busy||!originalReady||!candidateReady} onClick={onExclude}>{busy?'處理中…':'排除重複貨單'}</button>
  </footer>}
  {error&&<p className="shell-note" role="alert">{error}</p>}
 </dialog>;
}

export default function ReceiptDuplicates({storeId,month,supplier,search,disabled,onChanged,onOpenOriginal,onOpenDetails}:{
 storeId:string;
 month:string;
 supplier:string;
 search:string;
 disabled:boolean;
 onChanged:()=>Promise<unknown>;
 onOpenOriginal:(id:string)=>void;
 onOpenDetails:(id:string)=>void;
}){
 const [rows,setRows]=useState<DuplicateReceipt[]>([]);
 const [revision,setRevision]=useState(0);
 const [loading,setLoading]=useState(true);
 const [readError,setReadError]=useState('');
 const [saveError,setSaveError]=useState('');
 const [notice,setNotice]=useState('');
 const [selected,setSelected]=useState<DuplicateReceipt|null>(null);
 const [saving,setSaving]=useState(false);
 const saveLock=useRef(false);

 useEffect(()=>{
  const controller=new AbortController();
  void receiptRead(signal=>supabase.rpc('get_baihuayuan_receipt_duplicates',{p_store_id:storeId}).abortSignal(signal),controller.signal)
   .then(response=>{
    const next=receiptReadRows<DuplicateReceipt>(response);
    if(!controller.signal.aborted)setRows(next);
   })
   .catch(error=>{
    if(!controller.signal.aborted){setRows([]);setReadError('重複貨單未能讀取。'+receiptReadError(error));}
   })
   .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return()=>controller.abort();
 },[storeId,revision]);

 function reload(){
  setLoading(true);
  setReadError('');
  setRevision(value=>value+1);
 }

 async function change(row:DuplicateReceipt,action:DuplicateAction){
  const batchId=row.batch_id;
  if(saveLock.current||disabled||!batchId||(action==='restore'?!row.can_restore:!row.can_exclude))return;
  saveLock.current=true;
  setSaving(true);
  setSaveError('');
  setNotice('');
  try{
   const response=await operationDeadline(signal=>supabase.rpc('set_baihuayuan_receipt_duplicate',{
    p_store_id:storeId,
    p_batch_id:batchId,
    p_original_batch_id:row.original_batch_id,
    p_action:action,
   }).abortSignal(signal));
   if(response.error)throw response.error;
   if(!response.data||typeof response.data!=='object'||Array.isArray(response.data)||response.data.saved!==true)throw Error('SAVE_NOT_CONFIRMED');
   setSelected(null);
   setNotice(action==='restore'?'已解除排除，貨單已回到清單。':'已排除重複貨單，清單保留原單。');
   reload();
   await onChanged().catch(()=>{});
  }catch(error){
   const message=error&&typeof error==='object'&&'message'in error?String(error.message):String(error);
   const errors:Record<string,string>={
    RECEIPT_DUPLICATE_CHANGED:'貨單狀態已變更，請關閉後重新讀取。',
    RECEIPT_DUPLICATE_POSTED:'此筆已有入帳紀錄，請重新讀取並核對明細。',
    RECEIPT_DUPLICATE_BUSY:'此貨單仍在處理中，請稍後重新讀取。',
   };
   setSaveError(errors[message]||'處理結果尚未確認，請重新讀取後再試。');
  }finally{
   saveLock.current=false;
   setSaving(false);
  }
 }

 const query=inboxNameKey(search);
 const visible=rows.filter(row=>{
  const receiptDate=row.batch_id?row.receipt_date||'':'';
  if(month&&inboxMonth({receipt_date:receiptDate,uploaded_at:row.occurred_at})!==month)return false;
  if(supplier&&row.supplier_name!==supplier)return false;
  return !query||[row.supplier_name,row.document_number,row.receipt_date].some(value=>value&&inboxNameKey(value).includes(query));
 });
 const unavailable=loading||saving||disabled;

 return <section aria-label="重複貨單紀錄">
  <div className="receipt-duplicate-toolbar">
   <small className="supplier-inbox-footnote">{loading?'正在讀取重複貨單…':readError?'':`共 ${visible.length} 筆紀錄`}</small>
   <button type="button" className="text-button" disabled={unavailable} onClick={()=>{setSaveError('');setNotice('');reload();}}>重新讀取</button>
  </div>
  {readError&&<p className="shell-note" role="alert">{readError}</p>}
  {notice&&<p className="shell-note" role="status">{notice}</p>}
  {!selected&&saveError&&<p className="shell-note" role="alert">{saveError}</p>}
  {!loading&&!readError&&(!visible.length?<p className="shell-note">目前沒有符合條件的重複貨單。</p>:
   <ul className="receipt-duplicate-list">
    {visible.map(row=><li key={row.id} className="receipt-duplicate-row">
     <span className={`receipt-progress-chip ${row.status==='EXCLUDED'?'details':'entry'}`}>{statusLabels[row.status]}</span>
     <div className="receipt-duplicate-summary">
      <strong>{row.supplier_name||'供應商待補'}</strong>
      <small>{[row.receipt_date,row.document_number&&`單號 ${row.document_number}`,row.total!==null&&`NT$ ${row.total.toLocaleString('zh-TW')}`].filter(Boolean).join(' · ')}</small>
      <small>{reasonLabels[row.reason]}{!row.batch_id&&` · ${taipeiTime.format(new Date(row.occurred_at))} 重傳，未建立副本`}</small>
     </div>
     <div className="receipt-duplicate-actions">
      {row.status==='EXCLUDED'?<>
       <button type="button" className="text-button" disabled={unavailable} onClick={()=>onOpenOriginal(row.original_batch_id)}>查看原單</button>
       {row.batch_id&&row.can_restore&&<button type="button" className="text-button" disabled={unavailable} onClick={()=>void change(row,'restore')}>解除排除</button>}
      </>:<button type="button" className="shell-secondary" disabled={unavailable} onClick={()=>{setSaveError('');setSelected(row);}}>{row.status==='POSTED_REVIEW'?'查看明細':'比對貨單'}</button>}
     </div>
    </li>)}
   </ul>)}
  {selected&&<ReceiptDuplicateComparison key={selected.id} row={selected} busy={saving} error={saveError}
   onClose={()=>{setSelected(null);setSaveError('');}} onExclude={()=>void change(selected,'exclude')}
   onOpenDetails={id=>{setSelected(null);onOpenDetails(id);}}/>}
 </section>;
}
