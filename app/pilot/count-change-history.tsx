'use client';
import {useEffect,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase-browser';
import {operationDeadline} from '@/lib/operation-deadline';
type Change={id:number;product_name:string;action:string;actor_name:string;happened_at:string;before_data:Record<string,unknown>|null;after_data:Record<string,unknown>|null};
const labels:Record<string,string>={name:'品名',quantity:'數量',unit:'單位',note:'備註',zone:'儲物區',specification:'規格',status:'狀態'};
const value=(v:unknown)=>v===null||v===undefined||v===''?'未填':String(v);
export function CountChangeDetail({item}:{item:Change}){return <article style={{borderBottom:'1px solid #e2e8e3',padding:'12px 0'}}><strong>{item.product_name}・{item.action}</strong><p>{item.actor_name}・{new Date(item.happened_at).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false})}</p>{Object.keys(labels).filter(k=>item.before_data?.[k]!==item.after_data?.[k]).map(k=><div key={k} style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{labels[k]}：{item.before_data?`${value(item.before_data[k])} → `:''}{value(item.after_data?.[k])}</div>)}</article>;}
export default function CountChangeHistory({storeId,disabled=false}:{storeId:string;disabled?:boolean}){
 const[open,setOpen]=useState(false),[items,setItems]=useState<Change[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[more,setMore]=useState(false);const generation=useRef(0),lock=useRef(false);
 useEffect(()=>{const ref=generation;return()=>{ref.current++;};},[storeId]);
 async function read(older=false){if(lock.current)return;lock.current=true;setBusy(true);const request=++generation.current;try{const{data,error}=await operationDeadline(signal=>supabase.rpc('get_count_item_changes',{p_store_id:storeId,...(older&&items.length?{p_before_id:items.at(-1)!.id}:{})}).abortSignal(signal));if(error)throw error;if(request!==generation.current)return;const rows=data as unknown as Change[];setItems(old=>older?[...old,...rows]:rows);setMore(rows.length===100);setError('');}catch{if(request===generation.current)setError('異動紀錄讀取失敗，請重試。');}finally{lock.current=false;if(request===generation.current)setBusy(false);}}

 return <><button type="button" className="text-button" disabled={disabled} onClick={()=>{setOpen(true);void read();}}>現場異動紀錄</button>{open&&<div className="im-modal-backdrop"><section className="im-modal" role="dialog" aria-modal="true" aria-label="現場異動紀錄"><header><h2>現場異動紀錄</h2><button type="button" onClick={()=>setOpen(false)}>關閉</button></header><p>本門市已儲存的修改、移出與復原紀錄。</p>{error&&<p role="alert">{error}</p>}<div style={{maxHeight:'60vh',overflowY:'auto'}}>{items.map(item=><CountChangeDetail key={item.id} item={item}/>)}{!items.length&&!busy&&!error&&<p>目前沒有異動紀錄。</p>}</div><footer><button type="button" disabled={busy} onClick={()=>void read()}>重新整理</button>{more&&<button type="button" disabled={busy} onClick={()=>void read(true)}>載入更早紀錄</button>}{busy&&<span role="status">讀取中…</span>}</footer></section></div>}</>;
}
