'use client';

import {useCallback, useEffect, useRef, useState} from 'react';
import {ArrowLeft, BookOpen, ChevronDown, ChevronRight, Plus, Search, Upload, X} from 'lucide-react';
import {appError, readWorkspace, writeOperation, type AppStore} from '@/lib/app-workspace';
import {emptyRecipe, linkRecipePreps, recipeDisplayName, recipeComponents, retainRecipeComponentOrder, type RecipeCard, type RecipeDocument, type RecipeWorkspace} from '@/lib/recipe-cost';
import {recipeCostChange,recipeCommitPrices,type RecipePriceDraft} from '@/lib/recipe-price-draft';
import {RecipeDraftBook, importRecipeFiles} from '@/lib/recipe-drafts';
import RecipeEditor, {recipeMoney} from './recipe-editor';
import RecipeModal from './recipe-modal';
import RecipeCostReview from './recipe-cost-review';
import './recipes.css';

const blankWorkspace:RecipeWorkspace={recipes:[],products:[],prices:[],can_price:false};
type Props={store:AppStore;userId:string;onBack:()=>void;onPrices?:()=>void;registerPrepareTools?:(handler:(()=>Promise<boolean>)|null)=>void;registerLeave?:(handler:(()=>Promise<boolean>)|null)=>void};
type ParentRecipe={id:string;child:string;attachNew:boolean};

function RecipeCards({recipes,workspace,onOpen,expandedId,onExpand}:{recipes:RecipeCard[];workspace:RecipeWorkspace;onOpen:(recipe:RecipeCard)=>void;expandedId:string;onExpand:(id:string)=>void}){
 return <div className="recipe-card-grid">{recipes.map(recipe=>{
  const expanded=expandedId===recipe.id;
  const movement=recipeCostChange(recipe,workspace);
  const components=recipeComponents(recipe,workspace);
  const pendingComponents=components.filter(component=>!component.uses.length||!component.recipe);
  return <article className="recipe-tree-card" key={recipe.id}>
   <button className="recipe-list-row recipe-tree-toggle" id={`recipe-toggle-${recipe.id}`} aria-expanded={expanded} aria-controls={`recipe-children-${recipe.id}`} onClick={()=>onExpand(expanded?'':recipe.id)}>
    <span className="recipe-list-description"><span className="recipe-tag recipe-kind-dish">主食譜</span><strong>{recipeDisplayName(recipe.document)}</strong><small>出餐用料 {recipe.document.lines.length} 項</small>{movement&&<small className="recipe-price-change-note">價格異動 · {movement.count} 項 · {movement.percent===null?'待確認':`${movement.percent>=0?'+':''}${movement.percent.toFixed(1)}%`}（未套用）</small>}</span>
    <span className="recipe-list-cost">{recipe.cost_loaded===false?<><strong>—</strong><small className="recipe-pending">草稿已保留</small></>:recipe.cost.total===null?<><strong>{recipe.cost.lines.every(line=>line.amount===null)?'—':recipeMoney(Number(recipe.document.yield)>0?recipe.cost.subtotal/Number(recipe.document.yield):recipe.cost.subtotal)}</strong><small className="recipe-pending">已計入金額</small></>:<><strong>{recipeMoney(Number(recipe.document.yield)>0?recipe.cost.total/Number(recipe.document.yield):recipe.cost.total)}</strong><small>{Number(recipe.document.yield)>0?`每 ${recipe.document.unit}`:'整份配方'} · 成本已鎖定</small></>}<span className="recipe-expand-label">{expanded?'收合':'展開'}<ChevronDown size={16}/></span></span>
   </button>
   {expanded&&<section className="recipe-tree-children" id={`recipe-children-${recipe.id}`} aria-label={`${recipeDisplayName(recipe.document)}的主食譜明細`}>
    {recipe.document.lines.length>0?<table className="recipe-serving-table" aria-label="主食譜出餐用料"><thead><tr><th scope="col">品項</th><th scope="col">使用量</th><th scope="col">單位成本</th><th scope="col">使用成本</th></tr></thead><tbody>{recipe.document.lines.map(line=>{
     const result=recipe.cost.lines.find(cost=>cost.id===line.id),quantity=Number(line.quantity),unitCost=result?.amount!=null&&quantity>0?result.amount/quantity:null;
     return <tr key={line.id}><th scope="row">{line.name||'未命名品項'}</th><td>{line.quantity||'待填'} {line.unit}</td><td>{unitCost===null?<span className="recipe-pending">{costIssueLabel(result?.reason)}</span>:<>{unitCost.toLocaleString('zh-TW',{minimumFractionDigits:4,maximumFractionDigits:4})}<small>元／{line.unit}</small></>}</td><td>{result?.amount==null?<span title={result?.reason||''}>—</span>:result.amount.toLocaleString('zh-TW',{minimumFractionDigits:2,maximumFractionDigits:2})}</td></tr>;
    })}</tbody></table>:<p className="recipe-muted">尚未加入出餐用料。</p>}
    <div className="recipe-tree-actions"><small className={pendingComponents.length?'recipe-pending':''}>{pendingComponents.length?`${pendingComponents.length} 個配件待確認出餐用量`:'金額：新臺幣'}</small><button className="text-button" onClick={()=>onOpen(recipe)}>編輯主食譜<ChevronRight size={16}/></button></div>
   </section>}
  </article>;
 })}</div>;
}

