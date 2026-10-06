'use client';
import {useRef,useState} from 'react';
import {appError,readWorkspace,writeOperation,type AppStore} from '@/lib/app-workspace';
import {recipePurchaseDisplay,recipePurchaseUnitAmount,type RecipeCost,type RecipeCard,type RecipePrice,type RecipeWorkspace} from '@/lib/recipe-cost';
import {recipeIngredientMovements,type IngredientMovement} from '@/lib/recipe-ingredient-review';
import RecipeModal from './recipe-modal';
import {recipeMoney} from './recipe-editor';
import './recipe-cost-review.css';
type Props={store:AppStore;workspace:RecipeWorkspace;beforeReview:(id:string)=>Promise<boolean>;reload:()=>Promise<RecipeWorkspace>};
type Review={key:string;token:string;rows:{id:string;name:string;kind:string;before:RecipeCost;after:RecipeCost}[]};
function purchaseLabel(price:RecipePrice|null){if(!price)return '—';const purchase=price.purchase?recipePurchaseDisplay(price.purchase):null,value=recipePurchaseUnitAmount({...price,purchase});return value===null?'—':`${value.toLocaleString('zh-TW',{maximumFractionDigits:4})} 元／${purchase?.unit||price.unit}`;}
export default function RecipeCostReview({store,workspace,reload}:Props){
 const [selected,setSelected]=useState<{movement:IngredientMovement;review:Review}|null>(null),[history,setHistory]=useState<RecipeCard|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const flight=useRef(false),retry=useRef<{payload:{key:string;token:string};request:string}|null>(null);
 const groups=recipeIngredientMovements(workspace),canConfirm=workspace.can_price&&store.access_mode!=='VIEW';
 async function review(movement:IngredientMovement){
  if(flight.current)return;flight.current=true;setBusy(true);setError('');
  try{const result=await writeOperation<Review>(store.id,'recipe.ingredient.review',{key:movement.key},crypto.randomUUID());setSelected({movement,review:result});retry.current=null;}
  catch(e){setError(appError(e));}finally{setBusy(false);flight.current=false;}
 }
 async function confirm(){
  if(!selected||flight.current)return;flight.current=true;setBusy(true);setError('');
  try{const attempt=retry.current||{payload:{key:selected.review.key,token:selected.review.token},request:crypto.randomUUID()};retry.current=attempt;
   const result=await writeOperation<{updated:number}>(store.id,'recipe.ingredient.confirm',attempt.payload,attempt.request);
   await reload();setNotice(`已更新 ${result.updated} 份食譜／配件，更新紀錄已保留。`);setSelected(null);retry.current=null;
  }catch(e){setError(`${appError(e)} 請重新查看異動；確認前的成本保留。`);}finally{flight.current=false;setBusy(false);}
 }
 async function showHistory(id:string){if(flight.current)return;flight.current=true;setBusy(true);setError('');try{setHistory(await readWorkspace<RecipeCard>(store.id,'recipes.review',{id}));}catch(e){setError(appError(e));}finally{flight.current=false;setBusy(false);}}
 const dishes=selected?.review.rows.filter(row=>row.kind==='dish').length||0;
 return <section className="recipe-cost-review" aria-label="食材價格異動提醒">
  <div className="recipe-cost-review-header"><strong>食材價格異動</strong><span>{workspace.pricing_loaded===false?'讀取最新進價中…':groups.length?`${groups.length} 項食材價格異動`:'目前沒有價格異動'}</span></div>
  <p>已儲存成本固定；查看相關食譜，確認後統一更新本次食材價格。</p>
  {groups.map(group=><div className="recipe-ingredient-alert" key={group.key}><span><strong>{group.name} · {group.percent===null?'價格異動':`${group.percent>=0?'上漲':'下降'} ${Math.abs(group.percent).toLocaleString('zh-TW',{maximumFractionDigits:1})}%`}</strong><small>{purchaseLabel(group.before)} → {purchaseLabel(group.after)} · 影響 {group.recipeIds.filter(id=>workspace.recipes.find(r=>r.id===id)?.document.kind==='dish').length} 份食譜</small></span><button className="recipe-secondary" disabled={busy} onClick={()=>void review(group)}>查看並確認</button></div>)}
  {notice&&<p role="status">✓ {notice}</p>}
  <details><summary>查看儲存紀錄</summary><div className="recipe-cost-review-list">{workspace.recipes.map(card=><div key={card.id}><span>{card.document.name}</span><button className="text-button" disabled={busy} onClick={()=>void showHistory(card.id)}>查看紀錄</button></div>)}</div></details>
  {error&&!selected&&<p role="alert" className="recipe-alert">{error}</p>}
  {selected&&<RecipeModal title={`${selected.movement.name} · 價格異動確認`} busy={busy} onClose={()=>{setSelected(null);setError('');}}>
   <p>{purchaseLabel(selected.movement.before)} → {purchaseLabel(selected.movement.after)}</p><small>來源：{selected.movement.after.source} · {selected.movement.after.effective_date||''}</small>
   <div className="recipe-cost-table-scroll"><table><thead><tr><th>相關食譜／配件</th><th>原成本</th><th>更新後</th><th>差額</th></tr></thead><tbody>{selected.review.rows.map(row=><tr key={row.id}><th>{row.name}<small>{row.kind==='prep'?'配件整批成本':'食譜整份成本（含配件）'}</small></th><td>{recipeMoney(row.before?.total??null)}</td><td>{recipeMoney(row.after.total)}{row.after.total===null&&<small>已計入 {recipeMoney(row.after.subtotal)}</small>}</td><td>{row.before?.total!=null&&row.after.total!=null?recipeMoney(row.after.total-row.before.total):'—'}</td></tr>)}</tbody></table></div>
   <p>確認前維持原成本；本次僅更新「{selected.movement.name}」。無法計算的項目保留原金額，不影響其他項目儲存。</p>
   {error&&<p role="alert" className="recipe-alert">{error}</p>}
   <div className="recipe-actions"><button className="recipe-secondary" disabled={busy} onClick={()=>setSelected(null)}>保留原成本</button>{canConfirm&&<button className="shell-primary" disabled={busy||!selected.review.rows.length} onClick={()=>void confirm()}>{busy?'儲存中…':`確認並更新全部 ${dishes} 份食譜及相關配件`}</button>}</div>
  </RecipeModal>}
  {history&&<RecipeModal title={`${history.document.name} · 儲存紀錄`} busy={busy} onClose={()=>setHistory(null)}>{history.cost_history?.map(entry=><p key={entry.id}>{new Date(entry.at).toLocaleString('zh-TW')} · {entry.actor_name||'原始紀錄'} · {recipeMoney(entry.cost.total)}{entry.cost.total===null?`（已計入 ${recipeMoney(entry.cost.subtotal)}）`:''}</p>)}</RecipeModal>}
 </section>;
}
