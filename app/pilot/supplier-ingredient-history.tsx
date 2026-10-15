'use client';
import {useEffect,useState} from 'react';
import {supabase} from '@/lib/supabase-browser';
import {type PriceSheetData,supplierOptions} from '@/lib/ingredient-price-sheet';
export default function SupplierIngredientHistory({storeId,supplierId,name}:{storeId:string;supplierId:string;name:string}){
 const [data,setData]=useState<PriceSheetData|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{const controller=new AbortController();void (async()=>{try{const r=await supabase.rpc('baihuayuan_ingredient_prices' as never,{p_store_id:storeId} as never).abortSignal(controller.signal);if(r.error)throw r.error;if(!controller.signal.aborted){setData(r.data as unknown as PriceSheetData);setError('');}}catch{if(!controller.signal.aborted)setError('供應紀錄讀取失敗，請重試。');}})();return()=>controller.abort();},[storeId,retry]);
 const key=`id:${supplierId}`,legacy=`name:${name.normalize('NFKC').trim().toLowerCase()}`;
 const events=data?.supply_events.filter(e=>e.supplier_key===key||e.supplier_key===legacy||e.supplier_key==='*'&&data.ingredients.some(r=>r.id===e.ingredient_id&&supplierOptions(r).some(s=>s.key===key||s.key===legacy)))||[];
 return <details><summary>食材停供與替代品紀錄（{events.length}）</summary>{error?<p role="alert">{error}<button onClick={()=>setRetry(x=>x+1)}>重試</button></p>:!data?<p>讀取中…</p>:!events.length?<p>尚無相關紀錄。可至食材價格表的「供應紀錄」登記。</p>:<table><thead><tr><th>食材</th><th>異動</th><th>原因／備註</th><th>替代品</th><th>日期</th></tr></thead><tbody>{events.map(e=><tr key={e.id}><td>{e.snapshot.name}</td><td>{e.supplier_key==='*'?'本店整項 · ':''}{e.action==='stop'?'停用':e.action==='restore'?'恢復':'補充'}</td><td>{e.reason} · {e.note}</td><td>{e.replacement||'尚未記錄'}</td><td>{new Date(e.created_at).toLocaleDateString('zh-TW',{timeZone:'Asia/Taipei'})}</td></tr>)}</tbody></table>}</details>;
}
