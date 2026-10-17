'use client';
import {useEffect,useState,type ReactNode} from 'react';
import {supabase} from '@/lib/supabase-browser';
import {receiptRead,receiptReadError} from '@/lib/receipt-read';
import ReceiptRecognitionStatus from './receipt-recognition-status';
import {ReceiptPhotoTasks,RequestReceiptPhoto} from './receipt-photo-workspace';
import type {Detail} from './receiving-workspace';
export default function ReceiptEntryMore(props:{children?:ReactNode;storeId:string;batchId:string;disabled?:boolean;hasSavedData?:boolean;onResult:()=>void}){
 const [open,setOpen]=useState(false),[detail,setDetail]=useState<Detail|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{if(!open)return;const c=new AbortController();
  void receiptRead(signal=>supabase.rpc('get_pilot_receipt',{p_batch_id:props.batchId}).abortSignal(signal),c.signal).then(r=>{if(c.signal.aborted)return;if(r.error)throw r.error;setDetail(r.data as unknown as Detail);setError('');}).catch(e=>{if(!c.signal.aborted)setError(receiptReadError(e));});
  return()=>c.abort();
 },[open,props.batchId,retry]);
 return <details className="receipt-entry-more" onToggle={e=>{setOpen(e.currentTarget.open);setDetail(null);setError('');}}><summary>更多</summary>{open&&<div>
  {props.children}
  {detail&&<p>上傳紀錄：{new Date(detail.batch.uploaded_at).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false})}</p>}
  {error&&<p role="alert">{error}<button type="button" onClick={()=>setRetry(v=>v+1)}>重新讀取</button></p>}
  <ReceiptRecognitionStatus storeId={props.storeId} batchId={props.batchId} disabled={!!props.disabled} hasSavedData={!!props.hasSavedData} onResult={props.onResult}/>
  <ReceiptPhotoTasks storeId={props.storeId} batchId={props.batchId} readOnly/>
  {detail?.review_allowed&&!!detail.documents.length&&<RequestReceiptPhoto storeId={props.storeId} documents={detail.documents} onChanged={()=>setRetry(v=>v+1)}/>}
 </div>}</details>;
}
