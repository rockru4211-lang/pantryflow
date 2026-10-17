'use client';
import {useEffect,useState} from 'react';
import {readReceiptStoreChoices} from '@/lib/receipt-accounting-api';
export default function ReceiptStoreField({storeId,value,onChange,disabled}:{storeId:string;value:string;onChange:(id:string)=>void;disabled:boolean}){
 const [choices,setChoices]=useState<{id:string;name:string}[]>([]),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{const c=new AbortController();void readReceiptStoreChoices(storeId,c.signal).then(rows=>{if(!c.signal.aborted){setChoices(rows);setError('');}}).catch(()=>{if(!c.signal.aborted)setError('門市暫時無法讀取。');});return()=>c.abort();},[storeId,retry]);
 return <div className="receipt-store-correction">{error?<p role="alert">{error}<button type="button" onClick={()=>setRetry(n=>n+1)}>重試</button></p>:choices.length?<><label><span>門市</span><select aria-label="更改貨單門市" value={value} disabled={disabled} onChange={e=>onChange(e.target.value)}>{choices.map(s=><option key={s.id} value={s.id}>{s.name==='BeApe'?'一店 BeApe':'二店 Gras'}</option>)}</select></label><small>更改後按儲存</small></>:<small>讀取門市…</small>}</div>;
}
