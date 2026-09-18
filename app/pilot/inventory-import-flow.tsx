'use client';
import {useEffect,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase-browser';
import {parseInventoryWorkbook,readInventoryWorkbook} from '@/lib/inventory-import';
import {readInventoryPdf} from '@/lib/inventory-pdf-browser';
import {appError} from '@/lib/app-workspace';
import {emptyReviewRow,restoreReviewRows,reviewPayload,workbookReview,type ReviewRow,type ReviewStatus,type ImportSource} from '@/lib/inventory-review';
import type {Json} from '@/lib/database.types';

type RpcResult={data:unknown;error:{message:string}|null};
type BuiltItem={productId:string;sourceId:string;name:string;unit:string;specification:string|null;zone:string;quantity:string;status:ReviewStatus;reason?:string;updated_at?:string};
type Screen='main'|'exceptions'|'item';
type ZoneOption={id:string;name:string};
type EditDraft={name:string;unit:string;specification:string;zone:string;quantity:string};

export default function InventoryImportFlow({userId,storeId,organizationId,disabled,onImported,onHistory}:{userId:string;storeId:string;organizationId:string;disabled:boolean;onImported:()=>Promise<void>;onHistory?:()=>void}) {
 void disabled;
 const rootRef=useRef<HTMLDivElement>(null);
 const booted=useRef(false);
 const[rows,setRows]=useState<ReviewRow[]>([]);
 const[source,setSource]=useState<ImportSource>();
 const[files,setFiles]=useState<ImportSource[]>([]);
 const[builtItems,setBuiltItems]=useState<BuiltItem[]>([]);
 const[busy,setBusy]=useState(false);
 const[notice,setNotice]=useState('');
 const[model,setModel]=useState('');
 const[screen,setScreen]=useState<Screen>('main');
 const[selected,setSelected]=useState<BuiltItem>();
 const[zones,setZones]=useState<ZoneOption[]>([]);
 const[editDraft,setEditDraft]=useState<EditDraft>({name:'',unit:'',specification:'',zone:'未分類',quantity:''});
 const rpcAny=supabase.rpc as unknown as (name:string,args:Record<string,unknown>)=>Promise<RpcResult>;

 async function fetchFiles(){
  const result=await supabase.from('inventory_import_files').select('id,original_filename,file_sha256,storage_path,sheet_names').eq('store_id',storeId).order('created_at',{ascending:false}).limit(30);
  const next=(result.data||[]).map(f=>({...f,sheet_names:Array.isArray(f.sheet_names)?f.sheet_names.map(String):[]})) as ImportSource[];
  setFiles(next);return next;
 }

 async function loadPersisted(file:ImportSource,quiet=false){
  if(!file.id)return;
  const result=await supabase.from('inventory_import_rows').select('source_id,sheet_name,source_row,raw_values,merged_ranges,normalized_values,status,reason,product_id').eq('store_id',storeId).eq('import_file_id',file.id).order('source_row').limit(5000);
  if(result.error)throw result.error;
  if(!result.data?.length)return;
  const restored=restoreReviewRows(result.data as unknown as Record<string,unknown>[],file.sheet_names);
  setSource(file);setRows(restored);
  const productIds=[...new Set(result.data.map(r=>r.product_id).filter(Boolean) as string[])];
  let products=new Map<string,{id:string;name:string;count_unit:string|null;specification:string|null;updated_at:string}>();
  if(productIds.length){const p=await supabase.from('products').select('id,name,count_unit,specification,updated_at').in('id',productIds);if(!p.error)products=new Map((p.data||[]).map(item=>[item.id,item]));}
  const bySource=new Map(restored.map(r=>[r.sourceId,r]));
  const built=(result.data||[]).filter(r=>r.product_id&&!['FAILED','SKIPPED'].includes(String(r.status))).map(r=>{const product=products.get(String(r.product_id));const review=bySource.get(String(r.source_id));const raw=(r.raw_values&&typeof r.raw_values==='object'&&!Array.isArray(r.raw_values)?r.raw_values:{}) as Record<string,unknown>;const explicitReason=String(raw.__review_reason||'').trim();const status=String(r.status) as ReviewStatus;const actionableReason=explicitReason||(status==='PENDING'?String(r.reason||'需要確認'):'');return {productId:String(r.product_id),sourceId:String(r.source_id),name:product?.name||review?.name||'未命名',unit:product?.count_unit||review?.unit||'未設定',specification:product?.specification??review?.specification??null,zone:review?.zoneName||'未分類',quantity:review?.quantityText||'未提供',status,reason:actionableReason,updated_at:product?.updated_at};});
  setBuiltItems(built);
  if(!quiet&&built.length)setNotice(`已恢復上次進度：${built.length} 個品項已建立。`);
 }

 useEffect(()=>{if(booted.current)return;booted.current=true;void(async()=>{try{const [latest,zoneResult]=await Promise.all([fetchFiles(),supabase.from('count_zones').select('id,name').eq('store_id',storeId).eq('is_active',true).order('sort_order')]);if(!zoneResult.error)setZones((zoneResult.data||[]) as ZoneOption[]);if(latest[0])await loadPersisted(latest[0]);}catch{}})();},[storeId]);
 useEffect(()=>{const root=rootRef.current;const parent=root?.parentElement;if(!root||!parent)return;const hide=()=>{for(const child of Array.from(parent.children)){if(child!==root&&child instanceof HTMLElement&&child.classList.contains('shell-button-stack'))child.style.display='none';}};hide();const o=new MutationObserver(hide);o.observe(parent,{childList:true});return()=>{o.disconnect();for(const child of Array.from(parent.children)){if(child instanceof HTMLElement)child.style.removeProperty('display');}};},[]);

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
  meta.sheet_names=[...new Set(review.map(r=>r.sheetName))];setModel(`${result.data.model}・${(result.data.durationMs/1000).toFixed(1)} 秒`);return review;
 }

 async function recognize(bytes:ArrayBuffer,meta:ImportSource){
  if(/\.pdf$/i.test(meta.original_filename)){const parsed=await readInventoryPdf(bytes);if(parsed){meta.sheet_names=parsed.sheets.map(s=>s.sheetName);setModel('PDF 文字層');return workbookReview(parsed);}return visionReview(meta,'掃描 PDF');}
  if(isImage(meta.original_filename))return visionReview(meta,'照片');
  const parsed=parseInventoryWorkbook(readInventoryWorkbook(bytes,meta.original_filename));meta.sheet_names=parsed.sheets.map(s=>s.sheetName);return workbookReview(parsed);
 }

 async function build(review:ReviewRow[],meta:ImportSource){
  const candidates=review.filter(r=>r.status!=='SKIPPED'&&canBuild(r));
  if(!candidates.length)throw Error('目前沒有可建立的品項，請重新辨識或改用其他檔案。');
  let next=review.map(r=>({...r}));
  const prepared=candidates.map(r=>({...r,unit:r.unit.trim()||'未設定',zoneName:r.zoneName.trim()||'未分類',reason:r.reason||''}));
  for(let start=0;start<prepared.length;start+=500){const chunk=prepared.slice(start,start+500);const response=await rpcAny('import_pilot_inventory_quick',{p_store_id:storeId,p_rows:{file:meta,rows:chunk.map(reviewPayload)} as unknown as Json});if(response.error)throw Error(response.error.message);const results=response.data as {source_id:string;status:ReviewStatus;reason:string}[];next=next.map(row=>{const saved=results.find(r=>r.source_id===row.sourceId);return saved?{...row,unit:row.unit.trim()||'未設定',status:saved.status,reason:row.reason||saved.reason}:row;});}
  const sync=await rpcAny('sync_active_count_after_import',{p_store_id:storeId});if(sync.error)throw Error(sync.error.message);
  const active=await supabase.from('inventory_count_sessions').select('id').eq('store_id',storeId).in('status',['DRAFT','IN_PROGRESS']).limit(1).maybeSingle();
  if(!active.error&&!active.data){const started=await rpcAny('start_pilot_count',{p_store_id:storeId,p_selection:null});if(started.error)throw Error(started.error.message);}
  setRows(next);await onImported();const latest=(await fetchFiles()).find(f=>f.file_sha256===meta.file_sha256)||meta;await loadPersisted(latest,true);
 }

 async function readFile(file:File){
  if(busy)return;
  if(source&&builtItems.length&&!window.confirm('改用新的檔案？目前已建立的資料會保留，不會被刪除。'))return;
  setBusy(true);setRows([]);setBuiltItems([]);setModel('');setScreen('main');setNotice('正在讀取檔案…');
  try{
   if(!/\.(xlsx?|csv|pdf|jpe?g|png|webp)$/i.test(file.name))throw Error('請選擇 Excel、CSV、PDF 或照片。');
   if(file.size>15*1024*1024)throw Error('檔案最多 15 MB。');
   const bytes=await file.arrayBuffer();const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
   const meta:ImportSource={original_filename:file.name,file_sha256:hash,storage_path:`${organizationId}/${storeId}/${hash}/${file.name.normalize('NFKC').replace(/[^A-Za-z0-9._-]+/g,'-')||'inventory'}`,sheet_names:[]};
   const previous=files.find(f=>f.file_sha256===hash);if(previous){meta.id=previous.id;meta.storage_path=previous.storage_path;}
   setSource(meta);
   if(!previous){const contentType=/\.pdf$/i.test(file.name)?'application/pdf':isImage(file.name)?(file.type||'image/jpeg'):file.type||'application/octet-stream';const uploaded=await supabase.storage.from('inventory-imports').upload(meta.storage_path,bytes,{contentType,upsert:false});if(uploaded.error&&!/duplicate|already exists|resource exists/i.test(uploaded.error.message))throw uploaded.error;}
   const review=await recognize(bytes,meta);setRows(review);setSource({...meta});setNotice('辨識完成，系統正在自動建立品項…');await build(review,meta);setNotice('資料已整理完成，可直接開始盤點。');
  }catch(error){setNotice(error instanceof Error?error.message:appError(error));}
  finally{setBusy(false);}
 }

 async function retryRecognition(){if(!source||busy)return;setBusy(true);setNotice('正在重新辨識…');try{const original=await supabase.storage.from('inventory-imports').download(source.storage_path);if(original.error||!original.data)throw Error('原始檔讀取失敗，請重新上傳。');const review=await recognize(await original.data.arrayBuffer(),{...source});setRows(review);await build(review,{...source});setNotice('重新整理完成，可直接開始盤點。');}catch(e){setNotice(e instanceof Error?e.message:appError(e));}finally{setBusy(false);}}
 async function removeItem(item:BuiltItem){if(busy||!window.confirm(`移除「${item.name}」？尚未盤點的本次新建品項才可移除。`))return;setBusy(true);try{const r=await rpcAny('remove_single_imported_product_safely',{p_store_id:storeId,p_product_id:item.productId});if(r.error)throw Error(r.error.message);if(source)await loadPersisted(source,true);await onImported();setSelected(undefined);setScreen('exceptions');setNotice(`已移除「${item.name}」。`);}catch(e){const raw=e instanceof Error?e.message:String(e);setNotice(/PRODUCT_ALREADY_COUNTED/.test(raw)?'這個品項已經有盤點數量，不能直接移除。':appError(e));}finally{setBusy(false);}}
 async function excludeItem(item:BuiltItem){if(busy||!window.confirm(`本次略過「${item.name}」？品項資料會保留。`))return;setBusy(true);try{const r=await rpcAny('set_pilot_count_next_period',{p_store_id:storeId,p_product_id:item.productId,p_action:'EXCLUDE_CURRENT'});if(r.error)throw Error(r.error.message);setBuiltItems(current=>current.filter(row=>row.sourceId!==item.sourceId));await onImported();setSelected(undefined);setScreen('exceptions');setNotice(`「${item.name}」已從本次盤點略過。`);}catch(e){const raw=e instanceof Error?e.message:String(e);setNotice(/PRODUCT_ALREADY_COUNTED/.test(raw)?'這個品項已經填過盤點數量，不能略過。':appError(e));}finally{setBusy(false);}}
 async function saveItem(){if(!selected||!source?.id||busy)return;const name=editDraft.name.trim();const unit=editDraft.unit.trim();const quantityText=editDraft.quantity.trim();if(!name||!unit){setNotice('請填寫品名與單位。');return;}if(quantityText!==''&&(!Number.isFinite(Number(quantityText))||Number(quantityText)<0)){setNotice('期初數量格式不正確。');return;}setBusy(true);setNotice('正在儲存修改…');try{const r=await rpcAny('update_imported_inventory_item',{p_store_id:storeId,p_import_file_id:source.id,p_source_id:selected.sourceId,p_product_id:selected.productId,p_name:name,p_unit:unit,p_specification:editDraft.specification.trim(),p_zone_name:editDraft.zone,p_opening_quantity:quantityText===''?null:Number(quantityText)});if(r.error)throw Error(r.error.message);const updated={...selected,name,unit,specification:editDraft.specification.trim()||null,zone:editDraft.zone||'未分類',quantity:quantityText||'未提供',reason:''};setBuiltItems(current=>current.map(row=>row.sourceId===selected.sourceId?updated:row));setSelected(updated);await onImported();setNotice('已儲存修改。');setScreen('exceptions');}catch(e){setNotice(e instanceof Error?e.message:appError(e));}finally{setBusy(false);}}
 async function undoBatch(){if(!source||busy||!window.confirm('整批移除本次建檔？只會移除本次新建且尚未產生盤點紀錄的品項。'))return;setBusy(true);setNotice('正在移除本次建檔…');try{const r=await rpcAny('undo_inventory_import_batch',{p_store_id:storeId,p_file_sha256:source.file_sha256});if(r.error)throw Error(r.error.message);setRows([]);setBuiltItems([]);setSelected(undefined);setScreen('main');await onImported();await fetchFiles();setNotice('本次建檔已移除，可重新上傳。');}catch(e){setNotice(e instanceof Error?e.message:appError(e));}finally{setBusy(false);}}
 async function enterCount(){if(busy)return;setNotice('正在開啟盤點…');try{const parent=rootRef.current?.parentElement;const legacyButton=parent?.querySelector<HTMLButtonElement>('.shell-button-stack .shell-primary');if(legacyButton){legacyButton.click();return;}await onImported();setNotice('盤點已準備完成。');}catch(e){setNotice(e instanceof Error?e.message:appError(e));}}

 const openItem=(item:BuiltItem)=>{setSelected(item);setEditDraft({name:item.name,unit:item.unit==='未設定'?'':item.unit,specification:item.specification||'',zone:item.zone||'未分類',quantity:item.quantity==='未提供'?'':item.quantity});setNotice('');setScreen('item');};
 const reasonFor=(item:BuiltItem)=>item.reason || (item.zone==='未分類'?'缺儲物區':item.quantity==='未提供'?'期初數字不確定':item.unit==='未設定'?'單位待補':!item.specification?'規格待補':'需要確認');

 return <div ref={rootRef} className="inventory-import-flow">
  {screen==='main'&&<>
   {!builtItems.length&&<section className="shell-card upload-shell"><h2>上傳盤點資料</h2><p>拍照或上傳檔案，系統會自動辨識品名與手寫期初數字。</p><label className="import-button">{busy?'處理中…':'選擇檔案或照片'}<input type="file" accept=".xlsx,.xls,.csv,.pdf,.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" disabled={busy} onChange={e=>{const f=e.target.files?.[0];e.target.value='';if(f)void readFile(f);}}/></label><small className="shell-note">支援 Excel、CSV、PDF、JPG、PNG、WEBP</small><div className="shell-card" style={{marginTop:14,padding:12,background:'#f6f8f7'}}><strong>小提示</strong><p className="shell-note">可上傳盤點表、手寫單等，系統會自動辨識與整理。</p></div></section>}
   {builtItems.length>0&&<section className="shell-card" style={{padding:18}}><div className="shell-section-head"><h2>本次建檔</h2>{source&&<span style={{maxWidth:150,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{source.original_filename}</span>}</div><div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,margin:'14px 0'}}><div style={{padding:14,borderRadius:14,background:'#eef8f3',textAlign:'center'}}><strong style={{fontSize:28}}>{builtItems.length}</strong><small style={{display:'block'}}>本次匯入項目</small></div><div style={{padding:14,borderRadius:14,background:'#fff4e7',textAlign:'center'}}><strong style={{fontSize:28}}>{exceptions.length}</strong><small style={{display:'block'}}>需確認項目</small></div></div><button className="shell-primary full" onClick={()=>void enterCount()}>開始盤點 →</button>{exceptions.length>0&&<button className="shell-secondary full" style={{marginTop:8}} onClick={()=>setScreen('exceptions')}>處理 {exceptions.length} 項需確認</button>}<button className="text-button full" style={{marginTop:8}} disabled={busy} onClick={()=>void undoBatch()}>整批移除本次建檔</button>{onHistory&&<button className="shell-list-row" style={{marginTop:12}} onClick={onHistory}><span><strong>歷史建檔</strong><small>查看過去匯入紀錄</small></span><b>›</b></button>}<p className="shell-note" style={{marginTop:10}}>未完整資料可之後補，不影響現場盤點。</p></section>}
   {notice&&<p className="pilot-message" role="status">{notice}</p>}{model&&<p className="shell-note">辨識方式：{model}</p>}
   {!builtItems.length&&source&&!busy&&<button className="shell-secondary full" onClick={()=>void retryRecognition()}>重新辨識</button>}
  </>}

  {screen==='exceptions'&&<><button className="shell-back" onClick={()=>setScreen('main')}>‹ 返回整理結果</button><h1>需確認項目（{exceptions.length}）</h1><p className="shell-note">只處理例外，其餘品項已建立完成。</p><div className="shell-card shell-list">{exceptions.map(item=><button className="shell-list-row" key={item.sourceId} onClick={()=>openItem(item)}><span><strong>{item.name}</strong><small>{reasonFor(item)}</small></span><b>›</b></button>)}</div><div className="shell-card" style={{marginTop:12,padding:12,background:'#eef8f3'}}><strong>其餘 {ready.length} 個品項已完成建立</strong><p className="shell-note">可直接開始盤點。</p></div><button className="shell-primary full" style={{marginTop:10}} onClick={()=>void enterCount()}>開始盤點</button></>}

  {screen==='item'&&selected&&<><button className="shell-back" onClick={()=>setScreen('exceptions')}>‹ 返回需確認項目</button><div className="shell-section-head"><h1>查看並修改</h1><span>{reasonFor(selected)}</span></div><form className="shell-card" style={{padding:14,display:'grid',gap:12}} onSubmit={e=>{e.preventDefault();void saveItem();}}><label className="field">品名<input value={editDraft.name} onChange={e=>setEditDraft(d=>({...d,name:e.target.value}))} required/></label><label className="field">單位<input value={editDraft.unit} onChange={e=>setEditDraft(d=>({...d,unit:e.target.value}))} required/></label><label className="field">規格（選填）<input value={editDraft.specification} onChange={e=>setEditDraft(d=>({...d,specification:e.target.value}))}/></label><label className="field">儲物區<select value={editDraft.zone} onChange={e=>setEditDraft(d=>({...d,zone:e.target.value}))}><option value="未分類">未分類</option>{zones.map(zone=><option key={zone.id} value={zone.name}>{zone.name}</option>)}</select></label><label className="field">期初<input inputMode="decimal" value={editDraft.quantity} placeholder="可留白" onChange={e=>setEditDraft(d=>({...d,quantity:e.target.value}))}/></label><div className="shell-button-stack"><button type="button" className="shell-secondary" disabled={busy} onClick={()=>setScreen('exceptions')}>取消</button><button className="shell-primary" disabled={busy}>{busy?'儲存中…':'儲存'}</button></div></form><div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginTop:12}}><button className="shell-secondary" disabled={busy} onClick={()=>void excludeItem(selected)}>本次略過</button>{selected.status==='ADDED'?<button className="text-button" style={{color:'#b42318'}} disabled={busy} onClick={()=>void removeItem(selected)}>移除品項</button>:<button className="text-button" disabled>保留既有品項</button>}</div><p className="shell-note" style={{marginTop:10}}>只有系統判斷不確定的資料需要確認；其他資料可之後補，不影響開始盤點。</p>{notice&&<p className="pilot-message" role="status">{notice}</p>}</>}
 </div>;
}
