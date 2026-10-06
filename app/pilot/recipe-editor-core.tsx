'use client';

import {useCallback, useEffect, useRef, useState} from 'react';
import {ArrowLeft, BookOpen, Check, ChevronDown, ChevronRight, Copy, Plus, Search, Trash2, X} from 'lucide-react';
import RecipeModal from './recipe-modal';
import {recipeUnitMoney,type RecipePriceInput} from './recipe-price-editor';
import RecipeInlinePrice,{recipeInputUnits} from './recipe-inline-price';
import {recipeCostChange,recipeLockedPriceWorkspace,recipeEditorDisplayCost,recipeInitialPriceDrafts,recipeEditorPreview,recipePriceDraft,type RecipePriceDraft} from '@/lib/recipe-price-draft';
export type {RecipePriceInput} from './recipe-price-editor';
import {recipeCost, recipeComponents, recipeDisplayName, recipePortionCost, recipePrepOptions, recipeYieldHint, recipeNoteText, recipeUnit, recipeIngredientOptions, type RecipeDocument, type RecipeLine, recipePurchaseDisplay, recipePurchaseUnitAmount, type RecipeWorkspace} from '@/lib/recipe-cost';

export const recipeMoney = (value:number|null) => value === null ? '—' : `NT$ ${value.toLocaleString('zh-TW', {minimumFractionDigits:2, maximumFractionDigits:2})}`;
const units = recipeInputUnits;
type Props = {
 document:RecipeDocument; recipeId:string; workspace:RecipeWorkspace; status:string; saving:boolean;
 onChange:(patch:Partial<RecipeDocument>)=>void;
 onBack:()=>void; backLabel?:string; onCopy:()=>void; onSave:()=>void;
 onPrice:(data:RecipePriceInput)=>Promise<boolean>;
 draftKey?:string; registerPriceSave?:(handler:(()=>Promise<boolean>)|null)=>void;
 onFillPrices?:()=>void;fillingPrices?:boolean;fillNotice?:string;
 embedded?:boolean; locked?:boolean; onOpenPrep?:(id:string)=>void; onCreatePrep?:(name:string)=>void; excludedRecipeIds?:string[];
};

