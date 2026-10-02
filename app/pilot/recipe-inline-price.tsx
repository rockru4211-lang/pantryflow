'use client';
import {ChevronDown,Search} from 'lucide-react';
import {useState} from 'react';
import {recipeFactor,recipeUnit,recipeNoteBasis,type RecipeLine,type RecipeWorkspace} from '@/lib/recipe-cost';
import {changeRecipePriceUnit,findRecipePrice,recipePriceDraft,recipePriceKey,type RecipePriceDraft} from '@/lib/recipe-price-draft';
export const recipeInputUnits=['g','公斤','台斤','ml','L','顆','片','份','包','桶','瓶','罐','盒','袋','箱','塊','卷'];
const choices=(unit:string)=>[...new Set([unit,...recipeInputUnits])].filter(Boolean);
export default function RecipeInlinePrice({line,sourceText,draft,workspace,pending,error,disabled,onChange,onMap,onDiscard}:{line:RecipeLine;sourceText:string;draft:RecipePriceDraft;workspace:RecipeWorkspace;pending:boolean;error?:string;disabled:boolean;onChange:(draft:RecipePriceDraft)=>void;onMap:(id?:string)=>void;onDiscard:()=>void}){
 const [search,setSearch]=useState(''),[totalMode,setTotalMode]=useState(false);
 const needsConversion=recipeUnit(draft.unit)!==recipeUnit(line.unit),basis=recipeNoteBasis(line,sourceText);
 const change=(patch:Partial<RecipePriceDraft>)=>onChange({...draft,...patch});
 const mapped=workspace.products.find(p=>p.id===line.product_id),current=findRecipePrice(line,workspace);
 const candidates=(workspace.price_candidates||[]).filter(p=>p.key===recipePriceKey(line));
 const sourceLabel=current?.source_kind==='history'?'歷史價格':current?.source_kind==='purchase'||current?.source==='已核對進貨'?'進貨價格':current?.source;
 const usage=Number(line.quantity)*recipeFactor(line.unit)/recipeFactor(draft.unit),canTotal=!needsConversion&&Number.isFinite(usage)&&usage>0;
 const total=totalMode&&canTotal;
 return <div className="recipe-inline-price">
  <span className="recipe-mobile-label">食材單價</span>
  {!pending&&current&&<small className="recipe-price-source">{sourceLabel} · {current.effective_date||'日期未記載'}{current.source_ref?.url&&/^https?:\/\//i.test(current.source_ref.url)&&<a href={current.source_ref.url} target="_blank" rel="noreferrer">查看來源</a>}</small>}
  {!pending&&candidates.length>0&&<details className="recipe-price-candidates" open={!current}><summary>{current?'另有價格待確認':`找到 ${candidates.length} 筆價格待確認`}</summary>{candidates.map(candidate=><div key={candidate.reference_id}><strong>{candidate.source_ref?.name||candidate.name}</strong><small>{candidate.purchase?`${candidate.purchase.amount/candidate.purchase.quantity} 元／${candidate.purchase.unit}`:`${candidate.price} 元／${candidate.unit}`} · {candidate.effective_date||'日期未記載'}</small><small>{candidate.source_ref?.review_note||'請確認是同一食材與包裝規格。'}</small><button type="button" className="text-button" disabled={disabled} onClick={()=>onChange(recipePriceDraft(line,{...workspace,prices:[candidate]},sourceText))}>確認品項並帶入</button></div>)}</details>}
  <div className="recipe-direct-pair"><input data-price-input aria-label={`${line.name}${total?'使用量合計':'成本單價'}`} type="number" inputMode="decimal" min="0" step="any" placeholder={total?'填本次用量總價':'填單價'} value={total&&draft.amount!==''?String(Number(draft.amount)*usage):draft.amount} disabled={disabled} onChange={e=>change({amount:e.target.value===''?'':String(Number(e.target.value)/(total?usage:1)),amountEdited:true})}/>{total?<span>元／{line.quantity} {line.unit}合計</span>:<select aria-label={`${line.name}計價單位`} value={draft.unit} disabled={disabled} onChange={e=>{setTotalMode(false);onChange(changeRecipePriceUnit(draft,e.target.value));}}>{choices(draft.unit).map(u=><option key={u} value={u}>元／{u}</option>)}</select>}</div>
  {canTotal&&<button type="button" className="text-button" disabled={disabled} onClick={()=>setTotalMode(!total)}>{total?'改填每單位價格':`改填 ${line.quantity} ${line.unit}合計金額`}</button>}
  {!needsConversion&&<small className="recipe-inline-conversion">依實際用量計價，不必補重量。{total&&draft.amount!==''?` 每${draft.unit} ${Number(draft.amount).toLocaleString('zh-TW',{maximumFractionDigits:6})}元` : recipeFactor(draft.unit)!==recipeFactor(line.unit)?` 1 ${draft.unit}＝${recipeFactor(draft.unit)/recipeFactor(line.unit)} ${line.unit} · 自動換算`:''}</small>}
  {needsConversion&&<div className="recipe-inline-package"><span>每 1 {draft.unit}＝</span><input aria-label={`${line.name}包裝內容量`} type="number" inputMode="decimal" min="0" step="any" placeholder="換算數量" value={draft.content} disabled={disabled} onChange={e=>change({content:e.target.value})}/><select aria-label={`${line.name}包裝內容單位`} value={draft.contentUnit} disabled={disabled} onChange={e=>change({contentUnit:e.target.value})}>{choices(draft.contentUnit).map(u=><option value={u} key={u}>{u}</option>)}</select></div>}
  {needsConversion&&<small className="recipe-inline-conversion">整卷、整盒使用：將左側用量單位改成「{draft.unit}」並填實際數量；只有拆開使用才需換算。{basis&&!draft.content?` 原備註：${basis.quantity}${basis.unit}＝${basis.count}${basis.countUnit}`:''}</small>}
  {draft.rawAmount!==null&&Number(draft.amount)>Number(draft.rawAmount)&&<small className="recipe-inline-estimate">高估計價 · 原進價 {draft.rawAmount} 元／{draft.unit}</small>}
  <details className="recipe-inline-details"><summary>價格設定{pending&&<span>待儲存</span>}<ChevronDown size={13}/></summary><div>
   {pending&&<button type="button" className="text-button" disabled={disabled} onClick={onDiscard}>取消價格修改</button>}
   <label>原始進價<div className="recipe-direct-pair"><input aria-label={`${line.name}原始進價`} type="number" inputMode="decimal" min="0" step="any" placeholder={draft.amount||'依填寫單價'} value={draft.rawAmount??''} disabled={disabled} onChange={e=>change({rawAmount:e.target.value||null})}/><span>元／{draft.unit}</span></div></label>
   <small>成本單價與原進價分開保留。單價供本門市食譜共用；不同包裝單位不會直接沿用原價。</small>
   <label>供應商<input aria-label={`${line.name}供應商`} list={`recipe-suppliers-${line.id}`} value={draft.supplierName||''} placeholder="可搜尋或補填" disabled={disabled} onChange={e=>{const name=e.target.value,matches=(workspace.suppliers||[]).filter(s=>s.name===name);change({supplierName:name,supplierId:matches.length===1?matches[0].id:null});}}/><datalist id={`recipe-suppliers-${line.id}`}>{(workspace.suppliers||[]).map(s=><option key={s.id} value={s.name}/>)}</datalist></label>
   <label>價格來源<input aria-label={`${line.name}價格來源`} value={draft.source} disabled={disabled} onChange={e=>change({source:e.target.value})}/></label>
   <label>價格日期<input aria-label={`${line.name}價格日期`} type="date" value={draft.date} disabled={disabled} onChange={e=>change({date:e.target.value})}/></label>{draft.referenceId&&!draft.date&&<small>原始資料未記載價格日期，保留空白。</small>}
   <small>{mapped?`已對應：${mapped.name} ${mapped.specification||''}`:'對應進貨食材後可帶入已有價格。'}</small>
   <label className="recipe-search"><Search size={14}/><input aria-label={`${line.name}搜尋進貨食材`} placeholder="搜尋對應食材" value={search} disabled={disabled} onChange={e=>setSearch(e.target.value)}/></label>
   {search.trim()&&<div className="recipe-match-list">{workspace.products.filter(p=>`${p.name} ${p.specification||''}`.toLowerCase().includes(search.trim().toLowerCase())).slice(0,8).map(p=><button type="button" key={p.id} disabled={disabled} onClick={()=>{onMap(p.id);setSearch('');}}>{p.name}<small>{p.specification||p.unit}</small></button>)}</div>}
   {line.product_id&&<button type="button" className="text-button" disabled={disabled} onClick={()=>onMap(undefined)}>取消對應</button>}
  </div></details>{error&&<small className="recipe-inline-error" role="alert">{error}</small>}
 </div>;
}
