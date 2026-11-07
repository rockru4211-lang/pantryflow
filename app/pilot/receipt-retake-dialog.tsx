'use client';

import {useEffect,useId,useRef,useState} from 'react';
import {operationDeadline} from '@/lib/operation-deadline';
import {photoRetakeReasonLabels,type PhotoRetakeReason} from '@/lib/receipt-photo-quality';
import {receiptError} from '@/lib/receipt-workflow';
import {supabase} from '@/lib/supabase-browser';
import ReceiptImage from './receipt-image';
import type {ReceiptSourceDocument} from './receipt-source-viewer';
import './receipt-retake-dialog.css';

export default function ReceiptRetakeDialog({storeId,documentId,documents,imageUrls,blocked,onRequested,onClose}:{
 storeId:string;
 documentId:string;
 documents:ReceiptSourceDocument[];
 imageUrls:Record<string,string>;
 blocked:string;
 onRequested:(documentId:string,alreadyRequested:boolean)=>void;
 onClose:()=>void;
}){
 const titleId=useId();
 const dialog=useRef<HTMLDialogElement>(null);
 const submitting=useRef(false);
 const mounted=useRef(false);
 const [selected,setSelected]=useState(documentId);
 const [reason,setReason]=useState<PhotoRetakeReason|''>('');
 const [note,setNote]=useState('');
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const page=documents.find(document=>document.id===selected);
 const url=page&&imageUrls[page.path];

 useEffect(()=>{
  mounted.current=true;
  dialog.current?.showModal();
  return()=>{mounted.current=false;};
 },[]);

 function close(){
  if(submitting.current)return;
  dialog.current?.close();
  onClose();
 }

 async function submit(){
  if(submitting.current||blocked||!page||!reason)return;
  submitting.current=true;
  setBusy(true);
  setError('');
  try{
   const response=await operationDeadline(signal=>supabase.rpc('baihuayuan_receipt_photo',{
    p_action:'request',
    p_store:storeId,
    p_data:{document_id:page.id,reason,note:note.trim()},
   }).abortSignal(signal));
   if(response.error)throw response.error;
   if(!response.data||typeof response.data!=='object'||Array.isArray(response.data)||response.data.requested!==true){
    throw Error('PHOTO_RETAKE_UNCONFIRMED');
   }
   if(!mounted.current)return;
   dialog.current?.close();
   onRequested(page.id,response.data.already_requested===true);
  }catch(cause){
   if(mounted.current){
    const message=cause&&typeof cause==='object'&&'message' in cause?String(cause.message):String(cause);
    setError(message.includes('PHOTO_PROCESSING_BUSY')?'系統正在辨識這張貨單，請稍後再試。':receiptError(cause));
   }
  }finally{
   submitting.current=false;
   if(mounted.current)setBusy(false);
  }
 }

 return <dialog ref={dialog} className="receipt-retake-dialog" aria-labelledby={titleId}
  onCancel={event=>{event.preventDefault();event.stopPropagation();close();}}>
  <form onSubmit={event=>{event.preventDefault();event.stopPropagation();void submit();}}>
   <h2 id={titleId}>退回重拍</h2>
   <fieldset disabled={busy}>
    <div className="receipt-retake-page">
     {page&&url&&page.mime_type.startsWith('image/')&&
      <ReceiptImage src={url} mime={page.mime_type} alt={`貨單第 ${page.page_order} 張`}/>}
     <label>重拍範圍
      <select value={selected} onChange={event=>setSelected(event.target.value)}>
       {documents.map(document=><option key={document.id} value={document.id}>第 {document.page_order} 張・{document.name}</option>)}
      </select>
     </label>
    </div>
    <fieldset className="receipt-retake-reasons">
     <legend>重拍原因</legend>
     {(Object.keys(photoRetakeReasonLabels) as PhotoRetakeReason[]).map(value=>
      <label key={value}>
       <input type="radio" name={titleId} required checked={reason===value} onChange={()=>setReason(value)}/>
       {photoRetakeReasonLabels[value]}
      </label>
     )}
    </fieldset>
    <label className="receipt-retake-note">補充說明（選填）
     <textarea rows={2} maxLength={500} value={note} onChange={event=>setNote(event.target.value)}
      placeholder="例如：右下角金額看不清，請拍完整四角。"/>
    </label>
   </fieldset>
   <p className="receipt-retake-help">補拍後會接回這張貨單。</p>
   {(blocked||error)&&<p className="shell-note" role="alert">{blocked||error}</p>}
   <footer>
    <button type="button" className="shell-secondary" disabled={busy} onClick={close}>取消</button>
    <button type="submit" className="shell-primary" disabled={busy||!!blocked||!page||!reason}>{busy?'送出中…':'確認退回'}</button>
   </footer>
  </form>
 </dialog>;
}
