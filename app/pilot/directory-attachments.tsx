'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase-browser';
import {appError} from '@/lib/app-workspace';
import {operationDeadline} from '@/lib/operation-deadline';
import {attachmentAccept,attachmentMime,attachmentHash,type AttachmentKind,type DirectoryAttachment} from '@/lib/directory-attachments';
import type {Json} from '@/lib/database.types';
import './directory-attachments.css';
async function attachmentRpc(store:string,kind:AttachmentKind,target:string|null,operation:string,data:Record<string,unknown>={},request=crypto.randomUUID()){
 const r=await operationDeadline(signal=>supabase.rpc('app_operation',{p_store_id:store,p_action:'directory.attachments',p_data:{kind,target,operation,...data} as Json,p_request_id:request}).abortSignal(signal));if(r.error)throw r.error;return r.data;
}
export function useAttachmentCounts(store:string,kind:AttachmentKind,enabled=true){
 const [counts,setCounts]=useState<Record<string,number>>({});
 useEffect(()=>{let active=true;const load=()=>{if(enabled)void attachmentRpc(store,kind,null,'counts').then(data=>{if(active)setCounts(data as Record<string,number>);}).catch(()=>{});};load();window.addEventListener('directory-attachments-changed',load);return()=>{active=false;window.removeEventListener('directory-attachments-changed',load);};},[store,kind,enabled]);return counts;
}
export function DirectoryAttachments({storeId,kind,targetId,count=0,editable=false,saved=true,expanded=false,disabled=false}:{storeId:string;kind:AttachmentKind;targetId:string;count?:number;editable?:boolean;saved?:boolean;expanded?:boolean;disabled?:boolean}){
 const [open,setOpen]=useState(expanded),[rows,setRows]=useState<DirectoryAttachment[]>([]),[urls,setUrls]=useState<Record<string,string>>({}),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[failed,setFailed]=useState<File[]>([]),[loaded,setLoaded]=useState(false);
 const input=useRef<HTMLInputElement>(null),camera=useRef<HTMLInputElement>(null),lock=useRef(false),alive=useRef(true),requests=useRef(new Map<string,string>());
 const load=useCallback(async()=>{setLoading(true);try{const data=await attachmentRpc(storeId,kind,targetId,'list') as DirectoryAttachment[];if(!Array.isArray(data))throw Error('INVALID_RESPONSE');if(!alive.current)return;setRows(data);setLoaded(true);
 if(!data.length){setUrls({});return;}
 const signed=await supabase.storage.from('directory-attachments').createSignedUrls(data.map(r=>r.storage_path),300);if(signed.error)throw signed.error;if(alive.current)setUrls(Object.fromEntries((signed.data||[]).map(r=>[r.path||'',r.signedUrl||''])));
 }catch(e){if(alive.current)setError(appError(e));}finally{if(alive.current)setLoading(false);}},[storeId,kind,targetId]);
 useEffect(()=>{alive.current=true;if(open&&saved)queueMicrotask(()=>{if(alive.current)void load();});return()=>{alive.current=false;};},[open,saved,load]);
 useEffect(()=>{const warn=(e:BeforeUnloadEvent)=>{if(lock.current){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[]);
 const changed=()=>window.dispatchEvent(new Event('directory-attachments-changed'));
 async function upload(files:File[]){if(lock.current||!editable||disabled||!saved)return;lock.current=true;setBusy(true);setError('');setNotice('');setFailed([]);const failures:File[]=[];let done=0;const messages:string[]=[];
 try{for(const [index,file] of files.entries()){try{setNotice(`正在上傳 ${index+1}／${files.length}：${file.name}`);const mime=attachmentMime(file),hash=await attachmentHash(file);if(!requests.current.has(hash))requests.current.set(hash,crypto.randomUUID());const meta={name:file.name,mime,size:file.size,sha256:hash};let a=await attachmentRpc(storeId,kind,targetId,'prepare',meta,requests.current.get(hash)) as DirectoryAttachment;
 if(!a.stored&&!a.ready_at){const result=await supabase.storage.from('directory-attachments').upload(a.storage_path,file,{contentType:mime,upsert:false});if(result.error){a=await attachmentRpc(storeId,kind,targetId,'prepare',meta,requests.current.get(hash)) as DirectoryAttachment;if(!a.stored)throw result.error;}}
 await attachmentRpc(storeId,kind,targetId,'complete',{id:a.id});done++;
 }catch(e){failures.push(file);messages.push(`${file.name}：${e instanceof Error?e.message:appError(e)}`);}}
 if(alive.current){setFailed(failures);setNotice(`已儲存 ${done} 個附件${failures.length?`，${failures.length} 個未完成，可重試。`:'。'}`);setError(messages.join('\n'));await load();}changed();
 }finally{lock.current=false;if(alive.current)setBusy(false);}}
 async function remove(row:DirectoryAttachment){if(lock.current||disabled||!editable||!window.confirm(`移除附件「${row.filename}」？原有資料內容會保留。`))return;lock.current=true;setBusy(true);setError('');try{await attachmentRpc(storeId,kind,targetId,'remove',{id:row.id});await load();changed();setNotice('已移除附件。');}catch(e){setError(appError(e));}finally{lock.current=false;setBusy(false);}}
 async function openFile(row:DirectoryAttachment,download=false){setError('');const tab=download?null:window.open('about:blank','_blank');if(tab)tab.opener=null;try{const r=await supabase.storage.from('directory-attachments').createSignedUrl(row.storage_path,60,download?{download:row.filename}:undefined);if(r.error)throw r.error;if(download){const a=document.createElement('a');a.href=r.data.signedUrl;a.download=row.filename;document.body.appendChild(a);a.click();a.remove();}else if(tab)tab.location.href=r.data.signedUrl;else{setError('請允許開啟新分頁後重試，或使用下載。');}}catch(e){tab?.close();setError(appError(e));}}
 if(!saved)return <div className="directory-attachments"><small>儲存這筆資料後，即可加入照片或文件附件。</small></div>;
 return <div className="directory-attachments"><button type="button" className="attachment-toggle" aria-expanded={open} disabled={busy} onClick={()=>setOpen(v=>!v)}>📎 {open&&loaded?rows.length:count}{expanded?' 個附件':''}</button>{open&&<div className="attachment-panel">
 {editable&&<><div className="attachment-tools"><button type="button" disabled={busy||disabled} onClick={()=>input.current?.click()}>＋上傳附件</button><button type="button" disabled={busy||disabled} onClick={()=>camera.current?.click()}>拍照</button><button type="button" disabled={busy||loading} onClick={()=>void load()}>重新讀取</button></div><small>圖片、PDF、Word、Excel；每個最多 20 MB。附件上傳後即儲存，可稍後補上。</small>
 <input ref={input} hidden type="file" accept={attachmentAccept} multiple onChange={e=>{const files=Array.from(e.target.files||[]);e.target.value='';if(files.length)void upload(files);}}/><input ref={camera} hidden type="file" accept="image/*" capture="environment" onChange={e=>{const files=Array.from(e.target.files||[]);e.target.value='';if(files.length)void upload(files);}}/></>}
 {loading&&<p role="status">正在讀取附件…</p>}{notice&&<p role="status">{notice}</p>}{error&&<p role="alert">{error}</p>}{failed.length>0&&<button type="button" disabled={busy||disabled} onClick={()=>void upload(failed)}>重試未完成的 {failed.length} 個附件</button>}
 <div className="attachment-items">{rows.map(row=><div key={row.id} className="attachment-item">{['image/jpeg','image/png','image/webp'].includes(row.mime)&&urls[row.storage_path]?<button type="button" className="attachment-preview" onClick={()=>void openFile(row)} aria-label={`預覽 ${row.filename}`}><img src={urls[row.storage_path]} alt={row.filename}/></button>:<span aria-hidden="true">📄</span>}<div><strong>{row.filename}</strong><small>{(row.byte_size/1024/1024).toFixed(2)} MB</small><div className="attachment-tools"><button type="button" onClick={()=>void openFile(row)}>{row.mime==='application/pdf'||row.mime.startsWith('image/')?'預覽':'開啟'}</button><button type="button" onClick={()=>void openFile(row,true)}>下載</button>{editable&&<button type="button" disabled={busy||disabled} onClick={()=>void remove(row)}>移除</button>}</div></div></div>)}</div>{!loading&&!rows.length&&!error&&<small>尚無附件，可之後再補。</small>}
 </div>}</div>;
}
