'use client';

import {useCallback, useEffect, useRef, useState} from 'react';
import {ArrowLeft, BookOpen, ChevronRight, Plus, Search, Upload} from 'lucide-react';
import {appError, readWorkspace, writeOperation, type AppStore} from '@/lib/app-workspace';
import {emptyRecipe, linkRecipePreps, parseRecipeText, recipeDisplayName, type RecipeCard, type RecipeDocument, type RecipeWorkspace} from '@/lib/recipe-cost';
import RecipeEditor, {recipeMoney, type RecipePriceInput} from './recipe-editor';
import RecipeModal from './recipe-modal';
import './recipes.css';

const blankWorkspace:RecipeWorkspace={recipes:[],products:[],prices:[],can_price:false};
type Props={store:AppStore;userId:string;onBack:()=>void;registerLeave?:(handler:(()=>Promise<boolean>)|null)=>void};
type LocalDraft={id:string;revision:number;document:RecipeDocument};
type SaveRequest={id:string;revision:number;encoded:string;request:string;document:RecipeDocument};
type ParentRecipe=LocalDraft&{attachNew:boolean};

function RecipeCards({recipes,workspace,onOpen}:{recipes:RecipeCard[];workspace:RecipeWorkspace;onOpen:(recipe:RecipeCard)=>void}){
 const relations=(recipe:RecipeCard)=>{
  const related=recipe.document.kind==='dish'
   ?workspace.recipes.filter(r=>r.document.kind==='prep'&&recipe.document.lines.some(line=>line.recipe_id===r.id))
   :workspace.recipes.filter(r=>r.document.lines.some(line=>line.recipe_id===recipe.id));
  const names=related.map(r=>recipeDisplayName(r.document));
  return names.length?`${recipe.document.kind==='dish'?'配件':'用於'}：${names.slice(0,2).join('、')}${names.length>2?` 等 ${names.length} 項`:''}`:recipe.document.kind==='prep'?'尚未被引用':'尚未加入配件';
 };
 return <div className="recipe-card-grid">{recipes.map(recipe=><button className="recipe-list-row" key={recipe.id} onClick={()=>onOpen(recipe)}><span className="recipe-list-description"><span className={`recipe-tag recipe-kind-${recipe.document.kind}`}>{recipe.document.kind==='prep'?'配件':'主食譜'}</span><strong>{recipeDisplayName(recipe.document)}</strong><small>{recipe.document.lines.length} 個品項 · {recipe.document.kind==='prep'?'製成':'可做'} {recipe.document.yield||'待填'} {recipe.document.unit}</small><small className="recipe-list-relation" title={relations(recipe)}>{relations(recipe)}</small></span><span className="recipe-list-cost">{recipe.cost.total===null?<b className="recipe-pending">待補資料</b>:<><strong>{recipeMoney(Number(recipe.document.yield)>0?recipe.cost.total/Number(recipe.document.yield):recipe.cost.total)}</strong><small>{Number(recipe.document.yield)>0?`每 ${recipe.document.unit}`:'整份配方'}</small></>}<ChevronRight size={18}/></span></button>)}</div>;
}

