'use client';

import {useCallback, useEffect, useRef, useState} from 'react';
import {ArrowLeft, BookOpen, Check, ChevronDown, Copy, Plus, Search, Trash2, X} from 'lucide-react';
import {recipeUnitMoney,type RecipePriceInput} from './recipe-price-editor';
import RecipeInlinePrice,{recipeInputUnits} from './recipe-inline-price';
import {draftRecipePrice,normalizeRecipeLineDraft,recipePriceDraft,recipePriceKey,type RecipePriceDraft} from '@/lib/recipe-price-draft';
export type {RecipePriceInput} from './recipe-price-editor';
import {recipeCost, recipePortionCost, recipeNoteBasis, recipeNoteText, recipeUnit, type RecipeDocument, type RecipeLine, type RecipeWorkspace} from '@/lib/recipe-cost';

export const recipeMoney = (value:number|null) => value === null ? '待補齊' : `NT$ ${value.toLocaleString('zh-TW', {minimumFractionDigits:2, maximumFractionDigits:2})}`;
const units = recipeInputUnits;
type Props = {
 document:RecipeDocument; recipeId:string; workspace:RecipeWorkspace; status:string; saving:boolean;
 onChange:(patch:Partial<RecipeDocument>)=>void;
 onBack:()=>void; onCopy:()=>void; onSave:()=>void;
 onPrice:(data:RecipePriceInput)=>Promise<boolean>;
 draftKey?:string; registerPriceSave?:(handler:(()=>Promise<boolean>)|null)=>void;
};

