'use client';
import {useRef,useState} from 'react';
import {appError,readWorkspace,writeOperation,type AppStore} from '@/lib/app-workspace';
import {recipeDisplayName,recipeCost,recipePurchaseDisplay,recipePurchaseUnitAmount,type RecipeCard,type RecipeWorkspace} from '@/lib/recipe-cost';
import RecipeModal from './recipe-modal';
import {recipeMoney} from './recipe-editor';
import './recipe-cost-review.css';

type Props={store:AppStore;workspace:RecipeWorkspace;beforeReview:(id:string)=>Promise<boolean>;reload:()=>Promise<RecipeWorkspace>};
const changed=(card:RecipeCard)=>{
 const saved=card.cost,latest=card.proposed_cost;
 if(!saved||!latest)return true;
 const baseline=card.approved_cost?.document||card.document;
 if(baseline.yield!==card.document.yield||baseline.unit!==card.document.unit)return true;
 return saved.lines.length!==latest.lines.length||latest.lines.some(line=>{
  const old=saved.lines.find(row=>row.id===line.id);
  return !old||(old.amount===null)!==(line.amount===null)||(old.amount!==null&&line.amount!==null&&Math.abs(old.amount-line.amount)>0.000001);
 });
};
export default function RecipeCostReview({store,workspace,beforeReview,reload}:Props){
 const [selected,setSelected]=useState<RecipeCard|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const flight=useRef(false),retry=useRef<{payload:Record<string,unknown>;request:string}|null>(null);
 const reviewWorkspace={...workspace,recipes:workspace.recipes.map(card=>({...card,proposed_cost:workspace.pricing_loaded===false?undefined:recipeCost(card.document,{...workspace,cost_mode:'latest'},[card.id])}))};
 const pending=workspace.pricing_loaded===false?[]:reviewWorkspace.recipes.filter(changed),admin=workspace.can_price&&store.access_mode!=='VIEW';
 async function review(id:string){
  if(flight.current)return;flight.current=true;setBusy(true);setError('');
  try{if(!await beforeReview(id)){setError('這份配方或引用備料仍有待補資料，原成本保留；可先繼續其他項目。');return;}
   await reload();const card=await readWorkspace<RecipeCard>(store.id,'recipes.review',{id});
   if(card){setSelected(card);retry.current=null;}
  }catch(e){setError(appError(e));}finally{flight.current=false;setBusy(false);}
 }
 async function confirm(){
  if(!selected||flight.current)return;flight.current=true;setBusy(true);setError('');
  try{
   const attempt=retry.current||{payload:{id:selected.id,revision:selected.revision,approval_id:selected.approved_cost?.id||null,expected_token:selected.proposed_cost_token},request:crypto.randomUUID()};
   retry.current=attempt;
   await writeOperation(store.id,'recipe.cost.confirm',attempt.payload,attempt.request);
   await reload();setSelected(null);retry.current=null;
  }catch(e){setError(`${appError(e)} 若資料已異動，請關閉後重新查看；原成本仍保留。`);}finally{flight.current=false;setBusy(false);}
 }
 const latest=selected?.proposed_cost,old=selected?{...selected.approved_cost,cost:selected.cost,document:selected.approved_cost?.document||selected.document,at:selected.approved_cost?.at||selected.updated_at}:null;
 const purchaseLabel=(price:import('@/lib/recipe-cost').RecipePrice|null|undefined)=>{if(!price)return '—';const purchase=price.purchase?recipePurchaseDisplay(price.purchase):null;const value=recipePurchaseUnitAmount({...price,purchase});return value===null?'—':`${value.toLocaleString('zh-TW',{maximumFractionDigits:4})} 元／${purchase?.unit||price.unit}`;};
 return <section className="recipe-cost-review" aria-label="成本異動提醒">
  <div className="recipe-cost-review-header"><strong>已保存成本保留</strong><span>{workspace.pricing_loaded===false?'已保存成本已讀取':pending.length?`${pending.length} 份成本待確認`:'目前沒有成本異動'}</span></div>
  <p>儲存後價格與成本固定。新進價只提醒，確認後才更新這份食譜；其他食譜保留原成本。</p>
  <details><summary>查看食譜與備料成本</summary><div className="recipe-cost-review-list">{reviewWorkspace.recipes.map(card=><div key={card.id}><span><strong>{recipeDisplayName(card.document)}</strong><small>{`保留成本：${recipeMoney(card.cost.total)}${card.cost.total===null?`（已計入 ${recipeMoney(card.cost.subtotal)}）`:''}`}</small></span><button type="button" className="recipe-secondary" disabled={busy} onClick={()=>void review(card.id)}>{changed(card)?'查看異動':'查看紀錄'}</button></div>)}</div></details>
  {error&&<p role="alert" className="recipe-alert">{error}</p>}
  {selected&&<RecipeModal title={`${recipeDisplayName(selected.document)} · 成本確認`} busy={busy} onClose={()=>{setSelected(null);setError('');}}>
   <p>比較整份配方成本，包含引用備料。按下確認才會採用右側金額，並保留原版本。</p>
   <div className="recipe-cost-comparison"><div><small>原保存成本</small><strong>{recipeMoney(old?.cost.total??null)}</strong><small>{old?new Date(old.at).toLocaleString('zh-TW'):'尚未確認'}</small></div><div><small>最新價格試算（未套用）</small><strong>{recipeMoney(latest?.total??null)}</strong><small>{old?.cost.total!=null&&latest?.total!=null?`差額 ${recipeMoney(latest.total-old.cost.total)}${old.cost.total>0?`（${((latest.total/old.cost.total-1)*100).toFixed(1)}%）`:''}`:'缺少資料的項目仍列為待補'}</small></div></div>
   <div className="recipe-cost-table-scroll"><table><thead><tr><th>品項</th><th>原進價</th><th>新進價</th><th>原使用成本</th><th>更新後成本</th></tr></thead><tbody>{Array.from(new Set([...(old?.document.lines.map(line=>line.id)||[]),...selected.document.lines.map(line=>line.id)])).map(id=>{const line=selected.document.lines.find(l=>l.id===id)||old?.document.lines.find(l=>l.id===id),a=old?.cost.lines.find(l=>l.id===id),b=latest?.lines.find(l=>l.id===id);return <tr key={id}><th>{line?.name}</th><td>{purchaseLabel(a?.price)}</td><td>{purchaseLabel(b?.price)}</td><td>{a?recipeMoney(a.amount):'新增'}</td><td>{b?recipeMoney(b.amount):'已移除'}</td></tr>;})}</tbody></table></div>
   {selected.cost_history&&<details><summary>歷次成本紀錄</summary>{selected.cost_history.map(entry=><p key={entry.id}>{new Date(entry.at).toLocaleString('zh-TW')} · {entry.actor_name||'原始紀錄'} · {recipeMoney(entry.cost.total)}{entry.cost.total===null?`（已計入 ${recipeMoney(entry.cost.subtotal)}）`:''}</p>)}</details>}
   {error&&<p role="alert" className="recipe-alert">{error}</p>}
   <div className="recipe-actions"><button className="recipe-secondary" disabled={busy} onClick={()=>setSelected(null)}>保留原成本</button>{admin&&<button className="shell-primary" disabled={busy||latest?.total==null} onClick={()=>void confirm()}>{busy?'處理中…':'確認更新成本'}</button>}</div>
  </RecipeModal>}
 </section>;
}
