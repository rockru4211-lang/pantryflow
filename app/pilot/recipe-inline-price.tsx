'use client';
import {recipeFactor,recipeUnit,type RecipeLine,type RecipeWorkspace} from '@/lib/recipe-cost';
import {changeRecipePriceUnit,findRecipePrice,type RecipePriceDraft} from '@/lib/recipe-price-draft';
export const recipeInputUnits=['g','公斤','台斤','ml','L','顆','片','份','包','桶','瓶','罐','盒','袋','箱','塊','卷'];
const choices=(unit:string)=>[...new Set([unit,...recipeInputUnits])].filter(Boolean);
export default function RecipeInlinePrice({line,draft,workspace,pending,error,disabled,onChange}:{line:RecipeLine;sourceText:string;draft:RecipePriceDraft;workspace:RecipeWorkspace;pending:boolean;error?:string;disabled:boolean;onChange:(draft:RecipePriceDraft)=>void;onMap:(id?:string)=>void;onDiscard:()=>void}){
 const needsConversion=recipeUnit(draft.unit)!==recipeUnit(line.unit);
 const change=(patch:Partial<RecipePriceDraft>)=>onChange({...draft,...patch,referenceId:undefined,source:'手動補價',amountEdited:true,date:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei'}).format(new Date())});
 const current=findRecipePrice(line,workspace);
 const sourceLabel=current?.source_kind==='history'?'過去食譜成本表':current?.source||draft.source;
 return <div className="recipe-inline-price">
  <span className="recipe-mobile-label">進價</span>
  {<small className="recipe-price-source">來源：{pending?'手動輸入':sourceLabel}{current?.effective_date?` · ${current.effective_date}`:''}</small>}
  <div className="recipe-direct-pair"><input data-price-input aria-label={`${line.name}成本單價`} type="number" inputMode="decimal" min="0" step="any" placeholder="填進價" value={draft.amount} disabled={disabled} onChange={e=>change({amount:e.target.value,rawAmount:null,referenceId:undefined,source:'手動補價',amountEdited:true})}/><select aria-label={`${line.name}計價單位`} value={draft.unit} disabled={disabled} onChange={e=>{onChange(changeRecipePriceUnit(draft,e.target.value));}}>{choices(draft.unit).map(u=><option key={u} value={u}>元／{u}</option>)}</select></div>

  {!needsConversion&&<small className="recipe-inline-conversion">依實際用量計價，不必補重量。{recipeFactor(draft.unit)!==recipeFactor(line.unit)?` 1 ${draft.unit}＝${recipeFactor(draft.unit)/recipeFactor(line.unit)} ${line.unit} · 自動換算`:''}</small>}
  {needsConversion&&<div className="recipe-inline-package"><span>每 1 {draft.unit}＝</span><input aria-label={`${line.name}包裝內容量`} type="number" inputMode="decimal" min="0" step="any" placeholder="容量或重量，可留白" value={draft.content} disabled={disabled} onChange={e=>change({content:e.target.value})}/><select aria-label={`${line.name}包裝內容單位`} value={draft.contentUnit} disabled={disabled} onChange={e=>change({contentUnit:e.target.value})}>{choices(draft.contentUnit).map(u=><option value={u} key={u}>{u}</option>)}</select></div>}
  {needsConversion&&<small className="recipe-inline-conversion">填每{draft.unit}重量或容量，系統依左側實際用量計算成本；資料可後補。</small>}
  {draft.rawAmount!==null&&Number(draft.amount)>Number(draft.rawAmount)&&<small className="recipe-inline-estimate">高估計價 · 原進價 {draft.rawAmount} 元／{draft.unit}</small>}
{error&&<small className="recipe-inline-error" role="alert">{error}</small>}
 </div>;
}
