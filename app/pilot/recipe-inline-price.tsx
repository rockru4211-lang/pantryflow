'use client';

import {ChevronDown,Search} from 'lucide-react';
import {useState} from 'react';
import {recipeFactor,recipeUnit,type RecipeLine,type RecipeWorkspace} from '@/lib/recipe-cost';
import {changeRecipePriceUnit,normalizeRecipeDraft,type RecipePriceDraft} from '@/lib/recipe-price-draft';
import {recipeUnitMoney} from './recipe-price-editor';

export const recipeInputUnits=['g','公斤','台斤','ml','L','顆','片','份','包','桶','瓶','盒'];
const choices=(unit:string)=>[...new Set([unit,...recipeInputUnits])].filter(Boolean);
export default function RecipeInlinePrice({line,draft,workspace,pending,error,disabled,onChange,onUnit,onMap,onDiscard}:{line:RecipeLine;draft:RecipePriceDraft;workspace:RecipeWorkspace;pending:boolean;error?:string;disabled:boolean;onChange:(draft:RecipePriceDraft)=>void;onUnit:(unit:string)=>void;onMap:(id?:string)=>void;onDiscard:()=>void}){
 const [search,setSearch]=useState('');
 const needsConversion=recipeUnit(draft.unit)!==recipeUnit(line.unit);
 let preview:ReturnType<typeof normalizeRecipeDraft>|null=null;
 try{preview=normalizeRecipeDraft(draft,line.unit);}catch{/* Incomplete input stays pending. */}
 const change=(patch:Partial<RecipePriceDraft>)=>onChange({...draft,...patch});
 const mapped=workspace.products.find(p=>p.id===line.product_id);
 return <div className="recipe-inline-price">
  <span className="recipe-mobile-label">成本單價</span>
  <div className="recipe-direct-pair"><input data-price-input aria-label={`${line.name}成本單價`} type="number" inputMode="decimal" min="0" step="any" placeholder="填單價" value={draft.amount} disabled={disabled} onChange={e=>change({amount:e.target.value,amountEdited:true})}/><select aria-label={`${line.name}計價單位`} value={draft.unit} disabled={disabled} onChange={e=>{onChange(changeRecipePriceUnit(draft,e.target.value));onUnit(e.target.value);}}>{choices(draft.unit).map(u=><option key={u} value={u}>元／{u}</option>)}</select></div>
  {needsConversion&&<div className="recipe-inline-package"><span>每{draft.unit}</span><input aria-label={`${line.name}包裝內容量`} type="number" inputMode="decimal" min="0" step="any" placeholder="內容量" value={draft.content} disabled={disabled} onChange={e=>change({content:e.target.value})}/><select aria-label={`${line.name}包裝內容單位`} value={draft.contentUnit} disabled={disabled} onChange={e=>change({contentUnit:e.target.value})}>{choices(draft.contentUnit).map(u=><option value={u} key={u}>{u}</option>)}</select></div>}
  {needsConversion?<small className="recipe-inline-conversion">{preview?`換算 ${recipeUnitMoney((preview.costPrice??preview.price)*recipeFactor(line.unit))}／${line.unit}`:'填每包裝的數量與單位'}</small>:recipeFactor(draft.unit)!==recipeFactor(line.unit)&&<small className="recipe-inline-conversion">1 {draft.unit}＝{(recipeFactor(draft.unit)/recipeFactor(line.unit)).toLocaleString('zh-TW')} {line.unit} · 自動</small>}
  {draft.rawAmount!==null&&Number(draft.amount)>Number(draft.rawAmount)&&<small className="recipe-inline-estimate">高估計價 · 原進價 {draft.rawAmount} 元／{draft.unit}</small>}
  <details className="recipe-inline-details"><summary>價格設定{pending&&<span>待儲存</span>}<ChevronDown size={13}/></summary><div>
   {pending&&<button type="button" className="text-button" disabled={disabled} onClick={onDiscard}>取消價格修改</button>}
   <label>原始進價<div className="recipe-direct-pair"><input aria-label={`${line.name}原始進價`} type="number" inputMode="decimal" min="0" step="any" placeholder={draft.amount||'依填寫單價'} value={draft.rawAmount??''} disabled={disabled} onChange={e=>change({rawAmount:e.target.value||null})}/><span>元／{draft.unit}</span></div></label>
   <small>成本單價可高估，原進價另行保留；留空依填寫單價。此價格供門市食譜共用。</small>
   <label>價格來源<input aria-label={`${line.name}價格來源`} value={draft.source} disabled={disabled} onChange={e=>change({source:e.target.value})}/></label>
   <label>價格日期<input aria-label={`${line.name}價格日期`} type="date" value={draft.date} disabled={disabled} onChange={e=>change({date:e.target.value})}/></label>
   <small>{mapped?`已對應：${mapped.name} ${mapped.specification||''}`:'可先填價格，再對應進貨食材。'}</small>
   <label className="recipe-search"><Search size={14}/><input aria-label={`${line.name}搜尋進貨食材`} placeholder="搜尋對應食材" value={search} disabled={disabled} onChange={e=>setSearch(e.target.value)}/></label>
   {search.trim()&&<div className="recipe-match-list">{workspace.products.filter(p=>`${p.name} ${p.specification||''}`.toLowerCase().includes(search.trim().toLowerCase())).slice(0,8).map(p=><button type="button" key={p.id} disabled={disabled} onClick={()=>{onMap(p.id);setSearch('');}}>{p.name}<small>{p.specification||p.unit}</small></button>)}</div>}
   {line.product_id&&<button type="button" className="text-button" disabled={disabled} onClick={()=>onMap(undefined)}>取消對應</button>}
  </div></details>
  {error&&<small className="recipe-inline-error" role="alert">{error}</small>}
 </div>;
}
