'use client';
import {useEffect,useRef,useState} from 'react';
import {ArrowLeft,Pencil,ExternalLink} from 'lucide-react';
import {canData} from '@/lib/data-access';
import {appError,type AppStore} from '@/lib/app-workspace';
import {supabase} from '@/lib/supabase-browser';
import type {RecipeCard,RecipeWorkspace} from '@/lib/recipe-model';
import {recipeDisplayName,recipeNotesView,recipeSourceUrl} from '@/lib/recipe-model';
import {recipeComponents,recipeLineCode} from '@/lib/recipe-cost';
import {canApproveRecipe,lifecycleLabels,recipeLifecycle,type RecipeLifecycle,type RecipeMenu} from '@/lib/recipe-organization';
import {recipeMoney} from './recipe-editor';
import RecipeModal from './recipe-modal';
import './recipe-detail.css';

type Props={card:RecipeCard;workspace:RecipeWorkspace;store:AppStore;onBack:()=>void;onEdit:()=>void;onOpen:(card:RecipeCard)=>void;reload:()=>Promise<unknown>;beforeUpdate:()=>boolean};
export default function RecipeDetail({card,workspace,store,onBack,onEdit,onOpen,reload,beforeUpdate}:Props){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[component,setComponent]=useState<RecipeCard|null>(null);
 const [menus,setMenus]=useState<RecipeMenu[]>([]);
 useEffect(()=>{let active=true;void supabase.rpc('recipe_organization',{p_store_id:store.id}).then(({data,error})=>{if(!active)return;if(error)setError(appError(error));else setMenus((data as unknown as {menus:RecipeMenu[]}).menus);});return()=>{active=false;};},[store.id]);
 const flight=useRef(false),requests=useRef(new Map<string,string>());
 const doc=card.document,state=recipeLifecycle(doc,menus),editable=store.role!=='STAFF'&&canData(store,'RECIPE',true),approver=editable&&canApproveRecipe(store);
 const notes=recipeNotesView(doc.notes),source=recipeSourceUrl(doc.source_url),components=recipeComponents(card,workspace);
 const total=card.cost.total??(card.cost.lines.some(l=>l.amount!==null)?card.cost.subtotal:null),portion=total!==null&&Number(doc.yield)>0?total/Number(doc.yield):total;
 async function classify(next:RecipeLifecycle){
  if(flight.current||!editable)return;
  if(!beforeUpdate()){setError('此食譜有未儲存的編輯，請先完成儲存。');return;}
  flight.current=true;setBusy(true);setError('');setNotice('');
  const key=`${card.id}:${card.revision}:${next}`;if(!requests.current.has(key))requests.current.set(key,crypto.randomUUID());
  try{const {error}=await supabase.rpc('recipe_organization',{p_store_id:store.id,p_action:'update',p_data:{rows:[{id:card.id,revision:card.revision}],patch:{lifecycle:next}},p_request_id:requests.current.get(key)!}).abortSignal(AbortSignal.timeout(20000));if(error)throw error;await reload();requests.current.delete(key);setNotice(`已列為「${lifecycleLabels[next]}」，已儲存成本保留。`);}catch(e){setError(appError(e));}finally{flight.current=false;setBusy(false);}
 }
 const detailTable=(item:RecipeCard)=><div className="recipe-detail-table-scroll"><table><thead><tr><th>食材</th><th>用量</th><th>成本</th></tr></thead><tbody>{item.document.lines.map((line,i)=><tr key={line.id}><th>{line.name}<small>{recipeLineCode(line,workspace)}</small></th><td>{line.quantity||'—'} {line.unit}</td><td>{recipeMoney(item.cost.lines.find(l=>l.id===line.id)?.amount??item.cost.lines[i]?.amount??null)}</td></tr>)}</tbody></table></div>;
 return <section className="recipe-detail" aria-label="檢視食譜">
  <header className="recipe-detail-toolbar"><button className="recipe-back" disabled={busy} onClick={onBack}><ArrowLeft size={18}/>返回列表</button>{editable&&<button className="shell-primary" disabled={busy} onClick={onEdit}><Pencil size={16}/>編輯食譜</button>}</header>
  {error&&<p className="recipe-alert" role="alert">{error}</p>}{notice&&<p className="recipe-save-success" role="status">{notice}</p>}
  <div className="recipe-detail-heading"><div><h1>{recipeDisplayName(doc)} <span className={`rd-state rd-${state}`}>{lifecycleLabels[state]}</span></h1><p>編碼 {card.recipe_code||'—'}　·　{store.name}　·　{doc.season||'季節未設定'}</p></div><div className="recipe-detail-total"><small>每 {doc.unit||'份'} 成本</small><strong>{recipeMoney(portion)}</strong><small>已儲存成本</small></div></div>
  <section className="recipe-detail-panel"><h2>{doc.kind==='prep'?'配件配方':'主配方'}</h2><div className="recipe-detail-table-scroll"><table><thead><tr><th>食材</th><th>用量</th><th>單位成本</th><th>成本</th></tr></thead><tbody>{doc.lines.flatMap((line,index)=>line.recipe_id?[]:[<tr key={line.id}><th>{line.name}<small>{recipeLineCode(line,workspace)}</small></th><td>{line.quantity||'—'} {line.unit}</td><td>{card.cost.lines[index]?.amount!==null&&Number(line.quantity)>0?`${recipeMoney((card.cost.lines[index]?.amount??0)/Number(line.quantity))}／${line.unit}`:'—'}</td><td>{recipeMoney(card.cost.lines[index]?.amount??null)}</td></tr>])}</tbody></table></div>{!doc.lines.length&&<p>尚未加入食材，可先儲存，稍後補齊。</p>}</section>
  {components.length>0&&<section className="recipe-detail-panel"><h2>配件</h2><div className="recipe-detail-table-scroll"><table><thead><tr><th>配件名稱</th><th>本食譜使用量</th><th>計入成本</th><th>操作</th></tr></thead><tbody>{components.map(c=>{const uses=doc.lines.flatMap((l,i)=>l.recipe_id===c.id?[{line:l,cost:card.cost.lines[i]?.amount??null}]:[]);return <tr key={c.id}><th>{c.name}<small>{c.recipe?.recipe_code||'—'}</small></th><td>{uses.length?uses.map(u=>`${u.line.quantity||'—'} ${u.line.unit}`).join('、'):'尚未設定'}</td><td>{uses.length&&uses.every(u=>u.cost!==null)?recipeMoney(uses.reduce((sum,u)=>sum+(u.cost||0),0)):'—'}</td><td><button className="recipe-secondary" disabled={!c.recipe} onClick={()=>setComponent(c.recipe||null)}>查看配方</button></td></tr>;})}</tbody></table></div></section>}
  <section className="recipe-detail-panel"><header><h2>做法與備註</h2>{source&&<a className="recipe-source-link" href={source} target="_blank" rel="noopener noreferrer"><ExternalLink size={15}/>開啟原始表格</a>}</header>{notes.text&&<p className="recipe-detail-notes">{notes.text}</p>}{!notes.text&&!source&&<small>尚未填寫，可於編輯時補充。</small>}{notes.imported&&<details><summary>查看匯入原文</summary><pre className="recipe-original-text">{notes.original}</pre></details>}</section>
  {editable&&<section className="recipe-detail-panel recipe-review-actions"><div><h2>{state==='unset'?'主管確認':state==='ready'?'準備上線':'分類與使用'}</h2><small>調整分類保留配方與已儲存成本。</small></div><div className="recipe-review-buttons">
   {state==='research'&&<button className="shell-primary" disabled={busy} onClick={()=>void classify('unset')}>送主管確認</button>}
   {state==='unset'&&approver&&<><button className="recipe-secondary" disabled={busy} onClick={()=>void classify('research')}>退回修改</button><button className="recipe-secondary" disabled={busy} onClick={()=>void classify('ready')}>確認，列為待上線</button><button className="shell-primary" disabled={busy} onClick={()=>void classify('serving')}>確認並立即上線</button></>}
   {state==='unset'&&!approver&&<span>已送主管確認</span>}
   {['ready','reserve','archived'].includes(state)&&approver&&<button className="shell-primary" disabled={busy} onClick={()=>void classify('serving')}>{state==='ready'?'設為使用中':'重新上線'}</button>}
   {state==='serving'&&approver&&<><button className="recipe-secondary" disabled={busy} onClick={()=>void classify('reserve')}>移至季節備用</button><button className="recipe-secondary" disabled={busy} onClick={()=>void classify('archived')}>移至舊食譜</button></>}
  </div></section>}
  {component&&<RecipeModal title={recipeDisplayName(component.document)} onClose={()=>setComponent(null)}>{detailTable(component)}{editable&&<footer className="recipe-modal-footer"><button className="shell-primary" onClick={()=>{setComponent(null);onOpen(component);}}>編輯配件</button></footer>}</RecipeModal>}
 </section>;
}
