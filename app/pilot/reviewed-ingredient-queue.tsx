'use client';

import {useEffect,useState} from 'react';
import {supabase} from '@/lib/supabase-browser';

type ReviewItem={code:string;name:string;supplier:string;unit:string;specification:string;category:string;reason:string};

export default function ReviewedIngredientQueue({storeId,query}:{storeId:string;query:string}){
 const [rows,setRows]=useState<ReviewItem[]|null>(null);
 const [failed,setFailed]=useState(false);
 const [retry,setRetry]=useState(0);
 useEffect(()=>{
  const request=new AbortController();
  void Promise.resolve(supabase.rpc('get_baihuayuan_ingredient_review_queue' as never,{p_store_id:storeId} as never)
   .abortSignal(request.signal)).then(({data,error})=>{
    if(request.signal.aborted)return;
    if(error){setFailed(true);return;}
    setRows((data||[]) as unknown as ReviewItem[]);
   }).catch(()=>{if(!request.signal.aborted)setFailed(true);});
  return()=>request.abort();
 },[storeId,retry]);
 if(failed)return <p role="alert">品項待確認清單讀取失敗。<button type="button" onClick={()=>{setFailed(false);setRetry(n=>n+1);}}>重試</button></p>;
 if(!rows)return <p role="status">讀取品項待確認清單…</p>;
 const matches=rows.filter(r=>[r.name,r.supplier,r.category,r.code,r.specification].join(' ').normalize('NFKC').toLowerCase().includes(query));
 return <section aria-label="品項對應待確認" className="price-sheet-scroll">
  <h3>品項對應待確認</h3>
  {matches.length?<table className="price-pending-suppliers"><thead><tr><th>品名</th><th>供應商</th><th>進貨單位／規格</th><th>待確認原因</th></tr></thead>
   <tbody>{matches.map(row=><tr key={row.code}><td><strong>{row.name}</strong><small>{row.category}</small></td>
    <td>{row.supplier||'未填供應商'}</td><td>{[row.unit,row.specification].filter(Boolean).join('／')||'未填'}</td><td>{row.reason}</td></tr>)}</tbody></table>:
   <p className="price-empty">沒有符合條件的待確認品項。</p>}
 </section>;
}
