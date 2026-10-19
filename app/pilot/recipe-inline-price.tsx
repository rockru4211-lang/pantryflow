'use client';
import {recipeUnit,type RecipeLine,type RecipeWorkspace} from '@/lib/recipe-cost';
import {changeRecipePriceUnit,findRecipePrice,type RecipePriceDraft} from '@/lib/recipe-price-draft';
export const recipeInputUnits=['g','公斤','台斤','ml','L','顆','片','份','包','桶','瓶','罐','盒','袋','箱','塊','卷'];
const choices=(unit:string)=>[...new Set([unit,...recipeInputUnits])].filter(Boolean);
export default function RecipeInlinePrice({line,draft,workspace,pending,error,disabled,onChange}:{line:RecipeLine;sourceText:string;draft:RecipePriceDraft;workspace:RecipeWorkspace;pending:boolean;error?:string;disabled:boolean;onChange:(draft:RecipePriceDraft)=>void;onMap:(id?:string)=>void;onDiscard:()=>void}){
 const needsConversion=recipeUnit(draft.unit)!==recipeUnit(line.unit);
 const change=(patch:Partial<RecipePriceDraft>)=>onChange({...draft,...patch,referenceId:undefined,source:'手動補價',amountEdited:true,date:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei'}).format(new Date())});
 const current=findRecipePrice(line,workspace);
 const sourceLabel=pending?'手動輸入':current?.source_kind==='history'?'食譜紀錄':current?.source_kind==='purchase'?'進貨':current?.source_kind==='manual'?'手動輸入':(current?.source||draft.source||'').includes('請購')?'請購表':'已存價格';
 return <div className="recipe-inline-price">
  <span className="recipe-mobile-label">進價</span>
  <small className="recipe-price-source">{sourceLabel}</small>
  <div className="recipe-direct-pair"><input data-price-input aria-label={`${line.name}成本單價`} type="number" inputMode="decimal" min="0" step="any" placeholder="填進價" value={draft.amount} disabled={disabled} onChange={e=>change({amount:e.target.value,rawAmount:null,referenceId:undefined,source:'手動補價',amountEdited:true})}/><select aria-label={`${line.name}計價單位`} value={draft.unit} disabled={disabled} onChange={e=>{onChange(changeRecipePriceUnit(draft,e.target.value));}}>{choices(draft.unit).map(u=><option key={u} value={u}>元／{u}</option>)}</select></div>

  {needsConversion&&<div className="recipe-inline-package"><span>每 1 {draft.unit}＝</span><input aria-label={`${line.name}包裝內容量`} type="number" inputMode="decimal" min="0" step="any" placeholder="內容量" value={draft.content} disabled={disabled} onChange={e=>change({content:e.target.value})}/><select aria-label={`${line.name}包裝內容單位`} value={draft.contentUnit} disabled={disabled} onChange={e=>change({contentUnit:e.target.value})}>{choices(draft.contentUnit).map(u=><option value={u} key={u}>{u}</option>)}</select></div>}
  {draft.rawAmount!==null&&Number(draft.amount)>Number(draft.rawAmount)&&<small className="recipe-inline-estimate">高估計價 · 原進價 {Number(draft.rawAmount).toLocaleString('zh-TW',{maximumFractionDigits:6})} 元／{draft.unit}</small>}
{error&&<small className="recipe-inline-error" role="alert">{error}</small>}
 </div>;
}
