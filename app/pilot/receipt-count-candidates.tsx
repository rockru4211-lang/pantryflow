'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {receiptCountCandidates,receiptCandidateError,type ReceiptCountCandidates} from '@/lib/receipt-count-candidates';
import './receipt-count-candidates.css';
export default function ReceiptCountCandidatesNotice({storeId,onAdded}:{storeId:string;onAdded?:()=>void}){
 const [data,setData]=useState<ReceiptCountCandidates|null>(null),[open,setOpen]=useState(false),[ids,setIds]=useState<string[]>([]),[zone,setZone]=useState(''),[query,setQuery]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const lock=useRef(false),alive=useRef(true),retry=useRef<{key:string;id:string}|null>(null),flight=useRef<AbortController|null>(null);
 const refresh=useCallback(async()=>{flight.current?.abort();const controller=new AbortController();flight.current=controller;try{const next=await receiptCountCandidates(storeId,'list',{},null,controller.signal);if(!controller.signal.aborted){setData(next);setIds(old=>old.filter(id=>next.rows.some(r=>r.id===id)));setError('');}}catch(e){if(!controller.signal.aborted)setError(receiptCandidateError(e));}},[storeId]);
 useEffect(()=>{alive.current=true;void Promise.resolve().then(()=>{if(alive.current)return refresh();});const wake=()=>{if(!lock.current)void refresh();};window.addEventListener('focus',wake);window.addEventListener('custody-reminder-change',wake);return()=>{alive.current=false;flight.current?.abort();window.removeEventListener('focus',wake);window.removeEventListener('custody-reminder-change',wake);};},[refresh]);
 async function save(action:'add'|'dismiss'){
  if(lock.current||!ids.length)return;if(action==='add'&&!zone){setError('請先選擇儲物區。');return;}
  const payload={ids:[...ids].sort(),...(action==='add'?{zone_id:zone}:{})},key=JSON.stringify({storeId,action,payload});if(retry.current?.key!==key)retry.current={key,id:crypto.randomUUID()};
  lock.current=true;setBusy(true);setError('');
  try{await receiptCountCandidates(storeId,action,payload,retry.current.id);if(!alive.current)return;retry.current=null;setNotice(action==='add'?`已加入 ${ids.length} 項至盤點。`:`已將 ${ids.length} 項標記為不需盤點。`);setIds([]);await refresh();if(action==='add')onAdded?.();}
  catch(e){if(alive.current)setError(receiptCandidateError(e));}finally{lock.current=false;if(alive.current)setBusy(false);}
 }
 if(!data&&!error)return null;
 if(data&&!data.rows.length&&!error&&!notice)return null;
 const visible=data?.rows.filter(r=>`${r.name} ${r.supplier||''} ${r.specification}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))||[];
 return <div className="receipt-count-candidates">
  {notice&&<p role="status">{notice}</p>}
  {!!data?.rows.length&&<button type="button" className="text-button" aria-expanded={open} disabled={busy} onClick={()=>setOpen(v=>!v)}>有 {data.rows.length} 項進貨品項尚未加入盤點 · {open?'收起':'查看'}</button>}
  {error&&<p role="alert">{error} <button type="button" className="text-button" disabled={busy} onClick={()=>void refresh()}>重新讀取</button></p>}
  {open&&!!data?.rows.length&&<div className="receipt-count-candidates-body">
   <input aria-label="搜尋待加入盤點品項" placeholder="搜尋品項／供應商" value={query} disabled={busy} onChange={e=>setQuery(e.target.value)}/>
   <div className="receipt-count-candidates-list">{visible.map(r=><label key={r.id}><input type="checkbox" aria-label={`選取 ${r.name}`} checked={ids.includes(r.id)} disabled={busy||!data.editable} onChange={e=>setIds(old=>e.target.checked?[...old,r.id]:old.filter(id=>id!==r.id))}/><span><strong>{r.name}</strong><small>{r.supplier||'供應商未提供'} · {r.unit}{r.specification?` · ${r.specification}`:''} · {r.receipt_date}</small></span></label>)}{!visible.length&&<p>沒有符合的品項。</p>}</div>
   {data.editable?<div className="receipt-count-candidates-actions"><span>已選 {ids.length} 項</span><select aria-label="新品加入儲物區" value={zone} disabled={busy} onChange={e=>setZone(e.target.value)}><option value="">選擇儲物區</option>{data.zones.map(z=><option key={z.id} value={z.id}>{z.name}</option>)}</select><button type="button" className="shell-primary" disabled={busy||!ids.length||!zone} onClick={()=>void save('add')}>加入盤點</button><button type="button" className="text-button" disabled={busy||!ids.length} onClick={()=>void save('dismiss')}>不需盤點</button>{!data.zones.length&&<small>請先在盤點設定建立儲物區，再回來加入。</small>}</div>:<small>請由有盤點設定權限的人員加入儲物區。</small>}
  </div>}
 </div>;
}
