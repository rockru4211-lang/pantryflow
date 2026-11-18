'use client';
import {useEffect,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase-browser';
import {usageNamesError} from '@/lib/ingredient-usage-names';
import './ingredient-name-editor.css';
type Detail={name:string;code:string;revision:number};
export default function SharedIngredientNameEditor({storeId,ingredientId,onClose,onSaved}:{storeId:string;ingredientId:string;onClose:()=>void;onSaved:()=>void}){
 const[data,setData]=useState<Detail|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const alive=useRef(true),lock=useRef(false),request=useRef<{name:string;id:string}|null>(null);
 useEffect(()=>{let current=true;alive.current=true;const controller=new AbortController();void Promise.resolve(supabase.rpc('baihuayuan_shared_ingredient_name' as never,{p_store_id:storeId,p_ingredient_id:ingredientId} as never).abortSignal(AbortSignal.any([controller.signal,AbortSignal.timeout(25000)]))).then(r=>{if(r.error)throw r.error;if(current)setData(r.data as unknown as Detail);}).catch(e=>{if(current)setError(usageNamesError(e));});return()=>{current=false;alive.current=false;controller.abort();};},[storeId,ingredientId]);
 async function save(){if(!data||!data.name.trim()||lock.current)return;lock.current=true;setBusy(true);setError('');const name=data.name.trim();if(request.current?.name!==name)request.current={name,id:crypto.randomUUID()};try{const result=await supabase.rpc('baihuayuan_shared_ingredient_name' as never,{p_store_id:storeId,p_ingredient_id:ingredientId,p_name:name,p_revision:data.revision,p_request_id:request.current.id} as never).abortSignal(AbortSignal.timeout(25000));if(result.error)throw result.error;if(alive.current)onSaved();}catch(e){if(alive.current)setError(usageNamesError(e));}finally{lock.current=false;if(alive.current)setBusy(false);}}
 return <div className="code-modal-backdrop"><section className="ingredient-name-editor" role="dialog" aria-modal="true" aria-label="編輯共用品名"><h2>編輯共用品名</h2><p>只更新共用名稱。各店進價、庫存、食譜別名及供應狀態不變。</p>{data?<><div className="ingredient-name-code"><span>共用編碼</span><strong>{data.code}</strong></div><label>統一品名<input value={data.name} maxLength={160} disabled={busy} onChange={e=>setData({...data,name:e.target.value})}/></label></>:!error&&<p>讀取中…</p>}{error&&<p role="alert">{error}</p>}<footer><button className="shell-secondary" disabled={busy} onClick={onClose}>取消</button><button className="shell-primary" disabled={busy||!data?.name.trim()} onClick={()=>void save()}>{busy?'儲存中…':'儲存共用品名'}</button></footer></section></div>;
}
