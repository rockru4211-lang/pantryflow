'use client';

import {useEffect,useRef,useState} from 'react';
import {Check,ChevronDown,Search,X} from 'lucide-react';
import {normalizeRecipePurchase,recipeCountHint,recipeFactor,recipePurchaseUnitAmount,recipeUnit,type RecipeLine,type RecipePrice,type RecipePurchase,type RecipeWorkspace} from '@/lib/recipe-cost';

export type RecipePriceInput={name:string;product_id:string|null;unit:string;price:number;source:string;effective_date:string;purchase:RecipePurchase};
export const recipeUnitMoney=(value:number)=>`NT$ ${value.toLocaleString('zh-TW',{minimumFractionDigits:4,maximumFractionDigits:4})}`;
const currency=(value:number)=>`NT$ ${value.toLocaleString('zh-TW',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const quantityText=(value:number)=>value.toLocaleString('zh-TW',{maximumFractionDigits:8});
const units=['顆','盒','包','瓶','g','公斤','台斤','ml','公升','片','份'];
function findPrice(line:RecipeLine,workspace:RecipeWorkspace):RecipePrice|undefined{
 const key=line.product_id?`p:${line.product_id}`:`n:${line.name.trim().toLowerCase()}`;
 return workspace.prices.find(p=>p.key===key&&p.unit===recipeUnit(line.unit))||workspace.prices.find(p=>p.key===key);
}

export default function RecipePriceEditor({line,workspace,onChange,onSave,onClose}:{line:RecipeLine;workspace:RecipeWorkspace;onChange:(patch:Partial<RecipeLine>)=>void;onSave:(data:RecipePriceInput)=>Promise<boolean>;onClose:()=>void}){
 const [draft,setDraft]=useState({...line}),[previous]=useState(()=>findPrice(line,workspace));
 const [amount,setAmount]=useState(()=>previous?String(recipePurchaseUnitAmount(previous)):'');
 const [unit,setUnit]=useState(()=>previous?.purchase?.unit||previous?.unit||workspace.products.find(p=>p.id===line.product_id)?.unit||line.unit||'顆');
 const [content,setContent]=useState(()=>previous?.purchase?.content_quantity&&recipeUnit(previous.purchase.content_unit||'')===recipeUnit(line.unit)?String(previous.purchase.content_quantity*recipeFactor(previous.purchase.content_unit||line.unit)/recipeFactor(line.unit)):'');
 const [estimate,setEstimate]=useState(()=>previous?.purchase?.cost_unit_price===undefined?'':String(previous.purchase.cost_unit_price));
 const [source,setSource]=useState(()=>previous?.source&&previous.source!=='已核對進貨'?previous.source:'供應商報價');
 const [date,setDate]=useState(()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei'}).format(new Date()));
 const [search,setSearch]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const dialog=useRef<HTMLDialogElement>(null),amountInput=useRef<HTMLInputElement>(null);
 const mapped=workspace.products.find(p=>p.id===draft.product_id);
 const matches=workspace.products.filter(p=>`${p.name} ${p.specification||''}`.toLowerCase().includes(search.trim().toLowerCase()));
 const needsConversion=recipeUnit(unit)!==recipeUnit(draft.unit);
 const showAutomatic=!needsConversion&&recipeFactor(unit)!==recipeFactor(draft.unit);
 const hint=recipeCountHint(draft.name);
 const purchase:RecipePurchase={amount:Number(amount),quantity:1,unit:unit.trim(),...(needsConversion?{content_quantity:Number(content),content_unit:draft.unit}:{}),...(estimate.trim()?{cost_unit_price:Number(estimate)}:{})};
 let preview:ReturnType<typeof normalizeRecipePurchase>|null=null;
 if(amount.trim())try{preview=normalizeRecipePurchase(purchase,draft.unit);}catch{/* Missing data remains explicitly unresolved. */}
 const cost=preview&&Number.isFinite(Number(draft.quantity))&&Number(draft.quantity)>0?(preview.costPrice??preview.price)*Number(draft.quantity)*recipeFactor(draft.unit):null;
 function usageUnit(next:string){
  setContent(value=>value&&recipeUnit(next)===recipeUnit(draft.unit)?String(Number(value)*recipeFactor(draft.unit)/recipeFactor(next)):'');
  setDraft(current=>({...current,unit:next}));setError('');
 }
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
  if(!amount.trim()||!source.trim()||!date){setError('請填採購單價、價格來源及日期。');amountInput.current?.focus();return;}
  if(!draft.quantity.trim()||!Number.isFinite(Number(draft.quantity))||Number(draft.quantity)<=0||!draft.unit.trim()){setError('請填食譜用量與單位。');return;}
  let normalized:ReturnType<typeof normalizeRecipePurchase>;
  try{normalized=normalizeRecipePurchase(purchase,draft.unit);}catch(e){setError(e instanceof Error?e.message:'請確認換算資料。');return;}
  setBusy(true);setError('');
  try{
   if(await onSave({name:draft.name,product_id:draft.product_id||null,unit:normalized.unit,price:normalized.price,source:source.trim(),effective_date:date,purchase})){
    onChange({name:draft.name,product_id:draft.product_id,quantity:draft.quantity,unit:draft.unit});onClose();
   }else setError('尚未確認儲存成功，輸入內容已保留，請重試。');
  }catch{setError('儲存失敗，請重試。');}finally{setBusy(false);}
 }
 return <dialog ref={dialog} className="recipe-price-dialog recipe-unit-price-dialog" aria-label={`${line.name}補價格`} onCancel={e=>{e.preventDefault();if(!busy)onClose();}}>
  <header className="recipe-price-dialog-header"><div><small>食材成本 · 未稅</small><h2>{draft.name}</h2></div><button type="button" className="recipe-icon-button" aria-label="關閉價格設定" disabled={busy} onClick={onClose}><X size={20}/></button></header>
  <div className="recipe-price-dialog-body">
   <fieldset disabled={busy}>
    <label>採購單價<div className="recipe-purchase-pair recipe-unit-price-input"><input ref={amountInput} aria-label={`${line.name}採購單價`} type="number" inputMode="decimal" step="any" min="0" placeholder="例如 700" value={amount} onChange={e=>{setAmount(e.target.value);setError('');}}/><select aria-label="計價單位" value={unit} onChange={e=>{setUnit(e.target.value);setContent('');setEstimate('');setError('');}}>{[...new Set([unit,...units])].filter(Boolean).map(u=><option value={u} key={u}>元／{u}</option>)}</select></div></label>
    {needsConversion&&draft.unit?<div className="recipe-conversion-strip recipe-conversion-edit"><span>1 {unit} ＝</span><input aria-label="每單位包裝內容數量" type="number" inputMode="decimal" step="any" min="0" placeholder="數量" value={content} onChange={e=>{setContent(e.target.value);setError('');}}/><span>{draft.unit}</span><small>下次沿用</small></div>:showAutomatic?<div className="recipe-conversion-strip"><span>1 {unit} ＝ {quantityText(recipeFactor(unit)/recipeFactor(draft.unit))} {draft.unit}</span><small>自動</small></div>:null}
    <label>食譜用量<div className="recipe-purchase-pair"><input aria-label="食譜用量" type="number" inputMode="decimal" step="any" min="0" placeholder="用量" value={draft.quantity} onChange={e=>{setDraft({...draft,quantity:e.target.value});setError('');}}/><select aria-label="食譜用量單位" value={draft.unit} onChange={e=>usageUnit(e.target.value)}>{!draft.unit&&<option value="">請選單位</option>}{[...new Set([draft.unit,...units])].filter(Boolean).map(u=><option value={u} key={u}>{u}</option>)}</select></div></label>
    {hint&&<div className="recipe-count-hint"><small>名稱標示 {hint.quantity} {hint.unit}</small><button type="button" className="text-button" onClick={()=>{usageUnit(hint.unit);setDraft(current=>({...current,...hint}));}}>改用 {hint.quantity} {hint.unit}</button></div>}
    <div className="recipe-price-preview" aria-live="polite"><div><span>{needsConversion||showAutomatic?'換算單價':'每'+(draft.unit||'單位')+'單價'}</span><strong>{preview?`${recipeUnitMoney(preview.price*recipeFactor(draft.unit))}／${draft.unit}`:'待確認資料'}</strong></div>{preview?.costPrice!=null&&<div className="recipe-estimate-preview"><span>高估採用</span><strong>{recipeUnitMoney(preview.costPrice*recipeFactor(draft.unit))}／{draft.unit}</strong></div>}<div><span>本食材成本</span><strong>{cost===null?'待填齊資料':currency(cost)}</strong></div></div>
    <details className="recipe-price-more recipe-estimate-settings"><summary><span>成本高估（選填）{estimate.trim()&&<small>採用 {estimate} 元／{unit}</small>}</span><ChevronDown size={18}/></summary><label>成本採用單價<div className="recipe-purchase-pair"><input aria-label="成本採用單價" type="number" inputMode="decimal" step="any" min={amount||'0'} value={estimate} placeholder="留空依採購單價" onChange={e=>{setEstimate(e.target.value);setError('');}}/><span>元／{unit}</span></div></label><small>原始進價保留；此筆價格供門市食譜共用。留空可取消高估。</small></details>
    <details className="recipe-price-more"><summary><span>價格來源與對應</span><ChevronDown size={18}/></summary>
     {previous&&<small>上次來源：{previous.source} · {previous.effective_date}，請核對本次日期。</small>}
     {previous?.purchase&&previous.purchase.quantity!==1&&<small>原始報價 {currency(previous.purchase.amount)}／{previous.purchase.quantity} {previous.purchase.unit}，已換成每 {previous.purchase.unit} 單價。</small>}
     <label>價格來源<input aria-label="價格來源" value={source} onChange={e=>{setSource(e.target.value);setError('');}}/></label><label>價格日期<input aria-label="價格日期" type="date" value={date} onChange={e=>{setDate(e.target.value);setError('');}}/></label>
     <p>{mapped?`已對應：${mapped.name} ${mapped.specification||''}`:'可先補價，之後再對應進貨食材。'}</p>
     <label className="recipe-search"><Search size={18}/><input aria-label="搜尋對應進貨食材" placeholder="搜尋進貨食材" value={search} onChange={e=>setSearch(e.target.value)}/></label>
     {search.trim()&&<div className="recipe-match-list">{matches.slice(0,12).map(p=><button type="button" key={p.id} onClick={()=>{setDraft({...draft,product_id:p.id});setSearch('');}}><span>{p.name}<small>{p.specification||p.unit}</small></span>{draft.product_id===p.id?<Check size={18}/>:<span>對應</span>}</button>)}{!matches.length&&<p>沒有符合的食材。</p>}</div>}
     {draft.product_id&&<button type="button" className="text-button" onClick={()=>setDraft({...draft,product_id:undefined})}>取消對應，使用食材名稱報價</button>}
    </details>
   </fieldset>
   {error&&<p className="recipe-price-error" role="alert">{error}</p>}
  </div>
  <footer className="recipe-price-dialog-footer"><button type="button" className="shell-primary" disabled={busy} onClick={()=>void save()}><Check size={18}/>{busy?'儲存中…':'確認並套用'}</button></footer>
 </dialog>;
}
