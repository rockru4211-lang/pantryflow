'use client';

import {useCallback, useEffect, useRef, useState, type ReactNode} from 'react';
import {ArrowLeft, BookOpen, Check, ChevronDown, ChevronRight, Copy, Plus, Search, X} from 'lucide-react';
import RecipeModal from './recipe-modal';
import RecipeLossControl,{type RecipeLinePanel} from './recipe-loss-control';
import {recipeLossLabel} from '@/lib/recipe-loss';
import {linkRecipeComponentUsage} from '@/lib/recipe-attachment';
import {recipeUnitMoney,type RecipePriceInput} from './recipe-price-editor';
import RecipeInlinePrice,{recipeInputUnits} from './recipe-inline-price';
import {recipeCostChange,recipeLockedPriceWorkspace,recipeEditorDisplayCost,recipeInitialPriceDrafts,recipeEditorPreview,recipePriceDraft,type RecipePriceDraft} from '@/lib/recipe-price-draft';
export type {RecipePriceInput} from './recipe-price-editor';
import {recipeLineCode,recipeNotesView,recipeUpdateNotes,recipeSourceUrl, recipeCost, recipeComponents, recipeDisplayName, recipePortionCost, recipePrepOptions, recipeYieldHint, recipeNoteText, recipeUnit, recipeIngredientOptions, type RecipeDocument, type RecipeLine, recipePurchaseDisplay, recipePurchaseUnitAmount, type RecipeWorkspace} from '@/lib/recipe-cost';

export const recipeMoney = (value:number|null) => value === null ? '—' : `NT$ ${value.toLocaleString('zh-TW', {minimumFractionDigits:2, maximumFractionDigits:2})}`;
const units = recipeInputUnits;
type Props = {
 document:RecipeDocument; recipeId:string; workspace:RecipeWorkspace; status:string; saving:boolean;
 onChange:(patch:Partial<RecipeDocument>)=>void;
 onBack:()=>void; backLabel?:string; onCopy:()=>void; onSave:()=>void;
 onPrice:(data:RecipePriceInput)=>Promise<boolean>;
 tools?:ReactNode; organizationFields?:ReactNode; fieldFlow?:ReactNode;
 draftKey?:string; registerPriceSave?:(handler:(()=>Promise<boolean>)|null)=>void;
 onAttachComponents?:()=>void;onFillPrices?:()=>void;fillingPrices?:boolean;fillNotice?:string;
 embedded?:boolean; locked?:boolean;readOnly?:boolean; onOpenPrep?:(id:string)=>void; onCreatePrep?:(name:string)=>void; excludedRecipeIds?:string[];
};

