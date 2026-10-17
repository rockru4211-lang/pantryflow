'use client';
import {useEffect,useRef,useState,useId,type ReactNode} from 'react';
import {supabase} from '@/lib/supabase-browser';
import {receiptRead,receiptReadError} from '@/lib/receipt-read';
import ReceiptRecognitionStatus from './receipt-recognition-status';
import {ReceiptPhotoTasks,RequestReceiptPhoto} from './receipt-photo-workspace';
import type {Detail} from './receiving-workspace';
export default function ReceiptEntryMore(props:{children?:ReactNode;storeId:string;batchId:string;disabled?:boolean;hasSavedData?:boolean;onResult:()=>void}){
 const [open,setOpen]=useState(false),[recognition,setRecognition]=useState(false),[detail,setDetail]=useState<Detail|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 const root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null),panelId=useId();
 useEffect(()=>{if(!open)return;
  const outside=(event:PointerEvent)=>{if(event.target instanceof Node&&!root.current?.contains(event.target)){setOpen(false);setRecognition(false);}};
  const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setOpen(false);setRecognition(false);trigger.current?.focus();}};
  document.addEventListener('pointerdown',outside,true);document.addEventListener('keydown',escape,true);
  return()=>{document.removeEventListener('pointerdown',outside,true);document.removeEventListener('keydown',escape,true);};
 },[open]);
 useEffect(()=>{if(!open||!recognition)return;const c=new AbortController();
  void receiptRead(signal=>supabase.rpc('get_pilot_receipt',{p_batch_id:props.batchId}).abortSignal(signal),c.signal).then(r=>{if(c.signal.aborted)return;if(r.error)throw r.error;setDetail(r.data as unknown as Detail);setError('');}).catch(e=>{if(!c.signal.aborted)setError(receiptReadError(e));});
  return()=>c.abort();
 },[open,recognition,props.batchId,retry]);
 return <div ref={root} className="receipt-entry-more"><button ref={trigger} type="button" className="receipt-more-trigger" aria-expanded={open} aria-controls={panelId} onClick={()=>{setOpen(v=>!v);setRecognition(false);}}>更多 <span aria-hidden="true">⌄</span></button>{open&&<div id={panelId} className="receipt-more-popover" aria-label="貨單更多設定">
  {props.children}
  <details className="receipt-more-recognition" onToggle={e=>setRecognition(e.currentTarget.open)}><summary>辨識資訊</summary>{recognition&&<div>
   {detail&&<p>上傳紀錄：{new Date(detail.batch.uploaded_at).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false})}</p>}
   {error&&<p role="alert">{error}<button type="button" onClick={()=>setRetry(v=>v+1)}>重新讀取</button></p>}
   <ReceiptRecognitionStatus storeId={props.storeId} batchId={props.batchId} disabled={!!props.disabled} hasSavedData={!!props.hasSavedData} onResult={props.onResult}/>
   <ReceiptPhotoTasks storeId={props.storeId} batchId={props.batchId} readOnly/>
   {detail?.review_allowed&&!!detail.documents.length&&<RequestReceiptPhoto storeId={props.storeId} documents={detail.documents} onChanged={()=>setRetry(v=>v+1)}/>}
  </div>}</details>
 </div>}</div>;
}
