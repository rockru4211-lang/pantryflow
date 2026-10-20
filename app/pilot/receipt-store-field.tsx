'use client';
import {useEffect,useState} from 'react';
import {readReceiptStoreChoices} from '@/lib/receipt-accounting-api';
export default function ReceiptStoreField({storeId,value,onChange,disabled}:{storeId:string;value:string;onChange:(id:string)=>void;disabled:boolean}){
 const [choices,setChoices]=useState<{id:string;name:string}[]>([]),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{const c=new AbortController();void readReceiptStoreChoices(storeId,c.signal).then(rows=>{if(!c.signal.aborted){setChoices(rows);setError('');}}).catch(()=>{if(!c.signal.aborted)setError('門市暫時無法讀取。');});return()=>c.abort();},[storeId,retry]);
 const label=(name:string)=>name==='BeApe'?'一店 BeApe':name==='Gras'?'二店 Gras':name;
 return <details className="receipt-store-correction" onToggle={e=>{if(!e.currentTarget.open)return;const box=e.currentTarget.getBoundingClientRect();e.currentTarget.dataset.side=box.right+200>window.innerWidth?'left':'right';}}>
  <summary className="receipt-more-row"><span>貨單門市</span><span className="receipt-more-value">{choices.find(s=>s.id===value)?label(choices.find(s=>s.id===value)!.name):'讀取中'}<span aria-hidden="true">›</span></span></summary>
  <div className="receipt-store-options" aria-label="更改貨單門市">
   {error?<p role="alert">{error}<button type="button" onClick={()=>setRetry(n=>n+1)}>重試</button></p>:choices.length?choices.map(s=><button type="button" key={s.id} disabled={disabled} aria-pressed={s.id===value} onClick={e=>{onChange(s.id);const details=e.currentTarget.closest('details');if(details){details.open=false;details.querySelector('summary')?.focus();}}}><span className="receipt-store-check" aria-hidden="true">{s.id===value?'✓':''}</span>{label(s.name)}</button>):<span>讀取門市…</span>}
  </div>
 </details>;
}
