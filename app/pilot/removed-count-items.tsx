'use client';
import {useState} from 'react';
import {supabase} from '@/lib/supabase-browser';
import {operationDeadline} from '@/lib/operation-deadline';
import {useOperation} from './operation-hooks';
export type RemovedCountItem={product_id:string;name:string;removed_at:string;removed_by:string};
export async function readRemovedCountItems(storeId:string){
 const {data,error}=await operationDeadline(signal=>supabase.rpc('get_count_field_removed',{p_store_id:storeId}).abortSignal(signal));
 if(error)throw error;return data as unknown as RemovedCountItem[];
}
export default function RemovedCountItems({storeId,userId,beforeOpen,onChanged,disabled=false}:{storeId:string;userId:string;beforeOpen?:()=>Promise<boolean>;onChanged?:()=>void|Promise<unknown>;disabled?:boolean}){
 const[open,setOpen]=useState(false);const[items,setItems]=useState<RemovedCountItem[]>([]);const[loading,setLoading]=useState(false);const[error,setError]=useState('');const[notice,setNotice]=useState('');const op=useOperation(storeId,userId);
 async function read(){setLoading(true);try{setItems(await readRemovedCountItems(storeId));setError('');}catch{setError('已移出品項讀取失敗，請重試。');}finally{setLoading(false);}}
 return <><button type="button" className="text-button" disabled={disabled} onClick={async()=>{if(beforeOpen&&!await beforeOpen())return;setOpen(true);setNotice('');void read();}}>已移出品項</button>{open&&<div className="modal-backdrop"><section className="shell-card count-product-dialog" role="dialog" aria-modal="true" aria-label="已移出品項"><header><h2>已移出品項</h2><button type="button" className="text-button" disabled={op.busy} onClick={()=>setOpen(false)}>關閉</button></header><p>僅影響本門市；原有盤點紀錄保留。</p>{loading?<p role="status">讀取中…</p>:<div style={{maxHeight:'60vh',overflowY:'auto'}}>{items.map(item=><article key={item.product_id} className="shell-list-row"><span><strong>{item.name}</strong><small>{item.removed_by}・{new Date(item.removed_at).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'})} 移出</small></span><button type="button" className="text-button" disabled={op.busy} onClick={async()=>{const result=await op.run<{restored_in_current:boolean}>('count.field-restore',{product_id:item.product_id,removed_at:item.removed_at});if(result){setNotice(result.restored_in_current?'已復原至本次盤點。':'已恢復，下次盤點會列入。');await read();await onChanged?.();}}}>復原</button></article>)}{!items.length&&<p>目前沒有已移出品項。</p>}</div>}{notice&&<p role="status">{notice}</p>}{(error||op.error)&&<p role="alert">{error||op.error}<button type="button" className="text-button" onClick={()=>void read()}>重新讀取</button></p>}</section></div>}</>;
}
