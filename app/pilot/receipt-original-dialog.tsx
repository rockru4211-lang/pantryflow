'use client';
import {useEffect,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase-browser';
import {receiptRead,receiptReadError} from '@/lib/receipt-read';
import ReceiptSourceViewer from './receipt-source-viewer';
import type {Detail} from './receiving-workspace';

export function ReceiptOriginalContent({batchId,downloadOnly=false,onReady}:{
 batchId:string;downloadOnly?:boolean;onReady?:(ready:boolean)=>void;
}){
 const [detail,setDetail]=useState<Detail|null>(null);
 const [urls,setUrls]=useState<Record<string,string>>({});
 const [error,setError]=useState('');

 useEffect(()=>{
  const controller=new AbortController();
  async function load(){
   try{
    const response=await receiptRead(signal=>supabase.rpc('get_pilot_receipt',{p_batch_id:batchId}).abortSignal(signal),controller.signal);
    if(response.error)throw response.error;
    const next=response.data as unknown as Detail;
    if(next?.batch?.id!==batchId)throw Error('RECEIPT_ACCESS_DENIED');
    if(controller.signal.aborted)return;
    setDetail(next);
    if(!next.documents.length)return;
    const result=await receiptRead(
     ()=>supabase.storage.from('receipt-documents').createSignedUrls(next.documents.map(document=>document.path),3600),
     controller.signal,
    );
    if(result.error)throw result.error;
    if(controller.signal.aborted)return;
    const signed=Object.fromEntries((result.data||[]).map(document=>[document.path||'',document.signedUrl||'']));
    setUrls(signed);
    if(next.documents.some(document=>!signed[document.path]))throw Error('RECEIPT_SOURCE_MISSING');
    onReady?.(true);
   }catch(cause){
    if(!controller.signal.aborted)setError(receiptReadError(cause));
   }
  }
  void load();
  return()=>controller.abort();
 },[batchId,onReady]);

 return <>
  {error&&<p role="alert">{error}</p>}
  {detail?detail.documents.length?downloadOnly
   ? <div className="receipt-download-list">{detail.documents.map((doc,i)=><p key={doc.id}>{urls[doc.path]?<a href={urls[doc.path]+'&download='+encodeURIComponent(doc.name)} download={doc.name}>下載第 {i+1} 張・{doc.name}</a>:!error&&<span>正在準備檔案…</span>}</p>)}</div>
   : <ReceiptSourceViewer documents={detail.documents} imageUrls={urls}/>
   : <p>此筆為直接登記，沒有原始貨單檔案。</p>
   : !error&&<p role="status">正在讀取原單…</p>}
 </>;
}

export default function ReceiptOriginalDialog({batchId,onClose,downloadOnly=false,docked=false}:{batchId:string;onClose:()=>void;downloadOnly?:boolean;docked?:boolean}){
 const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{if(!docked)dialog.current?.showModal();},[docked]);
 return <dialog ref={dialog} open={docked||undefined} className={`receipt-line-dialog${docked?' receipt-source-docked':''}`} aria-label="貨單原始檔案" onCancel={e=>{e.preventDefault();onClose();}}>
  <header><h2>{downloadOnly?'下載貨單':'原始貨單'}</h2><button type="button" className="shell-secondary" onClick={onClose}>關閉</button></header>
  <ReceiptOriginalContent key={batchId} batchId={batchId} downloadOnly={downloadOnly}/>
 </dialog>;
}