export default function RecipeEditor({document:doc,recipeId,workspace,status,onChange,onBack,backLabel='食譜清單',onCopy,onSave,draftKey,registerPriceSave,embedded=false,locked=false,onOpenPrep,onCreatePrep,excludedRecipeIds=[],onFillPrices,fillingPrices=false,fillNotice=''}:Props){
 const compact=!embedded;
 const overview=compact&&doc.kind==='dish';
 const [basicsOpen,setBasicsOpen]=useState(()=>!doc.name||overview);
 const [ingredientsOpen,setIngredientsOpen]=useState(()=>!doc.lines.length);
 const [editingLine,setEditingLine]=useState<string|null>(null);
 const [search,setSearch]=useState(''),[kind,setKind]=useState<'all'|'products'|'prep'>('all'),[picking,setPicking]=useState(false);
 const [photoError,setPhotoError]=useState('');
 const [openNotes,setOpenNotes]=useState<Record<string,boolean>>({});
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
 const pendingComponents=components.filter(component=>!component.uses.length||!component.recipe);
 const yieldQty=Number(doc.yield),perUnit=cost.total!==null&&yieldQty>0?cost.total/yieldQty:null;
 const portion=recipePortionCost(doc,cost);
 const yieldHint=recipeYieldHint(doc);
 const showYieldHint=yieldHint&&(yieldQty<=0||recipeUnit(doc.unit)!==recipeUnit(yieldHint.unit));
 const yieldHintControl=showYieldHint&&<div className="recipe-yield-hint"><small>原食譜記載：製成{yieldHint.name} {yieldHint.quantity}{yieldHint.unit}</small><button type="button" className="text-button" onClick={()=>onChange({yield:yieldHint.quantity,unit:yieldHint.unit})}>採用 {yieldHint.quantity}{yieldHint.unit}</button></div>;
 const term=search.trim().toLowerCase();
 const ingredients=recipeIngredientOptions(workspace);
 const products=ingredients.filter(p=>`${p.name} ${(p.aliases||[]).join(' ')} ${p.specification||''} ${p.price?.supplier_name||p.price?.source_ref?.supplier_name||''}`.toLowerCase().includes(term));
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
 function beginPicking(){setPicking(true);searchInput.current?.focus();searchInput.current?.scrollIntoView({block:'nearest',behavior:'smooth'});}
 function openLine(line:RecipeLine){if(line.recipe_id&&onOpenPrep)void afterPrices(()=>{setEditingLine(null);onOpenPrep(line.recipe_id!);});else setEditingLine(line.id);}
 function linkPrep(line:RecipeLine,recipe_id:string){
  if(!recipePrepOptions(line,workspace,[recipeId,...excludedRecipeIds]).some(r=>r.id===recipe_id))return;
  const next={...priceDraftRef.current};delete next[line.id];stashPrices(next);setPriceErrors({});
  updateLine(line.id,{recipe_id,product_id:undefined,ingredient_id:undefined});setEditingLine(null);
 }

 const renderLine=(line:RecipeLine,index:number)=>{
  const result=cost.lines[index];
  const draft=priceDrafts[line.id]||recipePriceDraft(line,lockedPrices,doc.notes);
  const displayedPrice=draft.amount.trim()&&Number.isFinite(Number(draft.amount))?Number(draft.amount):null;
  return <article className={`recipe-row${result.reason?' recipe-row-pending':''}`} key={line.id} data-line-id={line.id}>
   <div className="recipe-row-main">
    <div className="recipe-row-name">{line.recipe_id&&onOpenPrep?<button className="recipe-name-button" onClick={()=>openLine(line)}>{workspace.recipes.find(r=>r.id===line.recipe_id)?.document.name||line.name}<ChevronRight size={16}/></button>:<input aria-label={`第${index+1}項食材名稱`} list={`recipe-products-${recipeId}`} value={line.name} maxLength={160} onChange={e=>chooseIngredient(line,e.target.value)}/>}<button type="button" className="text-button recipe-note-toggle" aria-label={`${line.name}備註開關`} aria-expanded={!!openNotes[line.id]} aria-controls={`recipe-note-${line.id}`} onClick={()=>setOpenNotes(current=>({...current,[line.id]:!current[line.id]}))}>備註{recipeNoteText(line,doc.notes)&&<span className="recipe-note-dot" aria-label="已有備註"/>}<ChevronDown size={12}/></button></div>
    <div className="recipe-quantity"><input data-quantity-id={line.id} aria-label={`${line.name}用量`} type="number" inputMode="decimal" min="0" value={line.quantity} placeholder="用量" onChange={e=>updateLine(line.id,{quantity:e.target.value})}/><select aria-label={`${line.name}單位`} value={line.unit} onChange={e=>updateLine(line.id,{unit:e.target.value})}>{[...new Set([line.unit,...units])].map(u=><option key={u} value={u}>{u||'請選單位'}</option>)}</select></div>
    {workspace.can_price&&!line.recipe_id?<RecipeInlinePrice line={line} sourceText={doc.notes} draft={draft} workspace={lockedPrices} pending={!!priceDrafts[line.id]} error={priceErrors[line.id]} disabled={locked} onDiscard={()=>{const next={...priceDraftRef.current};delete next[line.id];stashPrices(next);setPriceErrors({});}} onChange={next=>editPrice(line,next)} onMap={product_id=>mapIngredient(line,product_id)}/>:<div className="recipe-unit-price"><span className="recipe-mobile-label">食材單價</span><span>{line.recipe_id?'依配件配方':displayedPrice===null?'—':`${displayedPrice.toLocaleString('zh-TW',{maximumFractionDigits:6})} 元／${draft.unit}`}</span></div>}
    <div className="recipe-row-cost" aria-live="polite"><span className="recipe-mobile-label">使用成本</span><strong>{result.amount===null?'—':recipeMoney(result.amount)}</strong></div>
    <div className="recipe-line-note-panel" id={`recipe-note-${line.id}`} hidden={!openNotes[line.id]}><label>{line.name}備註<textarea rows={2} maxLength={800} aria-label={`${line.name}備註`} placeholder="例如：120g 使用 6顆；或取皮切絲等說明" value={recipeNoteText(line,doc.notes)} onChange={e=>updateLine(line.id,{note:e.target.value})}/></label></div>
    <button className="recipe-icon-button recipe-remove" aria-label={`移除${line.name}`} onClick={()=>{remove(line,index);setEditingLine(null);}}><Trash2 size={17}/></button>
   </div>
  </article>;
 };
 const yieldField=<label>{doc.kind==='prep'?'這批製成':overview?'製成量':'這份配方可做'}<div className="recipe-quantity"><input aria-label="製成量" type="number" inputMode="decimal" min="0" value={doc.yield} placeholder="製成數量" onChange={e=>onChange({yield:e.target.value})}/><select aria-label="製成單位" value={doc.unit} onChange={e=>onChange({unit:e.target.value})}>{[...new Set([doc.unit,...units])].map(u=><option key={u} value={u}>{u||'單位'}</option>)}</select></div></label>;
 return <div className={`recipe-editor recipe-direct-editor${compact?' recipe-compact-editor':''}${embedded?' recipe-embedded-editor':''}${overview?' recipe-dish-editor':''}`} ref={root}>
  <header className="recipe-editor-header">{!embedded&&<button className="recipe-back" disabled={locked} onClick={()=>void afterPrices(onBack)}><ArrowLeft size={18}/>{backLabel}</button>}<span className="recipe-save-state" role="status">{priceBusy?'儲存中…':Object.keys(priceDrafts).length?'草稿已保留':status||'草稿已保留'}</span>{!embedded&&<button className="text-button" onClick={()=>void afterPrices(onCopy)} disabled={locked}><Copy size={16}/>複製</button>}</header>
  <p className="recipe-cost-note" role="status">已儲存成本保留；新進價先提醒，確認後再更新。手動修改價格時顯示試算。</p>
  <fieldset className="recipe-edit-fields" disabled={locked}><div className="recipe-editor-layout"><main className="recipe-main-column">
   <section className="recipe-panel recipe-basics" aria-label="配方資料">
    <div className="recipe-title-kind"><span className={`recipe-tag recipe-kind-${doc.kind}`}>{doc.kind==='prep'?'配件':'主食譜'}</span>{!embedded&&<h1>{overview?'編輯主食譜':recipeDisplayName(doc)||(doc.kind==='prep'?'新增配件':'新增主食譜')}</h1>}</div>
    {movement&&<small className="recipe-price-change-note">價格異動 · {movement.count} 項 · {movement.percent===null?'待確認':`${movement.percent>=0?'+':''}${movement.percent.toFixed(1)}%`} · 原成本保留，請至成本異動提醒查看</small>}
    <details className="recipe-basic-settings" open={overview||basicsOpen} onToggle={e=>setBasicsOpen(e.currentTarget.open)}><summary>{embedded?'修改配件名稱':doc.kind==='prep'?'名稱與類型':'名稱與份量'}</summary>
     <div className="recipe-basic-fields"><label>配方名稱<input placeholder="例如：大蒜美乃滋" value={overview?recipeDisplayName(doc):doc.name} maxLength={160} onChange={e=>onChange({name:e.target.value})}/></label>{!embedded&&doc.kind!=='prep'&&yieldField}</div>
     {!embedded&&<details className="recipe-advanced-settings"><summary>其他設定</summary><div className="recipe-type-switch" aria-label="配方類型"><button aria-pressed={doc.kind==='dish'} onClick={()=>selectKind('dish')}>主食譜</button><button aria-pressed={doc.kind==='prep'} onClick={()=>selectKind('prep')}>配件</button></div>{doc.source_name&&<p className="recipe-source">匯入：{doc.source_name} · 請核對名稱、用量與製成量</p>}</details>}
    </details>
    {embedded&&yieldHintControl}
   </section>
   {onFillPrices&&<div className="recipe-price-fill"><div className="recipe-section-heading"><button type="button" className="recipe-secondary" disabled={locked} onClick={()=>void afterPrices(onFillPrices)}>{fillingPrices?'帶入中…':'帶入食材價格'}</button>{fillNotice&&<small role="status">{fillNotice}</small>}</div><small className="recipe-muted">只補空白價格，保留手動價格與已存成本。</small></div>}
   {overview&&<button className="recipe-usage-toggle" aria-expanded={ingredientsOpen} aria-controls={`recipe-usage-${recipeId}`} onClick={()=>setIngredientsOpen(!ingredientsOpen)}><strong>出餐用料 · {doc.lines.length} 項</strong><span>{ingredientsOpen?'收合用料':'編輯用料'}<ChevronDown size={16}/></span></button>}
   <section className="recipe-panel recipe-ingredients" id={`recipe-usage-${recipeId}`} hidden={overview&&!ingredientsOpen} aria-label="食材與用量">
    <div className="recipe-section-heading"><h2>食材與成本 <span className="recipe-count">{doc.lines.length}</span></h2><small>直接填寫，即時計算成本</small></div>
    <div className="recipe-picker" onKeyDown={e=>{if(e.key==='Escape')setPicking(false);}}>
     <label className="recipe-search"><Search size={19}/><input ref={searchInput} aria-label="搜尋食材或備料" placeholder="搜尋食材或備料，直接加入" value={search} onFocus={()=>setPicking(true)} onChange={e=>{setSearch(e.target.value);setPicking(true);}}/>{picking&&<button className="recipe-icon-button" aria-label="收起食材搜尋" onClick={()=>setPicking(false)}><X size={18}/></button>}</label>
     {picking&&<div className="recipe-picker-results"><div className="recipe-picker-tabs">{([['all','全部'],['products','食材'],['prep','配件']] as const).map(([value,label])=><button key={value} aria-pressed={kind===value} onClick={()=>setKind(value)}>{label}</button>)}</div>
      <div className="recipe-match-list">
       {kind!=='prep'&&products.slice(0,15).map(p=>{const price=p.price,purchase=price?.purchase?recipePurchaseDisplay(price.purchase):null,amount=price?recipePurchaseUnitAmount({...price,purchase}):null;return <button key={p.key} onClick={()=>add(p.name,recipeUnit(p.unit),p.product_id,undefined,p.ingredient_id)}><span><strong>{p.name}</strong><small>{p.specification||p.unit}{price&&amount!==null?` · ${recipeMoney(amount)}／${purchase?.unit||price.unit}${purchase?.content_quantity?`・每 ${purchase.unit} ${purchase.content_quantity} ${purchase.content_unit}`:''}`:' · 價格待補／確認'}</small></span><Plus size={19}/></button>;})}
       {kind!=='products'&&preps.slice(0,15).map(r=><button key={r.id} onClick={()=>add(r.document.name,r.document.unit,undefined,r.id)}><span><strong>{r.document.name}<em>配件</em></strong><small>製成 {r.document.yield||'待填'} {r.document.unit}</small></span><Plus size={19}/></button>)}
      </div>
      {term&&<button className="recipe-add-new" onClick={()=>add(search.trim(),'g')}><Plus size={17}/>新增食材名稱「{search.trim()}」<small>價格可由行政補齊</small></button>}
      {onCreatePrep&&kind!=='products'&&<button className="recipe-add-new" onClick={()=>void afterPrices(()=>{setPicking(false);onCreatePrep(search.trim());})}><Plus size={17}/>建立新配件{term?`「${search.trim()}」`:''}</button>}
      {!term&&<small className="recipe-picker-hint">輸入名稱可搜尋更多食材；選取後直接填用量。</small>}
     </div>}
    </div>
    {doc.lines.length>0&&<div className={compact?'recipe-compact-head':'recipe-table-head'} aria-hidden="true">{compact?<><span>品項</span><span>使用量</span><span>進價</span><span>本次成本</span><span/></>:<><span>品項</span><span>食譜使用量</span><span>進價與包裝</span><span>使用成本</span><span/></>}</div>}
    <div className="recipe-rows">{displayDoc.lines.map((line,index)=>{
     if(!compact)return renderLine(line,index);
     const result=cost.lines[index],unitPrice=unitCosts.lines[index].amount;
     const quote=priceDrafts[line.id]||recipePriceDraft(line,lockedPrices,doc.notes);
     const source=result.price;
     const quoteAmount=quote.amount.trim()?Number(quote.rawAmount??quote.amount):null;
     const needsPrepYield=!!line.recipe_id&&unitPrice===null;
     const name=line.recipe_id?workspace.recipes.find(r=>r.id===line.recipe_id)?.document.name||line.name:line.name;
     return <article className="recipe-compact-row" key={line.id} data-line-id={line.id}>
      <button className="recipe-name-button" aria-label={`編輯${name||'未命名品項'}`} onClick={()=>openLine(line)}><span>{name||'填寫品項'}{!line.recipe_id&&<small className="recipe-source-micro">來源：{source?.source_kind==='history'?'過去食譜成本表':source?.source||quote.source}{source?.effective_date?` · ${source.effective_date}`:''}</small>}</span><ChevronRight size={15}/></button>
      <div className="recipe-quantity"><input data-quantity-id={line.id} aria-label={`${line.name}用量`} type="number" inputMode="decimal" min="0" value={line.quantity} placeholder="用量" onChange={e=>updateLine(line.id,{quantity:e.target.value})}/><select aria-label={`${line.name}單位`} value={line.unit} onChange={e=>updateLine(line.id,{unit:e.target.value})}>{[...new Set([line.unit,...units])].map(u=><option key={u} value={u}>{u||'單位'}</option>)}</select></div>
      <button className="recipe-compact-price" aria-label={`編輯${name}單價`} onClick={()=>needsPrepYield?openLine(line):setEditingLine(line.id)}>{line.recipe_id?(unitPrice===null?'—':unitPrice.toLocaleString('zh-TW',{maximumFractionDigits:4})):quoteAmount===null?'—':`NT$ ${quoteAmount.toLocaleString('zh-TW',{maximumFractionDigits:4})}／${quote.unit}`}<small>{line.recipe_id?`元／${line.unit}`:quote.content?`每 ${quote.unit} ${quote.content} ${quote.contentUnit}`:recipeUnit(quote.unit)===recipeUnit(line.unit)?'依使用量計價':'換算可後補'}</small></button>
      <div className="recipe-compact-cost" aria-live="polite"><strong>{result.amount===null?'—':result.amount.toLocaleString('zh-TW',{minimumFractionDigits:2,maximumFractionDigits:2})}</strong>{result.amount!==null&&!priceDrafts[line.id]&&workspace.recipes.find(r=>r.id===recipeId)?.cost?.lines.some(l=>l.id===line.id&&l.amount!==null)&&<small>沿用已存成本</small>}</div>
      <button className="recipe-icon-button recipe-compact-remove" aria-label={`移除${line.name}`} onClick={()=>remove(line,index)}><Trash2 size={15}/></button>
     </article>;
    })}</div>
    {!doc.lines.length&&<div className="recipe-empty"><BookOpen size={28}/><p>先加入第一項食材</p><small>可選擇進貨食材，也可引用已建立的備料。</small></div>}
    <button className="recipe-add-line" onClick={beginPicking}><Plus size={20}/>新增品項</button>
    {compact&&<small>點單價補充價格與換算，缺少資料仍可儲存。</small>}
    {canUndo&&<div className="recipe-undo" role="status">已移除此項食材<button className="text-button" onClick={undo}>復原</button></div>}
   </section>
   {overview&&<section className="recipe-panel recipe-components-panel" aria-label="配件成本">
    <div className="recipe-section-heading recipe-components-heading"><div><h2>配件成本</h2><small>配件整批成本與使用量，會計入本菜品成本。</small></div><span className="recipe-component-count">共 {components.length} 項</span></div>
    {components.length>0?<><div className="recipe-component-columns" aria-hidden="true"><span>配件名稱</span><span>製成量</span><span>整批成本</span><span>操作</span></div>{components.map((component,index)=>{
     const child=component.recipe,childCost=child?recipeEditorDisplayCost(child.document,workspace,{},child.id).total:null;
     const title=<span className="recipe-component-title"><span className="recipe-component-number">{index+1}</span><strong>{component.name}</strong></span>;
     return child||!component.candidates.length?<button type="button" className="recipe-component-row" key={component.id} disabled={!child||!onOpenPrep} aria-label={`編輯配件${component.name}`} onClick={()=>{if(child&&onOpenPrep)void afterPrices(()=>onOpenPrep(child.id));}}>{title}<span>{child?.document.yield||'待填'}<small>{child?.document.unit||''}</small></span><span className={childCost===null?'recipe-pending':''}>{childCost===null?'—':`$ ${childCost.toLocaleString('zh-TW',{minimumFractionDigits:2,maximumFractionDigits:2})}`}</span><span className="recipe-component-action">查看 <ChevronRight size={15}/></span></button>:<div className="recipe-tree-variant" key={component.id}>{title}<select aria-label={`${component.name}配件版本`} value="" disabled={!onOpenPrep} onChange={e=>{const selected=component.candidates.find(card=>card.id===e.target.value);if(selected&&onOpenPrep)void afterPrices(()=>onOpenPrep(selected.id));}}><option value="" disabled>選擇版本（{component.candidates.length}）</option>{component.candidates.map(card=><option key={card.id} value={card.id}>製成 {card.document.yield||'待填'} {card.document.unit} · {card.updated_at?.slice(0,10)}</option>)}</select></div>;
    })}<small className="recipe-components-hint">配件可沿用已建立的配件食譜；資料未完整仍可先儲存，稍後再補。</small></>:<p className="recipe-muted">尚未加入配件，可在「編輯用料」新增品項。</p>}
    {pendingComponents.length>0&&<small className="recipe-pending recipe-component-pending-note">{pendingComponents.map(component=>`${component.name}${component.uses.length?'待補配件':'待確認出餐用量'}`).join('、')}，可稍後補齊。</small>}
   </section>}
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
   <details className="recipe-panel recipe-notes"><summary><span>照片與做法 <small>選填</small></span><ChevronDown size={18}/></summary><label>做法與備註<textarea rows={6} value={doc.notes} onChange={e=>onChange({notes:e.target.value})}/></label><label>配方照片<input type="file" accept="image/*" onChange={e=>{const file=e.target.files?.[0];if(!file)return;if(file.size>1000000){setPhotoError('請選擇 1MB 以下的照片。');return;}const reader=new FileReader();reader.onload=()=>{onChange({photo:String(reader.result)});setPhotoError('');};reader.readAsDataURL(file);}}/></label>{photoError&&<p role="alert">{photoError}</p>}{doc.photo&&<><img className="recipe-photo" src={doc.photo} alt="配方照片"/><button className="text-button" onClick={()=>onChange({photo:undefined})}>移除照片</button></>}</details>
  </aside></div>
  <datalist id={`recipe-products-${recipeId}`}>{ingredients.map(p=><option key={p.key} value={p.name}>{p.specification||p.unit}</option>)}</datalist>
  <datalist id={`recipe-units-${recipeId}`}>{units.map(unit=><option key={unit} value={unit}/>)}</datalist>
  {priceErrors._save&&<p className="recipe-inline-error" role="alert">{priceErrors._save}</p>}
  </fieldset><footer className="recipe-footer"><div><small role="status" aria-live="polite">{status.startsWith('尚未同步')?status:priceBusy?'儲存中…':Object.keys(priceDrafts).length?'草稿已保留':status}</small><small>{`每 ${doc.unit||'份'} 成本試算`}</small><strong>{doc.kind==='prep'&&perUnit!==null?recipeUnitMoney(perUnit):perUnit!==null?recipeMoney(perUnit):recipeMoney(cost.total??(cost.lines.some(line=>line.amount!==null)?cost.subtotal:null))}</strong></div><button className="recipe-secondary" onClick={()=>void afterPrices(onBack)}>{embedded?'返回主表（保留草稿）':'保留草稿'}</button><button className="shell-primary" disabled={locked} onClick={()=>void afterPrices(onSave)}><Check size={18}/>{fillingPrices?'帶入中…':locked?'儲存中…':embedded?'儲存並帶回主表':'儲存至食譜'}</button></footer>
  {editingLine&&doc.lines.some(l=>l.id===editingLine)&&<RecipeModal title="編輯品項" busy={false} onClose={()=>void afterPrices(()=>setEditingLine(null))}>
   {(()=>{const line=doc.lines.find(l=>l.id===editingLine)!;const options=recipePrepOptions(line,workspace,[recipeId,...excludedRecipeIds]);const current=workspace.recipes.find(r=>r.id===line.recipe_id);return (options.length>0||current)&&<section className="recipe-prep-source">
    <label>帶入備料成本<select aria-label={`${line.name}備料來源`} value={line.recipe_id||''} disabled={locked} onChange={e=>linkPrep(line,e.target.value)}><option value="" disabled>選擇已建立的備料配方</option>{options.map(r=><option value={r.id} key={r.id}>{r.document.name} · 製成 {r.document.yield||'待填'} {r.document.unit}{recipeUnit(r.document.unit)!==recipeUnit(line.unit)?' · 需確認換算':''} · {r.updated_at?.slice(0,10)||''}</option>)}</select></label>
    <small>{current?`成本來自「${current.document.name}」：整批成本 ÷ ${current.document.yield||'待填'} ${current.document.unit}，依本表使用量計算。`:'選定後自動帶入成本，保留原本的使用量與備註。'}</small>
   </section>;})()}
   <div className="recipe-ingredient-modal-body">{renderLine(doc.lines.find(l=>l.id===editingLine)!,doc.lines.findIndex(l=>l.id===editingLine))}</div>
   <footer className="recipe-modal-footer"><button className="shell-primary" disabled={locked} onClick={()=>void afterPrices(()=>setEditingLine(null))}>完成編輯</button></footer>
  </RecipeModal>}
 </div>;
}
