'use client';
import {useEffect,useRef,useState} from 'react';
import {Search,ChevronDown,Trash2,CheckCircle2} from 'lucide-react';
import {WorkDayPicker} from './work-date-picker';
import FieldProductForm from './field-product-form';
import type {FieldProduct} from '@/lib/field-product';
import UnitSelect from './unit-select';
import {transferDirections,selectedTransferDirection,sourceTransferProducts,type TransferCatalog} from '@/lib/transfer-direction';
import {addTransferProduct,emptyTransferBatch,migrateSingleTransfer,readTransferBatch,submitTransferBatch,transferBatchPayload,MAX_TRANSFER_ITEMS,type BatchDraft,type BatchLine} from '@/lib/transfer-batch';
import {workspaceStorage} from '@/lib/workspace-storage';
import {operationDeadline} from '@/lib/operation-deadline';
import {appError,writeOperation} from '@/lib/app-workspace';
import './transfer-directions.css';
import './transfer-batch-form.css';
import './field-operation-date.css';
import {taipeiDate} from '@/lib/expiry-waste';

type Props={store:{id:string;name:string};userId:string;peers:{id:string;name:string}[];catalogs?:TransferCatalog[];units:string[];batchVersion?:number;loading:boolean;refresh:()=>Promise<unknown>;onBack:()=>void};
export default function TransferBatchForm({store,userId,peers,catalogs,units,batchVersion,loading,refresh,onBack}:Props){
 const key=`app-draft:${userId}:${store.id}:transfer-batch-v1`;
 const[draft,setDraft]=useState<BatchDraft>(emptyTransferBatch);const[ready,setReady]=useState(false);const[error,setError]=useState('');const[busy,setBusy]=useState(false);const[notice,setNotice]=useState('');
 const[open,setOpen]=useState(false);const[query,setQuery]=useState('');const[choices,setChoices]=useState<string[]>([]);const[composing,setComposing]=useState(false);
 const[addingProduct,setAddingProduct]=useState(false);const[newProducts,setNewProducts]=useState<FieldProduct[]>([]);
 const current=useRef(draft);const raw=useRef<string|null>(null);const lock=useRef(false);const alive=useRef(false);const search=useRef<HTMLInputElement>(null);
 const directions=transferDirections(store,peers);const direction=selectedTransferDirection(directions,draft,store.id);const products=[...new Map([...sourceTransferProducts(catalogs,direction?.from_store_id),...newProducts.filter(p=>p.store_id===direction?.from_store_id)].map(p=>[p.id,p])).values()];
 const capable=batchVersion===1&&Array.isArray(catalogs)&&directions.length===2;
 const today=taipeiDate();
 const frozen=busy||!!draft.pending;const disabled=frozen||!ready;
 useEffect(()=>{let active=true;alive.current=true;queueMicrotask(()=>{if(!active)return;try{
  const storage=workspaceStorage(userId);const saved=storage.getItem(key);const next=saved?readTransferBatch(saved):migrateSingleTransfer(storage.getItem(`app-draft:${userId}:${store.id}:transfer-guided`),storage.getItem(`app-request:${userId}:${store.id}:movement.transfer-create`),store.id);
  const text=JSON.stringify(next);storage.setItem(key,text);raw.current=text;current.current=next;setDraft(next);setReady(true);
 }catch{setError('無法讀取或保存調撥草稿，為避免遺失或重複建檔，暫不送出。請保留此頁並重新讀取。');}
 });return()=>{active=false;alive.current=false;};},[key,store.id,userId]);
 function persist(next:BatchDraft){
  const storage=workspaceStorage(userId);
  if(storage.getItem(key)!==raw.current)throw Error('TRANSFER_DRAFT_CHANGED');
  const text=JSON.stringify(next);storage.setItem(key,text);raw.current=text;current.current=next;if(alive.current)setDraft(next);
 }
 function edit(next:BatchDraft){if(lock.current||current.current.pending||!ready)return;try{persist(next);setError('');}catch{setError('草稿未能儲存，或已在另一個頁面變更。請先重新讀取，不要重複送出。');}}
 function changeLine(key:string,patch:Partial<BatchLine>){edit({...current.current,items:current.current.items.map(row=>row.key===key?{...row,...patch}:row)});}
 function changeDirection(option:typeof directions[number]){
  if(current.current.items.length&&!window.confirm('更換調撥方向會清除已選品項與數量，備註會保留。確定更換？'))return;
  edit({...current.current,from_store_id:option.from_store_id,to_store_id:option.to_store_id,items:[]});setChoices([]);setQuery('');setOpen(false);
 }
 function expand(){setQuery('');setChoices([]);setOpen(true);search.current?.focus();}
 function addSelected(){try{let next=current.current;for(const id of choices){const p=products.find(p=>p.id===id);if(p)next=addTransferProduct(next,p,crypto.randomUUID());}edit(next);setChoices([]);setQuery('');setOpen(false);}catch{setError(`一次最多 ${MAX_TRANSFER_ITEMS} 項。`);}}
 function addManual(){if(current.current.items.length>=MAX_TRANSFER_ITEMS){setError(`一次最多 ${MAX_TRANSFER_ITEMS} 項。`);return;}setAddingProduct(true);setOpen(false);}

 function nextBatch(saved:BatchDraft){
  persist({...emptyTransferBatch(),from_store_id:saved.from_store_id,to_store_id:saved.to_store_id,work_date:saved.work_date});
 }

 async function submit(next=false){
  if(lock.current||!ready||current.current.completed)return;
  let payload;
  try{if(!current.current.pending){if(!capable)throw Error('多品項調撥資料尚未備妥，請重新讀取。');const workDate=current.current.work_date??taipeiDate();if(!workDate||workDate>taipeiDate())throw Error('請選擇有效的調撥日期。');payload=transferBatchPayload({...current.current,work_date:workDate},products,directions);}}catch(e){setError((e as Error).message);return;}
  lock.current=true;setBusy(true);setError('');
  try{
   const saved=await submitTransferBatch({...current.current,work_date:current.current.work_date??payload?.work_date},payload,{
    recordingStoreId:store.id,requestId:()=>crypto.randomUUID(),persist,
    send:(data,id)=>operationDeadline(signal=>writeOperation(store.id,'movement.transfer-create',data,id,signal)),
   });
   if(alive.current){
    void refresh();
    if(next&&saved.completed){
     nextBatch(saved);
     setNotice(`已登記 ${saved.work_date} 的 ${saved.completed.count} 項調撥。`);
    }
   }
  }
  catch(e){if(alive.current){const message=(e as Error)?.message||'';setError(message==='INVALID_WORK_DATE'?'請選擇今天或更早的調撥日期。':message==='TRANSFER_DRAFT_CHANGED'?'草稿已在另一個頁面變更，請重新讀取後確認。':message==='UNCONFIRMED_TRANSFER'||current.current.pending?'尚未確認送出結果，內容已保留。請按「確認上次送出／重試」，系統會沿用同一筆請求，不重複建檔。':/TRANSFER_ITEM_(\d+)/.test(message)?`第 ${message.match(/TRANSFER_ITEM_(\d+)/)?.[1]} 項資料需要修正，本次沒有新增任何品項；請確認數量、單位與來源品項。`:appError(e));}}
  finally{lock.current=false;if(alive.current)setBusy(false);}
 }
 if(draft.completed)return <section className="shell-card transfer-batch-complete"><CheckCircle2 aria-hidden="true"/><h2>已登記 {draft.completed.count} 項調撥</h2><p>{draft.work_date && <>{draft.work_date}・</>}{direction?.label}</p><div className="result-list">{draft.completed.items.map(row=><div key={row.id}><span>{row.name}</span><strong>{row.quantity} {row.unit}</strong></div>)}</div><p>行政／後勤可逐項核對。</p>{error&&<p role="alert">{error}</p>}<button type="button" className="shell-primary full" onClick={()=>{try{nextBatch(draft);setError('');}catch{setError('無法建立新草稿，請重新讀取；剛才的調撥已登記。');}}}>新增下一批</button><button type="button" className="shell-secondary full" onClick={onBack}>返回借貸與調撥</button></section>;
 const term=query.trim().normalize('NFKC').toLocaleLowerCase();const matches=products.filter(p=>p.name.normalize('NFKC').toLocaleLowerCase().includes(term));
 return <form className="transfer-batch-form" onSubmit={e=>{e.preventDefault();if(!composing)void submit((e.nativeEvent as SubmitEvent | undefined)?.submitter?.getAttribute('value')==='next');}}>
  <section className="shell-card transfer-form"><h2>現場調撥登記</h2>
   <div className="field-operation-date">
    <label htmlFor="transfer-work-date">調撥日期</label>
    <WorkDayPicker id="transfer-work-date" label="調撥日期" value={draft.work_date??today} max={today}
      disabled={disabled} onChange={work_date=>edit({...current.current,work_date})}/>
   </div>
   <fieldset className="transfer-direction-options" disabled={disabled||!capable}><legend>調撥方向</legend>{directions.map(option=><label className="transfer-direction-option" data-selected={direction?.id===option.id} key={option.id}><input type="radio" name="transfer-direction" value={option.id} checked={direction?.id===option.id} onChange={()=>changeDirection(option)}/><span>{option.label}</span></label>)}</fieldset>
   {!capable&&<p role="alert">多品項調撥資料尚未備妥。<button type="button" className="text-button" disabled={loading} onClick={()=>void refresh()}>重新讀取</button></p>}
   <div className="transfer-batch-picker"><label htmlFor="transfer-batch-search">品項</label><div className="transfer-batch-search"><Search aria-hidden="true" size={20}/><input id="transfer-batch-search" ref={search} value={query} placeholder="搜尋或選擇品項" disabled={disabled||!direction||!capable} autoComplete="off" onFocus={()=>setOpen(true)} onCompositionStart={()=>setComposing(true)} onCompositionEnd={()=>setComposing(false)} onChange={e=>{setQuery(e.target.value);setOpen(true);}} onKeyDown={e=>{if(e.nativeEvent.isComposing)return;if(e.key==='Enter'){e.preventDefault();}if(e.key==='Escape'){setOpen(false);}}}/><button type="button" aria-label={open?'收合品項選單':'展開品項選單'} aria-expanded={open} disabled={disabled||!direction||!capable} onClick={()=>open?setOpen(false):expand()}><ChevronDown size={20}/></button></div>
    {open&&(matches.length>0||choices.length>0)&&<div className="transfer-batch-menu"><div className="transfer-batch-options" role="group" aria-label="勾選調撥品項">{matches.map(p=>{const added=draft.items.some(r=>r.product_id===p.id);return <label key={p.id}><input type="checkbox" checked={added||choices.includes(p.id)} disabled={disabled||added} onChange={()=>setChoices(prev=>prev.includes(p.id)?prev.filter(id=>id!==p.id):[...prev,p.id])}/><span>{p.name}</span><small>{added?'已加入':p.unit}</small></label>;})}</div><button type="button" className="shell-secondary full" disabled={disabled||!choices.length} onClick={addSelected}>加入已選品項（{choices.length} 項）</button></div>}
    {open&&!matches.length&&<div className="field-operation-no-results"><small>{term?'沒有符合的品項':'輸入品名以搜尋或新增'}</small>{term&&<button type="button" disabled={disabled} onClick={addManual}>＋ 新增「{query.trim()}」</button>}</div>}
   </div>
   <section className="transfer-batch-selected" aria-label="已選品項"><h3>已選品項（可一次送出多項）</h3>{!draft.items.length&&<p className="transfer-batch-empty">先選擇品項，再一起填寫數量。</p>}
    {draft.items.map((row,index)=><div className="transfer-batch-row" key={row.key}><div className="transfer-batch-name">{row.manual?<><small>手動輸入</small><input aria-label={`第 ${index+1} 項品名`} value={row.name} placeholder="品項名稱" maxLength={160} disabled={disabled} onChange={e=>changeLine(row.key,{name:e.target.value})}/></>:<strong>{row.name}</strong>}</div><input aria-label={`第 ${index+1} 項數量`} inputMode="decimal" type="number" min="0.000001" max="999999999" step="any" placeholder="數量" value={row.quantity} disabled={disabled} onChange={e=>changeLine(row.key,{quantity:e.target.value})}/><div role="group" aria-label={`第 ${index+1} 項單位`}><UnitSelect units={units} value={row.unit} disabled={disabled} onChange={unit=>changeLine(row.key,{unit})}/></div><button type="button" className="transfer-batch-remove" aria-label={`移除第 ${index+1} 項 ${row.name}`} disabled={disabled} onClick={()=>edit({...draft,items:draft.items.filter(r=>r.key!==row.key)})}><Trash2 size={21}/></button></div>)}
    {draft.items.length>0&&<button type="button" className="transfer-batch-add" disabled={disabled||!direction||!capable} onClick={expand}>＋ 繼續加入品項</button>}
   </section>
   <label className="transfer-batch-note"><span>備註（選填）</span><input value={draft.note} maxLength={200} placeholder="例如：支援活動、臨時調貨" disabled={disabled} onChange={e=>edit({...draft,note:e.target.value})}/></label>
  </section>
  <p className="shell-note">一次送出多個品項，行政／後勤之後再逐項核對數量、單價與金額。單位依現場填寫，不自動換算數量。</p>
  {error&&<p className="pilot-message" role="alert">{error}</p>}
  {draft.pending&&<p role="status">上次送出結果待確認；品項與方向暫時鎖定，重試不會重複建檔。</p>}
  {notice&&<p role="status">{notice}</p>}
  {draft.pending
   ? <button type="submit" className="shell-primary full" disabled={busy||!ready}>{busy?'送出中…':'確認上次送出／重試'}</button>
   : <div className="field-operation-actions transfer-batch-actions">
      <button type="submit" value="save" className="shell-primary" disabled={disabled||!capable||!direction||!draft.items.length}>{busy?'送出中…':`送出調撥登記（共 ${draft.items.length} 項）`}</button>
      <button type="submit" value="next" className="shell-secondary" disabled={disabled||!capable||!direction||!draft.items.length}>儲存並新增下一批</button>
     </div>}
 {addingProduct&&direction&&<FieldProductForm storeId={store.id} targetStoreId={direction.from_store_id} initialName={query.trim()} saveLabel="儲存並帶入調撥" onClose={()=>setAddingProduct(false)} onSaved={async p=>{persist(addTransferProduct(current.current,p,crypto.randomUUID()));setNewProducts(old=>[...old,p]);setAddingProduct(false);setQuery('');setChoices([]);void refresh();}}/>}
 </form>;
}
