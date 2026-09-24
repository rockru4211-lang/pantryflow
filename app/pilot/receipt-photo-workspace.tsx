"use client";
import {useCallback,useEffect,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase-browser';
import {normalizeReceiptPhoto,receiptPhotoAccept} from '@/lib/receipt-photo';
import {photoIssueLabels} from '@/lib/receipt-photo-quality';
import {receiptFingerprint,receiptGroups,receiptError,sha256} from '@/lib/receipt-workflow';
import ReceiptImage from './receipt-image';
import type {Json} from '@/lib/database.types';

type Task={id:string;batch_id:string;batch_number:string;page:number;reason:keyof typeof photoIssueLabels;name:string;path:string;mime:string;created_at:string};
const rpcPhoto=async(action:string,store:string,data:Json={})=>{
 const result=await supabase.rpc('baihuayuan_receipt_photo',{p_action:action,p_store:store,p_data:data});
 if(result.error)throw result.error;
 return result.data;
};
export function ReceiptPhotoTasks({storeId,batchId,readOnly=false,onChanged}:{storeId:string;batchId?:string;readOnly?:boolean;onChanged?:()=>void}){
 const [tasks,setTasks]=useState<Task[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState('');
 const [urls,setUrls]=useState<Record<string,string>>({});
 const lock=useRef(false);
 const refresh=useCallback(async()=>{
  const rows=await rpcPhoto('list',storeId) as unknown as Task[];
  setTasks(rows.filter(row=>!batchId||row.batch_id===batchId));setError('');
 },[storeId,batchId]);
 useEffect(()=>{let active=true;const run=()=>{if(active&&!lock.current)void refresh().catch(()=>{if(active)setError('重拍清單暫時無法讀取，請稍後重試。');});};run();const timer=setInterval(run,6000);window.addEventListener('focus',run);return()=>{active=false;clearInterval(timer);window.removeEventListener('focus',run);};},[refresh]);
 const paths=tasks.map(task=>task.path).join('|');
 useEffect(()=>{let active=true;if(!paths)return;void supabase.storage.from('receipt-documents').createSignedUrls(paths.split('|'),3600).then(({data})=>{if(active)setUrls(Object.fromEntries((data||[]).map(item=>[item.path||'',item.signedUrl||''])));});return()=>{active=false;};},[paths]);
 async function replace(task:Task,selected:File|undefined){
  if(!selected||lock.current)return;lock.current=true;setBusy(task.id);setError('');
  try{
   const file=await normalizeReceiptPhoto(selected),hash=await sha256(await file.arrayBuffer());
   const prepared=await rpcPhoto('prepare',storeId,{request_id:task.id,sha256:hash,name:file.name,mime:file.type,size:file.size}) as {path?:string;stored?:boolean;completed?:boolean};
   if(!prepared.completed){
    if(!prepared.path)throw Error('ORIGINAL_UPLOAD_INCOMPLETE');
    if(!prepared.stored){const upload=await supabase.storage.from('receipt-documents').upload(prepared.path,file,{contentType:file.type,upsert:false});if(upload.error){const retry=await rpcPhoto('prepare',storeId,{request_id:task.id,sha256:hash,name:file.name,mime:file.type,size:file.size}) as {stored?:boolean};if(!retry.stored)throw upload.error;}}
    const completed=await rpcPhoto('complete',storeId,{request_id:task.id}) as {queued?:boolean;batch_id?:string};
    // The durable SQL queue owns progress, even if this wake-up fails or the user leaves.
    if(completed.queued)void supabase.functions.invoke('enqueue-receipt-ocr',{body:{batchId:task.batch_id}});
   }
   await refresh();onChanged?.();
  }catch(e){setError(receiptError(e));}finally{lock.current=false;setBusy('');}
 }
 if(readOnly&&!tasks.length&&!error)return null;
 return <section className="shell-section"><div className="shell-section-head"><h2>需要重拍{tasks.length?`（${tasks.length}）`:''}</h2></div>
  {error&&<p className="shell-note" role="alert">{error}<button type="button" className="text-button" onClick={()=>void refresh().catch(()=>setError('重拍清單暫時無法讀取，請稍後重試。'))}>重新讀取</button></p>}
  {tasks.map(task=><article key={task.id} className="shell-card" style={{marginBottom:12}}>
   {urls[task.path]&&<ReceiptImage src={urls[task.path]} mime={task.mime} alt={`需要重拍：${task.name} 第 ${task.page} 張`} style={{maxWidth:'100%',height:150,objectFit:'contain'}}/>}
   <strong>{task.name}・第 {task.page} 張</strong><p>{photoIssueLabels[task.reason]}</p>
   {readOnly?<small>已通知現場補拍，收到後系統會重新辨識。</small>:<label className="shell-secondary" style={{display:'inline-block'}}>{busy===task.id?'上傳中…':'重新拍照／選取照片'}<input type="file" accept={receiptPhotoAccept} disabled={!!busy} aria-label={`重拍第 ${task.page} 張`} style={{display:'block',maxWidth:'100%',marginTop:8}} onChange={event=>{void replace(task,event.target.files?.[0]);event.target.value='';}}/></label>}
  </article>)}
  {!tasks.length&&!error&&!readOnly&&<p className="shell-note">目前沒有需要重拍的貨單。</p>}
 </section>;
}

export function RequestReceiptPhoto({storeId,documents,onChanged}:{storeId:string;documents:{id:string;name:string;page_order:number}[];onChanged:()=>void}){
 const [documentId,setDocumentId]=useState(documents[0]?.id||''),[reason,setReason]=useState<keyof typeof photoIssueLabels>('BLUR');
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
 return <details className="shell-card"><summary>照片看不清楚？請現場補拍</summary><p>僅照片模糊、反光或未拍完整時需要重拍；辨識文字與數字有疑義，請直接依原圖修正。</p>
  <label>照片<select value={documentId} onChange={e=>setDocumentId(e.target.value)}>{documents.map(d=><option key={d.id} value={d.id}>第 {d.page_order} 張・{d.name}</option>)}</select></label>
  <label>原因<select value={reason} onChange={e=>setReason(e.target.value as keyof typeof photoIssueLabels)}>{Object.entries(photoIssueLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
  <button type="button" className="shell-secondary" disabled={busy||!documentId} onClick={async()=>{setBusy(true);setMessage('');try{await rpcPhoto('request',storeId,{document_id:documentId,reason});setMessage('已加入現場重拍清單。');onChanged();}catch(e){setMessage(receiptError(e));}finally{setBusy(false);}}}>{busy?'送出中…':'請現場重拍'}</button>
  {message&&<p role="status">{message}</p>}
 </details>;
}

type Photo={file:File;hash:string;preview:string};
export default function ReceiptPhotoWorkspace({storeId,onBack}:{storeId:string;onBack:()=>void}){
 const [photos,setPhotos]=useState<Photo[]>([]),[same,setSame]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const photoRef=useRef<Photo[]>([]),lock=useRef(false),input=useRef<HTMLInputElement>(null);
 useEffect(()=>{photoRef.current=photos;},[photos]);
 useEffect(()=>()=>photoRef.current.forEach(p=>URL.revokeObjectURL(p.preview)),[]);
 async function select(files:FileList|null){if(!files||lock.current)return;lock.current=true;setBusy(true);setMessage('');const next=[...photoRef.current];let skipped=0;try{for(const selected of Array.from(files)){if(next.length>=10)break;const file=await normalizeReceiptPhoto(selected),hash=await sha256(await file.arrayBuffer());if(next.some(p=>p.hash===hash)){skipped++;continue;}next.push({file,hash,preview:URL.createObjectURL(file)});}setPhotos(next);if(skipped)setMessage(`已略過 ${skipped} 張重複照片。`);}catch(e){setPhotos(next);setMessage(receiptError(e));}finally{lock.current=false;setBusy(false);if(input.current)input.current.value='';}}
 async function upload(){
  if(lock.current||!photos.length)return;lock.current=true;setBusy(true);setMessage('');
  const remaining:Photo[]=[],errors:string[]=[];let added=0,skipped=0;
  try{
   for(const group of receiptGroups(photos,same)){
    try{
     const mode=same?'SAME_RECEIPT':'SEPARATE_RECEIPTS';
     const args={p_store_id:storeId,p_fingerprint:await receiptFingerprint(mode,group.map(p=>p.hash)),p_group_mode:mode,p_documents:group.map(p=>({sha256:p.hash,name:p.file.name,mime_type:p.file.type,byte_size:p.file.size}))};
     const read=await supabase.rpc('begin_baihuayuan_receipt_upload',args);if(read.error)throw read.error;
     const manifest=read.data as {duplicate?:boolean;batch_id:string;documents:{sha256:string;storage_path:string;stored:boolean}[]};
     if(manifest.duplicate){skipped++;continue;}
     for(const doc of manifest.documents){if(doc.stored)continue;const photo=group.find(p=>p.hash===doc.sha256);if(!photo)throw Error('ORIGINAL_UPLOAD_INCOMPLETE');const result=await supabase.storage.from('receipt-documents').upload(doc.storage_path,photo.file,{contentType:photo.file.type,upsert:false});if(result.error){const retry=await supabase.rpc('begin_baihuayuan_receipt_upload',args);const check=retry.data as typeof manifest;if(retry.error||(!check.duplicate&&!check.documents?.find(d=>d.sha256===doc.sha256)?.stored))throw result.error;}}
     const queue=await supabase.functions.invoke('enqueue-receipt-ocr',{body:{batchId:manifest.batch_id}});
     if(queue.error||queue.data?.results?.some((r:{queued:boolean})=>!r.queued))throw Error('QUEUE_FAILED');
     added++;
    }catch(e){remaining.push(...group);errors.push(receiptError(e));}
   }
   photos.filter(p=>!remaining.includes(p)).forEach(p=>URL.revokeObjectURL(p.preview));setPhotos(remaining);
   setMessage(errors.length?`已收到 ${added} 張貨單，${errors.length} 張尚未完成，請重試上傳。${errors[0]}`:`已收到 ${added} 張貨單${skipped?`，重複略過 ${skipped} 張`:''}。可離開此頁，資料由行政核對。`);
  }finally{lock.current=false;setBusy(false);}
 }
 return <div><button type="button" className="shell-back" disabled={busy} onClick={onBack}>返回首頁</button><h1>上傳貨單</h1><p>拍清楚整張貨單即可，資料由行政核對。</p>
  <input ref={input} type="file" accept={receiptPhotoAccept} multiple hidden aria-label="選取貨單照片" onChange={e=>void select(e.target.files)}/>
  <section className="shell-card"><button type="button" className="shell-primary full" disabled={busy||photos.length>=10} onClick={()=>input.current?.click()}>拍照／選取貨單</button>
   {!!photos.length&&<><div className="photo-grid">{photos.map((p,index)=><div key={p.hash}><ReceiptImage src={p.preview} mime={p.file.type} alt={`第 ${index+1} 張貨單`} style={{width:'100%',height:120,objectFit:'contain'}}/><button type="button" disabled={busy} aria-label={`移除第 ${index+1} 張`} onClick={()=>{URL.revokeObjectURL(p.preview);setPhotos(photos.filter(x=>x.hash!==p.hash));}}>移除</button></div>)}</div>
    {photos.length>1&&<label><input type="checkbox" checked={same} disabled={busy} onChange={e=>setSame(e.target.checked)}/>這些照片屬於同一張貨單（多頁／不同角度）</label>}
    <button type="button" className="shell-primary full" disabled={busy} onClick={()=>void upload()}>{busy?'上傳中…':'確認上傳'}</button></>}
   <small>一次最多 10 張</small>
  </section>{message&&<p className="shell-note" role="status">{message}</p>}
  <ReceiptPhotoTasks storeId={storeId}/>
 </div>;
}