export default function RecipeEditor({document:doc,recipeId,workspace,status,saving,onChange,onBack,onCopy,onSave,onPrice,draftKey,registerPriceSave}:Props){
 const [search,setSearch]=useState(''),[kind,setKind]=useState<'all'|'products'|'prep'>('all'),[picking,setPicking]=useState(false);
 const [photoError,setPhotoError]=useState('');
 const [openNotes,setOpenNotes]=useState<Record<string,boolean>>({});
 const [priceDrafts,setPriceDrafts]=useState<Record<string,RecipePriceDraft>>(()=>{try{return draftKey?JSON.parse(localStorage.getItem(draftKey)||'{}'):{};}catch{return {};}});
 const priceDraftRef=useRef(priceDrafts),priceFlight=useRef<Promise<boolean>|null>(null);
 const [priceBusy,setPriceBusy]=useState(false),[priceErrors,setPriceErrors]=useState<Record<string,string>>({});
 const displayDoc=doc;
 const previewWorkspace={...workspace,prices:[...workspace.prices]};
 for(const line of displayDoc.lines){const draft=priceDrafts[line.id];if(!draft||line.recipe_id)continue;const key=recipePriceKey(line),replacedUnits=[recipeUnit(line.unit),recipeUnit(draft.unit),recipeNoteBasis(line,doc.notes)?.countUnit];previewWorkspace.prices=previewWorkspace.prices.filter(p=>!(p.key===key&&replacedUnits.includes(p.unit)));try{previewWorkspace.prices.unshift(draftRecipePrice(line,draft,doc.notes));}catch{/* An incomplete draft never falls back to a misleading saved price. */}}
 const stashPrices=useCallback((next:Record<string,RecipePriceDraft>)=>{priceDraftRef.current=next;setPriceDrafts(next);if(draftKey)try{if(Object.keys(next).length)localStorage.setItem(draftKey,JSON.stringify(next));else localStorage.removeItem(draftKey);}catch{setPriceErrors(current=>({...current,_save:'無法保留裝置草稿，請儲存後再離開。'}));}},[draftKey]);
 const flushPrices=useCallback(async():Promise<boolean>=>{
  if(priceFlight.current)return priceFlight.current;
  const entries=doc.lines.filter(l=>priceDraftRef.current[l.id]&&!l.recipe_id);
  if(!entries.length)return true;
  if(!workspace.can_price){setPriceErrors({_save:'目前帳號無法儲存價格，輸入內容已保留。'});return false;}
  const errors:Record<string,string>={},prepared:{line:RecipeLine;data:RecipePriceInput}[]=[],seen=new Map<string,string>();
  for(const original of entries){const line=original,draft=priceDraftRef.current[line.id];try{
   const n=normalizeRecipeLineDraft(line,draft,doc.notes);if(!line.name.trim())throw Error('請填食材名稱。');
   const data={name:line.name,product_id:line.product_id||null,unit:n.unit,price:n.price,source:draft.source.trim(),effective_date:draft.date,purchase:n.purchase};
   const key=recipePriceKey(line)+':'+n.unit,encoded=JSON.stringify(data);
   if(seen.has(key)&&seen.get(key)!==encoded)throw Error('相同食材有不同價格，請統一單價與包裝規格。');seen.set(key,encoded);prepared.push({line,data});
  }catch(e){errors[line.id]=e instanceof Error?e.message:'請核對價格與包裝量。';}}
  if(Object.keys(errors).length){setPriceErrors(errors);root.current?.querySelector(`[data-line-id="${Object.keys(errors)[0]}"]`)?.scrollIntoView({block:'center'});return false;}
  setPriceBusy(true);setPriceErrors({});
  const job=(async()=>{try{
   for(const {line,data} of prepared){if(!await onPrice(data)){setPriceErrors({[line.id]:'尚未確認儲存成功，內容已保留，請重試。'});return false;}
    const next={...priceDraftRef.current};delete next[line.id];stashPrices(next);
   }
   return true;
  }catch{setPriceErrors({_save:'價格尚未儲存成功，內容已保留。'});return false;}finally{setPriceBusy(false);priceFlight.current=null;}})();
  priceFlight.current=job;return job;
 },[doc.lines,doc.notes,workspace.can_price,onPrice,stashPrices]);
 useEffect(()=>{registerPriceSave?.(flushPrices);return()=>registerPriceSave?.(null);},[registerPriceSave,flushPrices]);
 useEffect(()=>{const warn=(e:BeforeUnloadEvent)=>{if(Object.keys(priceDraftRef.current).length)e.preventDefault();};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[]);
 function editPrice(line:RecipeLine,draft:RecipePriceDraft){stashPrices({...priceDraftRef.current,[line.id]:draft});setPriceErrors({});}
 async function afterPrices(action:()=>void){if(await flushPrices())action();}

 const root=useRef<HTMLDivElement>(null),searchInput=useRef<HTMLInputElement>(null),focusLine=useRef<string|null>(null);
 const removed=useRef<{line:RecipeLine;index:number;price?:RecipePriceDraft}|null>(null),[canUndo,setCanUndo]=useState(false);
 const cost=recipeCost(displayDoc,previewWorkspace,[recipeId]);
 // Show the normalized unit price even before a recipe usage amount is filled.
 const unitCosts=recipeCost({...displayDoc,lines:displayDoc.lines.map(line=>({...line,quantity:'1'}))},previewWorkspace,[recipeId]);
 const yieldQty=Number(doc.yield),perUnit=cost.total!==null&&yieldQty>0?cost.total/yieldQty:null;
 const portion=recipePortionCost(doc,cost);
 const term=search.trim().toLowerCase();
 const products=workspace.products.filter(p=>`${p.name} ${p.specification||''}`.toLowerCase().includes(term));
 const preps=workspace.recipes.filter(r=>r.id!==recipeId&&r.document.kind==='prep'&&r.document.name.toLowerCase().includes(term));
 const unresolved=doc.lines.filter((_,i)=>cost.lines[i]?.reason);
 useEffect(()=>{if(!focusLine.current)return;const target=root.current?.querySelector<HTMLInputElement>(`[data-quantity-id="${focusLine.current}"]`);target?.focus();target?.select();focusLine.current=null;},[doc.lines]);
 function updateLine(id:string,patch:Partial<RecipeLine>){onChange({lines:doc.lines.map(l=>l.id===id?{...l,...patch}:l)});}
 function chooseIngredient(line:RecipeLine,name:string){
  if(line.recipe_id){if(name!==line.name)updateLine(line.id,{name});return;}
  const matches=workspace.products.filter(p=>p.name===name.trim());
  if(name===line.name&&(line.product_id||matches.length!==1))return;
  updateLine(line.id,{name,product_id:matches.length===1?matches[0].id:undefined});
  const drafts={...priceDraftRef.current};delete drafts[line.id];stashPrices(drafts);setPriceErrors({});
 }
 function mapIngredient(line:RecipeLine,product_id?:string){
  updateLine(line.id,{product_id});
  const hasQuote=workspace.prices.some(p=>p.key===(product_id?`p:${product_id}`:`n:${line.name.trim().toLowerCase()}`));
  // First-time mapping may retain an unsaved manual quote when no catalog quote exists.
  if(!line.product_id&&product_id&&!hasQuote&&priceDraftRef.current[line.id])return;
  const drafts={...priceDraftRef.current};delete drafts[line.id];stashPrices(drafts);setPriceErrors({});
 }
 function add(name:string,unit:string,product_id?:string,recipe_id?:string){
  const existing=doc.lines.find(l=>product_id?l.product_id===product_id:recipe_id?l.recipe_id===recipe_id:!l.product_id&&!l.recipe_id&&l.name===name);
  const id=existing?.id||crypto.randomUUID();focusLine.current=id;
  onChange({lines:existing?[...doc.lines]:[...doc.lines,{id,name,unit:unit||'g',quantity:'',product_id,recipe_id}]});
  setPicking(false);setSearch('');
 }
 function remove(line:RecipeLine,index:number){removed.current={line,index,price:priceDraftRef.current[line.id]};const drafts={...priceDraftRef.current};delete drafts[line.id];stashPrices(drafts);setCanUndo(true);onChange({lines:doc.lines.filter(l=>l.id!==line.id)});}
 function undo(){if(!removed.current)return;const lines=[...doc.lines];lines.splice(Math.min(removed.current.index,lines.length),0,removed.current.line);onChange({lines});if(removed.current.price)stashPrices({...priceDraftRef.current,[removed.current.line.id]:removed.current.price});removed.current=null;setCanUndo(false);}
 function selectKind(kind:RecipeDocument['kind']){if(doc.kind===kind)return;onChange({kind,...(doc.lines.length===0&&doc.yield==='1'&&doc.unit==='份'&&kind==='prep'?{yield:'',unit:'g'}:{})});}
 function beginPicking(){setPicking(true);searchInput.current?.focus();searchInput.current?.scrollIntoView({block:'nearest',behavior:'smooth'});}
 function goToLine(id:string){requestAnimationFrame(()=>root.current?.querySelector(`[data-line-id="${id}"]`)?.scrollIntoView({block:'nearest',behavior:'smooth'}));}
 return <div className="recipe-editor recipe-direct-editor" ref={root}>
  <header className="recipe-editor-header"><button className="recipe-back" disabled={priceBusy} onClick={()=>void afterPrices(onBack)}><ArrowLeft size={18}/>食譜清單</button><span className="recipe-save-state" role="status">{priceBusy?'正在儲存價格…':Object.keys(priceDrafts).length?'價格待儲存':status||'填寫後自動儲存'}</span><button className="text-button" onClick={()=>void afterPrices(onCopy)} disabled={saving||priceBusy}><Copy size={16}/>複製</button></header>
  <fieldset className="recipe-edit-fields" disabled={priceBusy}><div className="recipe-editor-layout"><main className="recipe-main-column">
   <section className="recipe-panel recipe-basics" aria-label="配方資料">
    <div className="recipe-section-heading"><h1>{doc.name||'新增配方'}</h1><div className="recipe-type-switch" aria-label="配方類型"><button aria-pressed={doc.kind==='dish'} onClick={()=>selectKind('dish')}>出餐菜色</button><button aria-pressed={doc.kind==='prep'} onClick={()=>selectKind('prep')}>備料配方</button></div></div>
    <div className="recipe-basic-fields"><label>配方名稱<input placeholder="例如：大蒜美乃滋" value={doc.name} maxLength={160} onChange={e=>onChange({name:e.target.value})}/></label><label>{doc.kind==='prep'?'製成量':'這份配方可做'}<div className="recipe-quantity"><input aria-label="製成量" type="number" inputMode="decimal" min="0" value={doc.yield} placeholder={doc.kind==='prep'?'製成後重量':'份數'} onChange={e=>onChange({yield:e.target.value})}/><input aria-label="製成單位" list="recipe-units" value={doc.unit} onChange={e=>onChange({unit:e.target.value})}/></div></label></div>
    <small>{doc.kind==='prep'?'填製成後的重量或容量，引用時會依取用量換算。':'填食材與用量，系統自動帶入已核對進價。'}</small>
    {doc.source_name&&<p className="recipe-source">匯入：{doc.source_name} · 請核對名稱、用量與製成量</p>}
   </section>
   <section className="recipe-panel recipe-ingredients" aria-label="食材與用量">
    <div className="recipe-section-heading"><h2>食材與成本 <span className="recipe-count">{doc.lines.length}</span></h2><small>直接填寫，即時計算成本</small></div>
    <div className="recipe-picker" onKeyDown={e=>{if(e.key==='Escape')setPicking(false);}}>
     <label className="recipe-search"><Search size={19}/><input ref={searchInput} aria-label="搜尋食材或備料" placeholder="搜尋食材或備料，直接加入" value={search} onFocus={()=>setPicking(true)} onChange={e=>{setSearch(e.target.value);setPicking(true);}}/>{picking&&<button className="recipe-icon-button" aria-label="收起食材搜尋" onClick={()=>setPicking(false)}><X size={18}/></button>}</label>
     {picking&&<div className="recipe-picker-results"><div className="recipe-picker-tabs">{([['all','全部'],['products','食材'],['prep','備料']] as const).map(([value,label])=><button key={value} aria-pressed={kind===value} onClick={()=>setKind(value)}>{label}</button>)}</div>
      <div className="recipe-match-list">
       {kind!=='prep'&&products.slice(0,15).map(p=>{const price=workspace.prices.find(v=>v.key===`p:${p.id}`&&v.unit===recipeUnit(p.unit));return <button key={p.id} onClick={()=>add(p.name,recipeUnit(p.unit),p.id)}><span><strong>{p.name}</strong><small>{p.specification||p.unit}{price?` · 每 ${price.unit} ${recipeUnitMoney(Number(price.price))}`:' · 價格待補'}</small></span><Plus size={19}/></button>;})}
       {kind!=='products'&&preps.slice(0,15).map(r=><button key={r.id} onClick={()=>add(r.document.name,r.document.unit,undefined,r.id)}><span><strong>{r.document.name}<em>備料</em></strong><small>製成 {r.document.yield||'待填'} {r.document.unit}</small></span><Plus size={19}/></button>)}
      </div>
      {term&&<button className="recipe-add-new" onClick={()=>add(search.trim(),'g')}><Plus size={17}/>新增食材名稱「{search.trim()}」<small>價格可由行政補齊</small></button>}
      {!term&&<small className="recipe-picker-hint">輸入名稱可搜尋更多食材；選取後直接填用量。</small>}
     </div>}
    </div>
    {doc.lines.length>0&&<div className="recipe-table-head" aria-hidden="true"><span>品項</span><span>食譜使用量</span><span>食材單價</span><span>換算單價</span><span>使用成本</span><span/></div>}
    <div className="recipe-rows">{displayDoc.lines.map((line,index)=>{
     const result=cost.lines[index],unitResult=unitCosts.lines[index];
     const draft=priceDrafts[line.id]||recipePriceDraft(line,workspace,doc.notes);
     const unitPrice=unitResult.amount;
     const displayedPrice=draft.amount.trim()&&Number.isFinite(Number(draft.amount))?Number(draft.amount):null;
     return <article className={`recipe-row${result.reason?' recipe-row-pending':''}`} key={line.id} data-line-id={line.id}>
      <div className="recipe-row-main">
       <div className="recipe-row-name"><input aria-label={`第${index+1}項食材名稱`} list={line.recipe_id?undefined:`recipe-products-${recipeId}`} value={line.name} maxLength={160} onChange={e=>chooseIngredient(line,e.target.value)}/><button type="button" className="text-button recipe-note-toggle" aria-label={`${line.name}備註開關`} aria-expanded={!!openNotes[line.id]} aria-controls={`recipe-note-${line.id}`} onClick={()=>setOpenNotes(current=>({...current,[line.id]:!current[line.id]}))}>備註{recipeNoteText(line,doc.notes)&&<span className="recipe-note-dot" aria-label="已有備註"/>}<ChevronDown size={12}/></button></div>
       <div className="recipe-quantity"><input data-quantity-id={line.id} aria-label={`${line.name}用量`} type="number" inputMode="decimal" min="0" value={line.quantity} placeholder="用量" onChange={e=>updateLine(line.id,{quantity:e.target.value})}/><select aria-label={`${line.name}單位`} value={line.unit} onChange={e=>updateLine(line.id,{unit:e.target.value})}>{[...new Set([line.unit,...units])].map(u=><option key={u} value={u}>{u||'請選單位'}</option>)}</select></div>

       {workspace.can_price&&!line.recipe_id?<RecipeInlinePrice line={line} sourceText={doc.notes} draft={draft} workspace={workspace} pending={!!priceDrafts[line.id]} error={priceErrors[line.id]} disabled={priceBusy} onDiscard={()=>{const next={...priceDraftRef.current};delete next[line.id];stashPrices(next);setPriceErrors({});}} onChange={next=>editPrice(line,next)} onMap={product_id=>mapIngredient(line,product_id)}/>:<div className="recipe-unit-price"><span className="recipe-mobile-label">食材單價</span><span>{line.recipe_id?'依備料配方':displayedPrice===null?'待補價格':`${displayedPrice.toLocaleString('zh-TW',{maximumFractionDigits:6})} 元／${draft.unit}`}</span></div>}
       <div className="recipe-normalized-price" aria-label={`${line.name}換算單價`}><span className="recipe-mobile-label">換算單價</span><strong>{unitPrice===null?'待補齊':unitPrice.toLocaleString('zh-TW',{minimumFractionDigits:4,maximumFractionDigits:4})}</strong><small>{unitPrice===null?'':`元／${line.unit}`}</small></div>
       <div className="recipe-row-cost" aria-live="polite"><span className="recipe-mobile-label">使用成本</span><strong>{result.amount===null?'待補齊':recipeMoney(result.amount)}</strong>{result.reason&&<small>{result.reason}</small>}</div>
       <div className="recipe-line-note-panel" id={`recipe-note-${line.id}`} hidden={!openNotes[line.id]}><label>{line.name}備註<textarea rows={2} maxLength={800} aria-label={`${line.name}備註`} placeholder="例如：120g 使用 6顆；或取皮切絲等說明" value={recipeNoteText(line,doc.notes)} onChange={e=>updateLine(line.id,{note:e.target.value})}/></label></div>
       <button className="recipe-icon-button recipe-remove" aria-label={`移除${line.name}`} onClick={()=>remove(line,index)}><Trash2 size={17}/></button>
      </div>

     </article>;
    })}</div>
    {!doc.lines.length&&<div className="recipe-empty"><BookOpen size={28}/><p>先加入第一項食材</p><small>可選擇進貨食材，也可引用已建立的備料。</small></div>}
    <button className="recipe-add-line" onClick={beginPicking}><Plus size={20}/>加入食材</button>
    {canUndo&&<div className="recipe-undo" role="status">已移除此項食材<button className="text-button" onClick={undo}>復原</button></div>}
   </section>
   <details className="recipe-panel recipe-notes"><summary><span>照片與做法 <small>選填</small></span><ChevronDown size={18}/></summary><label>做法與備註<textarea rows={6} value={doc.notes} onChange={e=>onChange({notes:e.target.value})}/></label><label>配方照片<input type="file" accept="image/*" onChange={e=>{const file=e.target.files?.[0];if(!file)return;if(file.size>1000000){setPhotoError('請選擇 1MB 以下的照片。');return;}const reader=new FileReader();reader.onload=()=>{onChange({photo:String(reader.result)});setPhotoError('');};reader.readAsDataURL(file);}}/></label>{photoError&&<p role="alert">{photoError}</p>}{doc.photo&&<><img className="recipe-photo" src={doc.photo} alt="配方照片"/><button className="text-button" onClick={()=>onChange({photo:undefined})}>移除照片</button></>}</details>
  </main><aside className="recipe-cost-column" aria-label="即時成本">
   <section className="recipe-panel recipe-summary"><div className="recipe-section-heading"><h2>{doc.kind==='prep'?'整批食材成本':'整份配方成本'}</h2><span className="recipe-tag">未稅</span></div><strong className="recipe-total">{doc.lines.length===0?'尚未加入食材':cost.total===null?'成本尚未完整':recipeMoney(cost.total)}</strong>
    <p>製成 {doc.yield||'待填'} {doc.unit}</p>
    {cost.total!==null&&perUnit!==null&&<div className="recipe-summary-line"><span>每 {doc.unit} 成本</span><strong>{recipeMoney(perUnit)}</strong></div>}
    {doc.kind==='prep'&&<div className="recipe-portion"><label>每次取用<div className="recipe-quantity"><input aria-label="每次取用量" type="number" min="0" inputMode="decimal" placeholder="例如 30" value={doc.portion_quantity||''} onChange={e=>onChange({portion_quantity:e.target.value})}/><input aria-label="取用單位" list="recipe-units" value={doc.portion_unit||doc.unit} onChange={e=>onChange({portion_unit:e.target.value})}/></div></label><div className="recipe-summary-line"><span>取用成本</span><strong>{portion===null?'待填齊資料':recipeMoney(portion)}</strong></div></div>}
    {unresolved.length>0&&<div className="recipe-pending-summary"><strong>{unresolved.length} 項待補資料</strong><p>缺價可先存草稿，之後繼續補齊。</p>{unresolved.map(line=><button key={line.id} onClick={()=>goToLine(line.id)}>{line.name||'未命名食材'}<span>查看 →</span></button>)}</div>}
    {doc.lines.length>0&&yieldQty<=0&&<p className="recipe-pending">請填製成量，才能換算每份或取用成本。</p>}
    <small className="recipe-cost-note">依已核對進價與行政確認價格計算，價格更新後自動重算。</small>
   </section>
  </aside></div>
  <datalist id={`recipe-products-${recipeId}`}>{workspace.products.map(p=><option key={p.id} value={p.name}>{p.specification||p.unit}</option>)}</datalist>
  <datalist id="recipe-units">{units.map(unit=><option key={unit} value={unit}/>)}</datalist>
  {priceErrors._save&&<p className="recipe-inline-error" role="alert">{priceErrors._save}</p>}
  <footer className="recipe-footer"><div><small>{doc.kind==='prep'&&doc.portion_quantity?'取用成本':`每 ${doc.unit||'份'} 成本`}</small><strong>{recipeMoney(doc.kind==='prep'&&doc.portion_quantity?portion:perUnit)}</strong></div><button className="shell-primary" disabled={saving||priceBusy} onClick={()=>void afterPrices(onSave)}><Check size={18}/>{saving||priceBusy?'儲存中…':cost.total===null?'儲存草稿':'儲存配方'}</button></footer></fieldset>
 </div>;
}
