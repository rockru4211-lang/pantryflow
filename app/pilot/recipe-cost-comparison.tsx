'use client';
import {useState} from 'react';
import {ChevronDown,ChevronRight,LockKeyhole,RefreshCw} from 'lucide-react';
import {recipeDisplayName,type RecipeCard,type RecipePrice,type RecipeWorkspace} from '@/lib/recipe-model';
import {recipeCostComparison,recipeComponentSources,recipeTrialPriceDetails,signedCost} from '@/lib/recipe-cost-comparison';
import RecipeModal from './recipe-modal';
import './recipe-cost-comparison.css';
const money=(value:number|null)=>value===null?'待補成本':`NT$ ${value.toFixed(2)}`;
function Source({price}:{price:RecipePrice|null}){
 if(!price)return <>待補有效進價或換算</>;
 const details=recipeTrialPriceDetails(price);
 return <>{[price.effective_date,price.supplier_name||price.source_ref?.supplier_name,price.source].filter(Boolean).join(' · ')||'已保存價格'}<small>{details.original}</small><small>{details.specification}</small><small>{details.converted}</small>{price.source_ref?.name&&<small>{price.source_ref.name}</small>}</>;
}
export default function RecipeCostComparison({card,workspace,onClose}:{card:RecipeCard;workspace?:RecipeWorkspace;onClose:()=>void}){
 const [tab,setTab]=useState<'trial'|'history'>('trial'),[expanded,setExpanded]=useState<string[]>([]);
 const {baseline,latest,before,after,delta,percent}=recipeCostComparison(card,workspace);
 return <RecipeModal title="成本浮動明細" className="cost-change-modal" closeLabel="關閉成本明細" onClose={onClose}>
  <header className="cost-detail-title"><div><h3>{recipeDisplayName(card.document)}</h3><p>{card.recipe_code||'—'} <span>整份配方 · {card.document.yield} {card.document.unit} · 未稅</span></p></div></header>
  <div className="cost-comparison"><section><span><LockKeyhole size={14}/>原定價基準</span><strong>{money(before)}</strong><small>{card.approved_cost?.at||card.updated_at} · 固定保留</small></section><section className="latest"><span><RefreshCw size={14}/>最新價試算</span><strong>{!latest?'尚未讀取':after===null?'待補進價':money(after)}</strong><small>{!latest?'最新價格尚未載入':after===null?`${latest.missing} 項成本未完整`:'有效進價自動試算'}{card.latest_cost_at?` · ${card.latest_cost_at}`:''}</small></section><section className={`difference ${delta!==null&&delta>0?'up':delta!==null&&delta<0?'down':''}`}><span>相較原定價基準</span><strong>{signedCost(delta)} <em>{signedCost(percent,'%')}</em></strong><small>差額（NT$）／漲跌幅</small></section></div>
  <nav className="cost-detail-tabs" aria-label="成本明細頁籤"><button aria-pressed={tab==='trial'} className={tab==='trial'?'selected':''} onClick={()=>setTab('trial')}>本次試算</button><button aria-pressed={tab==='history'} className={tab==='history'?'selected':''} onClick={()=>setTab('history')}>基準紀錄</button></nav>
  {tab==='history'?<><div className="detail-table-title"><strong>原定價基準</strong><span>只讀保存</span></div><p className="record-note">第 {card.revision} 版 · {money(before)}。原食譜用量與採用價格保留，新進價只更新最新價試算。</p>{card.cost_history?.map(record=><p className="record-note" key={record.id}>{record.at} · {money(record.cost.total)} {record.actor_name}</p>)}</>:<>
   <div className="detail-table-title"><strong>食材與配件</strong><span>同一配方用量，對照原基準與最新有效進價</span></div>
   <div className="cost-detail-scroll"><table className="cost-detail-table"><thead><tr><th>食材／配件</th><th>用量</th><th>基準成本</th><th>最新試算</th><th>差額</th><th>有效進價來源</th></tr></thead><tbody>{card.document.lines.map(line=>{
    const base=baseline.lines.find(row=>row.id===line.id)?.amount??null,trial=latest?.lines.find(row=>row.id===line.id),value=trial?.amount??null,change=base!==null&&value!==null?value-base:null,open=expanded.includes(line.id);
    const sources=line.recipe_id&&workspace&&workspace.current_prices!==undefined&&open?recipeComponentSources(card,line.id,workspace):[];
    return <CostRows key={line.id} row={<tr className={change?'changed-row':''}><td>{line.recipe_id?<button className="detail-row-name" aria-expanded={open} onClick={()=>setExpanded(current=>open?current.filter(id=>id!==line.id):[...current,line.id])}>{open?<ChevronDown size={14}/>:<ChevronRight size={14}/>}<b>{line.name}</b></button>:<b>{line.name}</b>}{line.recipe_id&&<small>配件</small>}</td><td>{line.quantity} {line.unit}</td><td>{money(base)}</td><td><b>{!latest?'尚未讀取':money(value)}</b></td><td className={change&&change>0?'up':change&&change<0?'down':''}>{signedCost(change)}</td><td>{line.recipe_id?'依配件內食材與損耗計算':trial?.price?<Source price={trial.price}/>:trial?.reason||'待補有效進價'}</td></tr>} detail={open&&<tr className="component-source"><td colSpan={6}>{sources.length?sources.map(source=><div key={source.key}><strong>{source.name}</strong><span>{Number.isFinite(source.quantity)?Number(source.quantity.toFixed(4)):'—'} {source.unit}</span><b>{money(source.amount)}</b><span><Source price={source.price}/>{source.reason&&<small>{source.reason}</small>}</span></div>):<p>配件來源尚未載入或未設定食材。原基準仍保留。</p>}<small>以上為本次用量的配件食材試算，已含配件損耗，不重複加總；原基準以已保存的配件成本為準。</small></td></tr>}/>;
   })}</tbody><tfoot><tr><td>整份配方合計</td><td>{card.document.yield} {card.document.unit}</td><td>{money(before)}</td><td>{!latest?'尚未讀取':money(after)}</td><td>{signedCost(delta)}</td><td>配件不重複加總</td></tr></tfoot></table></div>
  </>}
  <footer className="cost-detail-footer"><span><LockKeyhole size={14}/>此處不覆蓋原定價基準或歷史紀錄</span><button onClick={onClose}>關閉</button></footer>
 </RecipeModal>;
}
function CostRows({row,detail}:{row:React.ReactNode;detail:React.ReactNode}){return <>{row}{detail}</>;}
