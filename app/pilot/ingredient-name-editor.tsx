'use client';
import {useEffect,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase-browser';
import {usageNamesError,type IngredientUsageNames,type SupplierIngredientName} from '@/lib/ingredient-usage-names';
import './ingredient-name-editor.css';

export default function IngredientNameEditor({storeId,ingredientId,onClose,onSaved}:{storeId:string;ingredientId:string;onClose:()=>void;onSaved:()=>void}){
 const[data,setData]=useState<IngredientUsageNames|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[alias,setAlias]=useState(''),[reload,setReload]=useState(0);
 const alive=useRef(true),lock=useRef(false),request=useRef<{payload:string;id:string}|null>(null);
 useEffect(()=>{alive.current=true;let current=true;const controller=new AbortController();
  void Promise.resolve(supabase.rpc('baihuayuan_ingredient_names' as never,{p_store_id:storeId,p_ingredient_id:ingredientId} as never).abortSignal(AbortSignal.any([controller.signal,AbortSignal.timeout(25000)]))).then(r=>{if(r.error)throw r.error;if(current){setData(r.data as unknown as IngredientUsageNames);request.current=null;}}).catch(e=>{if(current)setError(usageNamesError(e));}).finally(()=>{if(current)setLoading(false);});
  return()=>{current=false;alive.current=false;controller.abort();};
 },[storeId,ingredientId,reload]);
 function change(next:IngredientUsageNames){setData(next);}
 function binding(index:number,patch:Partial<SupplierIngredientName>){if(data)change({...data,bindings:data.bindings.map((b,i)=>i===index?{...b,...patch}:b)});}
 function addAlias(){const name=alias.trim();if(!data||!name)return;change({...data,recipe_aliases:[...new Set([...data.recipe_aliases,name])]});setAlias('');}
 async function save(){if(!data||lock.current)return;lock.current=true;setBusy(true);setError('');
  try{const payload={revision:data.revision,formal_name:data.formal_name.trim(),count_name:data.count_name.trim(),recipe_aliases:[...new Set([...data.recipe_aliases,...(alias.trim()?[alias.trim()]:[])])],bindings:data.bindings};const serialized=JSON.stringify(payload);if(request.current?.payload!==serialized)request.current={payload:serialized,id:crypto.randomUUID()};
   const r=await supabase.rpc('baihuayuan_ingredient_names' as never,{p_store_id:storeId,p_ingredient_id:ingredientId,p_data:payload,p_request_id:request.current.id} as never).abortSignal(AbortSignal.timeout(25000));if(r.error)throw r.error;if(alive.current)onSaved();
  }catch(e){if(alive.current)setError(usageNamesError(e));}finally{lock.current=false;if(alive.current)setBusy(false);}
 }
 return <div className="code-modal-backdrop"><section className="ingredient-name-editor" role="dialog" aria-modal="true" aria-label="編碼與別名"><header><h2>編碼與別名</h2><button type="button" className="text-button" disabled={busy} aria-label="關閉編碼與別名" onClick={onClose}>關閉</button></header>
 {loading?<p>讀取名稱中…</p>:data&&<>
 <div className="ingredient-name-code"><span>食材編碼</span><strong>{data.code}</strong><small>固定編碼</small></div>
 <label>正式名稱<input value={data.formal_name} maxLength={160} disabled={busy} onChange={e=>change({...data,formal_name:e.target.value})}/></label>
 <label>盤點名稱<input value={data.count_name} maxLength={160} placeholder="沿用各盤點品項的名稱" disabled={busy} onChange={e=>change({...data,count_name:e.target.value})}/></label>
 {data.products.length>0&&<small className="ingredient-name-linked">已對應盤點：{data.products.map(p=>p.name).join('、')}</small>}
 <div className="ingredient-name-aliases"><strong>食譜別名</strong><div>{data.recipe_aliases.map(name=><span key={name}>{name}<button type="button" disabled={busy} aria-label={`移除食譜別名 ${name}`} onClick={()=>change({...data,recipe_aliases:data.recipe_aliases.filter(n=>n!==name)})}>×</button></span>)}</div><div className="ingredient-name-add"><input aria-label="新增食譜別名" value={alias} maxLength={160} placeholder="輸入食譜使用的名稱" disabled={busy} onChange={e=>setAlias(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();addAlias();}}}/><button type="button" disabled={busy||!alias.trim()} className="text-button" onClick={addAlias}>＋ 新增</button></div></div>
 <div className="ingredient-name-suppliers"><header><h3>供應商進貨名稱</h3><button type="button" className="text-button" disabled={busy} onClick={()=>change({...data,bindings:[...data.bindings,{supplier:'',supplier_id:null,name:'',unit:'',specification:'',ingredient_id:data.id,revision:0,stopped:false,supply_revision:0}]})}>＋ 新增對應</button></header>
 <div className="ingredient-name-table"><table><thead><tr><th>供應商</th><th>貨單名稱</th><th>單位／規格</th><th>供應狀態</th></tr></thead><tbody>{data.bindings.map((b,index)=><tr key={`${index}:${b.ingredient_id}`}><td>{b.revision>0?<span>{data.suppliers.find(s=>s.id===b.supplier_id)?.name||b.supplier}</span>:<select aria-label={`第 ${index+1} 筆供應商`} disabled={busy} value={b.supplier_id||''} onChange={e=>{const s=data.suppliers.find(s=>s.id===e.target.value);binding(index,{supplier_id:s?.id||null,supplier:s?.name||'',stopped:s?.stopped||false,supply_revision:s?.supply_revision||0});}}><option value="">選擇供應商</option>{data.suppliers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select>}</td><td>{b.revision>0?<span>{b.name}</span>:<input aria-label={`第 ${index+1} 筆貨單名稱`} value={b.name} maxLength={160} disabled={busy} onChange={e=>binding(index,{name:e.target.value})}/>}</td><td>{b.revision>0?<small>{[b.unit,b.specification].filter(Boolean).join('／')||'未提供'}</small>:<><input aria-label={`第 ${index+1} 筆進貨單位`} value={b.unit} maxLength={30} placeholder="單位" disabled={busy} onChange={e=>binding(index,{unit:e.target.value})}/><input aria-label={`第 ${index+1} 筆進貨規格`} value={b.specification} maxLength={500} placeholder="規格（選填）" disabled={busy} onChange={e=>binding(index,{specification:e.target.value})}/></>}</td><td><select aria-label={`${b.supplier||'新供應商'} ${b.name} 供應狀態`} value={b.stopped?'stopped':'active'} disabled={busy} onChange={e=>{const stopped=e.target.value==='stopped';change({...data,bindings:data.bindings.map((row,i)=>(b.supplier_id?row.supplier_id===b.supplier_id:i===index)?{...row,stopped}:row)});}}><option value="active">供應中</option><option value="stopped">已停供</option></select>{!b.revision&&<button type="button" className="text-button" disabled={busy} onClick={()=>change({...data,bindings:data.bindings.filter((_,i)=>i!==index)})}>移除</button>}</td></tr>)}</tbody></table></div>
 {!data.bindings.length&&<p className="ingredient-name-linked">選定進貨食材並儲存後，名稱會記在這裡。</p>}<small>同商品更換供應商沿用編碼，原進貨紀錄保留。</small></div>
 </>}
 {error&&<p className="code-error" role="alert">{error}<button type="button" className="text-button" disabled={busy||loading} onClick={()=>{setLoading(true);setError('');setReload(n=>n+1);}}>重新讀取（捨棄本次輸入）</button></p>}
 <footer><button type="button" className="shell-secondary" disabled={busy} onClick={onClose}>取消</button><button type="button" className="shell-primary" disabled={busy||loading||!data?.formal_name.trim()} onClick={()=>void save()}>{busy?'儲存中…':'儲存'}</button></footer>
 </section></div>;
}
