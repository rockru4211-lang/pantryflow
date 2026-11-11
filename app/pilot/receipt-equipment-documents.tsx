'use client';

import {useEffect,useState} from 'react';
import {accountMoney} from '@/lib/receipt-accounting';
import {readScopedReceiptAccounts} from '@/lib/receipt-accounting-api';
import {receiptDocumentTypes,type ReviewAccount} from '@/lib/receipt-review';
import ReceiptOriginalDialog from './receipt-original-dialog';

export default function ReceiptEquipmentDocuments({storeId}:{storeId:string}){
 const currentYear=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Taipei'}).slice(0,4);
 const [year,setYear]=useState(currentYear),[query,setQuery]=useState('');
 const [rows,setRows]=useState<ReviewAccount[]>([]);
 const [status,setStatus]=useState<'loading'|'ready'|'error'>('loading');
 const [retry,setRetry]=useState(0),[original,setOriginal]=useState('');
 useEffect(()=>{
  const controller=new AbortController();
  void readScopedReceiptAccounts(storeId,controller.signal,year?year+'-01-01':'',year?year+'-12-31':'','ALL').then(accounts=>{
   if(!controller.signal.aborted){setRows(accounts.filter(row=>row.record_state==='LIVE'&&row.review_completed&&row.receipt_entry_metadata?.equipment));setStatus('ready');}
  }).catch(()=>{if(!controller.signal.aborted)setStatus('error');});
  return()=>controller.abort();
 },[storeId,year,retry]);
 const visible=rows.filter(row=>{
  const details=row.receipt_entry_metadata?.equipment;
  return `${details?.name} ${row.supplier_name} ${row.note} ${details?.model}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
 }).sort((a,b)=>(b.receipt_date||'').localeCompare(a.receipt_date||''));
 return <>
  <div className="repair-tools">
   <label className="repair-search"><input type="search" placeholder="搜尋設備或廠商" aria-label="搜尋設備單據" value={query} onChange={e=>setQuery(e.target.value)}/></label>
   <select aria-label="單據年份" value={year} onChange={e=>{setStatus('loading');setYear(e.target.value);}}>
    <option value={currentYear}>{currentYear} 年</option><option value={String(Number(currentYear)-1)}>{Number(currentYear)-1} 年</option><option value="">全部年份</option>
   </select>
  </div>
  {status==='loading'?<p role="status">讀取設備單據中…</p>:status==='error'?<p role="alert">設備單據暫時無法讀取。<button type="button" className="text-button" onClick={()=>{setStatus('loading');setRetry(n=>n+1);}}>重試</button></p>:visible.length?<div className="repair-table-wrap"><table>
   <thead><tr><th>日期</th><th>設備</th><th>單據性質</th><th>供應商</th><th>金額</th><th>原單</th></tr></thead>
   <tbody>{visible.map(row=>{
    const details=row.receipt_entry_metadata?.equipment;
    return details&&<tr key={row.batch_id}>
     <td>{details.date||row.receipt_date}</td>
     <td>{details.name}{details.model&&<small>{details.model}</small>}{details.warranty_until&&<small>保固至 {details.warranty_until}</small>}{row.note&&<small>{row.note}</small>}</td>
     <td>{receiptDocumentTypes[details.kind]}</td><td>{row.supplier_name}</td><td>{accountMoney(row.total)}</td>
     <td><button type="button" className="text-button" onClick={()=>setOriginal(row.batch_id)}>查看原單</button></td>
    </tr>;
   })}</tbody>
  </table></div>:<p className="shell-note">目前沒有符合條件的設備單據。</p>}
  {original&&<ReceiptOriginalDialog batchId={original} onClose={()=>setOriginal('')}/>}
 </>;
}
