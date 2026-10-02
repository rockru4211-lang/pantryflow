'use client';
import {useEffect,useRef,useState} from 'react';
import {Search,ChevronDown,Trash2,CheckCircle2} from 'lucide-react';
import UnitSelect from './unit-select';
import {transferDirections,selectedTransferDirection,sourceTransferProducts,type TransferCatalog} from '@/lib/transfer-direction';
import {addTransferProduct,emptyTransferBatch,migrateSingleTransfer,readTransferBatch,submitTransferBatch,transferBatchPayload,MAX_TRANSFER_ITEMS,type BatchDraft,type BatchLine} from '@/lib/transfer-batch';
import {workspaceStorage} from '@/lib/workspace-storage';
import {operationDeadline} from '@/lib/operation-deadline';
import {appError,writeOperation} from '@/lib/app-workspace';
import './transfer-directions.css';
import './transfer-batch-form.css';

type Props={store:{id:string;name:string};userId:string;peers:{id:string;name:string}[];catalogs?:TransferCatalog[];units:string[];batchVersion?:number;loading:boolean;refresh:()=>Promise<unknown>;onBack:()=>void};
export default function TransferBatchForm({store,userId,peers,catalogs,units,batchVersion,loading,refresh,onBack}:Props){
 const key=`app-draft:${userId}:${store.id}:transfer-batch-v1`;
 const[draft,setDraft]=useState<BatchDraft>(emptyTransferBatch);const[ready,setReady]=useState(false);const[error,setError]=useState('');const[busy,setBusy]=useState(false);
 const[open,setOpen]=useState(false);const[query,setQuery]=useState('');const[choices,setChoices]=useState<string[]>([]);const[composing,setComposing]=useState(false);
 const current=useRef(draft);const raw=useRef<string|null>(null);const lock=useRef(false);const alive=useRef(false);const search=useRef<HTMLInputElement>(null);
 const directions=transferDirections(store,peers);const direction=selectedTransferDirection(directions,draft,store.id);const products=sourceTransferProducts(catalogs,direction?.from_store_id);
 const capable=batchVersion===1&&Array.isArray(catalogs)&&directions.length===2;
 const frozen=busy||!!draft.pending;const disabled=frozen||!ready;
 useEffect(()=>{alive.current=true;try{
  const storage=workspaceStorage(userId);const saved=storage.getItem(key);const next=saved?readTransferBatch(saved):migrateSingleTransfer(storage.getItem(`app-draft:${userId}:${store.id}:transfer-guided`),storage.getItem(`app-request:${userId}:${store.id}:movement.transfer-create`),store.id);
  const text=JSON.stringify(next);storage.setItem(key,text);raw.current=text;current.current=next;setDraft(next);setReady(true);
 }catch{setError('無法讀取或保存調撥草稿，為避免遺失或重複建檔，暫不送出。請保留此頁並重新讀取。');}
 return()=>{alive.current=false;};},[key,store.id,userId]);
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
 function addManual(){if(current.current.items.length>=MAX_TRANSFER_ITEMS){setError(`一次最多 ${MAX_TRANSFER_ITEMS} 項。`);return;}edit({...current.current,items:[...current.current.items,{key:crypto.randomUUID(),product_id:'',name:query.trim(),quantity:'',unit:'',manual:true}]});setQuery('');setChoices([]);setOpen(false);}
 async function submit(){
  if(lock.current||!ready||current.current.completed)return;
  let payload;
  try{if(!current.current.pending){if(!capable)throw Error('多品項調撥資料尚未備妥，請重新讀取。');payload=transferBatchPayload(current.current,products,directions);}}catch(e){setError((e as Error).message);return;}
  lock.current=true;setBusy(true);setError('');
  try{await submitTransferBatch(current.current,payload,{recordingStoreId:store.id,requestId:()=>crypto.randomUUID(),persist,send:(data,id)=>operationDeadline(signal=>writeOperation(store.id,'movement.transfer-create',data,id,signal))});if(alive.current)void refresh();}
  catch(e){if(alive.current){const message=(e as Error)?.message||'';setError(message==='TRANSFER_DRAFT_CHANGED'?'草稿已在另一個頁面變更，請重新讀取後確認。':message==='UNCONFIRMED_TRANSFER'||current.current.pending?'尚未確認送出結果，內容已保留。請按「確認上次送出／重試」，系統會沿用同一筆請求，不重複建檔。':/TRANSFER_ITEM_(\d+)/.test(message)?`第 ${message.match(/TRANSFER_ITEM_(\d+)/)?.[1]} 項資料需要修正，本次沒有新增任何品項；請確認數量、單位與來源品項。`:appError(e));}}
  finally{lock.current=false;if(alive.current)setBusy(false);}
 }
 if(draft.completed)return <section className="shell-card transfer-batch-complete"><CheckCircle2 aria-hidden="true"/><h2>已登記 {draft.completed.count} 項調撥</h2><p>{direction?.label}</p><div className="result-list">{draft.completed.items.map(row=><div key={row.id}><span>{row.name}</span><strong>{row.quantity} {row.unit}</strong></div>)}</div><p>行政／後勤可逐項核對。</p>{error&&<p role="alert">{error}</p>}<button type="button" className="shell-primary full" onClick={()=>{try{persist({...emptyTransferBatch(),from_store_id:draft.from_store_id,to_store_id:draft.to_store_id});setError('');}catch{setError('無法建立新草稿，請重新讀取；剛才的調撥已登記。');}}}>再登記一批</button><button type="button" className="shell-secondary full" onClick={onBack}>返回借貸與調撥</button></section>;
 const term=query.trim().normalize('NFKC').toLocaleLowerCase();const matches=products.filter(p=>p.name.normalize('NFKC').toLocaleLowerCase().includes(term));
 return <form className="transfer-batch-form" onSubmit={e=>{e.preventDefault();if(!composing)void submit();}}>
  <section className="shell-card transfer-form"><h2>現場調撥登記</h2>
   <fieldset className="transfer-direction-options" disabled={disabled||!capable}><legend>調撥方向</legend>{directions.map(option=><label className="transfer-direction-option" data-selected={direction?.id===option.id} key={option.id}><input type="radio" name="transfer-direction" value={option.id} checked={direction?.id===option.id} onChange={()=>changeDirection(option)}/><span>{option.label}</span></label>)}</fieldset>
   {!capable&&<p role="alert">多品項調撥資料尚未備妥。<button type="button" className="text-button" disabled={loading} onClick={()=>void refresh()}>重新讀取</button></p>}
   <div className="transfer-batch-picker"><label htmlFor="transfer-batch-search">品項</label><div className="transfer-batch-search"><Search aria-hidden="true" size={20}/><input id="transfer-batch-search" ref={search} value={query} placeholder="搜尋或選擇品項" disabled={disabled||!direction||!capable} autoComplete="off" onFocus={()=>setOpen(true)} onCompositionStart={()=>setComposing(true)} onCompositionEnd={()=>setComposing(false)} onChange={e=>{setQuery(e.target.value);setOpen(true);}} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();}if(e.key==='Escape'){setOpen(false);}}}/><button type="button" aria-label={open?'收合品項選單':'展開品項選單'} aria-expanded={open} disabled={disabled||!direction||!capable} onClick={()=>open?setOpen(false):expand()}><ChevronDown size={20}/></button></div>
    {open&&<div className="transfer-batch-menu"><div className="transfer-batch-options" role="group" aria-label="勾選調撥品項">{matches.map(p=>{const added=draft.items.some(r=>r.product_id===p.id);return <label key={p.id}><input type="checkbox" checked={added||choices.includes(p.id)} disabled={disabled||added} onChange={()=>setChoices(prev=>prev.includes(p.id)?prev.filter(id=>id!==p.id):[...prev,p.id])}/><span>{p.name}</span><small>{added?'已加入':p.unit}</small></label>;})}{!matches.length&&<p>找不到符合的品項</p>}</div><button type="button" className="shell-secondary full" disabled={disabled||!choices.length} onClick={addSelected}>加入已選品項（{choices.length} 項）</button><button type="button" className="transfer-batch-add" disabled={disabled} onClick={addManual}>＋ 找不到品項？手動輸入</button></div>}
   </div>
   <section className="transfer-batch-selected" aria-label="已選品項"><h3>已選品項（可一次送出多項）</h3>{!draft.items.length&&<p className="transfer-batch-empty">先選擇品項，再一起填寫數量。</p>}
    {draft.items.map((row,index)=><div className="transfer-batch-row" key={row.key}><div className="transfer-batch-name">{row.manual?<><small>手動輸入</small><input aria-label={`第 ${index+1} 項品名`} value={row.name} placeholder="品項名稱" maxLength={160} disabled={disabled} onChange={e=>changeLine(row.key,{name:e.target.value})}/></>:<strong>{row.name}</strong>}</div><input aria-label={`第 ${index+1} 項數量`} inputMode="decimal" type="number" min="0.000001" max="999999999" step="any" placeholder="數量" value={row.quantity} disabled={disabled} onChange={e=>changeLine(row.key,{quantity:e.target.value})}/><div role="group" aria-label={`第 ${index+1} 項單位`}><UnitSelect units={units} value={row.unit} disabled={disabled} onChange={unit=>changeLine(row.key,{unit})}/></div><button type="button" className="transfer-batch-remove" aria-label={`移除第 ${index+1} 項 ${row.name}`} disabled={disabled} onClick={()=>edit({...draft,items:draft.items.filter(r=>r.key!==row.key)})}><Trash2 size={21}/></button></div>)}
    <button type="button" className="transfer-batch-add" disabled={disabled||!direction||!capable} onClick={expand}>＋ 繼續加入品項</button><button type="button" className="transfer-batch-add" disabled={disabled||!direction||!capable} onClick={addManual}>＋ 找不到品項？手動輸入</button>
   </section>
   <label className="transfer-batch-note"><span>備註（選填）</span><input value={draft.note} maxLength={200} placeholder="例如：支援活動、臨時調貨" disabled={disabled} onChange={e=>edit({...draft,note:e.target.value})}/></label>
  </section>
  <p className="shell-note">一次送出多個品項，行政／後勤之後再逐項核對數量、單價與金額。單位依現場填寫，不自動換算數量。</p>
  {error&&<p className="pilot-message" role="alert">{error}</p>}
  {draft.pending&&<p role="status">上次送出結果待確認；品項與方向暫時鎖定，重試不會重複建檔。</p>}
  <button type="submit" className="shell-primary full" disabled={busy||!ready||(!draft.pending&&(!capable||!direction||!draft.items.length))}>{busy?'送出中…':draft.pending?'確認上次送出／重試':`送出調撥登記（共 ${draft.items.length} 項）`}</button>
 </form>;
}
