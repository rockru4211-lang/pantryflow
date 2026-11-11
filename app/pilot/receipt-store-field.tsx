'use client';

import {useEffect,useState} from 'react';
import {readReceiptStoreChoices} from '@/lib/receipt-accounting-api';

type Choice={id:string;name:string};
const storeLabel=(name:string)=>name==='BeApe'?'一店 BeApe':name==='Gras'?'二店 Gras':name;

export default function ReceiptStoreField({storeId,storeName,value,onChange,disabled}:{storeId:string;storeName?:string;value:string;onChange:(id:string)=>void;disabled:boolean}){
 const [choices,setChoices]=useState<Choice[]>([]);
 const [status,setStatus]=useState<'loading'|'ready'|'error'>('loading');
 const [retry,setRetry]=useState(0);
 useEffect(()=>{
  const controller=new AbortController();
  void readReceiptStoreChoices(storeId,controller.signal).then(rows=>{
   if(!controller.signal.aborted){setChoices(rows);setStatus('ready');}
  }).catch(()=>{if(!controller.signal.aborted)setStatus('error');});
  return()=>controller.abort();
 },[storeId,retry]);
 const options=choices.some(choice=>choice.id===storeId)?choices:[{id:storeId,name:storeName||'目前門市'},...choices];
 return <div className="receipt-store-field">
  <label>貨單門市<select aria-label="貨單門市" value={value} onChange={e=>onChange(e.target.value)} disabled={disabled||status!=='ready'||options.length<2}>
   {options.map(choice=><option key={choice.id} value={choice.id}>{storeLabel(choice.name)}</option>)}
  </select></label>
  {value!==storeId&&<small role="status">儲存後移至所選門市</small>}
  {!disabled&&status==='error'&&<button type="button" className="text-button" onClick={()=>{setStatus('loading');setRetry(n=>n+1);}}>門市讀取失敗，重試</button>}
 </div>;
}
