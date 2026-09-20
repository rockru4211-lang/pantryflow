'use client';
import {useEffect,useRef,useState} from 'react';
import {Trash2} from 'lucide-react';
import {runInventoryImportQueue,replaceImportedFile,type ImportQueueEntry} from '@/lib/inventory-import-queue';
import {importRemovalConfirmation,importRemovalError,removeInventoryImport} from '@/lib/inventory-import-removal';
import {isImportModuleLoadError,importModuleLoadMessage} from '@/lib/inventory-import-errors';
import {supabase} from '@/lib/supabase-browser';
import {parseInventoryWorkbook,readInventoryWorkbook} from '@/lib/inventory-import';
import {readInventoryPdf} from '@/lib/inventory-pdf-browser';
import {appError} from '@/lib/app-workspace';
import {emptyReviewRow,restoreReviewRows,reviewPayload,workbookReview,type ReviewRow,type ReviewStatus,type ImportSource} from '@/lib/inventory-review';
import type {Json} from '@/lib/database.types';

type RpcResult={data:unknown;error:{message:string}|null};
type BuiltItem={file:ImportSource;productId:string;sourceId:string;name:string;unit:string;specification:string|null;zone:string;quantity:string;status:ReviewStatus;reason?:string;updated_at?:string};
type Screen='main'|'exceptions'|'item';
type ZoneOption={id:string;name:string};
type EditDraft={name:string;unit:string;specification:string;zone:string;quantity:string};