export default function RecipesWorkspace({store,userId,onBack,registerLeave}:Props){
 const [workspace,setWorkspace]=useState<RecipeWorkspace>(blankWorkspace),[loaded,setLoaded]=useState(false),[error,setError]=useState('');
 const [doc,setDoc]=useState<RecipeDocument|null>(null),[id,setId]=useState(''),[search,setSearch]=useState('');
 const [filter,setFilter]=useState<'dish'|'prep'|'pending'>('dish');
 const [parents,setParents]=useState<ParentRecipe[]>([]),[switching,setSwitching]=useState(false);
 const transition=useRef(false);
 const componentOpener=useRef<HTMLElement|null>(null);
 const [status,setStatus]=useState(''),[busy,setBusy]=useState(false),[imports,setImports]=useState<RecipeDocument[]>([]),[importing,setImporting]=useState(false),[hasDraft,setHasDraft]=useState(false);
 const revision=useRef(0),current=useRef({id:'',doc:null as RecipeDocument|null}),saved=useRef(''),flight=useRef<Promise<boolean>|null>(null);
 const saveRequest=useRef<SaveRequest|null>(null),priceRequest=useRef<{encoded:string;request:string}|null>(null);
 const priceSavers=useRef(new Map<string,()=>Promise<boolean>>());
 const registerPriceSave=(recipeId:string)=>(handler:(()=>Promise<boolean>)|null)=>{if(handler)priceSavers.current.set(recipeId,handler);else priceSavers.current.delete(recipeId);};
 const draftKey=`recipe-draft:${userId}:${store.id}`;
 const reload=useCallback(async()=>{const data=await readWorkspace<RecipeWorkspace>(store.id,'recipes');setWorkspace(data);setLoaded(true);return data;},[store.id]);
 useEffect(()=>{
  let alive=true;
  void readWorkspace<RecipeWorkspace>(store.id,'recipes').then(data=>{if(alive){setWorkspace(data);setLoaded(true);setHasDraft(Boolean(localStorage.getItem(draftKey)));}}).catch(e=>{if(alive)setError(appError(e));});
  return()=>{alive=false;};
 },[store.id,draftKey]);
 const save=useCallback(async():Promise<boolean>=>{
  if(flight.current){const ok=await flight.current;if(!ok)return false;}
  const target=current.current;
  if(!target.doc||(!saveRequest.current&&saved.current===JSON.stringify(target.doc)))return true;
  if(!target.doc.name.trim()){setStatus('請先填配方名稱');return false;}
  // Retry an unconfirmed write unchanged before sending newer edits.
  const pending=saveRequest.current||{id:target.id,revision:revision.current,document:target.doc,encoded:JSON.stringify(target.doc),request:crypto.randomUUID()};
  saveRequest.current=pending;setBusy(true);setStatus('正在儲存…');
  const job=(async()=>{try{
   const result=await writeOperation<{revision:number}>(store.id,'recipe.save',{id:pending.id,revision:pending.revision,document:pending.document},pending.request);
   revision.current=result.revision;saved.current=pending.encoded;saveRequest.current=null;
   try{localStorage.setItem(draftKey,JSON.stringify({id:pending.id,revision:result.revision,document:current.current.doc}));}catch{/* A confirmed cloud save does not depend on local storage. */}
   setStatus(saved.current===JSON.stringify(current.current.doc)?'已儲存':'新修改等待儲存');setError('');return true;
  }catch(e){setStatus('尚未同步，草稿保留在此裝置');setError(appError(e));return false;}finally{setBusy(false);flight.current=null;}})();
  flight.current=job;return job;
 },[store.id,draftKey]);
 const leave=useCallback(async()=>{let ok=await save();if(ok&&current.current.doc&&saved.current!==JSON.stringify(current.current.doc))ok=await save();return ok&&(!current.current.doc||saved.current===JSON.stringify(current.current.doc));},[save]);
 useEffect(()=>{registerLeave?.(async()=>{if(transition.current)return false;const prices=priceSavers.current.get(current.current.id);if(prices&&!await prices())return false;return leave();});return()=>registerLeave?.(null);},[registerLeave,leave]);
 useEffect(()=>{
  if(!doc)return;
  const stash=setTimeout(()=>{try{localStorage.setItem(draftKey,JSON.stringify({id,revision:revision.current,document:doc}));setHasDraft(true);if(saved.current!==JSON.stringify(doc))setStatus('草稿已保留，等待同步…');}catch{setError('裝置無法保留草稿，請按儲存並確認成功。');}},0);
  const timer=setTimeout(()=>{void leave();},1500);
  return()=>{clearTimeout(stash);clearTimeout(timer);};
 },[doc,id,draftKey,leave]);
 useEffect(()=>{const warn=(e:BeforeUnloadEvent)=>{if(current.current.doc&&saved.current!==JSON.stringify(current.current.doc))e.preventDefault();};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[]);
 useEffect(()=>{const refresh=()=>{void reload().catch(()=>{});};window.addEventListener('focus',refresh);const timer=setInterval(refresh,30000);return()=>{window.removeEventListener('focus',refresh);clearInterval(timer);};},[reload]);
 function linkedDocument(document:RecipeDocument,recipeId:string,additionalExcluded:string[]=[]){
  let pending:string[];try{pending=Object.keys(JSON.parse(localStorage.getItem(`${draftKey}:${recipeId}:prices`)||'{}'));}catch{pending=document.lines.map(line=>line.id);}
  return linkRecipePreps(document,workspace,[recipeId,...parents.map(p=>p.id),...additionalExcluded],pending);
 }
 function open(document:RecipeDocument,card?:Pick<RecipeCard,'id'|'revision'>,additionalExcluded:string[]=[]){
  revision.current=card?.revision||0;const nextId=card?.id||crypto.randomUUID();saved.current=card?JSON.stringify(document):'';saveRequest.current=null;
  const linked=linkedDocument(document,nextId,additionalExcluded);
  current.current={id:nextId,doc:linked};setId(nextId);setDoc(linked);setSearch('');setError('');setStatus(linked!==document?'已連結備料配方，等待儲存':card?'已儲存':'填寫後自動儲存');
 }
 function change(patch:Partial<RecipeDocument>){const next=current.current.doc?linkedDocument({...current.current.doc,...patch},current.current.id):null;current.current={id:current.current.id,doc:next};setDoc(next);}
 async function editComponent(recipeId?:string,name=''){
  if(transition.current||!current.current.doc)return;
  if(!parents.length)componentOpener.current=window.document.activeElement as HTMLElement|null;
  transition.current=true;setSwitching(true);
  try{
   const prices=priceSavers.current.get(current.current.id);if(prices&&!await prices())return;
   if(!await leave())return;
   const parent=current.current;
   if(!parent.doc)return;
   if(recipeId&&(recipeId===parent.id||parents.some(p=>p.id===recipeId))){setError('此配件已在上層配方，無法重複引用。');return;}
   const data=await reload();
   const card=recipeId?data.recipes.find(r=>r.id===recipeId):undefined;
   if(recipeId&&!card){setError('找不到這份配件，請重新同步後再試。');return;}
   // Capture the parent's revision before open() switches the active save session.
   const frame:ParentRecipe={id:parent.id,document:parent.doc,revision:revision.current,attachNew:!recipeId};
   setParents(previous=>[...previous,frame]);
   open(card?.document||{...emptyRecipe(),name,kind:'prep',yield:'',unit:'g'},card,[parent.id]);
  }catch(e){setError(appError(e));}finally{transition.current=false;setSwitching(false);}
 }
 async function finishComponent(){
  if(transition.current||!parents.length)return;
  transition.current=true;setSwitching(true);
  try{
   const prices=priceSavers.current.get(current.current.id);if(prices&&!await prices())return;
   const child=current.current;
   const untouched=revision.current===0&&child.doc&&!child.doc.name.trim()&&!child.doc.lines.length&&!child.doc.notes&&!child.doc.photo;
   if(!untouched&&!await leave())return;
   await reload();
   const parent=parents[parents.length-1];
   setParents(previous=>previous.slice(0,-1));
   open(parent.document,parent);
   if(parent.attachNew&&!untouched&&child.doc){
    const line={id:crypto.randomUUID(),name:child.doc.name,quantity:'',unit:child.doc.unit,recipe_id:child.id};
    change({lines:[...parent.document.lines,line]});setStatus('配件已建立，請填這道菜的使用量');
   }
  }catch(e){setError(appError(e));}finally{transition.current=false;setSwitching(false);}
 }
 async function back(){
  const untouched=revision.current===0&&doc&&!doc.name.trim()&&!doc.lines.length&&!doc.notes&&!doc.photo;
  if(!untouched&&!await leave())return;
  current.current={id:'',doc:null};setDoc(null);setStatus('');localStorage.removeItem(draftKey);setHasDraft(false);
  try{await reload();}catch(e){setError(appError(e));}
 }
 function restore(){try{
  const raw=localStorage.getItem(draftKey);if(!raw){setHasDraft(false);return;}
  const draft=JSON.parse(raw) as LocalDraft,live=workspace.recipes.find(r=>r.id===draft.id);
  if(live&&live.revision!==draft.revision){open({...draft.document,name:draft.document.name+'（草稿副本）'});setStatus('門市版本已更新，裝置草稿保留為副本');return;}
  open(draft.document,draft);saved.current='';setStatus('已恢復裝置草稿');
 }catch{setError('無法讀取此裝置草稿。');}}
 async function copy(){if(current.current.doc&&await leave()){const source=current.current.doc;if(source)open({...source,name:source.name+'（副本）'});}}
 async function upload(file:File){setImporting(true);setError('');try{const{readRecipeFile}=await import('@/lib/recipe-import');const text=await readRecipeFile(file);setImports(parseRecipeText(text,file.name.replace(/\.[^.]+$/,'')));}catch(e){setError(e instanceof Error?e.message:'無法讀取食譜');}finally{setImporting(false);}}
 function openImport(recipe:RecipeDocument,index:number){
  const lines=recipe.lines.map(line=>{
   const remembered=[...new Set(workspace.recipes.flatMap(r=>r.document.lines).filter(x=>x.name===line.name&&x.product_id).map(x=>x.product_id!))];
   const matches=workspace.products.filter(p=>p.name===line.name);
   const product_id=remembered.length===1?remembered[0]:matches.length===1?matches[0].id:undefined;
   return product_id?{...line,product_id}:line;
  });
  open({...recipe,lines});setImports(imports.filter((_,i)=>i!==index));
 }
 async function savePrice(data:RecipePriceInput){
  const encoded=JSON.stringify(data);if(priceRequest.current?.encoded!==encoded)priceRequest.current={encoded,request:crypto.randomUUID()};
  try{await writeOperation(store.id,'recipe.price',data,priceRequest.current.request);await reload();priceRequest.current=null;setError('');return true;}
  catch(e){setError(appError(e));return false;}
 }
 if(store.role==='STAFF')return <p role="alert">請使用主管或行政帳號建立食譜。</p>;
 const recipes=workspace.recipes.filter(r=>`${recipeDisplayName(r.document)} ${r.document.name}`.toLowerCase().includes(search.trim().toLowerCase())&&(filter==='pending'?r.cost.total===null:r.document.kind===filter));
 const counts={dish:workspace.recipes.filter(r=>r.document.kind==='dish').length,prep:workspace.recipes.filter(r=>r.document.kind==='prep').length,pending:workspace.recipes.filter(r=>r.cost.total===null).length};
 const editor=(document:RecipeDocument,recipeId:string,embedded=false)=><RecipeEditor key={recipeId} draftKey={`${draftKey}:${recipeId}:prices`} registerPriceSave={registerPriceSave(recipeId)} document={document} recipeId={recipeId} workspace={workspace} status={recipeId===id?status:'已儲存'} saving={busy||switching} onChange={change} onBack={()=>void back()} onCopy={()=>void copy()} onSave={()=>void (embedded?finishComponent():leave().then(ok=>{if(ok)setStatus('已儲存');}))} onPrice={savePrice} embedded={embedded} locked={switching} onOpenPrep={componentId=>void editComponent(componentId)} onCreatePrep={name=>void editComponent(undefined,name)} excludedRecipeIds={parents.map(p=>p.id)}/>;
 const errorPanel=error&&<div className="recipe-alert" role="alert"><span>{error}</span><button className="text-button" onClick={()=>void (doc?leave():reload()).catch(e=>setError(appError(e)))}>重新同步</button>{doc&&<button className="text-button" disabled={busy||switching} onClick={()=>{open({...doc,name:doc.name+'（保留副本）'});}}>保留為新配方</button>}</div>;
 return <div className="recipe-workspace">
  {!parents.length&&errorPanel}
  {doc?<>{editor(parents[0]?.document||doc,parents[0]?.id||id)}{parents.length>0&&<RecipeModal title={doc.name||'新增配件'} busy={busy||switching} onClose={()=>void finishComponent()} returnFocus={componentOpener}>{errorPanel}{parents.length>1&&<small className="recipe-component-path">{parents.slice(1).map(p=>p.document.name).join(' ／ ')} ／ {doc.name||'新增配件'}</small>}{editor(doc,id,true)}</RecipeModal>}</>:<>
   <button className="recipe-back" onClick={onBack}><ArrowLeft size={18}/>返回首頁</button>
   <header className="recipe-list-header"><div><small>{store.name} · 門市共用配方</small><h1>食譜與成本</h1><p>主廚填配方，系統帶入成本。</p></div><div className="recipe-actions"><label className="recipe-secondary recipe-upload"><Upload size={18}/>{importing?'讀取中…':'匯入食譜'}<input aria-label="匯入 Word 或 PDF 食譜" type="file" accept=".docx,.pdf" disabled={importing||!loaded} onChange={e=>{const file=e.target.files?.[0];if(file)void upload(file);e.target.value='';}}/></label><button className="shell-primary" disabled={!loaded} onClick={()=>open(filter==='prep'?{...emptyRecipe(),kind:'prep',yield:'',unit:'g'}:emptyRecipe())}><Plus size={18}/>{filter==='prep'?'新增配件':'新增主食譜'}</button></div></header>
   {hasDraft&&<div className="recipe-draft-banner"><span>此裝置有上次編輯的配方</span><button className="text-button" onClick={restore}>繼續編輯<ChevronRight size={16}/></button></div>}
   {imports.length>0&&<section className="recipe-panel"><h2>選擇要建立的配方</h2><p>已整理為草稿，請核對用量與製成量。</p>{imports.map((recipe,i)=><button className="recipe-list-row" key={i} onClick={()=>openImport(recipe,i)}><span><span className={`recipe-tag recipe-kind-${recipe.kind}`}>{recipe.kind==='prep'?'配件':'主食譜'}</span><strong>{recipeDisplayName(recipe)}</strong><small>{recipe.lines.length} 個品項</small></span><span>核對配方 →</span></button>)}</section>}
   <div className="recipe-list-tools"><label className="recipe-search"><Search size={18}/><input aria-label="搜尋主食譜或配件" placeholder={filter==='prep'?'搜尋配件名稱':'搜尋主食譜或配件'} value={search} onChange={e=>setSearch(e.target.value)}/></label><nav className="recipe-list-tabs" aria-label="食譜分類">{([['dish','主食譜'],['prep','配件'],['pending','待補資料']] as const).map(([value,label])=><button key={value} aria-pressed={filter===value} onClick={()=>setFilter(value)}>{label}<span className="recipe-tab-count">{counts[value]}</span></button>)}</nav><small className="recipe-list-hint">{filter==='dish'?'出餐菜色，可包含食材與配件。':filter==='prep'?'醬汁、備料等，可供多份食譜共用。':'補齊價格、用量或換算後，即可計算成本。'}</small></div>
   {!loaded&&!error?<p role="status">正在讀取配方…</p>:filter==='pending'?(['dish','prep'] as const).map(kind=>{const group=recipes.filter(r=>r.document.kind===kind);return group.length>0&&<section className="recipe-list-group" key={kind} aria-label={kind==='dish'?'待補主食譜':'待補配件'}><h2>{kind==='dish'?'主食譜':'配件'}<span className="recipe-count">{group.length}</span></h2><RecipeCards recipes={group} workspace={workspace} onOpen={recipe=>open(recipe.document,recipe)}/></section>;}):<RecipeCards recipes={recipes} workspace={workspace} onOpen={recipe=>open(recipe.document,recipe)}/>}
   {loaded&&recipes.length===0&&<section className="recipe-empty"><BookOpen size={32}/><h2>{workspace.recipes.length?'沒有符合的配方':'建立第一份配方'}</h2><p>{workspace.recipes.length?'換個名稱或分類試試。':'新增配方或匯入 Word／文字型 PDF，即可開始。'}</p></section>}
  </>}
 </div>;
}
