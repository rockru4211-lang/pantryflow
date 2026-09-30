'use client';

import {useEffect,useRef,useState} from 'react';
import {Check,ChevronDown,Search,X} from 'lucide-react';
import {normalizeRecipePurchase,recipeFactor,recipeUnit,type RecipeLine,type RecipePrice,type RecipePurchase,type RecipeWorkspace} from '@/lib/recipe-cost';

export type RecipePriceInput={name:string;product_id:string|null;unit:string;price:number;source:string;effective_date:string;purchase:RecipePurchase};
export const recipeUnitMoney=(value:number)=>`NT$ ${value.toLocaleString('zh-TW',{minimumFractionDigits:4,maximumFractionDigits:4})}`;
const currency=(value:number)=>`NT$ ${value.toLocaleString('zh-TW',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const purchaseUnits=['顆','盒','包','瓶','g','公斤','台斤','ml','公升','片','份'];
function findPrice(line:RecipeLine,workspace:RecipeWorkspace):RecipePrice|undefined{
 const key=line.product_id?`p:${line.product_id}`:`n:${line.name.trim().toLowerCase()}`;
 return workspace.prices.find(p=>p.key===key&&p.unit===recipeUnit(line.unit))||workspace.prices.find(p=>p.key===key);
}

export default function RecipePriceEditor({line,workspace,onChange,onSave,onClose}:{line:RecipeLine;workspace:RecipeWorkspace;onChange:(patch:Partial<RecipeLine>)=>void;onSave:(data:RecipePriceInput)=>Promise<boolean>;onClose:()=>void}){
 const [previous]=useState(()=>findPrice(line,workspace));
 const [amount,setAmount]=useState(()=>previous?String(previous.purchase?.amount??previous.price):'');
 const [quantity,setQuantity]=useState(()=>String(previous?.purchase?.quantity??1));
 const [unit,setUnit]=useState(()=>previous?.purchase?.unit||previous?.unit||workspace.products.find(p=>p.id===line.product_id)?.unit||line.unit||'顆');
 const [content,setContent]=useState(()=>previous?.purchase?.content_quantity&&recipeUnit(previous.purchase.content_unit||'')===recipeUnit(line.unit)?String(previous.purchase.content_quantity*recipeFactor(previous.purchase.content_unit||line.unit)/recipeFactor(line.unit)):'');
 const [source,setSource]=useState('供應商報價'),[date,setDate]=useState(()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei'}).format(new Date()));
 const [search,setSearch]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const dialog=useRef<HTMLDialogElement>(null),amountInput=useRef<HTMLInputElement>(null);
 const mapped=workspace.products.find(p=>p.id===line.product_id);
 const matches=workspace.products.filter(p=>`${p.name} ${p.specification||''}`.toLowerCase().includes(search.trim().toLowerCase()));
 const needsConversion=recipeUnit(unit)!==recipeUnit(line.unit);
 const purchase:RecipePurchase={amount:Number(amount),quantity:Number(quantity),unit:unit.trim(),...(needsConversion?{content_quantity:Number(content),content_unit:line.unit}: {})};
 let preview:ReturnType<typeof normalizeRecipePurchase>|null=null;
 if(amount.trim()&&quantity.trim())try{preview=normalizeRecipePurchase(purchase,line.unit);}catch{/* Required conversion stays visibly unresolved. */}
 const cost=preview&&Number(line.quantity)>0?preview.price*Number(line.quantity)*recipeFactor(line.unit):null;
 useEffect(()=>{
  const element=dialog.current,viewport=window.visualViewport;
  const fit=()=>{
   if(!element)return;
   if(viewport&&window.matchMedia('(max-width:520px)').matches){
    element.style.maxHeight=`${Math.max(160,viewport.height-12)}px`;
    element.style.bottom=`${Math.max(0,window.innerHeight-viewport.height-viewport.offsetTop)}px`;
   }else{element.style.removeProperty('max-height');element.style.removeProperty('bottom');}
  };
  element?.showModal();fit();viewport?.addEventListener('resize',fit);viewport?.addEventListener('scroll',fit);
  return()=>{viewport?.removeEventListener('resize',fit);viewport?.removeEventListener('scroll',fit);element?.close();};
 },[]);
 async function save(){
  if(busy)return;
  if(!amount.trim()||!quantity.trim()||!source.trim()||!date){setError('請填採購金額、數量、價格來源及日期。');amountInput.current?.focus();return;}
  let normalized:ReturnType<typeof normalizeRecipePurchase>;
  try{normalized=normalizeRecipePurchase(purchase,line.unit);}catch(e){setError(e instanceof Error?e.message:'請確認換算資料。');return;}
  setBusy(true);setError('');
  try{if(await onSave({name:line.name,product_id:line.product_id||null,unit:normalized.unit,price:normalized.price,source:source.trim(),effective_date:date,purchase}))onClose();else setError('尚未確認儲存成功，輸入內容已保留，請重試。');}
  catch{setError('儲存失敗，請重試。');}finally{setBusy(false);}
 }
 return <dialog ref={dialog} className="recipe-price-dialog" aria-label={`${line.name}補價格`} onCancel={e=>{e.preventDefault();if(!busy)onClose();}}>
  <header className="recipe-price-dialog-header"><div><small>補價格與換算</small><h2>{line.name}</h2></div><button type="button" className="recipe-icon-button" aria-label="關閉價格設定" disabled={busy} onClick={onClose}><X size={20}/></button></header>
  <div className="recipe-price-dialog-body">
   <div className="recipe-price-usage">食譜用量<strong>{line.quantity||'待填'} {line.unit||'待填單位'}</strong></div>
   <fieldset disabled={busy}>
    <label className="recipe-purchase-amount">採購金額（未稅）<input ref={amountInput} aria-label={`${line.name}採購金額`} type="number" inputMode="decimal" step="any" min="0" placeholder="例如 300" value={amount} onChange={e=>{setAmount(e.target.value);setError('');}}/></label>
    <label>這筆金額的採購數量<div className="recipe-purchase-pair"><input aria-label={`${line.name}採購數量`} type="number" inputMode="decimal" step="any" min="0" value={quantity} onChange={e=>{setQuantity(e.target.value);setError('');}}/><select aria-label="採購單位" value={unit} onChange={e=>{setUnit(e.target.value);setContent('');setError('');}}>{[...new Set([unit,...purchaseUnits])].map(u=><option value={u} key={u}>{u}</option>)}</select></div></label>
    {needsConversion?<label className="recipe-package-conversion">每 1 {unit} 相當於多少 {line.unit||'食譜單位'}？<div className="recipe-purchase-pair"><input aria-label="每單位包裝內容數量" type="number" inputMode="decimal" step="any" min="0" placeholder="例如 6" value={content} onChange={e=>{setContent(e.target.value);setError('');}}/><span>{line.unit||'待填單位'}</span></div><small>依供應商規格或實測填寫，請勿估猜。</small></label>:<p className="recipe-auto-conversion">自動換算：1 {unit} ＝ {recipeFactor(unit)/recipeFactor(line.unit)} {line.unit}</p>}
    <div className="recipe-price-preview" aria-live="polite"><div><span>換算單價</span><strong>{preview?`${recipeUnitMoney(preview.price*recipeFactor(line.unit))}／${line.unit}`:'待確認換算'}</strong></div><div><span>本食材成本</span><strong>{cost===null?'待填齊資料':currency(cost)}</strong></div></div>
    {previous&&<small className="recipe-price-previous">上次來源：{previous.source} · {previous.effective_date}。請核對本次金額與日期。</small>}
    <details className="recipe-price-more"><summary><span>價格來源與對應<small>{source} · {mapped?.name||'以食材名稱保存'}</small></span><ChevronDown size={18}/></summary>
     <label>價格來源<input aria-label="價格來源" value={source} onChange={e=>{setSource(e.target.value);setError('');}}/></label><label>價格日期<input aria-label="價格日期" type="date" value={date} onChange={e=>{setDate(e.target.value);setError('');}}/></label>
     <p>{mapped?`已對應：${mapped.name} ${mapped.specification||''}`:'可先補價，之後再對應進貨食材。'}</p>
     <label className="recipe-search"><Search size={18}/><input aria-label="搜尋對應進貨食材" placeholder="搜尋進貨食材" value={search} onChange={e=>setSearch(e.target.value)}/></label>
     {search.trim()&&<div className="recipe-match-list">{matches.slice(0,12).map(p=><button type="button" key={p.id} onClick={()=>{onChange({product_id:p.id});setSearch('');}}><span>{p.name}<small>{p.specification||p.unit}</small></span>{line.product_id===p.id?<Check size={18}/>:<span>對應</span>}</button>)}{!matches.length&&<p>沒有符合的食材。</p>}</div>}
     {line.product_id&&<button type="button" className="text-button" onClick={()=>onChange({product_id:undefined})}>取消對應，使用食材名稱報價</button>}
    </details>
   </fieldset>
   {error&&<p className="recipe-price-error" role="alert">{error}</p>}
  </div>
  <footer className="recipe-price-dialog-footer"><small>儲存後立即重算成本</small><button type="button" className="shell-primary" disabled={busy} onClick={()=>void save()}><Check size={18}/>{busy?'儲存中…':'確認金額並套用'}</button></footer>
 </dialog>;
}