export default function InventoryImportFlow({storeId,storeName,organizationId,disabled,onImported,onHistory,onStartCount}:{storeId:string;storeName?:string;organizationId:string;disabled:boolean;onImported:()=>Promise<void>;onHistory?:()=>void;onStartCount?:()=>void}) {
 const booted=useRef(false);
 const removingRef=useRef(false);
 const processingRef=useRef(false);
 const completedHashes=useRef(new Set<string>());
 const[needsReload,setNeedsReload]=useState(false);
 const[loading,setLoading]=useState(true);
 const[queue,setQueue]=useState<ImportQueueEntry[]>([]);
 const filesRef=useRef<ImportSource[]>([]);
 const[builtItems,setBuiltItems]=useState<BuiltItem[]>([]);
 const[busy,setBusy]=useState(false);
 const[notice,setNotice]=useState('');
 const[screen,setScreen]=useState<Screen>('main');
 const[selected,setSelected]=useState<BuiltItem>();
 const[zones,setZones]=useState<ZoneOption[]>([]);
 const[editDraft,setEditDraft]=useState<EditDraft>({name:'',unit:'',specification:'',zone:'未分類',quantity:''});
 const rpcAny=supabase.rpc as unknown as (name:string,args:Record<string,unknown>)=>Promise<RpcResult>;

 async function fetchFiles(){
  const result=await supabase.from('inventory_import_files').select('id,original_filename,file_sha256,storage_path,sheet_names').eq('store_id',storeId).is('removed_at',null).order('created_at',{ascending:false}).limit(30);
  const next=(result.data||[]).map(f=>({...f,sheet_names:Array.isArray(f.sheet_names)?f.sheet_names.map(String):[]})) as ImportSource[];
  if(result.error)throw result.error;
  filesRef.current=next;return next;
 }

 async function loadPersisted(file:ImportSource){
  if(!file.id)throw Error('匯入紀錄尚未完整，請重試此檔案。');
  const result=await supabase.from('inventory_import_rows').select('source_id,sheet_name,source_row,raw_values,merged_ranges,normalized_values,status,reason,product_id').eq('store_id',storeId).eq('import_file_id',file.id).order('source_row').limit(5000);
  if(result.error)throw result.error;
  if(!result.data?.length)throw Error('匯入紀錄尚未完整，請重試此檔案。');
  const restored=restoreReviewRows(result.data as unknown as Record<string,unknown>[],file.sheet_names);
  const productIds=[...new Set(result.data.map(r=>r.product_id).filter(Boolean) as string[])];
  let products=new Map<string,{id:string;name:string;count_unit:string|null;specification:string|null;updated_at:string}>();
  if(productIds.length){const p=await supabase.from('products').select('id,name,count_unit,specification,updated_at').in('id',productIds);if(!p.error)products=new Map((p.data||[]).map(item=>[item.id,item]));}
  const bySource=new Map(restored.map(r=>[r.sourceId,r]));
  const built=(result.data||[]).filter(r=>r.product_id&&!['FAILED','SKIPPED'].includes(String(r.status))).map(r=>{const product=products.get(String(r.product_id));const review=bySource.get(String(r.source_id));const raw=(r.raw_values&&typeof r.raw_values==='object'&&!Array.isArray(r.raw_values)?r.raw_values:{}) as Record<string,unknown>;const explicitReason=String(raw.__review_reason||'').trim();const status=String(r.status) as ReviewStatus;const actionableReason=explicitReason||(status==='PENDING'?String(r.reason||'需要確認'):'');return {file,productId:String(r.product_id),sourceId:String(r.source_id),name:product?.name||review?.name||'未命名',unit:product?.count_unit||review?.unit||'未設定',specification:product?.specification??review?.specification??null,zone:review?.zoneName||'未分類',quantity:review?.quantityText||'未提供',status,reason:actionableReason,updated_at:product?.updated_at};});
  setBuiltItems(current=>replaceImportedFile(current,file.file_sha256,built));
 }

 useEffect(()=>{if(booted.current)return;booted.current=true;void(async()=>{try{const [latest,zoneResult]=await Promise.all([fetchFiles(),supabase.from('count_zones').select('id,name').eq('store_id',storeId).eq('is_active',true).order('sort_order')]);if(!zoneResult.error)setZones((zoneResult.data||[]) as ZoneOption[]);if(latest[0])await loadPersisted(latest[0]);}catch(error){setNotice(appError(error));}finally{setLoading(false);}})();},[storeId]);


 const isImage=(name:string)=>/\.(jpe?g|png|webp)$/i.test(name);
 const canBuild=(r:ReviewRow)=>Boolean(r.name.trim())&&(r.quantityText.trim()===''||(Number.isFinite(Number(r.quantityText))&&Number(r.quantityText)>=0));
 const needsFix=(item:BuiltItem)=>Boolean(item.reason);
 const exceptions=builtItems.filter(needsFix);
 const ready=builtItems.filter(item=>!needsFix(item));

 async function visionReview(meta:ImportSource,label:string){
  setNotice(`${label}辨識中，系統正在整理品名與手寫期初數字…`);
  const result=await supabase.functions.invoke('process-inventory-pdf',{body:{storeId,storagePath:meta.storage_path}});
  if(result.error||!result.data?.rows){let message=result.data?.message;if(!message&&result.error?.context instanceof Response){const body=await result.error.context.json().catch(()=>null);message=body?.message;}throw Error(message||`${label}辨識未完成，請重試。`);}
  const review:ReviewRow[]=result.data.rows.map((r:{page:number;row:number;name?:string;unit?:string;quantity:number|null;specification?:string;supplier?:string;zone?:string;raw?:string;uncertain?:boolean;skip_reason?:string},index:number)=>{const sheet=`第 ${r.page||1} 頁`;const zone=r.zone||'未分類';return {...emptyReviewRow(sheet,r.row),sourceId:`vision:${r.page||1}:${r.row}:${index}:${zone}`,name:r.name||'',unit:r.unit||'',openingQuantity:r.quantity,quantityText:r.quantity===null||r.quantity===undefined?'':String(r.quantity),specification:r.specification||'',supplierName:r.supplier||'',zoneName:zone,rawValues:{原文:r.raw||'',__review_reason:r.uncertain?'期初數字不確定':''},status:r.skip_reason?'SKIPPED':'PENDING',reason:r.skip_reason||(r.uncertain?'期初數字不確定':'')};});
  meta.sheet_names=[...new Set(review.map(r=>r.sheetName))];return review;
 }

 async function recognize(bytes:ArrayBuffer,meta:ImportSource){
  if(/\.pdf$/i.test(meta.original_filename)){const parsed=await readInventoryPdf(bytes);if(parsed){meta.sheet_names=parsed.sheets.map(s=>s.sheetName);return workbookReview(parsed);}return visionReview(meta,'掃描 PDF');}
  if(isImage(meta.original_filename))return visionReview(meta,'照片');
  const parsed=parseInventoryWorkbook(readInventoryWorkbook(bytes,meta.original_filename));meta.sheet_names=parsed.sheets.map(s=>s.sheetName);return workbookReview(parsed);
 }

 async function build(review:ReviewRow[],meta:ImportSource){
  const candidates=review.filter(r=>r.status!=='SKIPPED'&&canBuild(r));
  if(!candidates.length)throw Error('目前沒有可建立的品項，請重新辨識或改用其他檔案。');
  const prepared=candidates.map(r=>({...r,unit:r.unit.trim()||'未設定',zoneName:r.zoneName.trim()||'未分類',reason:r.reason||''}));
  for(let start=0;start<prepared.length;start+=500){const chunk=prepared.slice(start,start+500);const response=await rpcAny('import_pilot_inventory_quick',{p_store_id:storeId,p_rows:{file:meta,rows:chunk.map(reviewPayload)} as unknown as Json});if(response.error)throw Error(response.error.message);if(!Array.isArray(response.data)||response.data.some(row=>row.status==='FAILED'))throw Error('部分品項尚未建立，請重試此檔案；已建立的資料會保留。');}
  const sync=await rpcAny('sync_active_count_after_import',{p_store_id:storeId});if(sync.error)throw Error(sync.error.message);
  const active=await supabase.from('inventory_count_sessions').select('id').eq('store_id',storeId).in('status',['DRAFT','IN_PROGRESS']).limit(1).maybeSingle();
  if(active.error)throw active.error;
  if(!active.data){const started=await rpcAny('start_pilot_count',{p_store_id:storeId,p_selection:null});if(started.error)throw Error(started.error.message);}
  const saved=await supabase.from('inventory_import_files').select('id,original_filename,file_sha256,storage_path,sheet_names').eq('store_id',storeId).eq('file_sha256',meta.file_sha256).is('removed_at',null).single();
  if(saved.error)throw saved.error;
  const latest:ImportSource={...saved.data,sheet_names:Array.isArray(saved.data.sheet_names)?saved.data.sheet_names.map(String):[]};
  filesRef.current=[latest,...filesRef.current.filter(file=>file.file_sha256!==latest.file_sha256)];
  await loadPersisted(latest);
 }

 async function importFile(file:File){
  if(!/\.(xlsx?|csv|pdf|jpe?g|png|webp)$/i.test(file.name))throw Error('請選擇 Excel、CSV、PDF 或照片。');
  if(file.size>15*1024*1024)throw Error('每份檔案最多 15 MB。');
  const bytes=await file.arrayBuffer();const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
  if(completedHashes.current.has(hash))return;
  const meta:ImportSource={original_filename:file.name,file_sha256:hash,storage_path:`${organizationId}/${storeId}/${hash}/${file.name.normalize('NFKC').replace(/[^A-Za-z0-9._-]+/g,'-')||'inventory'}`,sheet_names:[]};
  const previous=filesRef.current.find(f=>f.file_sha256===hash);if(previous){meta.id=previous.id;meta.storage_path=previous.storage_path;}
  if(!previous){const contentType=/\.pdf$/i.test(file.name)?'application/pdf':isImage(file.name)?(file.type||'image/jpeg'):file.type||'application/octet-stream';const uploaded=await supabase.storage.from('inventory-imports').upload(meta.storage_path,bytes,{contentType,upsert:false});if(uploaded.error&&!/duplicate|already exists|resource exists/i.test(uploaded.error.message))throw uploaded.error;}
  const review=await recognize(bytes,meta);await build(review,meta);completedHashes.current.add(hash);
 }

 async function processQueue(entries:ImportQueueEntry[],preservedFailures:ImportQueueEntry[]=[]){
  if(busy||disabled||loading||processingRef.current||needsReload)return;
  processingRef.current=true;setBusy(true);setScreen('main');setNotice('');
  try{
   await runInventoryImportQueue(entries,importFile,next=>setQueue([...preservedFailures,...next]),error=>{
    if(isImportModuleLoadError(error)){setNeedsReload(true);return importModuleLoadMessage;}
    return error instanceof Error?error.message:appError(error);
   });
   setNotice('');
   try{await onImported();}catch{setNotice('匯入結果已保留，盤點清單尚未更新，請重新開啟盤點頁。');}
  }finally{processingRef.current=false;setBusy(false);}
 }
 function readFiles(selectedFiles:File[]){
  if(!selectedFiles.length||busy||disabled||loading||processingRef.current||needsReload)return;
  const entries:ImportQueueEntry[]=selectedFiles.map(file=>({id:crypto.randomUUID(),file,status:'pending'}));
  // Preserve failures for an explicit retry; adding files must not silently retry OCR.
  void processQueue(entries,queue.filter(entry=>entry.status==='failed'));
 }
 function retryRecognition(){void processQueue(queue);}
 async function removeItem(item:BuiltItem){if(busy||!window.confirm(`移除「${item.name}」？尚未盤點的本次新建品項才可移除。`))return;setBusy(true);try{const r=await rpcAny('remove_single_imported_product_safely',{p_store_id:storeId,p_product_id:item.productId});if(r.error)throw Error(r.error.message);await loadPersisted(item.file);await onImported();setSelected(undefined);setScreen('exceptions');setNotice(`已移除「${item.name}」。`);}catch(e){const raw=e instanceof Error?e.message:String(e);setNotice(/PRODUCT_ALREADY_COUNTED/.test(raw)?'這個品項已經有盤點數量，不能直接移除。':appError(e));}finally{setBusy(false);}}
 async function excludeItem(item:BuiltItem){if(busy||!window.confirm(`本次略過「${item.name}」？品項資料會保留。`))return;setBusy(true);try{const r=await rpcAny('set_pilot_count_next_period',{p_store_id:storeId,p_product_id:item.productId,p_action:'EXCLUDE_CURRENT'});if(r.error)throw Error(r.error.message);setBuiltItems(current=>current.filter(row=>row.productId!==item.productId));await onImported();setSelected(undefined);setScreen('exceptions');setNotice(`「${item.name}」已從本次盤點略過。`);}catch(e){const raw=e instanceof Error?e.message:String(e);setNotice(/PRODUCT_ALREADY_COUNTED/.test(raw)?'這個品項已經填過盤點數量，不能略過。':appError(e));}finally{setBusy(false);}}
 async function saveItem(){if(!selected||!selected.file.id||busy)return;const name=editDraft.name.trim();const unit=editDraft.unit.trim();const quantityText=editDraft.quantity.trim();if(!name||!unit){setNotice('請填寫品名與單位。');return;}if(quantityText!==''&&(!Number.isFinite(Number(quantityText))||Number(quantityText)<0)){setNotice('期初數量格式不正確。');return;}setBusy(true);setNotice('正在儲存修改…');try{const r=await rpcAny('update_imported_inventory_item',{p_store_id:storeId,p_import_file_id:selected.file.id,p_source_id:selected.sourceId,p_product_id:selected.productId,p_name:name,p_unit:unit,p_specification:editDraft.specification.trim(),p_zone_name:editDraft.zone,p_opening_quantity:quantityText===''?null:Number(quantityText)});if(r.error)throw Error(r.error.message);const updated={...selected,name,unit,specification:editDraft.specification.trim()||null,zone:editDraft.zone||'未分類',quantity:quantityText||'未提供',reason:''};setBuiltItems(current=>current.map(row=>row.sourceId===selected.sourceId&&row.file.id===selected.file.id?updated:row));setSelected(updated);await onImported();setNotice('已儲存修改。');setScreen('exceptions');}catch(e){setNotice(e instanceof Error?e.message:appError(e));}finally{setBusy(false);}}
 async function undoBatch(source:ImportSource){
  if(busy||removingRef.current||!window.confirm(importRemovalConfirmation(source.original_filename,storeName)))return;
  removingRef.current=true;setBusy(true);setNotice('正在整批移除資料與品項…');
  try{
   const message=await removeInventoryImport(rpcAny,storeId,source.file_sha256);
   setBuiltItems(current=>replaceImportedFile(current,source.file_sha256,[]));completedHashes.current.delete(source.file_sha256);setSelected(undefined);setScreen('main');setNotice(message);
   try{await onImported();await fetchFiles();}catch{setNotice(`${message}清單尚未更新，請重新開啟盤點頁。`);}
  }catch(e){setNotice(importRemovalError(e));}finally{removingRef.current=false;setBusy(false);}
 }
 function enterCount(){if(!busy&&!disabled)onStartCount?.();}

 const openItem=(item:BuiltItem)=>{setSelected(item);setEditDraft({name:item.name,unit:item.unit==='未設定'?'':item.unit,specification:item.specification||'',zone:item.zone||'未分類',quantity:item.quantity==='未提供'?'':item.quantity});setNotice('');setScreen('item');};
 const reasonFor=(item:BuiltItem)=>item.reason || (item.zone==='未分類'?'缺儲物區':item.quantity==='未提供'?'期初數字不確定':item.unit==='未設定'?'單位待補':!item.specification?'規格待補':'需要確認');

 const importedFiles=[...new Map(builtItems.map(item=>[item.file.file_sha256,item.file])).values()];
 const failedFiles=queue.filter(entry=>entry.status==='failed');
 const currentFile=queue.find(entry=>entry.status==='processing');
 const locked=busy||disabled||loading;
 const uploadButton=<label className="import-button" style={{marginTop:12}}>{locked?'處理中…':builtItems.length?'＋ 追加檔案或照片':'選擇檔案或照片（可多選）'}<input type="file" multiple accept=".xlsx,.xls,.csv,.pdf,.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" disabled={locked||needsReload} onChange={e=>{const selectedFiles=Array.from(e.target.files||[]);e.target.value='';readFiles(selectedFiles);}}/></label>;

 return <div className="inventory-import-flow">
  {screen==='main'&&<>
   <section className="shell-card" style={{padding:18}}>
    <div className="shell-section-head"><h2>{builtItems.length?'本次建檔':'上傳盤點資料'}</h2>{storeName&&<span>{storeName}</span>}</div>
    {builtItems.length>0?<>
     <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,margin:'14px 0'}}><div style={{padding:14,borderRadius:14,background:'#eef8f3',textAlign:'center'}}><strong style={{fontSize:28}}>{new Set(builtItems.map(item=>item.productId)).size}</strong><small style={{display:'block'}}>已匯入品項</small></div><div style={{padding:14,borderRadius:14,background:'#fff4e7',textAlign:'center'}}><strong style={{fontSize:28}}>{exceptions.length}</strong><small style={{display:'block'}}>需確認項目</small></div></div>
     {onStartCount&&<button className="shell-primary full" disabled={locked} onClick={enterCount}>開始盤點 →</button>}
     {exceptions.length>0&&<button className="shell-secondary full" disabled={locked} style={{marginTop:8}} onClick={()=>setScreen('exceptions')}>處理 {exceptions.length} 項需確認</button>}
    </>:<p className="shell-note">可一次選多份 Excel、CSV、PDF 或照片，每份最多 15 MB。</p>}
    {uploadButton}
    {importedFiles.length>0&&<><p className="shell-note" style={{marginTop:14}}>已加入 {importedFiles.length} 份檔案・左滑可整批移除資料與品項</p><div className="swipe-list">{importedFiles.map(file=><div className="swipe-row" key={file.file_sha256}><div className="swipe-row-main"><span><strong>{file.original_filename}</strong><small>{builtItems.filter(item=>item.file.file_sha256===file.file_sha256).length} 項</small></span></div><button type="button" className="swipe-row-remove" disabled={locked} aria-label={`整批移除資料與品項：${file.original_filename}`} onClick={()=>void undoBatch(file)}><Trash2 size={20} aria-hidden="true"/><span>移除</span></button></div>)}</div></>}
    {onHistory&&<button className="text-button full" style={{marginTop:12}} disabled={locked} onClick={onHistory}>歷史建檔 ›</button>}
   </section>
   {busy&&<p className="pilot-message" role="status">{currentFile?`正在處理 ${queue.filter(entry=>entry.status==='done'||entry.status==='failed').length+1}／${queue.length}：${currentFile.file.name}`:'正在更新…'}</p>}
   {failedFiles.length>0&&<section className="shell-card" style={{padding:14,marginTop:12}}><strong>{failedFiles.length} 份檔案未完成</strong>{failedFiles.map(entry=><p className="shell-note" key={entry.id}><strong>{entry.file.name}</strong><br/>{entry.error}</p>)}{!needsReload&&<button className="shell-secondary full" disabled={locked} onClick={retryRecognition}>只重試失敗檔案</button>}</section>}
   {!busy&&notice&&<p className="pilot-message" role="status">{notice}</p>}
   {needsReload&&<button type="button" className="shell-secondary full" disabled={busy} onClick={()=>window.location.reload()}>更新頁面</button>}
  </>}

  {screen==='exceptions'&&<><button className="shell-back" onClick={()=>setScreen('main')}>‹ 返回整理結果</button><h1>需確認項目（{exceptions.length}）</h1><p className="shell-note">只處理例外，其餘品項已建立完成。</p><div className="shell-card shell-list">{exceptions.map(item=><button className="shell-list-row" key={`${item.file.id}:${item.sourceId}`} onClick={()=>openItem(item)}><span><strong>{item.name}</strong><small>{item.file.original_filename}・{reasonFor(item)}</small></span><b>›</b></button>)}</div><div className="shell-card" style={{marginTop:12,padding:12,background:'#eef8f3'}}><strong>其餘 {ready.length} 個品項已完成建立</strong><p className="shell-note">可直接開始盤點。</p></div>{onStartCount&&<button className="shell-primary full" disabled={locked} style={{marginTop:10}} onClick={enterCount}>開始盤點</button>}</>}

  {screen==='item'&&selected&&<><button className="shell-back" onClick={()=>setScreen('exceptions')}>‹ 返回需確認項目</button><div className="shell-section-head"><h1>查看並修改</h1><span>{reasonFor(selected)}</span></div><form className="shell-card" style={{padding:14,display:'grid',gap:12}} onSubmit={e=>{e.preventDefault();void saveItem();}}><label className="field">品名<input value={editDraft.name} onChange={e=>setEditDraft(d=>({...d,name:e.target.value}))} required/></label><label className="field">單位<input value={editDraft.unit} onChange={e=>setEditDraft(d=>({...d,unit:e.target.value}))} required/></label><label className="field">規格（選填）<input value={editDraft.specification} onChange={e=>setEditDraft(d=>({...d,specification:e.target.value}))}/></label><label className="field">儲物區<select value={editDraft.zone} onChange={e=>setEditDraft(d=>({...d,zone:e.target.value}))}><option value="未分類">未分類</option>{zones.map(zone=><option key={zone.id} value={zone.name}>{zone.name}</option>)}</select></label><label className="field">期初<input inputMode="decimal" value={editDraft.quantity} placeholder="可留白" onChange={e=>setEditDraft(d=>({...d,quantity:e.target.value}))}/></label><div className="shell-button-stack"><button type="button" className="shell-secondary" disabled={busy} onClick={()=>setScreen('exceptions')}>取消</button><button className="shell-primary" disabled={busy}>{busy?'儲存中…':'儲存'}</button></div></form><div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginTop:12}}><button className="shell-secondary" disabled={busy} onClick={()=>void excludeItem(selected)}>本次略過</button>{selected.status==='ADDED'?<button className="text-button" style={{color:'#b42318'}} disabled={busy} onClick={()=>void removeItem(selected)}>移除品項</button>:<button className="text-button" disabled>保留既有品項</button>}</div><p className="shell-note" style={{marginTop:10}}>只有系統判斷不確定的資料需要確認；其他資料可之後補，不影響開始盤點。</p>{notice&&<p className="pilot-message" role="status">{notice}</p>}</>}
 </div>;
}
