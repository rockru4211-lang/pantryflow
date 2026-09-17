'use client';
import {useEffect,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase-browser';
import {parseInventoryWorkbook,readInventoryWorkbook} from '@/lib/inventory-import';
import {readInventoryPdf} from '@/lib/inventory-pdf-browser';
import {appError} from '@/lib/app-workspace';
import {emptyReviewRow,normalizeReview,reviewPayload,workbookReview,type ReviewRow,type ReviewStatus,type ImportSource} from '@/lib/inventory-review';
import type {Json} from '@/lib/database.types';

type UndoResult={removed?:number;protected?:number};
type RpcResult={data:unknown;error:{message:string}|null};

export default function InventoryImportFlow({userId,storeId,organizationId,disabled,onImported}:{userId:string;storeId:string;organizationId:string;disabled:boolean;onImported:()=>Promise<void>}) {
 void userId; void disabled;
 const rootRef=useRef<HTMLDivElement>(null);
 const[rows,setRows]=useState<ReviewRow[]>([]);
 const[source,setSource]=useState<ImportSource>();
 const[files,setFiles]=useState<ImportSource[]>([]);
 const[busy,setBusy]=useState(false);
 const[notice,setNotice]=useState('');
 const[model,setModel]=useState('');
 const rpcAny=supabase.rpc as unknown as (name:string,args:Record<string,unknown>)=>Promise<RpcResult>;

 async function loadFiles(){
  const result=await supabase.from('inventory_import_files').select('id,original_filename,file_sha256,storage_path,sheet_names').eq('store_id',storeId).order('created_at',{ascending:false}).limit(30);
  if(result.data)setFiles(result.data.map(f=>({...f,sheet_names:Array.isArray(f.sheet_names)?f.sheet_names.map(String):[]})));
 }
 useEffect(()=>{void loadFiles();},[storeId]);

 useEffect(()=>{
  const root=rootRef.current;if(!root)return;
  const parent=root.parentElement;if(!parent)return;
  const hideLegacyActions=()=>{
   for(const child of Array.from(parent.children)){
    if(child!==root&&child instanceof HTMLElement&&child.classList.contains('shell-button-stack'))child.style.display='none';
   }
  };
  hideLegacyActions();
  const observer=new MutationObserver(hideLegacyActions);observer.observe(parent,{childList:true,subtree:false});
  return()=>{observer.disconnect();for(const child of Array.from(parent.children)){if(child instanceof HTMLElement&&child.classList.contains('shell-button-stack'))child.style.removeProperty('display');}};
 },[]);

 async function saveReview(file:ImportSource,review:ReviewRow[]){
  const result=await supabase.rpc('save_inventory_import_review',{
   p_store_id:storeId,
   p_file:file as unknown as Json,
   p_rows:review.map(r=>({source_id:r.sourceId,sheet_name:r.sheetName,source_row:r.sourceRow,raw_values:r.rawValues,merged_ranges:r.mergedRanges,normalized_values:normalizeReview(r),status:r.status,reason:r.reason})) as unknown as Json
  });
  if(result.error)throw result.error;
 }

 const isImage=(name:string)=>/\.(jpe?g|png|webp)$/i.test(name);
 const canBuild=(r:ReviewRow)=>Boolean(r.name.trim())&&(r.quantityText.trim()===''||(Number.isFinite(Number(r.quantityText))&&Number(r.quantityText)>=0));

 async function readFile(file:File){
  if(busy)return;
  setBusy(true);setRows([]);setModel('');setNotice('正在辨識品項與手寫期初數字…');
  try{
   if(!/\.(xlsx?|csv|pdf|jpe?g|png|webp)$/i.test(file.name))throw Error('請選擇 Excel、CSV、PDF 或照片。');
   if(file.size>15*1024*1024)throw Error('檔案最多 15 MB。');
   const bytes=await file.arrayBuffer();
   const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
   const meta:ImportSource={original_filename:file.name,file_sha256:hash,storage_path:`${organizationId}/${storeId}/${hash}/${file.name.normalize('NFKC').replace(/[^A-Za-z0-9._-]+/g,'-')||'inventory'}`,sheet_names:[]};
   const previous=files.find(f=>f.file_sha256===hash);
   if(previous){meta.id=previous.id;meta.storage_path=previous.storage_path;}
   setSource(meta);
   if(!previous){
    const contentType=/\.pdf$/i.test(file.name)?'application/pdf':isImage(file.name)?(file.type||(/\.png$/i.test(file.name)?'image/png':/\.webp$/i.test(file.name)?'image/webp':'image/jpeg')):file.type||'application/octet-stream';
    const uploaded=await supabase.storage.from('inventory-imports').upload(meta.storage_path,bytes,{contentType,upsert:false});
    if(uploaded.error&&!/duplicate|already exists|resource exists/i.test(uploaded.error.message))throw uploaded.error;
   }
   await recognize(bytes,meta);
   await loadFiles();
  }catch(error){setNotice(error instanceof Error?error.message:appError(error));}
  finally{setBusy(false);}
 }

 async function visionReview(meta:ImportSource,label:string){
  setNotice(`${label}辨識中，優先抓品名與手寫期初數字…`);
  const result=await supabase.functions.invoke('process-inventory-pdf',{body:{storeId,storagePath:meta.storage_path}});
  if(result.error||!result.data?.rows){
   let message=result.data?.message;
   if(!message&&result.error?.context instanceof Response){const body=await result.error.context.json().catch(()=>null);message=body?.message;}
   throw Error(message||`${label}辨識未完成，請重試。`);
  }
  const review:ReviewRow[]=result.data.rows.map((r:{page:number;row:number;name?:string;unit?:string;quantity:number|null;specification?:string;supplier?:string;zone?:string;raw?:string;uncertain?:boolean;skip_reason?:string},index:number)=>{
   const sheet=`第 ${r.page||1} 頁`;const zone=r.zone||'未分類';
   return {...emptyReviewRow(sheet,r.row),sourceId:`vision:${r.page||1}:${r.row}:${index}:${zone}`,name:r.name||'',unit:r.unit||'',openingQuantity:r.quantity,quantityText:r.quantity===null||r.quantity===undefined?'':String(r.quantity),specification:r.specification||'',supplierName:r.supplier||'',zoneName:zone,rawValues:{原文:r.raw||''},status:r.skip_reason?'SKIPPED':'PENDING',reason:r.skip_reason||(r.uncertain?'數字辨識不確定，可之後再補':'')};
  });
  meta.sheet_names=[...new Set(review.map(r=>r.sheetName))];
  setModel(`${result.data.model}・${(result.data.durationMs/1000).toFixed(1)} 秒`);
  return review;
 }

 async function recognize(bytes:ArrayBuffer,meta:ImportSource){
  let review:ReviewRow[];
  if(/\.pdf$/i.test(meta.original_filename)){
   const parsed=await readInventoryPdf(bytes);
   if(parsed){meta.sheet_names=parsed.sheets.map(s=>s.sheetName);review=workbookReview(parsed);setModel('PDF 文字層');}
   else review=await visionReview(meta,'掃描 PDF');
  }else if(isImage(meta.original_filename)) review=await visionReview(meta,'照片');
  else{const parsed=parseInventoryWorkbook(readInventoryWorkbook(bytes,meta.original_filename));meta.sheet_names=parsed.sheets.map(s=>s.sheetName);review=workbookReview(parsed);}
  setSource({...meta});setRows(review);await saveReview(meta,review);
  const buildable=review.filter(r=>r.status!=='SKIPPED'&&canBuild(r)).length;
  const later=review.filter(r=>r.status!=='SKIPPED'&&!canBuild(r)).length;
  setNotice(later?`已辨識 ${buildable} 筆可直接建立；${later} 筆可之後再補。`:`已辨識 ${buildable} 筆，可以建立。`);
 }

 async function retryRecognition(){
  if(!source||busy)return;
  setBusy(true);setRows([]);setModel('');setNotice('正在重新辨識，請稍候…');
  try{
   const original=await supabase.storage.from('inventory-imports').download(source.storage_path);
   if(original.error||!original.data)throw Error('原始檔讀取失敗，請重新選擇檔案。');
   await recognize(await original.data.arrayBuffer(),{...source});
  }catch(error){setNotice(error instanceof Error?error.message:appError(error));}
  finally{setBusy(false);}
 }

 async function commit(){
  if(!source||busy)return;
  setBusy(true);
  let next=rows.map(r=>({...r}));
  try{
   const candidates=next.filter(r=>['PENDING','FAILED'].includes(r.status)&&canBuild(r));
   const later=next.filter(r=>['PENDING','FAILED'].includes(r.status)&&!canBuild(r));
   if(!candidates.length){setNotice(later.length?`目前 ${later.length} 筆無法自動建立，請重新辨識或重新選擇檔案。`:'沒有需要建立的新資料。');return;}
   const prepared=candidates.map(r=>({...r,unit:r.unit.trim()||'未設定',zoneName:r.zoneName.trim()||'未分類',reason:''}));
   await saveReview(source,next);
   for(let start=0;start<prepared.length;start+=500){
    const chunk=prepared.slice(start,start+500);
    const response=await rpcAny('import_pilot_inventory_quick',{p_store_id:storeId,p_rows:{file:source,rows:chunk.map(reviewPayload)} as unknown as Json});
    if(response.error)throw Error(response.error.message);
    const results=response.data as {source_id:string;status:ReviewStatus;reason:string}[];
    next=next.map(row=>{const saved=results.find(r=>r.source_id===row.sourceId);return saved?{...row,unit:row.unit.trim()||'未設定',status:saved.status,reason:saved.reason}:row;});
   }
   const sync=await rpcAny('sync_active_count_after_import',{p_store_id:storeId});
   if(sync.error)throw Error(sync.error.message);
   setRows(next);await saveReview(source,next);
   await onImported();await loadFiles();
   const built=next.filter(r=>['ADDED','EXISTING'].includes(r.status)).length;
   setNotice(later.length?`已建立 ${built} 筆；${later.length} 筆可之後補。`:`已建立 ${built} 筆資料。`);
  }catch(e){setNotice(e instanceof Error?e.message:appError(e));}
  finally{setBusy(false);}
 }

 async function enterCount(){
  if(busy)return;
  setBusy(true);setNotice('正在開啟本次盤點…');
  try{
   const active=await supabase.from('inventory_count_sessions').select('id').eq('store_id',storeId).in('status',['DRAFT','IN_PROGRESS']).order('started_at',{ascending:false}).limit(1).maybeSingle();
   if(active.error)throw active.error;
   if(!active.data){
    const started=await rpcAny('start_pilot_count',{p_store_id:storeId,p_selection:null});
    if(started.error)throw Error(started.error.message);
   }
   await onImported();
   await new Promise(resolve=>setTimeout(resolve,80));
   const root=rootRef.current;const parent=root?.parentElement;
   const legacyButton=parent?.querySelector<HTMLButtonElement>('.shell-button-stack .shell-primary');
   if(legacyButton){legacyButton.click();return;}
   setNotice('盤點已準備完成，請返回盤點頁。');
  }catch(e){setNotice(e instanceof Error?e.message:appError(e));}
  finally{setBusy(false);}
 }

 async function undoImport(){
  if(!source||busy)return;
  if(!window.confirm('確定移除本次建立資料？已經產生盤點紀錄的品項會保留，不會被刪除。'))return;
  setBusy(true);setNotice('正在移除本次建立資料…');
  try{
   const result=await rpcAny('undo_inventory_import_batch',{p_store_id:storeId,p_file_sha256:source.file_sha256});
   if(result.error)throw Error(result.error.message);
   const data=(result.data||{}) as UndoResult;
   setRows([]);setSource(undefined);setModel('');
   await onImported();await loadFiles();
   setNotice(data.protected?`已移除 ${data.removed||0} 個本次新建品項；${data.protected} 個已有後續紀錄，因此保留。`:`已移除本次建立資料。`);
  }catch(e){setNotice(e instanceof Error?e.message:appError(e));}
  finally{setBusy(false);}
 }

 const resetImport=()=>{if(busy)return;setRows([]);setSource(undefined);setModel('');setNotice('請重新選擇檔案。');};
 const edit=(id:string,patch:Partial<ReviewRow>)=>setRows(current=>current.map(r=>r.sourceId===id?{...r,...patch,status:'PENDING'}:r));
 const recognized=rows.filter(r=>r.status!=='SKIPPED');
 const buildable=recognized.filter(canBuild);
 const later=recognized.filter(r=>!canBuild(r));
 const built=rows.filter(r=>['ADDED','EXISTING'].includes(r.status));
 const hasBuilt=built.length>0;
 const productCount=new Set(recognized.filter(r=>r.name.trim()).map(r=>r.name.trim())).size;

 return <div ref={rootRef} className="inventory-import-flow">
  <section className="shell-card upload-shell">
   <h2>上傳盤點資料</h2>
   <p>先抓品名與手寫期初數字；其他資料可之後補。</p>
   <label className="import-button">{busy?'處理中…':'選擇檔案或照片'}<input type="file" accept=".xlsx,.xls,.csv,.pdf,.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" disabled={busy} onChange={e=>{const f=e.target.files?.[0];e.target.value='';if(f)void readFile(f);}}/></label>
   <small className="shell-note">支援 Excel、CSV、PDF、JPG、PNG、WEBP</small>
  </section>
  {notice&&<p className="pilot-message" role="status">{notice}</p>}{model&&<p className="shell-note">辨識方式：{model}</p>}
  {source&&rows.length===0&&!busy&&<div className="shell-button-stack"><button className="shell-primary" onClick={()=>void retryRecognition()}>重新辨識</button><button className="shell-secondary" onClick={resetImport}>重新選擇檔案</button></div>}
  {rows.length>0&&<section className="shell-section">
   <div className="shell-section-head"><h2>{hasBuilt?'建立完成':'辨識預覽'}</h2><span>{productCount} 個品項</span></div>
   {!hasBuilt&&<div className="shell-card count-detail-list">
    {recognized.slice(0,12).map(r=><article key={r.sourceId}><span><strong>{r.name||'品名待補'}</strong><small>{r.zoneName||'未分類'}・期初 {r.quantityText||'未辨識'} {r.unit||''}</small></span><b>{canBuild(r)?'可建立':'可後補'}</b></article>)}
   </div>}
   {!hasBuilt&&recognized.length>12&&<p className="shell-note">另有 {recognized.length-12} 筆，建立時會一併處理。</p>}
   {!hasBuilt&&later.length>0&&<details className="setup-panel"><summary>修正未辨識資料（選填）</summary>{later.map(r=><article className="shell-card import-review-row" key={r.sourceId}><label className="field">品名<input value={r.name} onChange={e=>edit(r.sourceId,{name:e.target.value})}/></label><label className="field">期初數量<input inputMode="decimal" value={r.quantityText} placeholder="可留白" onChange={e=>edit(r.sourceId,{quantityText:e.target.value})}/></label></article>)}</details>}
   {!hasBuilt&&<div className="shell-button-stack"><button className="shell-primary" disabled={busy||!buildable.length} onClick={()=>void commit()}>{busy?'建立中…':'建立'}</button><button className="shell-secondary" disabled={busy} onClick={()=>void retryRecognition()}>重新辨識</button><button className="text-button" disabled={busy} onClick={resetImport}>重新選擇檔案</button></div>}
   {hasBuilt&&<><section className="shell-card completion-card"><strong>資料建立完成</strong><p>{built.length} 筆已建立，可直接開始盤點。</p></section><div className="shell-button-stack"><button className="shell-primary" disabled={busy} onClick={()=>void enterCount()}>{busy?'開啟中…':'進入盤點'}</button><button className="text-button" disabled={busy} onClick={()=>void undoImport()}>移除本次建立資料</button></div></>}
  </section>}
 </div>;
}
