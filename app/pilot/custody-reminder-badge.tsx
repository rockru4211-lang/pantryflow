'use client';
import {useEffect,useState} from 'react';
import {custodyStatus,custodyStatusLabel,matchingReminders,reminderLabel,type CustodyReminder,type ReminderTag} from '@/lib/custody-reminders';
import type {ReviewDraft} from '@/lib/receipt-review';
import {reminderRequest} from './custody-reminder-api';
import './custody-reminders.css';
export function useCustodyReminders(storeId:string){
 const [state,setState]=useState<{storeId:string;rows:CustodyReminder[];tags:ReminderTag[];error:string}>({storeId:'',rows:[],tags:[],error:''});
 useEffect(()=>{let active=true;let sequence=0;const refresh=()=>{if(!storeId)return;const request=++sequence;void reminderRequest(storeId).then(data=>{if(active&&sequence===request)setState({storeId,rows:data.rows,tags:data.tags||data.rows,error:''});}).catch(()=>{if(active&&sequence===request)setState({storeId,rows:[],tags:[],error:'寄庫提醒暫時無法載入，請重新整理。'});});};refresh();const timer=setInterval(()=>{if(document.visibilityState==='visible')refresh();},60000);window.addEventListener('focus',refresh);window.addEventListener('custody-reminder-change',refresh);return()=>{active=false;clearInterval(timer);window.removeEventListener('focus',refresh);window.removeEventListener('custody-reminder-change',refresh);};},[storeId]);
 return state.storeId===storeId?state:{storeId,rows:[],tags:[],error:''};
}
export function ReceiptReminderBadge({rows,line,supplier,editable,disabled,onChange}:{rows:CustodyReminder[];line:ReviewDraft['lines'][number];supplier:string;editable:boolean;disabled:boolean;onChange:(id:string)=>void}){
 const linked=rows.find(r=>r.id===line.custody_reminder_id),candidates=matchingReminders(rows,line,supplier);
 if(!linked&&!line.custody_reminder_id&&!candidates.length)return null;
 if(editable&&line.handling!=='CUSTODY_RELEASE')return <select className="reminder-picker" aria-label={`${line.product_name} 寄庫`} disabled={disabled} value={line.custody_reminder_id||''} onChange={e=>onChange(e.target.value)}><option value="">一般進貨</option>{[...new Map([...(linked?[linked]:[]),...candidates].map(r=>[r.id,r])).values()].map(r=><option key={r.id} value={r.id}>{reminderLabel(r.kind)} · 剩 {r.remaining} {r.unit}</option>)}{!linked&&line.custody_reminder_id&&<option value={line.custody_reminder_id}>{reminderLabel(line.custody_reminder_kind||'supplier')}</option>}</select>;
 const label=linked?.kind||line.custody_reminder_kind||(candidates.length===1?candidates[0].kind:undefined);
 return label?<span className="custody-reminder-tag">{reminderLabel(label)}</span>:null;
}
export function ProductReminderBadge({rows,name,unit}:{rows:ReminderTag[];name:string;unit:string}){
 const kinds=[...new Set(rows.filter(r=>r.name.normalize('NFKC').trim()===name.normalize('NFKC').trim()&&r.unit===unit).map(r=>reminderLabel(r.kind)))];
 return <>{kinds.map(k=><span key={k} className="custody-reminder-tag" title="此品項有供應商寄庫提醒；調撥、廢棄不扣供應商餘量。">{reminderLabel(k)}</span>)}</>;
}

export function CountCustodyHint({rows,productId}:{rows:CustodyReminder[];productId:string}){
 const matches=rows.filter(r=>r.product_id===productId);if(!matches.length)return null;
 return <div className="count-custody-hint" aria-label="供應商寄庫餘量，不計入現場盤點">{matches.map(r=>{const status=custodyStatus(r);return <span key={r.id} title={`${r.supplier}・寄庫量不計入現場盤點`}>{matches.length>1&&`${r.supplier}・`}寄庫 {r.remaining.toLocaleString('zh-TW')} {r.unit}{r.order&&<><b className="custody-status">{custodyStatusLabel(status)}</b><small>{r.order.expected_on?`預計 ${r.order.expected_on}`:'交期待確認'}</small></>}</span>;})}</div>;
}
