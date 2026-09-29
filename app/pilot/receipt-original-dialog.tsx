'use client';
import {useEffect,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase-browser';
import {receiptRead,receiptReadError} from '@/lib/receipt-read';
import ReceiptSourceViewer from './receipt-source-viewer';
import type {Detail} from './receiving-workspace';
export default function ReceiptOriginalDialog({batchId,onClose,downloadOnly=false}:{batchId:string;onClose:()=>void;downloadOnly?:boolean}){
 const dialog=useRef<HTMLDialogElement>(null);const [detail,setDetail]=useState<Detail|null>(null),[urls,setUrls]=useState<Record<string,string>>({}),[error,setError]=useState('');
 useEffect(()=>{dialog.current?.showModal();const controller=new AbortController();async function load(){try{const r=await receiptRead(signal=>supabase.rpc('get_pilot_receipt',{p_batch_id:batchId}).abortSignal(signal),controller.signal);if(r.error)throw r.error;const d=r.data as unknown as Detail;if(d.batch.id!==batchId)throw Error('RECEIPT_ACCESS_DENIED');if(controller.signal.aborted)return;setDetail(d);if(d.documents.length){const result=await supabase.storage.from('receipt-documents').createSignedUrls(d.documents.map(x=>x.path),3600);if(result.error)throw result.error;if(!controller.signal.aborted)setUrls(Object.fromEntries((result.data||[]).map(x=>[x.path||'',x.signedUrl||''])));}}catch(e){if(!controller.signal.aborted)setError(receiptReadError(e));}}void load();return()=>controller.abort();},[batchId]);
 return <dialog ref={dialog} className="receipt-line-dialog" aria-label="貨單原始檔案" onCancel={e=>{e.preventDefault();onClose();}}><header><h2>{downloadOnly?'下載貨單':'原始貨單'}</h2><button type="button" className="shell-secondary" onClick={onClose}>關閉</button></header>{error&&<p role="alert">{error}</p>}{detail?detail.documents.length?downloadOnly?<div className="receipt-download-list">{detail.documents.map((doc,i)=><p key={doc.id}>{urls[doc.path]?<a href={urls[doc.path]+'&download='+encodeURIComponent(doc.name)} download={doc.name}>下載第 {i+1} 張・{doc.name}</a>:<span>正在準備檔案…</span>}</p>)}</div>:<ReceiptSourceViewer documents={detail.documents} imageUrls={urls}/>:<p>此筆為直接登記，沒有原始貨單檔案。</p>:!error&&<p role="status">正在讀取原單…</p>}</dialog>;
}
