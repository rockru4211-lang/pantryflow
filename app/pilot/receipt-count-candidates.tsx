'use client';

import {useCallback,useEffect,useRef,useState} from 'react';
import {inventoryCostRatio} from '@/lib/inventory-cost';
import {matchText} from '@/lib/receipt-ingredient-matching';
import {receiptCountCandidates,receiptCandidateError,type ReceiptCountCandidate,type ReceiptCountCandidates,type ReceiptCountTarget} from '@/lib/receipt-count-candidates';
import WorkspaceEditDialog from './workspace-edit-dialog';
import './receipt-count-candidates.css';

export default function ReceiptCountCandidatesNotice({storeId,month,onAdded,drawer=false}:{storeId:string;month?:string;onAdded?:()=>void;drawer?:boolean}){
 const [data,setData]=useState<ReceiptCountCandidates|null>(null);
 const [open,setOpen]=useState(false);
 const [ids,setIds]=useState<string[]>([]);
 const [zone,setZone]=useState('');
 const [query,setQuery]=useState('');
 const [error,setError]=useState('');
 const [busy,setBusy]=useState(false);
 const [notice,setNotice]=useState('');
 const [matching,setMatching]=useState<ReceiptCountCandidate|null>(null);
 const [targets,setTargets]=useState<ReceiptCountTarget[]|null>(null);
 const [matchQuery,setMatchQuery]=useState('');
 const [targetId,setTargetId]=useState('');
 const [remember,setRemember]=useState(true);
 const [matchError,setMatchError]=useState('');
 const lock=useRef(false),alive=useRef(true);
 const retry=useRef<{key:string;id:string}|null>(null);
 const flight=useRef<AbortController|null>(null),optionsFlight=useRef<AbortController|null>(null);
 const refresh=useCallback(async()=>{
  flight.current?.abort();
  const controller=new AbortController();
  flight.current=controller;
  try{
   const next=await receiptCountCandidates(storeId,'list',month?{month}:{},null,controller.signal);
   if(controller.signal.aborted)return;
   setData(next);
   setIds(old=>old.filter(id=>next.rows.some(r=>r.id===id)));
   setError('');
  }catch(e){if(!controller.signal.aborted)setError(receiptCandidateError(e));}
 },[storeId,month]);
 useEffect(()=>{
  alive.current=true;
  void Promise.resolve().then(()=>{if(alive.current)return refresh();});
  const wake=()=>{if(!lock.current)void refresh();};
  window.addEventListener('focus',wake);
  window.addEventListener('custody-reminder-change',wake);
  return()=>{
   alive.current=false;
   flight.current?.abort();
   optionsFlight.current?.abort();
   window.removeEventListener('focus',wake);
   window.removeEventListener('custody-reminder-change',wake);
  };
 },[refresh]);

 const target=targets?.find(item=>item.id===targetId);
 const purchaseUnit=matching?.purchase_unit||matching?.unit||'';
 const needsConversion=!!target&&target.units.some(unit=>inventoryCostRatio(purchaseUnit,unit)!==1);
 const knownSupplier=!!matching?.supplier?.trim()&&!['未提供','供應商未提供'].includes(matching.supplier.trim());
 const canRemember=!!target?.can_remember&&knownSupplier;
 function backToList(){
  optionsFlight.current?.abort();
  setMatching(null);
  setMatchError('');
 }
 function close(){
  backToList();
  setOpen(false);
 }
 async function loadTargets(){
  optionsFlight.current?.abort();
  const controller=new AbortController();
  optionsFlight.current=controller;
  setTargets(null);
  setMatchError('');
  try{
   const result=await receiptCountCandidates(storeId,'match-options',{},null,controller.signal);
   if(!controller.signal.aborted)setTargets(result.items);
  }catch(e){if(!controller.signal.aborted)setMatchError(receiptCandidateError(e));}
 }
 function openMatch(row:ReceiptCountCandidate){
  setMatching(row);
  setTargetId('');
  setRemember(true);
  const term=(row.receipt_name||row.name).replace(/\s*[（(][^）)]+[）)]\s*$/u,'').trim();
  setMatchQuery(term);
  void loadTargets();
 }
 async function save(action:'add'|'dismiss'|'match'){
  if(lock.current)return;
  let payload:Record<string,unknown>;
  if(action==='match'){
   if(!matching?.revision||!target||!data?.editable)return;
   payload={source_id:matching.id,source_revision:matching.revision,target_id:target.id,target_revision:target.revision,remember:remember&&canRemember};
  }else{
   if(!ids.length||!data?.editable)return;
   if(action==='add'&&!zone){setError('請先選擇儲物區。');return;}
   payload={ids:[...ids].sort(),...(action==='add'?{zone_id:zone}:{})};
  }
  if(month)payload={...payload,month};
  const key=JSON.stringify({storeId,action,payload});
  if(retry.current?.key!==key)retry.current={key,id:crypto.randomUUID()};
  lock.current=true;
  setBusy(true);
  setError('');
  setMatchError('');
  try{
   await receiptCountCandidates(storeId,action,payload,retry.current.id);
   if(!alive.current)return;
   retry.current=null;
   if(action==='match'&&matching&&target){
    setNotice((matching.receipt_name||matching.name)+' 已配對至「'+target.name+'」。'+(needsConversion?'換算待核。':''));
    setIds(old=>old.filter(id=>id!==matching.id));
    backToList();
   }else{
    setNotice(action==='add'?'已加入 '+ids.length+' 項至盤點。':'已將 '+ids.length+' 項標記為不需盤點。');
    setIds([]);
   }
   await refresh();
   if(alive.current&&action!=='dismiss')onAdded?.();
  }catch(e){
   if(alive.current)(action==='match'?setMatchError:setError)(receiptCandidateError(e));
  }finally{
   lock.current=false;
   if(alive.current)setBusy(false);
  }
 }

 const count=data?.rows.length||0;
 if(!open&&!count&&!error&&!notice)return null;
 const visible=data?.rows.filter(row=>matchText([row.receipt_name,row.name,row.supplier,row.specification].filter(Boolean).join(' ')).includes(matchText(query)))||[];
 const options=targets?.filter(item=>matchText([item.name,item.supplier,item.code,item.specification].join(' ')).includes(matchText(matchQuery)))||[];
 const list=<>
  {drawer&&notice&&<p className="receipt-count-note" role="status">{notice}</p>}
  {error&&<p role="alert" className="receipt-count-note">{error} <button type="button" className="text-button" disabled={busy} onClick={()=>void refresh()}>重新讀取</button></p>}
  {!!count&&<>
   <input type="search" data-initial-focus aria-label="搜尋待加入盤點品項" placeholder="搜尋品項或供應商" value={query} disabled={busy} onChange={e=>setQuery(e.target.value)}/>
   <div className="receipt-count-candidates-list">{visible.map(row=>{
    const name=drawer?row.receipt_name||row.name:row.name;
    return <div className="receipt-count-candidate-row" key={row.id}>
     <label><input type="checkbox" aria-label={'選取 '+name} checked={ids.includes(row.id)} disabled={busy||!data?.editable}
      onChange={e=>setIds(old=>e.target.checked?[...old,row.id]:old.filter(id=>id!==row.id))}/>
      <span><strong>{name}</strong><small>{[row.supplier||'供應商未提供',drawer?row.purchase_unit||row.unit:row.unit,row.specification,row.receipt_date].filter(Boolean).join(' · ')}</small></span>
     </label>
     {drawer&&data?.editable&&row.revision&&<button type="button" className="receipt-count-secondary" aria-label={'配對既有品項 '+name}
      disabled={busy} onClick={()=>openMatch(row)}>配對既有品項</button>}
    </div>;
   })}{!visible.length&&<p>沒有符合的品項。</p>}</div>
   {data?.editable?<div className="receipt-count-candidates-actions">
    <span>已選 {ids.length} 項</span>
    <select aria-label="新品加入儲物區" value={zone} disabled={busy} onChange={e=>setZone(e.target.value)}>
     <option value="">選擇儲物區</option>{data.zones.map(z=> <option key={z.id} value={z.id}>{z.name}</option>)}
    </select>
    <button type="button" className="shell-primary" disabled={busy||!ids.length||!zone} onClick={()=>void save('add')}>加入盤點</button>
    <button type="button" className="text-button" disabled={busy||!ids.length} onClick={()=>void save('dismiss')}>不需盤點</button>
    {!data.zones.length&&<small>請先在盤點設定建立儲物區，再回來加入。</small>}
   </div>:<small>請由有盤點設定權限的人員加入儲物區。</small>}
  </>}
  {!count&&!error&&<p className="receipt-count-note">目前沒有待選儲物區的品項。</p>}
 </>;
 if(!drawer)return <div className="receipt-count-candidates">
  {notice&&<p role="status">{notice}</p>}
  {!!count&&<button type="button" className="text-button" aria-expanded={open} disabled={busy} onClick={()=>setOpen(!open)}>
   有 {count} 項進貨品項待選儲物區 · {open?'收起':'查看'}
  </button>}
  {open&&<div className="receipt-count-candidates-body">{list}</div>}
  {!open&&error&&<p role="alert">{error} <button type="button" className="text-button" disabled={busy} onClick={()=>void refresh()}>重新讀取</button></p>}
 </div>;

 return <div className="receipt-count-entry">
  <button type="button" className="receipt-count-trigger" aria-haspopup="dialog" aria-expanded={open} disabled={busy} onClick={()=>setOpen(true)}>
   待選儲物區 {count>0&&<span>{count}</span>}
  </button>
  {open&&<WorkspaceEditDialog side title={matching?'配對既有品項':'待選儲物區'} busy={busy} onClose={close}>
   <div className="receipt-count-drawer">
    {matching?<>
     <div className="receipt-count-source"><small>貨單品名</small><strong>{matching.receipt_name||matching.name}</strong>
      <span>{[matching.supplier,purchaseUnit,matching.specification].filter(Boolean).join(' · ')}</span>
     </div>
     <label className="receipt-count-match-search">選擇盤點品項
      <input type="search" data-initial-focus value={matchQuery} placeholder="搜尋品名或品號" disabled={busy}
       onChange={e=>setMatchQuery(e.target.value)}/>
     </label>
     {matchError&&<p role="alert" className="receipt-count-note">{matchError} {!targets&&<button type="button" className="text-button" onClick={()=>void loadTargets()}>重新讀取</button>}</p>}
     <div className="receipt-count-matches" aria-label="既有盤點品項">
      {!targets&&!matchError&&<p role="status">讀取盤點品項中…</p>}
      {targets&&!options.length&&<p>沒有符合的品項。</p>}
      {options.map(item=>{
       const sameUnit=item.units.every(unit=>inventoryCostRatio(purchaseUnit,unit)===1);
       const sameSupplier=knownSupplier&&matchText(item.supplier)===matchText(matching.supplier||'');
       return <label key={item.id} className="receipt-count-match-option" data-selected={item.id===targetId}>
        <input type="radio" name="receipt-count-target" aria-label={item.name} checked={item.id===targetId} disabled={busy} onChange={()=>setTargetId(item.id)}/>
        <span><strong>{item.name}</strong>
         <small>{[item.supplier,item.units.join('、'),item.specification,item.code].filter(Boolean).join(' · ')}</small>
         {item.id===targetId&&!sameUnit&&<small className="receipt-count-unit-pending">{purchaseUnit} → {item.units.join('、')}，換算待核</small>}
        </span>
        {sameSupplier&&sameUnit&&<small className="receipt-count-same">同供應商、同單位</small>}
       </label>;
      })}
     </div>
     <label className="receipt-count-remember"><input type="checkbox" checked={canRemember&&remember} disabled={!canRemember||busy}
      onChange={e=>setRemember(e.target.checked)}/>記住此供應商的進貨別名</label>
     <footer className="receipt-count-candidates-actions">
      <button type="button" className="receipt-count-secondary" disabled={busy} onClick={backToList}>取消</button>
      <button type="button" className="shell-primary" disabled={busy||!target||!data?.editable} onClick={()=>void save('match')}>確認配對</button>
     </footer>
    </>:list}
   </div>
  </WorkspaceEditDialog>}
 </div>;
}