export default function RecipeEditor({document:doc,recipeId,workspace,status,onChange,onBack,backLabel='食譜清單',onCopy,onSave,draftKey,registerPriceSave,embedded=false,locked=false,readOnly=false,onOpenPrep,onCreatePrep,excludedRecipeIds=[],onFillPrices,fillingPrices=false,fillNotice='',onAttachComponents,tools,organizationFields,fieldFlow}:Props){
 const notesView=recipeNotesView(doc.notes);
 const [originalOpen,setOriginalOpen]=useState(false);
 const sourceUrl=recipeSourceUrl(doc.source_url);
 const compact=!embedded;
 const overview=compact&&doc.kind==='dish';
 const [basicsOpen,setBasicsOpen]=useState(()=>!doc.name);
 const [expandedPrep,setExpandedPrep]=useState<string|null>(null);
 const [editingLine,setEditingLine]=useState<string|null>(null);
 const [search,setSearch]=useState(''),[kind,setKind]=useState<'all'|'products'|'prep'>('all'),[picking,setPicking]=useState(false);
 const [photoError,setPhotoError]=useState('');
 const [lineAction,setLineAction]=useState<{id:string;view:RecipeLinePanel}|null>(null);
 const [priceDrafts,setPriceDrafts]=useState<Record<string,RecipePriceDraft>>(()=>{try{return recipeInitialPriceDrafts(doc,workspace,draftKey?JSON.parse(localStorage.getItem(draftKey)||'{}'):{});}catch{return recipeInitialPriceDrafts(doc,workspace);}});
 const priceDraftRef=useRef(priceDrafts);
 const priceBusy=locked;const [priceErrors,setPriceErrors]=useState<Record<string,string>>({});
 const displayDoc=doc;
 const lockedPrices=recipeLockedPriceWorkspace(doc,workspace,recipeId);
 const previewWorkspace=recipeEditorPreview(displayDoc,lockedPrices,priceDrafts);
 const savedCard=workspace.recipes.find(card=>card.id===recipeId),movement=savedCard?recipeCostChange(savedCard,workspace):null;
 const stashPrices=useCallback((next:Record<string,RecipePriceDraft>)=>{priceDraftRef.current=next;setPriceDrafts(next);if(draftKey)try{if(Object.keys(next).length)localStorage.setItem(draftKey,JSON.stringify(next));else localStorage.removeItem(draftKey);}catch{setPriceErrors(current=>({...current,_save:'無法保留裝置草稿，請儲存後再離開。'}));return false;}return true;},[draftKey]);
 const deferPrices=useCallback(async()=>stashPrices(priceDraftRef.current),[stashPrices]);
 useEffect(()=>{const saved=()=>{try{setPriceDrafts(draftKey?JSON.parse(localStorage.getItem(draftKey)||'{}'):{});priceDraftRef.current=draftKey?JSON.parse(localStorage.getItem(draftKey)||'{}'):{};}catch{/* Keep the last draft if storage is unavailable. */}};window.addEventListener('recipe-prices-saved',saved);return()=>window.removeEventListener('recipe-prices-saved',saved);},[draftKey]);
 useEffect(()=>{stashPrices(priceDraftRef.current);},[stashPrices]);
 useEffect(()=>{registerPriceSave?.(deferPrices);return()=>registerPriceSave?.(null);},[registerPriceSave,deferPrices]);
 useEffect(()=>{const warn=(e:BeforeUnloadEvent)=>{if(Object.keys(priceDraftRef.current).length)e.preventDefault();};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[]);
 function editPrice(line:RecipeLine,draft:RecipePriceDraft){setPriceErrors({});stashPrices({...priceDraftRef.current,[line.id]:draft});}
 async function afterPrices(action:()=>void){if(await deferPrices())action();}

 const root=useRef<HTMLDivElement>(null),searchInput=useRef<HTMLInputElement>(null),focusLine=useRef<string|null>(null);
 const removed=useRef<{line:RecipeLine;index:number;price?:RecipePriceDraft}|null>(null),[canUndo,setCanUndo]=useState(false);
 const cost=recipeEditorDisplayCost(displayDoc,lockedPrices,priceDrafts,recipeId);
 // Show the normalized unit price even before a recipe usage amount is filled.
 const unitCosts=recipeCost({...displayDoc,lines:displayDoc.lines.map(line=>({...line,quantity:'1'}))},previewWorkspace,[recipeId]);
 const editedRoot={id:recipeId,document:doc,revision:0,updated_at:'',cost};
 const componentWorkspace={...previewWorkspace,recipes:workspace.recipes.some(r=>r.id===recipeId)?workspace.recipes.map(r=>r.id===recipeId?editedRoot:r):[...workspace.recipes,editedRoot]};
 const components=overview?recipeComponents(editedRoot,componentWorkspace):[];
 const pendingComponents=components.filter(component=>!component.uses.length);
 const yieldQty=Number(doc.yield),perUnit=cost.total!==null&&yieldQty>0?cost.total/yieldQty:null;
 const portion=recipePortionCost(doc,cost);
 const yieldHint=recipeYieldHint(doc);
 const showYieldHint=yieldHint&&(yieldQty<=0||recipeUnit(doc.unit)!==recipeUnit(yieldHint.unit));
 const yieldHintControl=showYieldHint&&<div className="recipe-yield-hint"><small>原食譜記載：製成{yieldHint.name} {yieldHint.quantity}{yieldHint.unit}</small><button type="button" className="text-button" onClick={()=>onChange({yield:yieldHint.quantity,unit:yieldHint.unit})}>採用 {yieldHint.quantity}{yieldHint.unit}</button></div>;
 const term=search.trim().toLowerCase();
 const ingredients=recipeIngredientOptions(workspace);
 const products=ingredients.filter(p=>`${p.ingredient_code||''} ${p.name} ${(p.aliases||[]).join(' ')} ${p.specification||''} ${p.price?.supplier_name||p.price?.source_ref?.supplier_name||''}`.toLowerCase().includes(term));
 const preps=workspace.recipes.filter(r=>r.id!==recipeId&&!excludedRecipeIds.includes(r.id)&&r.document.kind==='prep'&&r.document.name.toLowerCase().includes(term));
 useEffect(()=>{if(!focusLine.current)return;const target=root.current?.querySelector<HTMLInputElement>(`[data-quantity-id="${focusLine.current}"]`);target?.focus();target?.select();focusLine.current=null;},[doc.lines]);
 useEffect(()=>{if(picking)searchInput.current?.focus({preventScroll:true});},[picking]);
 function updateLine(id:string,patch:Partial<RecipeLine>){onChange({lines:doc.lines.map(l=>l.id===id?{...l,...patch}:l)});}
 function chooseIngredient(line:RecipeLine,name:string){
  if(line.recipe_id){if(name!==line.name)updateLine(line.id,{name});return;}
  const matches=recipeIngredientOptions(workspace).filter(p=>p.name===name.trim());
  if(name===line.name&&(line.product_id||matches.length!==1))return;
  updateLine(line.id,{name,ingredient_id:matches.length===1?matches[0].ingredient_id:undefined,product_id:matches.length===1?matches[0].product_id:undefined});
  const drafts={...priceDraftRef.current};delete drafts[line.id];stashPrices(drafts);setPriceErrors({});
 }
 function mapIngredient(line:RecipeLine,product_id?:string){
  updateLine(line.id,{product_id,ingredient_id:undefined});
  const hasQuote=workspace.prices.some(p=>p.key===(product_id?`p:${product_id}`:`n:${line.name.trim().toLowerCase()}`));
  // First-time mapping may retain an unsaved manual quote when no catalog quote exists.
  if(!line.product_id&&product_id&&!hasQuote&&priceDraftRef.current[line.id])return;
  const drafts={...priceDraftRef.current};delete drafts[line.id];stashPrices(drafts);setPriceErrors({});
 }
 function add(name:string,unit:string,product_id?:string,recipe_id?:string,ingredient_id?:string){
  const existing=doc.lines.find(l=>ingredient_id?l.ingredient_id===ingredient_id&&l.unit===unit:product_id?l.product_id===product_id:recipe_id?l.recipe_id===recipe_id:!l.product_id&&!l.recipe_id&&l.name===name&&l.unit===unit);
  const id=existing?.id||crypto.randomUUID();focusLine.current=id;
  onChange({lines:existing?[...doc.lines]:[...doc.lines,{id,name,unit:unit||'g',quantity:'',product_id,recipe_id,ingredient_id}]});
  setPicking(false);setSearch('');
 }
 function remove(line:RecipeLine,index:number){removed.current={line,index,price:priceDraftRef.current[line.id]};const drafts={...priceDraftRef.current};delete drafts[line.id];stashPrices(drafts);setCanUndo(true);onChange({lines:doc.lines.filter(l=>l.id!==line.id)});}
 function undo(){if(!removed.current)return;const lines=[...doc.lines];lines.splice(Math.min(removed.current.index,lines.length),0,removed.current.line);onChange({lines});if(removed.current.price)stashPrices({...priceDraftRef.current,[removed.current.line.id]:removed.current.price});removed.current=null;setCanUndo(false);}
 function selectKind(kind:RecipeDocument['kind']){if(doc.kind===kind)return;onChange({kind,...(doc.lines.length===0&&doc.yield==='1'&&doc.unit==='份'&&kind==='prep'?{yield:'',unit:'g'}:{})});}
 function beginPicking(nextKind:'all'|'products'|'prep'='all'){setKind(nextKind);setPicking(true);searchInput.current?.focus();searchInput.current?.scrollIntoView({block:'nearest',behavior:'smooth'});}
 function openLine(line:RecipeLine){setEditingLine(line.id);}
 function linkPrep(line:RecipeLine,recipe_id:string){
  if(!recipePrepOptions(line,workspace,[recipeId,...excludedRecipeIds]).some(r=>r.id===recipe_id))return;
  const linked=linkRecipeComponentUsage(doc,line.id,recipe_id);
  const next=Object.fromEntries(Object.entries(priceDraftRef.current).filter(([key])=>linked.lines.some(row=>row.id===key&&!row.recipe_id)));
  if(!stashPrices(next))return;setPriceErrors({});onChange(linked);setEditingLine(null);
 }

 const renderLossLabel=(line:RecipeLine,scope='row')=>{const label=recipeLossLabel(line);return label?<button type="button" className="recipe-loss-summary" disabled={locked} aria-label={`${line.name}修改耗損`} onClick={()=>setLineAction({id:`${scope}:${line.id}`,view:'loss'})}>{label}</button>:null;};
 const renderActions=(line:RecipeLine,index:number,scope='row')=>{
  const view=lineAction?.id===`${scope}:${line.id}`?lineAction.view:null;
  return <RecipeLossControl key={`${line.id}:${view||'closed'}`} line={line} notes={doc.notes} disabled={locked} view={view} onViewChange={next=>setLineAction(next?{id:`${scope}:${line.id}`,view:next}:null)} onChange={patch=>updateLine(line.id,patch)} onRemove={()=>{remove(line,index);setEditingLine(null);}}/>;
 };
 const renderLine=(line:RecipeLine,index:number)=>{
  const result=cost.lines[index];
  const draft=priceDrafts[line.id]||recipePriceDraft(line,lockedPrices,doc.notes);
  const displayedPrice=draft.amount.trim()&&Number.isFinite(Number(draft.amount))?Number(draft.amount):null;
  return <article className={`recipe-row${result.reason?' recipe-row-pending':''}`} key={line.id} data-line-id={line.id}>
   <div className="recipe-row-main">
    <div className="recipe-row-name">{line.recipe_id&&onOpenPrep?<button className="recipe-name-button" onClick={()=>openLine(line)}>{line.name}<small>成本來自：{workspace.recipes.find(r=>r.id===line.recipe_id)?.document.name}</small><ChevronRight size={16}/></button>:<input aria-label={`第${index+1}項食材名稱`} list={`recipe-products-${recipeId}`} value={line.name} maxLength={160} onChange={e=>chooseIngredient(line,e.target.value)}/>}{recipeNoteText(line,doc.notes)&&<small className="recipe-source-micro">{recipeNoteText(line,doc.notes)}</small>}</div>
    <div className="recipe-quantity"><input data-quantity-id={line.id} aria-label={`${line.name}用量`} type="number" inputMode="decimal" min="0" value={line.quantity} placeholder="用量" onChange={e=>updateLine(line.id,{quantity:e.target.value})}/><select aria-label={`${line.name}單位`} value={line.unit} onChange={e=>updateLine(line.id,{unit:e.target.value})}>{[...new Set([line.unit,...units])].map(u=><option key={u} value={u}>{u||'請選單位'}</option>)}</select>{renderLossLabel(line,'detail')}</div>
    {workspace.can_price&&!line.recipe_id?<RecipeInlinePrice line={line} sourceText={doc.notes} draft={draft} workspace={lockedPrices} pending={!!priceDrafts[line.id]} error={priceErrors[line.id]} disabled={locked} onDiscard={()=>{const next={...priceDraftRef.current};delete next[line.id];stashPrices(next);setPriceErrors({});}} onChange={next=>editPrice(line,next)} onMap={product_id=>mapIngredient(line,product_id)}/>:<div className="recipe-unit-price"><span className="recipe-mobile-label">食材單價</span><span>{line.recipe_id?'依配件配方':displayedPrice===null?'—':`${displayedPrice.toLocaleString('zh-TW',{maximumFractionDigits:6})} 元／${draft.unit}`}</span></div>}
    <div className="recipe-row-cost" aria-live="polite"><span className="recipe-mobile-label">使用成本</span><strong>{result.amount===null?'—':recipeMoney(result.amount)}</strong></div>
    {renderActions(line,index,'detail')}
   </div>
  </article>;
 };
 const renderPrepDetails=(line:RecipeLine,amount:number|null)=>{
  const child=workspace.recipes.find(card=>card.id===line.recipe_id);
  if(!child)return <section className="recipe-inline-component" id={`recipe-component-${line.id}`}><p>找不到此配件，已保存的使用成本仍保留。</p><button type="button" className="text-button" onClick={()=>openLine(line)}>選擇配件來源</button></section>;
  const childCost=recipeEditorDisplayCost(child.document,workspace,{},child.id),quantity=Number(child.document.yield);
  const rate=childCost.total!==null&&quantity>0?childCost.total/quantity:null;
  return <section className="recipe-inline-component" id={`recipe-component-${line.id}`} aria-label={`${line.name}配件內容`}>
   <header><strong>{recipeDisplayName(child.document)} <small className="recipe-code-slot">配件編號 —</small> <span className="recipe-tag">配件食譜</span></strong><div>{onOpenPrep&&<button type="button" className="text-button" onClick={()=>void afterPrices(()=>onOpenPrep(child.id))}>開啟配件食譜 <ChevronRight size={15}/></button>}<button type="button" className="text-button" aria-label={`收合${line.name}配件內容`} onClick={()=>setExpandedPrep(null)}>收合 <ChevronDown size={15}/></button></div></header>
   <div className="recipe-inline-component-summary"><span>製成量 <strong>{child.document.yield||'待填'} {child.document.unit}</strong></span><span>整批成本 <strong>{recipeMoney(childCost.total)}</strong></span><span>每 {child.document.unit} <strong>{rate===null?'—':recipeUnitMoney(rate)}</strong></span></div>
   <table><thead><tr><th className="recipe-code-slot">編號</th><th>內容食材</th><th>配方用量</th><th>成本</th></tr></thead><tbody>{child.document.lines.map((item,index)=><tr key={item.id}><td className="recipe-code-slot">{recipeLineCode(item,workspace)}</td><th>{item.name}{item.recipe_id&&<span className="recipe-tag">配件</span>}{recipeNoteText(item,child.document.notes)&&<small>{recipeNoteText(item,child.document.notes)}</small>}</th><td>{item.quantity||'—'} {item.unit}</td><td>{recipeMoney(childCost.lines[index]?.amount??null)}</td></tr>)}</tbody></table>
   {recipeSourceUrl(child.document.source_url)&&<a className="recipe-source-link" href={recipeSourceUrl(child.document.source_url)!} target="_blank" rel="noopener noreferrer">↗ 查看原始試算表</a>}{recipeNotesView(child.document.notes).text&&<details className="recipe-inline-component-notes"><summary>做法與備註 <ChevronDown size={14}/></summary><p>{recipeNotesView(child.document.notes).text}</p></details>}{recipeNotesView(child.document.notes).imported&&<details className="recipe-inline-component-notes"><summary>查看匯入原文</summary><pre className="recipe-original-text">{recipeNotesView(child.document.notes).original}</pre></details>}
   <small className="recipe-inline-component-usage">本菜使用 {line.quantity||'—'} {line.unit}，計入成本 {recipeMoney(amount)}。依本菜已儲存成本或目前編輯試算。</small>
  </section>;
 };
 const ingredientPicker=<div className="recipe-picker" onKeyDown={e=>{if(e.key==='Escape')setPicking(false);}}>
     <label className="recipe-search"><Search size={19}/><input ref={searchInput} aria-label="搜尋食材或備料" placeholder="搜尋食材或備料，直接加入" value={search} onFocus={()=>setPicking(true)} onChange={e=>{setSearch(e.target.value);setPicking(true);}}/>{picking&&<button className="recipe-icon-button" aria-label="收起食材搜尋" onClick={()=>setPicking(false)}><X size={18}/></button>}</label>
     {picking&&<div className="recipe-picker-results"><div className="recipe-picker-tabs">{([['all','全部'],['products','食材'],['prep','配件']] as const).map(([value,label])=><button key={value} aria-pressed={kind===value} onClick={()=>setKind(value)}>{label}</button>)}</div>
      <div className="recipe-match-list">
       {kind!=='prep'&&products.slice(0,15).map(p=>{const price=p.price,purchase=price?.purchase?recipePurchaseDisplay(price.purchase):null,amount=price?recipePurchaseUnitAmount({...price,purchase}):null;return <button key={p.key} aria-label={`加入${p.name}`} onClick={()=>add(p.name,recipeUnit(p.unit),p.product_id,undefined,p.ingredient_id)}><span><strong><span className="recipe-picker-code">{p.ingredient_code||'—'}</span>{p.name}</strong><small>{p.specification||p.unit}{price&&amount!==null?` · ${recipeMoney(amount)}／${purchase?.unit||price.unit}${purchase?.content_quantity?`・每 ${purchase.unit} ${purchase.content_quantity} ${purchase.content_unit}`:''}`:' · 價格待補／確認'}</small></span><Plus size={19}/></button>;})}
       {kind!=='products'&&preps.slice(0,15).map(r=><button key={r.id} onClick={()=>add(r.document.name,r.document.unit,undefined,r.id)}><span><strong><span className="recipe-picker-code">—</span>{r.document.name}<em>配件</em></strong><small>製成 {r.document.yield||'待填'} {r.document.unit}</small></span><Plus size={19}/></button>)}
      </div>
      {term&&<button className="recipe-add-new" onClick={()=>add(search.trim(),'g')}><Plus size={17}/>新增食材名稱「{search.trim()}」<small>價格可由行政補齊</small></button>}
      {onCreatePrep&&kind!=='products'&&<button className="recipe-add-new" onClick={()=>void afterPrices(()=>{setPicking(false);onCreatePrep(search.trim());})}><Plus size={17}/>建立新配件{term?`「${search.trim()}」`:''}</button>}
      {!term&&<small className="recipe-picker-hint">輸入名稱可搜尋更多食材；選取後直接填用量。</small>}
     </div>}
    </div>;
 const renderUsageLine=(line:RecipeLine,index:number)=>{
     if(!compact)return renderLine(line,index);
     const result=cost.lines[index],unitPrice=unitCosts.lines[index].amount;
     const quote=priceDrafts[line.id]||recipePriceDraft(line,lockedPrices,doc.notes);
     const quoteAmount=quote.amount.trim()?Number(quote.rawAmount??quote.amount):null;
     const prepOpen=expandedPrep===line.id;
     const name=line.name;
     return <article className="recipe-compact-row" key={line.id} data-line-id={line.id}>
      <span className="recipe-code-slot" aria-label={`${line.name}編號`}>{recipeLineCode(line,workspace)}</span><div className="recipe-name-with-loss"><button className="recipe-name-button" aria-label={line.recipe_id?`${prepOpen?'收合':'展開'}${name}配件`:`編輯${name||'未命名品項'}`} aria-expanded={line.recipe_id?prepOpen:undefined} aria-controls={line.recipe_id?`recipe-component-${line.id}`:undefined} onClick={()=>line.recipe_id?setExpandedPrep(prepOpen?null:line.id):openLine(line)}><span>{name||'填寫品項'}{line.recipe_id&&<span className="recipe-tag">配件</span>}{!overview&&recipeNoteText(line,doc.notes)&&<small className="recipe-source-micro">{recipeNoteText(line,doc.notes)}</small>}</span>{line.recipe_id?(prepOpen?<ChevronDown size={15}/>:<ChevronRight size={15}/>):<ChevronRight size={15}/>}</button></div>
      <div className="recipe-quantity"><input data-quantity-id={line.id} aria-label={`${line.name}用量`} type="number" inputMode="decimal" min="0" value={line.quantity} placeholder="用量" onChange={e=>updateLine(line.id,{quantity:e.target.value})}/><select aria-label={`${line.name}單位`} value={line.unit} onChange={e=>updateLine(line.id,{unit:e.target.value})}>{[...new Set([line.unit,...units])].map(u=><option key={u} value={u}>{u||'單位'}</option>)}</select>{renderLossLabel(line)}</div>
      <button className="recipe-compact-price" aria-label={`編輯${name}單價`} onClick={()=>openLine(line)}>{line.recipe_id?(unitPrice===null?'—':unitPrice.toLocaleString('zh-TW',{maximumFractionDigits:4})):quoteAmount===null?'—':`NT$ ${quoteAmount.toLocaleString('zh-TW',{maximumFractionDigits:4})}／${quote.unit}`}<small>{line.recipe_id?`元／${line.unit}`:quote.content?`每 ${quote.unit} ${quote.content} ${quote.contentUnit}`:recipeUnit(quote.unit)===recipeUnit(line.unit)?'依使用量計價':'換算可後補'}</small></button>
      <div className="recipe-compact-cost" aria-live="polite"><strong>{result.amount===null?'—':result.amount.toLocaleString('zh-TW',{minimumFractionDigits:2,maximumFractionDigits:2})}</strong>{result.amount!==null&&!priceDrafts[line.id]&&workspace.recipes.find(r=>r.id===recipeId)?.cost?.lines.some(l=>l.id===line.id&&l.amount!==null)&&<small>沿用已存成本</small>}</div>
      {renderActions(line,index)}
      {line.recipe_id&&prepOpen&&renderPrepDetails(line,result.amount)}
     </article>;
 };
 const yieldField=<label>{doc.kind==='prep'?'這批製成':overview?'製成量':'這份配方可做'}<div className="recipe-quantity"><input aria-label="製成量" type="number" inputMode="decimal" min="0" value={doc.yield} placeholder="製成數量" onChange={e=>onChange({yield:e.target.value})}/><select aria-label="製成單位" value={doc.unit} onChange={e=>onChange({unit:e.target.value})}>{[...new Set([doc.unit,...units])].map(u=><option key={u} value={u}>{u||'單位'}</option>)}</select></div></label>;
 const basicFields=<>
     <div className="recipe-basic-fields"><label>配方名稱<input placeholder="例如：大蒜美乃滋" value={overview?recipeDisplayName(doc):doc.name} maxLength={160} onChange={e=>onChange({name:e.target.value})}/></label>{!embedded&&doc.kind!=='prep'&&yieldField}{organizationFields}</div>
     <label className="recipe-source-field">原始食譜表連結 <small>選填</small><input aria-label="原始食譜表連結" type="url" inputMode="url" placeholder="貼上 Google 試算表或其他原始表格網址" maxLength={2048} value={doc.source_url||''} onChange={e=>onChange({source_url:e.target.value})}/>{doc.source_url?.trim()&&!sourceUrl?<small role="status">請貼上完整的 http:// 或 https:// 網址；可先儲存，稍後補齊。</small>:<small>可連到指定分頁；原表修改不會自動更新已儲存成本。</small>}</label>
     {!embedded&&<details className="recipe-advanced-settings"><summary>其他設定</summary><div className="recipe-type-switch" aria-label="配方類型"><button aria-pressed={doc.kind==='dish'} onClick={()=>selectKind('dish')}>主食譜</button><button aria-pressed={doc.kind==='prep'} onClick={()=>selectKind('prep')}>配件</button></div>{doc.source_name&&<p className="recipe-source">匯入：{doc.source_name} · 請核對名稱、用量與製成量</p>}</details>}
 </>;
 return <div className={`recipe-editor recipe-direct-editor${compact?' recipe-compact-editor':''}${embedded?' recipe-embedded-editor':''}${overview?' recipe-dish-editor':''}`} ref={root}>
  <header className="recipe-editor-header">{!embedded&&<button className="recipe-back" disabled={locked} onClick={()=>void afterPrices(onBack)}><ArrowLeft size={18}/>{backLabel}</button>}<span className="recipe-save-state" role="status">{priceBusy?'儲存中…':Object.keys(priceDrafts).length?'草稿已保留':status||'草稿已保留'}</span>
   <details className="recipe-editor-tools"><summary aria-label="更多食譜操作">⋯</summary><div>{notesView.imported&&<button type="button" className="text-button" onClick={e=>{e.currentTarget.closest('details')?.removeAttribute('open');setOriginalOpen(true);}}>查看匯入原文</button>}{overview&&<button type="button" className="text-button" disabled={locked} onClick={e=>{e?.currentTarget.closest('details')?.removeAttribute('open');setBasicsOpen(true);}}>食譜設定</button>}{!embedded&&<button className="text-button" onClick={()=>void afterPrices(onCopy)} disabled={locked||readOnly}><Copy size={16}/>複製食譜</button>}{onFillPrices&&<button type="button" className="text-button" disabled={locked||readOnly} onClick={()=>void afterPrices(onFillPrices)}>{fillingPrices?'帶入中…':'補齊空白價格'}</button>}{onAttachComponents&&<button type="button" className="text-button" disabled={locked||readOnly} onClick={()=>void afterPrices(onAttachComponents)}>整理配件歸屬</button>}{tools}</div></details>
  </header>
  {fillNotice&&<p className="recipe-fill-notice" role="status">{fillNotice}</p>}
  <fieldset className="recipe-edit-fields" disabled={locked||readOnly}><div className="recipe-editor-layout"><main className="recipe-main-column">
   <section className="recipe-panel recipe-basics" aria-label="配方資料">
    <div className="recipe-title-kind"><span className={`recipe-tag recipe-kind-${doc.kind}`}>{doc.kind==='prep'?'配件':'主食譜'}</span>{!embedded&&<h1>{recipeDisplayName(doc)||(doc.kind==='prep'?'新增配件':'新增主食譜')}</h1>}</div>
    {embedded&&sourceUrl&&<a className="recipe-source-link" href={sourceUrl} target="_blank" rel="noopener noreferrer">↗ 查看原始試算表</a>}
    {movement&&<small className="recipe-price-change-note">價格異動 · {movement.count} 項 · {movement.percent===null?'待確認':`${movement.percent>=0?'+':''}${movement.percent.toFixed(1)}%`} · 原成本保留，請至成本異動提醒查看</small>}
    {!embedded&&<div className="recipe-recipe-meta"><span>{doc.category||doc.source_category||'待分類'}</span><span>{doc.kind==='prep'?'配件編號':'主食譜編號'} —</span><span>製成量 {doc.yield||'待填'} {doc.unit}</span>{sourceUrl&&<a href={sourceUrl} target="_blank" rel="noopener noreferrer">查看原始試算表 ↗</a>}</div>}
    {!overview?<details className="recipe-basic-settings" open={basicsOpen} onToggle={e=>setBasicsOpen(e.currentTarget.open)}><summary>{embedded?'修改配件名稱':'基本資料'}</summary>{basicFields}</details>:basicsOpen&&<RecipeModal title="食譜設定" busy={locked} onClose={()=>setBasicsOpen(false)}><fieldset className="recipe-edit-fields recipe-settings-fields" disabled={locked||readOnly}>{basicFields}</fieldset><footer className="recipe-modal-footer"><button type="button" className="shell-primary" onClick={()=>setBasicsOpen(false)}>完成設定</button></footer></RecipeModal>}
    {!sourceUrl&&notesView.imported&&<button type="button" className="text-button" onClick={()=>setBasicsOpen(true)}>＋ 補上原始試算表連結</button>}{embedded&&<small className="recipe-code-slot">配件編號 —</small>}{embedded&&yieldHintControl}
   </section>
   <section className="recipe-panel recipe-ingredients" id={`recipe-usage-${recipeId}`} aria-label="食材與用量">
    <div className="recipe-section-heading"><h2>{overview?'主配方':'用料明細'} <span className="recipe-count">{doc.lines.filter(line=>!overview||!line.recipe_id).length} 項</span></h2><button type="button" className="recipe-secondary" onClick={()=>beginPicking(overview?'products':'all')}><Plus size={17}/>{overview?'加入食材':'加入用料'}</button></div>
    {(!overview||kind!=='prep')&&ingredientPicker}
    {doc.lines.length>0&&<div className={compact?'recipe-compact-head':'recipe-table-head'} aria-hidden="true">{compact?<><span className="recipe-code-slot">編號</span><span>用料名稱</span><span>用量／單位</span><span>進價／配件單價</span><span>小計</span><span/></>:<><span>品項</span><span>食譜使用量</span><span>進價與包裝</span><span>使用成本</span><span/></>}</div>}
    <div className="recipe-rows">{displayDoc.lines.map((line,index)=>!overview||!line.recipe_id?renderUsageLine(line,index):null)}</div>
    {!doc.lines.some(line=>!overview||!line.recipe_id)&&<div className="recipe-empty"><BookOpen size={28}/><p>先加入第一項食材</p><small>可選擇進貨食材，也可引用已建立的備料。</small></div>}
    {compact&&!overview&&<small>點單價補充價格與換算，缺少資料仍可儲存。</small>}
    {canUndo&&<div className="recipe-undo" role="status">已移除此項食材<button className="text-button" onClick={undo}>復原</button></div>}
   </section>
   {overview&&<section className="recipe-panel recipe-ingredients recipe-linked-components" aria-label="配件">
    <div className="recipe-section-heading"><h2>配件 <span className="recipe-count">{doc.lines.filter(line=>line.recipe_id).length} 項</span></h2><button type="button" className="recipe-secondary" onClick={()=>beginPicking('prep')}><Plus size={17}/>加入配件</button></div>
    {kind==='prep'&&ingredientPicker}
    <div className="recipe-rows">{displayDoc.lines.map((line,index)=>line.recipe_id?renderUsageLine(line,index):null)}</div>
    {!doc.lines.some(line=>line.recipe_id)&&<p className="recipe-muted">尚未加入配件，需要時可選用已建立的配件食譜。</p>}
   </section>}
   {overview&&pendingComponents.length>0&&<details className="recipe-panel recipe-components-panel"><summary>尚未設定使用量的配件 · {pendingComponents.length} 項 <ChevronDown size={16}/></summary>
    <div className="recipe-section-heading recipe-components-heading"><div><h2>其他配件</h2><small>設定使用量後，才會計入本菜成本。</small></div><span className="recipe-component-count">共 {pendingComponents.length} 項</span></div>
    {pendingComponents.length>0?<><div className="recipe-component-columns" aria-hidden="true"><span>配件名稱</span><span>製成量</span><span>整批成本</span><span>操作</span></div>{pendingComponents.map(component=>{
     const child=component.recipe,childCost=child?recipeEditorDisplayCost(child.document,workspace,{},child.id).total:null;
     const title=<span className="recipe-component-title"><span className="recipe-component-number recipe-code-slot" aria-label="配件編號">—</span><strong>{component.name}</strong></span>;
     return child||!component.candidates.length?<button type="button" className="recipe-component-row" key={component.id} disabled={!child||!onOpenPrep} aria-label={`編輯配件${component.name}`} onClick={()=>{if(child&&onOpenPrep)void afterPrices(()=>onOpenPrep(child.id));}}>{title}<span>{child?.document.yield||'待填'}<small>{child?.document.unit||''}</small></span><span className={childCost===null?'recipe-pending':''}>{childCost===null?'—':`$ ${childCost.toLocaleString('zh-TW',{minimumFractionDigits:2,maximumFractionDigits:2})}`}</span><span className="recipe-component-action">查看 <ChevronRight size={15}/></span></button>:<div className="recipe-tree-variant" key={component.id}>{title}<select aria-label={`${component.name}配件版本`} value="" disabled={!onOpenPrep} onChange={e=>{const selected=component.candidates.find(card=>card.id===e.target.value);if(selected&&onOpenPrep)void afterPrices(()=>onOpenPrep(selected.id));}}><option value="" disabled>選擇版本（{component.candidates.length}）</option>{component.candidates.map(card=><option key={card.id} value={card.id}>製成 {card.document.yield||'待填'} {card.document.unit} · {card.updated_at?.slice(0,10)}</option>)}</select></div>;
    })}<small className="recipe-components-hint">配件可沿用已建立的配件食譜；資料未完整仍可先儲存，稍後再補。</small></>:<p className="recipe-muted">尚未加入配件，可在「編輯用料」新增品項。</p>}
    {pendingComponents.length>0&&<small className="recipe-pending recipe-component-pending-note">{pendingComponents.map(component=>`${component.name}${component.uses.length?'待補配件':'待確認出餐用量'}`).join('、')}，可稍後補齊。</small>}
   </details>}
  </main><aside className="recipe-cost-column" aria-label="即時成本">
   <section className={`recipe-panel recipe-summary${compact?' recipe-compact-summary':''}${doc.kind==='prep'?' recipe-prep-summary':''}`}>
    {(embedded||doc.kind==='prep')&&<div className="recipe-modal-yield">{yieldField}{!embedded&&yieldHintControl}</div>}
    <div className="recipe-section-heading"><h2>{doc.kind==='prep'?'整批食材成本試算':'整份配方成本試算'}</h2><span className="recipe-tag">未稅</span></div><strong className="recipe-total">{doc.lines.length===0?'尚未加入食材':recipeMoney(cost.total??(cost.lines.some(line=>line.amount!==null)?cost.subtotal:null))}</strong>{cost.total===null&&doc.lines.length>0&&<small className="recipe-pending">已計入金額；其餘項目顯示 —</small>}
    {!embedded&&doc.kind!=='prep'&&<p>製成 {doc.yield||'待填'} {doc.unit}</p>}
    {cost.total!==null&&perUnit!==null&&<div className="recipe-summary-line"><span>每 {doc.unit} 成本</span><strong>{doc.kind==='prep'?recipeUnitMoney(perUnit):recipeMoney(perUnit)}</strong></div>}
    {doc.kind==='prep'&&!embedded&&<details className="recipe-portion"><summary>取用試算 <ChevronDown size={16}/></summary><label>每次取用<div className="recipe-quantity"><input aria-label="每次取用量" type="number" min="0" inputMode="decimal" placeholder="例如 30" value={doc.portion_quantity||''} onChange={e=>onChange({portion_quantity:e.target.value})}/><input aria-label="取用單位" list={`recipe-units-${recipeId}`} value={doc.portion_unit||doc.unit} onChange={e=>onChange({portion_unit:e.target.value})}/></div></label><div className="recipe-summary-line"><span>取用成本</span><strong>{portion===null?'—':recipeMoney(portion)}</strong></div></details>}
    {doc.lines.length>0&&yieldQty<=0&&<p className="recipe-pending">請填製成量，才能換算每份或取用成本。</p>}
    <small className="recipe-cost-note">成本來源：進貨價格換算後依使用量計算。{cost.missing>0&&<> 尚有 {cost.missing} 項未計入。</>}</small>
   </section>
   <details className="recipe-panel recipe-notes"><summary><span>照片與做法 <small>選填</small></span><ChevronDown size={18}/></summary><label>做法與重點備註<textarea aria-label="做法與重點備註" rows={3} placeholder="補充料理步驟或注意事項" value={notesView.text} onChange={e=>onChange({notes:recipeUpdateNotes(doc.notes,e.target.value)})}/></label><label>配方照片<input type="file" accept="image/*" onChange={e=>{const file=e.target.files?.[0];if(!file)return;if(file.size>1000000){setPhotoError('請選擇 1MB 以下的照片。');return;}const reader=new FileReader();reader.onload=()=>{onChange({photo:String(reader.result)});setPhotoError('');};reader.readAsDataURL(file);}}/></label>{photoError&&<p role="alert">{photoError}</p>}{doc.photo&&<><img className="recipe-photo" src={doc.photo} alt="配方照片"/><button className="text-button" onClick={()=>onChange({photo:undefined})}>移除照片</button></>}</details>
  </aside></div>
  <datalist id={`recipe-products-${recipeId}`}>{ingredients.map(p=><option key={p.key} value={p.name}>{p.specification||p.unit}</option>)}</datalist>
  <datalist id={`recipe-units-${recipeId}`}>{units.map(unit=><option key={unit} value={unit}/>)}</datalist>
  {priceErrors._save&&<p className="recipe-inline-error" role="alert">{priceErrors._save}</p>}
  </fieldset>{fieldFlow}<p className="recipe-cost-note">已儲存成本保留，價格異動確認後更新。</p><footer className="recipe-footer"><div><small role="status" aria-live="polite">{status.startsWith('尚未同步')?status:priceBusy?'儲存中…':Object.keys(priceDrafts).length?'草稿已保留':status}</small><small>{`每 ${doc.unit||'份'} 成本試算`}</small><strong>{doc.kind==='prep'&&perUnit!==null?recipeUnitMoney(perUnit):perUnit!==null?recipeMoney(perUnit):recipeMoney(cost.total??(cost.lines.some(line=>line.amount!==null)?cost.subtotal:null))}</strong></div><button className="recipe-secondary" onClick={()=>void afterPrices(onBack)}>{embedded?'返回主表（保留草稿）':'保留草稿'}</button><button className="shell-primary" disabled={locked||readOnly} onClick={()=>void afterPrices(onSave)}><Check size={18}/>{fillingPrices?'帶入中…':locked?'儲存中…':embedded?'儲存並帶回主表':'儲存並鎖定'}</button></footer>
  {originalOpen&&<RecipeModal title="匯入原文" onClose={()=>setOriginalOpen(false)}><pre className="recipe-original-text">{notesView.original}</pre></RecipeModal>}
  {editingLine&&doc.lines.some(l=>l.id===editingLine)&&<RecipeModal title="編輯品項" busy={false} onClose={()=>void afterPrices(()=>setEditingLine(null))}>
   {(()=>{const line=doc.lines.find(l=>l.id===editingLine)!;const options=recipePrepOptions(line,workspace,[recipeId,...excludedRecipeIds]);const current=workspace.recipes.find(r=>r.id===line.recipe_id);return (options.length>0||current)&&<section className="recipe-prep-source">
    <label>使用配件成本<select aria-label={`${line.name}配件成本來源`} value={line.recipe_id||''} disabled={locked} onChange={e=>linkPrep(line,e.target.value)}><option value="" disabled>選擇配件配方</option>{options.map(r=><option value={r.id} key={r.id}>{r.document.name}{doc.lines.some(other=>other.id!==line.id&&other.recipe_id===r.id)?'（已列入，選取後合併）':''} · 製成 {r.document.yield||'待填'} {r.document.unit}{recipeUnit(r.document.unit)!==recipeUnit(line.unit)?' · 需確認換算':''} · {r.updated_at?.slice(0,10)||''}</option>)}</select></label>
    <small>{current?`成本來自「${current.document.name}」：整批成本 ÷ ${current.document.yield||'待填'} ${current.document.unit}，依本表使用量計算。`:'保留本行名稱與用量；若此配件已另列一行，會合併為本行，成本只算一次。'}</small>
    {current&&onOpenPrep&&<button type="button" className="text-button" onClick={()=>void afterPrices(()=>{setEditingLine(null);onOpenPrep(current.id);})}>查看配件配方</button>}
   </section>;})()}
   <div className="recipe-ingredient-modal-body">{renderLine(doc.lines.find(l=>l.id===editingLine)!,doc.lines.findIndex(l=>l.id===editingLine))}</div>
   <footer className="recipe-modal-footer"><button className="shell-primary" disabled={locked} onClick={()=>void afterPrices(()=>setEditingLine(null))}>完成編輯</button></footer>
  </RecipeModal>}
 </div>;
}
