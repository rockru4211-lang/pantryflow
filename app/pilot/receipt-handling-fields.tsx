'use client';
import {useEffect,useState} from 'react';
import {supabase} from '@/lib/supabase-browser';
import {receiptHandling,receiptHandlingLabels,isFreightName,type ReviewDraft} from '@/lib/receipt-review';
import type {CustodyState} from '@/lib/custody';
import './receipt-handling.css';
type Props={storeId:string;line:ReviewDraft['lines'][number];editing:boolean;disabled:boolean;onChange:(key:string,value:string)=>void};
export default function ReceiptHandlingFields({storeId,line,editing,disabled,onChange}:Props){
 const handling=receiptHandling(line),[state,setState]=useState<CustodyState|null>(null),[error,setError]=useState('');
 useEffect(()=>{if(!editing||handling!=='CUSTODY_RELEASE'||line.custody_posted)return;let live=true;void supabase.rpc('baihuayuan_custody',{p_store_id:storeId,p_kind:'supplier',p_action:'read'}).then(({data,error})=>{if(!live)return;if(error)setError('寄庫批次讀取失敗，請關閉編輯後重試。');else{setState(data as unknown as CustodyState);setError('');}});return()=>{live=false;};},[storeId,editing,handling,line.custody_posted]);
 const accounts=state?.accounts.filter(a=>a.unit===line.unit)||[],account=accounts.find(a=>a.lots.some(l=>l.id===line.custody_lot_id)),lot=account?.lots.find(l=>l.id===line.custody_lot_id);
 return <div className={`receipt-handling receipt-handling-${handling.toLowerCase()}`}>
  {editing?<select aria-label={`${line.product_name} 歸屬`} value={handling} disabled={disabled||line.custody_posted} onChange={e=>onChange('handling',e.target.value)}>{Object.entries(receiptHandlingLabels).map(([v,label])=><option value={v} key={v}>{label}</option>)}</select>:handling!=='NORMAL'&&<span className="receipt-handling-badge">{receiptHandlingLabels[handling]}</span>}
  {handling==='NORMAL'&&editing&&isFreightName(line.product_name)&&<button type="button" className="text-button" disabled={disabled} onClick={()=>onChange('handling','FREIGHT')}>設為運費</button>}
  {handling==='FREIGHT'&&<small>計入對帳，不加入食材價格與盤點。</small>}
  {handling==='CUSTODY_RELEASE'&&<><small>本次不計款；保留原採購成本。</small>{line.custody_posted?<small>已關聯領貨紀錄 · {line.custody_reference||'寄庫批次'}</small>:editing?<>
   <select aria-label={`${line.product_name} 寄庫批次`} value={line.custody_lot_id||''} disabled={disabled||!state} onChange={e=>{onChange('custody_lot_id',e.target.value);onChange('custody_event_id','');}}><option value="">關聯原採購／寄庫批次</option>{accounts.map(a=><optgroup key={a.id} label={`${a.party} · ${a.name}`}>{a.lots.map(l=><option key={l.id} value={l.id}>{l.label} · 剩 {l.remaining} {a.unit}{l.reference?` · ${l.reference}`:''}</option>)}</optgroup>)}</select>
   {lot&&<><small>原採購：{lot.reference||lot.label}</small><select aria-label={`${line.product_name} 領貨方式`} value={line.custody_event_id||''} disabled={disabled} onChange={e=>onChange('custody_event_id',e.target.value)}><option value="">尚未登記：送入對帳時登記領回</option>{account?.events.filter(e=>e.action==='collect'&&e.lot_id===lot.id&&e.quantity===Number(line.quantity)).map(e=><option key={e.id} value={e.id}>已登記：{e.occurred_on} · {e.quantity} {line.unit} · {e.handler}</option>)}</select><small>{line.custody_event_id?'關聯既有領貨，不重複扣寄庫或入庫。':`確認後：到店 +${line.quantity} ${line.unit}／寄庫 −${line.quantity} ${line.unit}`}</small></>}
   {state&&!accounts.length&&<small>尚無相同單位的寄庫資料，請先至「庫存管理 → 供應商寄庫」建立原採購批次。</small>}{error&&<small role="alert">{error}</small>}
  </>:<small>待確認領貨批次</small>}</>}
 </div>;
}
