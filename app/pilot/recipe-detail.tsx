'use client';
import {useEffect,useRef,useState} from 'react';
import {Pencil,ExternalLink} from 'lucide-react';
import {canData} from '@/lib/data-access';
import {appError,type AppStore} from '@/lib/app-workspace';
import {supabase} from '@/lib/supabase-browser';
import type {RecipeCard,RecipeWorkspace} from '@/lib/recipe-model';
import {recipeDisplayName,recipeNotesView,recipeSourceUrl} from '@/lib/recipe-model';
import {recipeComponents,recipeLineCode} from '@/lib/recipe-cost';
import {canApproveRecipe,lifecycleLabels,recipeLifecycle,type RecipeLifecycle,type RecipeMenu} from '@/lib/recipe-organization';
import {recipeMoney} from './recipe-editor';
import {recipeCostSummary,recipeSavedLineCost,recipeUsageSummary,recipeKitchenLineName} from '@/lib/recipe-display';
import {recipeUnitMoney} from './recipe-price-editor';
import RecipeModal from './recipe-modal';
import './recipe-detail.css';

type Props={card:RecipeCard;workspace:RecipeWorkspace;store:AppStore;onBack:()=>void;onEdit:(componentId?:string)=>void;reload:()=>Promise<unknown>;beforeUpdate:()=>boolean};
export default function RecipeDetail({card,workspace,store,onBack,onEdit,reload,beforeUpdate}:Props){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[componentId,setComponentId]=useState('');
 const [showComponents,setShowComponents]=useState(false);
 const [menus,setMenus]=useState<RecipeMenu[]>([]);
 useEffect(()=>{let active=true;void supabase.rpc('recipe_organization',{p_store_id:store.id}).then(({data,error})=>{if(!active)return;if(error)setError(appError(error));else setMenus((data as unknown as {menus:RecipeMenu[]}).menus);});return()=>{active=false;};},[store.id]);
 const flight=useRef(false),requests=useRef(new Map<string,string>());
 const doc=card.document,state=recipeLifecycle(doc,menus),editable=store.role!=='STAFF'&&store.access_mode!=='VIEW'&&canData(store,'RECIPE',true),approver=editable&&canApproveRecipe(store);
 const notes=recipeNotesView(doc.notes),source=recipeSourceUrl(doc.source_url),components=recipeComponents(card,workspace);
 const summary=recipeCostSummary(doc,card.cost),selected=components.find(item=>item.id===componentId)||components[0];
 async function classify(next:RecipeLifecycle){
  if(flight.current||!editable)return;
  if(!beforeUpdate()){setError('此食譜有未儲存的編輯，請先完成儲存。');return;}
  flight.current=true;setBusy(true);setError('');setNotice('');
  const key=`${card.id}:${card.revision}:${next}`;if(!requests.current.has(key))requests.current.set(key,crypto.randomUUID());
  try{const {error}=await supabase.rpc('recipe_organization',{p_store_id:store.id,p_action:'update',p_data:{rows:[{id:card.id,revision:card.revision}],patch:{lifecycle:next}},p_request_id:requests.current.get(key)!}).abortSignal(AbortSignal.timeout(20000));if(error)throw error;await reload();requests.current.delete(key);setNotice(`已列為「${lifecycleLabels[next]}」，已儲存成本保留。`);}catch(e){setError(appError(e));}finally{flight.current=false;setBusy(false);}
 }
 const detailTable=(item:RecipeCard)=><div className="recipe-detail-table-scroll"><table><thead><tr><th>食材／配件</th><th>用量</th><th>單位成本</th><th>使用成本</th></tr></thead><tbody>{item.document.lines.map(line=>{const amount=recipeSavedLineCost(item,line);return <tr key={line.id}><th>{line.recipe_id&&components.some(c=>c.id===line.recipe_id)?<button className="recipe-name-button" onClick={()=>{setComponentId(line.recipe_id!);setShowComponents(true);}}>{line.name}<span className="recipe-tag">配件</span></button>:recipeKitchenLineName(line,workspace)}<small>{recipeLineCode(line,workspace)}</small></th><td>{line.quantity||'—'} {line.unit}</td><td>{amount!==null&&Number(line.quantity)>0?`${recipeUnitMoney(amount/Number(line.quantity))}／${line.unit}`:'—'}</td><td>{recipeMoney(amount)}</td></tr>;})}</tbody></table></div>;
 const costSummary=(item:RecipeCard)=>{const value=recipeCostSummary(item.document,item.cost);return <div className="recipe-detail-component-summary"><span>製成量 <strong>{value.hasYield?`${item.document.yield} ${item.document.unit}`:'待填'}</strong></span><span>{value.partial?'已計入成本':'整批成本'} <strong>{recipeMoney(value.amount)}</strong></span>{value.hasYield&&<span>每 {item.document.unit} {value.partial?'已計入':'成本'} <strong>{value.unitAmount===null?'—':recipeUnitMoney(value.unitAmount)}</strong></span>}</div>;};
 return <RecipeModal title={recipeDisplayName(doc)} busy={busy} closeLabel="關閉食譜檢視" onClose={onBack}>
 <section className="recipe-detail" aria-label="檢視食譜">
  {error&&<p className="recipe-alert" role="alert">{error}</p>}{notice&&<p className="recipe-save-success" role="status">{notice}</p>}
  <div className="recipe-detail-heading"><div><span className={`rd-state rd-${state}`}>{lifecycleLabels[state]}</span><p>{card.recipe_code||'—'} · {store.name}{doc.season?` · ${doc.season}`:''}</p>{editable&&<button className="recipe-secondary" disabled={busy} onClick={()=>onEdit()}><Pencil size={16}/>編輯食譜</button>}</div><div className="recipe-detail-total"><small>{summary.partial?'總成本（部分）':'總成本'}</small><strong>{recipeMoney(summary.amount)}</strong><small>{card.cost.total!==null?'已鎖定':summary.partial?'部分成本':'尚無成本'}</small></div></div>
  {components.length>0&&<nav className="recipe-detail-views" aria-label="食譜內容"><button type="button" className="recipe-secondary" aria-pressed={!showComponents} onClick={()=>setShowComponents(false)}>{doc.kind==='prep'?'配件配方':'主配方'}</button><button type="button" className="recipe-secondary" aria-pressed={showComponents} onClick={()=>setShowComponents(true)}>配件 {components.length}</button></nav>}
  {(!showComponents||!components.length)&&<section className="recipe-detail-panel"><h2>{doc.kind==='prep'?'配件配方':'主配方'}</h2>{detailTable(card)}{!doc.lines.length&&<p>尚未加入食材</p>}</section>}
  {showComponents&&components.length>0&&<section className="recipe-detail-panel recipe-detail-components"><h2>配件組成</h2><div className="recipe-component-tablist" role="tablist" aria-label="查看配件">{components.map(c=>{const usage=recipeUsageSummary(card,c.id);return <button key={c.id} role="tab" id={`detail-tab-${c.id}`} aria-controls="detail-component-panel" aria-selected={selected?.id===c.id} onClick={()=>setComponentId(c.id)}><span>{c.name}</span><small>{c.recipe?.recipe_code||'—'}</small><small>{usage.lines.length?`本食譜使用 ${recipeMoney(usage.amount)}`:c.uses.length?'計入上層配件':'未設定使用量'}</small></button>;})}</div>
   {selected&&<div role="tabpanel" id="detail-component-panel" aria-labelledby={`detail-tab-${selected.id}`}>
    {selected.recipe?<><header className="recipe-detail-component-heading"><h3>{selected.name} <small>{selected.recipe.recipe_code||'—'}</small></h3></header>{costSummary(selected.recipe)}{(()=>{const usage=recipeUsageSummary(card,selected.id);return <p className="recipe-detail-usage">{usage.lines.length?<>本食譜使用 {usage.lines.map(line=>`${line.quantity||'待填'} ${line.unit}`).join('、')}　·　計入 {recipeMoney(usage.amount)}</>:selected.uses.length?`用於 ${[...new Set(selected.uses.map(use=>recipeDisplayName(use.parent.document)))].join('、')}`:'尚未加入主配方'}{!usage.lines.length&&!selected.uses.length&&editable&&<button className="text-button" disabled={busy} onClick={()=>onEdit(selected.id)}>設定使用量</button>}</p>;})()}{detailTable(selected.recipe)}{(recipeNotesView(selected.recipe.document.notes).text||recipeSourceUrl(selected.recipe.document.source_url))&&<details className="recipe-detail-notes-fold"><summary>做法與原始表格</summary>{recipeNotesView(selected.recipe.document.notes).text&&<p className="recipe-detail-notes">{recipeNotesView(selected.recipe.document.notes).text}</p>}{recipeSourceUrl(selected.recipe.document.source_url)&&<a href={recipeSourceUrl(selected.recipe.document.source_url)!} target="_blank" rel="noopener noreferrer">開啟原始表格 ↗</a>}</details>}</>:<p>請於編輯時選擇配件版本。</p>}
   </div>}
  </section>}
  {(notes.text||source||notes.imported)&&<details className="recipe-detail-panel recipe-detail-notes-fold"><summary>做法與原始表格</summary>{source&&<a className="recipe-source-link" href={source} target="_blank" rel="noopener noreferrer"><ExternalLink size={15}/>開啟原始表格</a>}{notes.text&&<p className="recipe-detail-notes">{notes.text}</p>}{notes.imported&&<details><summary>查看匯入原文</summary><pre className="recipe-original-text">{notes.original}</pre></details>}</details>}
  {editable&&<section className="recipe-detail-panel recipe-review-actions"><div><h2>{state==='unset'?'主管確認':state==='ready'?'準備上線':'分類與使用'}</h2></div><div className="recipe-review-buttons">
   {state==='research'&&<button className="shell-primary" disabled={busy} onClick={()=>void classify('unset')}>送主管確認</button>}
   {state==='unset'&&approver&&<><button className="recipe-secondary" disabled={busy} onClick={()=>void classify('research')}>退回修改</button><button className="recipe-secondary" disabled={busy} onClick={()=>void classify('ready')}>確認，列為待上線</button><button className="shell-primary" disabled={busy} onClick={()=>void classify('serving')}>確認並立即上線</button></>}
   {state==='unset'&&!approver&&<span>已送主管確認</span>}
   {['ready','reserve','archived'].includes(state)&&approver&&<button className="shell-primary" disabled={busy} onClick={()=>void classify('serving')}>{state==='ready'?'設為使用中':'重新上線'}</button>}
   {state==='serving'&&approver&&<><button className="recipe-secondary" disabled={busy} onClick={()=>void classify('reserve')}>移至季節備用</button><button className="recipe-secondary" disabled={busy} onClick={()=>void classify('archived')}>移至舊食譜</button></>}
  </div></section>}
 </section>
 </RecipeModal>;
}