function recipeMatches(recipe:RecipeCard,workspace:RecipeWorkspace,term:string):boolean{
 return `${recipeDisplayName(recipe.document)} ${recipe.document.name}`.toLowerCase().includes(term)||recipeComponents(recipe,workspace).some(component=>component.name.toLowerCase().includes(term));
}
function costIssueLabel(reason:string|null|undefined){
 if(!reason)return '無法計算';
 if(reason.includes('價格'))return '找不到進價';
 if(reason.includes('單位')||reason.includes('換算'))return '需要單位換算';
 if(reason.includes('用量'))return '需要使用量';
 if(reason.includes('製成量'))return '需要製成量';
 if(reason.includes('備料'))return '配件成本未完整';
 return reason;
}

export default function RecipesWorkspace(props:Props){return <RecipeWorkspaceSession key={`${props.userId}:${props.store.id}`} {...props}/>;}

function RecipeWorkspaceSession({store,userId,onBack,onPrices,registerLeave,registerPrepareTools}:Props){
 const [cloud,setCloud]=useState<RecipeWorkspace>(blankWorkspace),[loaded,setLoaded]=useState(false),[error,setError]=useState('');
 const [,render]=useState(0),[book,setBook]=useState<RecipeDraftBook|null>(null);
 const [search,setSearch]=useState(''),[filter,setFilter]=useState<'dish'|'draft'>('dish'),[expandedId,setExpandedId]=useState('');
 const [parents,setParents]=useState<ParentRecipe[]>([]),[switching,setSwitching]=useState(false),[importing,setImporting]=useState(false);
 const transition=useRef(false),componentOpener=useRef<HTMLElement|null>(null),mounted=useRef(true);
 const [files,setFiles]=useState(()=>new Map<string,File>());
 const priceSavers=useRef(new Map<string,()=>Promise<boolean>>());
 const cloudRef=useRef(cloud);useEffect(()=>{cloudRef.current=cloud;},[cloud]);
 const [notice,setNotice]=useState('');
 const draftKey=`recipe-draft:${userId}:${store.id}`;
 const readSequence=useRef(0),pricingFlight=useRef<Promise<Partial<RecipeWorkspace>>|null>(null);
 const [priceError,setPriceError]=useState('');
 const loadWorkspace=useCallback(async(target:RecipeDraftBook|null)=>{
  const sequence=++readSequence.current;
  const saved=await readWorkspace<RecipeWorkspace>(store.id,'recipes.saved');
  if(!mounted.current||sequence!==readSequence.current)return saved;
  target?.refresh(saved);setCloud(previous=>({...previous,...saved,prices:previous.prices,products:previous.products,ingredients:previous.ingredients,pricing_loaded:previous.pricing_loaded??false}));setLoaded(true);setError('');
  // Price loading may fail independently. It never erases the saved recipe costs.
  if(!pricingFlight.current)pricingFlight.current=Promise.all([readWorkspace<Partial<RecipeWorkspace>>(store.id,'recipes.pricing'),readWorkspace<Partial<RecipeWorkspace>>(store.id,'recipes.catalog')]).then(([prices,catalog])=>({...catalog,...prices})).finally(()=>{pricingFlight.current=null;});
  try{
   const pricing=await pricingFlight.current,complete={...saved,...pricing,recipes:saved.recipes};
   if(mounted.current&&sequence===readSequence.current){setCloud(complete);setPriceError('');}
   return complete;
  }catch{
   if(mounted.current&&sequence===readSequence.current)setPriceError('最新價格尚未讀取，已保存成本仍保留，可稍後重試。');
   return saved;
  }
 },[store.id]);
 useEffect(()=>{
  mounted.current=true;
  if(store.role==='STAFF')return;
  let alive=true;
  void Promise.resolve().then(()=>{
  if(!alive)return;
  const next=new RecipeDraftBook(`${draftKey}:workspace-v2`,localStorage,async pending=>{
   if(!pending.extra)return writeOperation<{revision:number}>(store.id,'recipe.save',{id:pending.id,revision:pending.revision,document:pending.document},pending.request);
   const prices=(pending.extra?.prices||[]) as ReturnType<typeof recipeCommitPrices>;
   const result=await writeOperation<{revision:number;accepted_lines:string[];ingredient_revisions:{id:string;revision:number}[]}>(store.id,'recipe.commit',{id:pending.id,revision:pending.revision,document:pending.document,prices:prices.map(price=>{const sent={...price};delete (sent as Partial<typeof sent>).draft_snapshot;return sent;})},pending.request);
   const revisions=new Map(result.ingredient_revisions.map(row=>[row.id,row.revision]));
   cloudRef.current={...cloudRef.current,ingredients:cloudRef.current.ingredients?.map(row=>revisions.has(row.id)?{...row,revision:revisions.get(row.id)!}:row)};
   const key=`${draftKey}:${pending.id}:prices`,remaining:Record<string,RecipePriceDraft>=JSON.parse(localStorage.getItem(key)||'{}');
   for(const price of prices)if(result.accepted_lines.includes(price.line_id)&&JSON.stringify(remaining[price.line_id])===price.draft_snapshot)delete remaining[price.line_id];
   if(Object.keys(remaining).length)localStorage.setItem(key,JSON.stringify(remaining));else localStorage.removeItem(key);
   window.dispatchEvent(new Event('recipe-prices-saved'));return result;
  },()=>{if(mounted.current)render(v=>v+1);},appError,(recipeId,document)=>({prices:recipeCommitPrices(document,cloudRef.current,JSON.parse(localStorage.getItem(`${draftKey}:${recipeId}:prices`)||'{}'))}));
  // Migrate the earlier single-recipe draft without deleting it until persistence succeeds.
  try{const raw=localStorage.getItem(draftKey);if(raw){const legacy=JSON.parse(raw);if(legacy.id&&legacy.document&&!next.drafts.has(legacy.id)){next.add(legacy.document,{id:legacy.id,revision:legacy.revision||0});const restored=next.drafts.get(legacy.id)!;restored.saved='';next.persist();}if(!next.storageError)localStorage.removeItem(draftKey);}}catch{setError('無法讀取上次的食譜草稿。');}
  setBook(next);
  void loadWorkspace(next).catch(e=>{if(mounted.current)setError(appError(e));});
  });
  return()=>{alive=false;mounted.current=false;};
 },[draftKey,store.id,store.role,loadWorkspace]);
 const reload=useCallback(()=>loadWorkspace(book),[book,loadWorkspace]);
 const overlaid=book?.overlay(cloud)||cloud;
 const workspace:RecipeWorkspace={...overlaid,recipes:overlaid.recipes.map(card=>{const saved=cloud.recipes.find(row=>row.id===card.id);return saved?{...card,approved_cost:{id:saved.approved_cost?.id||'',at:saved.updated_at,origin:'saved_version',document:saved.document,cost:saved.cost}}:card;})};
 const id=parents.at(-1)?.child||book?.active||'',draft=book?.drafts.get(id),doc=draft?.document;
 const registerPriceSave=(recipeId:string)=>(handler:(()=>Promise<boolean>)|null)=>{if(handler)priceSavers.current.set(recipeId,handler);else priceSavers.current.delete(recipeId);};
 const pendingPrices=useCallback((recipeId:string)=>{try{return Object.keys(JSON.parse(localStorage.getItem(`${draftKey}:${recipeId}:prices`)||'{}'));}catch{return ['unreadable'];}},[draftKey]);
 useEffect(()=>{
  registerLeave?.(async()=>{
   if(!book||transition.current||importing)return false;
   const prices=priceSavers.current.get(id);if(prices&&!await prices())return false;
   book.persist();return !book.storageError;
  });return()=>registerLeave?.(null);
 },[book,registerLeave,pendingPrices,importing,id]);
 useEffect(()=>{
  registerPrepareTools?.(async()=>{
   if(!book||transition.current||importing)return false;
   for(const save of priceSavers.current.values())if(!await save())return false;
   book.persist();return !book.storageError;
  });return()=>registerPrepareTools?.(null);
 },[book,registerPrepareTools,pendingPrices,importing,id]);
 useEffect(()=>{const warn=(e:BeforeUnloadEvent)=>{if(book&&([...book.drafts.keys()].some(key=>book.dirty(key)||pendingPrices(key).length)||importing))e.preventDefault();};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[book,pendingPrices,importing]);
 useEffect(()=>{if(!book)return;const refresh=()=>{if(!transition.current)void reload().catch(()=>{});};window.addEventListener('focus',refresh);const timer=setInterval(refresh,30000);return()=>{window.removeEventListener('focus',refresh);clearInterval(timer);};},[book,reload]);
 function linkedDocument(document:RecipeDocument,recipeId:string){
  const linked=linkRecipePreps(document,workspace,[recipeId,...parents.map(p=>p.id)],pendingPrices(recipeId));
  return retainRecipeComponentOrder(linked,recipeId,workspace);
 }
 function open(document:RecipeDocument,card?:Pick<RecipeCard,'id'|'revision'>){
  if(!book)return;const recipeId=book.add(document,card);const active=book.drafts.get(recipeId)!;
  book.edit(recipeId,linkedDocument(active.document,recipeId));setError('');setNotice('');
 }
 function change(patch:Partial<RecipeDocument>){if(book&&doc)book.edit(id,linkedDocument({...doc,...patch},id));}
 async function switchTab(next:string){
  if(!book||transition.current||parents.length)return;
  transition.current=true;setSwitching(true);
  try{
   // Incomplete prices stay in their recipe's local draft; they never block another tab.
   const prices=priceSavers.current.get(id);if(prices&&!await prices())return;
   book.persist();
   book.select(next);setError('');
  }finally{transition.current=false;setSwitching(false);}
 }
 async function closeTab(recipeId:string){
  if(!book||transition.current||parents.length)return;
  transition.current=true;setSwitching(true);
  try{
   const prices=priceSavers.current.get(recipeId);if(prices&&!await prices())return;
   const target=book.drafts.get(recipeId),untouched=target&&target.revision===0&&!target.pending&&!target.document.name.trim()&&!target.document.lines.length&&!target.document.notes&&!target.document.photo;
   if(!untouched){book.persist();if(book.storageError)return;}
   book.close(recipeId);if(untouched){book.drafts.delete(recipeId);book.persist();}
  }finally{transition.current=false;setSwitching(false);}
 }
 async function editComponent(recipeId?:string,name=''){
  if(!book||transition.current||!doc)return;
  if(recipeId&&(recipeId===id||parents.some(p=>p.id===recipeId))){setError('此配件已在上層配方，無法重複引用。');return;}
  if(!parents.length)componentOpener.current=window.document.activeElement as HTMLElement|null;
  transition.current=true;setSwitching(true);
  try{
   const prices=priceSavers.current.get(id);if(prices&&!await prices())return;
   const card=recipeId?workspace.recipes.find(r=>r.id===recipeId):undefined;
   if(recipeId&&!card){setError('找不到這份配件，請重新同步後再試。');return;}
   const child=book.add(card?.document||{...emptyRecipe(),name,kind:'prep',yield:'',unit:'g'},card,false);
   setParents(previous=>[...previous,{id,child,attachNew:!recipeId}]);setError('');
   book.persist();
  }finally{transition.current=false;setSwitching(false);}
 }
 async function saveRecipeTree(recipeId:string){
  if(!book)return false;
  const visited=new Set<string>();
  const include=(key:string)=>{if(visited.has(key))return;visited.add(key);const card=workspace.recipes.find(row=>row.id===key);if(card&&!book.drafts.has(key))book.add(card.document,card,false);
   for(const line of book.drafts.get(key)?.document.lines||[])if(line.recipe_id)include(line.recipe_id);
  };include(recipeId);return book.saveTree(recipeId);
 }
 async function finishComponent(){
  if(!book||transition.current||!parents.length||!doc)return;
  transition.current=true;setSwitching(true);
  try{
   const prices=priceSavers.current.get(id);if(prices&&!await prices())return;
   const untouched=draft?.revision===0&&!draft.pending&&!doc.name.trim()&&!doc.lines.length&&!doc.notes&&!doc.photo;
   if(!untouched&&!await saveRecipeTree(id)){setError('尚未同步，內容已保留在草稿。');return;}
   const parent=parents[parents.length-1];
   if(parent.attachNew&&!untouched){const prior=book.drafts.get(parent.id)!;book.edit(parent.id,{...prior.document,lines:[...prior.document.lines,{id:crypto.randomUUID(),name:doc.name,quantity:'',unit:doc.unit,recipe_id:id}]});}
   if(untouched){book.drafts.delete(id);book.persist();}
   setParents(previous=>previous.slice(0,-1));setError('');void reload().catch(()=>{});
  }finally{transition.current=false;setSwitching(false);}
 }
 async function copy(){if(!book||!doc)return;book.persist();open({...doc,name:doc.name+'（副本）'});}
 async function preserveCopy(){
  if(!book||!doc||transition.current||parents.length)return;
  transition.current=true;setSwitching(true);
  try{
   const original=id,source=doc,data=await reload();
   const next=book.add({...source,name:source.name+'（保留副本）'});
   const prices=localStorage.getItem(`${draftKey}:${original}:prices`);
   if(prices)localStorage.setItem(`${draftKey}:${next}:prices`,prices);
   // Confirm the preserved copy before retiring the conflicted local editing session.
   if(!await book.save(next))return;
   const live=data.recipes.find(card=>card.id===original);
   if(live)book.drafts.set(original,{id:original,revision:live.revision,document:live.document,saved:JSON.stringify(live.document)});
   else book.drafts.delete(original);
   book.close(original);book.select(next);localStorage.removeItem(`${draftKey}:${original}:prices`);setError('');
  }catch(e){setError(appError(e));}finally{transition.current=false;setSwitching(false);}
 }
 async function upload(selected:File[]){
  if(!book||importing)return;setImporting(true);setError('');
  try{const {readRecipeFile}=await import('@/lib/recipe-import');await importRecipeFiles(selected,book,workspace,readRecipeFile,(key,file)=>setFiles(previous=>new Map(previous).set(key,file)));book.persist();}
  catch(e){setError(appError(e));}finally{setImporting(false);}
 }
 if(store.role==='STAFF')return <p role="alert">請使用主管或行政帳號建立食譜。</p>;
 const listWorkspace=cloud;
 const draftCards=workspace.recipes.filter(r=>book?.dirty(r.id)||pendingPrices(r.id).length||r.revision===0);
 const dishes=listWorkspace.recipes.filter(r=>r.document.kind==='dish');
 const term=search.trim().toLowerCase();
 const recipes=dishes.filter(r=>recipeMatches(r,listWorkspace,term));
 const referencedIds=new Set(workspace.recipes.flatMap(r=>r.document.lines.flatMap(line=>line.recipe_id?[line.recipe_id]:[])));
 const groupedIds=new Set(dishes.flatMap(recipe=>recipeComponents(recipe,workspace).flatMap(component=>component.candidates.map(card=>card.id))));
 const unassigned=listWorkspace.recipes.filter(r=>r.document.kind==='prep'&&!referencedIds.has(r.id)&&!groupedIds.has(r.id)&&recipeMatches(r,listWorkspace,term));
 const counts={dish:dishes.length,draft:draftCards.length};
 const status=(recipeId:string)=>{
  const card=workspace.recipes.find(item=>item.id===recipeId);
  const related=[recipeId,...(card?recipeComponents(card,workspace).flatMap(item=>item.recipe?[item.recipe.id]:[]):[])];
  return related.some(key=>book?.busy(key))?'儲存中…':related.some(key=>book?.drafts.get(key)?.error)?'尚未同步':related.some(key=>pendingPrices(key).length)?'草稿已保留':related.some(key=>book?.dirty(key))?'草稿待儲存':'已儲存';
 };
 const editorWorkspace=workspace;
 async function saveVisibleRecipe(){
  if(!book||!id||transition.current)return;
  transition.current=true;++readSequence.current;setSwitching(true);setError('');
  try{
   if(!await saveRecipeTree(id)){setError('尚未同步，已填內容保留在草稿。');return;}
   await reload();book.select('');setFilter('dish');setNotice('已儲存至食譜列表；進價、單位與成本已保存。');
  }catch(e){setError(appError(e));}finally{transition.current=false;setSwitching(false);}
 }
 const editor=(document:RecipeDocument,recipeId:string,embedded=false)=><RecipeEditor key={recipeId} draftKey={`${draftKey}:${recipeId}:prices`} registerPriceSave={registerPriceSave(recipeId)} document={document} recipeId={recipeId} workspace={editorWorkspace} status={status(recipeId)} saving={switching} onChange={change} onBack={()=>void switchTab('')} onCopy={()=>void copy()} onSave={()=>void (embedded?finishComponent():saveVisibleRecipe())} onPrice={async()=>false} embedded={embedded} locked={switching||importing} onOpenPrep={componentId=>void editComponent(componentId)} onCreatePrep={name=>void editComponent(undefined,name)} excludedRecipeIds={parents.map(p=>p.id)}/>;
 const message=error||book?.storageError||draft?.error;
 const errorPanel=message&&<div className="recipe-alert" role="alert"><span>{message}</span><button className="text-button" disabled={switching} onClick={()=>void (book?book.saveAll().then(()=>reload()):reload()).catch(e=>setError(appError(e)))}>重新同步</button>{doc&&draft?.error&&<button className="text-button" disabled={switching||book?.busy(id)||!!parents.length} onClick={()=>void preserveCopy()}>保留為新配方</button>}</div>;
 const importInput=<label className="recipe-secondary recipe-upload"><Upload size={18}/>{importing?'讀取中…':'匯入多份食譜'}<input aria-label="匯入多份 Word 或 PDF 食譜" type="file" accept=".docx,.pdf" multiple disabled={importing||!loaded||switching||!!parents.length} onChange={e=>{const selected=Array.from(e.target.files||[]);if(selected.length)void upload(selected);e.target.value='';}}/></label>;
 return <div className="recipe-workspace">

  {!parents.length&&errorPanel}
  {!!book&&[...book.drafts.keys()].some(key=>book.dirty(key)||pendingPrices(key).length)&&<details className="recipe-import-results"><summary>編輯中的草稿</summary><p>已填內容保留在此裝置，可隨時接續編輯。</p>{[...book.drafts.values()].filter(item=>book.dirty(item.id)||pendingPrices(item.id).length).map(item=><div className="recipe-import-result" key={item.id}><span>{recipeDisplayName(item.document)||'未命名配方'} · {'草稿已保留'}</span><button className="text-button" disabled={switching||!!parents.length} onClick={()=>void switchTab(item.id)}>繼續編輯</button></div>)}</details>}
  {!!book?.tabs.length&&<nav className="recipe-open-tabs" aria-label="已開啟的食譜"><button className="recipe-tab-list" disabled={switching||!!parents.length||importing} aria-pressed={!book.active} onClick={()=>void switchTab('')}><BookOpen size={16}/>食譜清單</button><div className="recipe-open-scroll">{book.tabs.map(tabId=>{const item=book.drafts.get(tabId)!;return <div key={tabId} className={`recipe-open-tab ${book.active===tabId?'is-active':''}`}><button aria-pressed={book.active===tabId} disabled={switching||!!parents.length||importing} onClick={()=>void switchTab(tabId)}><span>{item.document.kind==='prep'?'配件 · ':''}{recipeDisplayName(item.document)||'新食譜'}</span><small className={item.error?'recipe-pending':''}>{status(tabId)}</small></button><button aria-label={`關閉${recipeDisplayName(item.document)||'新食譜'}分頁`} disabled={switching||!!parents.length||importing} onClick={()=>void closeTab(tabId)}><X size={14}/></button></div>;})}</div><button className="recipe-tab-add" aria-label="開啟其他食譜" disabled={switching||!!parents.length||importing} onClick={()=>void switchTab('')}><Plus size={18}/></button></nav>}
  {!!book?.imports.length&&<details className="recipe-import-results" open={importing||undefined}><summary>本次匯入：{book.imports.filter(item=>item.state==='ready').length} 份已讀取{book.imports.some(item=>item.state==='error')?` · ${book.imports.filter(item=>item.state==='error').length} 份待重試`:''}<small>展開查看結果</small></summary>{book.imports.map(item=><div className="recipe-import-result" key={item.id}><span><strong>{item.name}</strong><small>{item.state==='reading'?'正在讀取…':item.state==='error'?item.error:`${item.recipeIds.length} 個食譜／配件 · ${item.recipeIds.some(key=>book.dirty(key))?'草稿待同步':'已儲存'}`}</small></span><div>{item.state==='error'&&(files.has(item.id)?<button className="text-button" disabled={importing} onClick={()=>void upload([files.get(item.id)!])}>重試此檔</button>:<label className="text-button recipe-upload">重新選檔<input aria-label={`重新選取${item.name}`} type="file" accept=".docx,.pdf" disabled={importing} onChange={e=>{if(e.target.files?.[0]){book.removeImport(item.id);void upload([e.target.files[0]]);}e.target.value='';}}/></label>)}{item.state==='ready'&&<button className="text-button" disabled={importing||!!parents.length} onClick={()=>{const root=item.recipeIds.find(key=>book.drafts.get(key)?.document.kind==='dish')||item.recipeIds[0];void switchTab(root);}}>編輯</button>}<button className="recipe-icon-button" aria-label={`移除${item.name}匯入結果`} title="只移除結果列，保留已建立的食譜" disabled={importing} onClick={()=>book.removeImport(item.id)}><X size={14}/></button></div></div>)}</details>}
  {doc?<><div className="recipe-multi-toolbar"><small>各食譜分開儲存，切換保留草稿。</small>{importInput}</div>{editor(book!.drafts.get(book!.active)!.document,book!.active)}{parents.length>0&&<RecipeModal title={doc.name||'新增配件'} busy={switching} onClose={()=>void finishComponent()} returnFocus={componentOpener}>{errorPanel}{parents.length>1&&<small className="recipe-component-path">{parents.map(p=>book?.drafts.get(p.id)?.document.name).join(' ／ ')} ／ {doc.name||'新增配件'}</small>}{editor(doc,id,true)}</RecipeModal>}</>:<>
   <button className="recipe-back" onClick={onBack}><ArrowLeft size={18}/>返回首頁</button>
   <header className="recipe-list-header"><div><small>{store.name} · 門市共用配方</small><h1>食譜與成本</h1><p>已保存成本保留；價格異動先提醒，確認後才更新。</p>{onPrices&&<button className="text-button" onClick={onPrices}>食材價格表 →</button>}</div><div className="recipe-actions">{importInput}<button className="shell-primary" disabled={!loaded||importing} onClick={()=>open(emptyRecipe())}><Plus size={18}/>新增主食譜</button></div></header>
   {loaded&&<RecipeCostReview store={store} workspace={cloud} beforeReview={async()=>true} reload={reload}/>}
   {notice&&<p className="recipe-save-success" role="status">✓ {notice}</p>}
   {priceError&&<p role="status" className="recipe-muted">{priceError} <button className="text-button" onClick={()=>void reload().catch(e=>setError(appError(e)))}>重新讀取價格</button></p>}
   <div className="recipe-list-tools"><label className="recipe-search"><Search size={18}/><input aria-label="搜尋主食譜或配件" placeholder="搜尋菜名或配件，找到所屬主食譜" value={search} onChange={e=>setSearch(e.target.value)}/></label><nav className="recipe-list-tabs" aria-label="食譜分類">{([['dish','食譜列表'],['draft','草稿']] as const).map(([value,label])=><button key={value} aria-pressed={filter===value} onClick={()=>setFilter(value)}>{label}<span className="recipe-tab-count">{counts[value]}</span></button>)}</nav><small className="recipe-list-hint">展開查看出餐用料，進入編輯後查看配件。可開啟多份食譜。</small></div>
   {!loaded&&!error?<p role="status">正在讀取已保存成本…</p>:filter==='draft'?<RecipeCards recipes={draftCards.filter(r=>recipeMatches(r,workspace,term))} workspace={workspace} expandedId={expandedId} onExpand={setExpandedId} onOpen={recipe=>open(recipe.document,recipe)}/>:<RecipeCards recipes={recipes} workspace={listWorkspace} expandedId={expandedId} onExpand={setExpandedId} onOpen={recipe=>open(recipe.document,recipe)}/>}
   {loaded&&filter==='dish'&&recipes.length===0&&<section className="recipe-empty"><BookOpen size={32}/><h2>{dishes.length?'沒有符合的主食譜':'建立第一份主食譜'}</h2><p>{dishes.length?'換個名稱或分類試試。':'新增主食譜或一次選取多份 Word／PDF。'}</p></section>}
   {loaded&&filter==='dish'&&unassigned.length>0&&<details className="recipe-unassigned"><summary><span>待加入主食譜的配件 <span className="recipe-tab-count">{unassigned.length}</span></span><ChevronDown size={16}/></summary><small>在主食譜「新增品項」中選取，即可帶入配件與成本。</small><div className="recipe-unassigned-list">{unassigned.map(recipe=><button className="recipe-unassigned-row" key={recipe.id} onClick={()=>open(recipe.document,recipe)}><span><strong>{recipeDisplayName(recipe.document)}</strong><small>製成 {recipe.document.yield||'待填'} {recipe.document.unit}</small></span><ChevronRight size={16}/></button>)}</div></details>}
  </>}
 </div>;
}
