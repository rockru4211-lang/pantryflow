'use client';

import {useEffect, useRef, useState} from 'react';
import {ArrowLeft, BookOpen, Check, ChevronDown, Copy, Plus, Search, Trash2, X} from 'lucide-react';
import RecipePriceEditor, {recipeUnitMoney,type RecipePriceInput} from './recipe-price-editor';
export type {RecipePriceInput} from './recipe-price-editor';
import {recipeCost, recipeFactor, recipePortionCost, recipeUnit, type RecipeDocument, type RecipeLine, type RecipeWorkspace} from '@/lib/recipe-cost';

export const recipeMoney = (value:number|null) => value === null ? '待補齊' : `NT$ ${value.toLocaleString('zh-TW', {minimumFractionDigits:2, maximumFractionDigits:2})}`;
const units = ['g','ml','份','顆','片','公斤','斤','包','瓶','盒'];
type Props = {
 document:RecipeDocument; recipeId:string; workspace:RecipeWorkspace; status:string; saving:boolean;
 onChange:(patch:Partial<RecipeDocument>)=>void;
 onBack:()=>void; onCopy:()=>void; onSave:()=>void;
 onPrice:(data:RecipePriceInput)=>Promise<boolean>;
};

export default function RecipeEditor({document:doc,recipeId,workspace,status,saving,onChange,onBack,onCopy,onSave,onPrice}:Props){
 const [search,setSearch]=useState(''),[kind,setKind]=useState<'all'|'products'|'prep'>('all'),[picking,setPicking]=useState(false);
 const [priceId,setPriceId]=useState<string|null>(null),[photoError,setPhotoError]=useState('');
 const root=useRef<HTMLDivElement>(null),searchInput=useRef<HTMLInputElement>(null),focusLine=useRef<string|null>(null);
 const removed=useRef<{line:RecipeLine;index:number}|null>(null),[canUndo,setCanUndo]=useState(false);
 const cost=recipeCost(doc,workspace,[recipeId]);
 const yieldQty=Number(doc.yield),perUnit=cost.total!==null&&yieldQty>0?cost.total/yieldQty:null;
 const portion=recipePortionCost(doc,cost);
 const term=search.trim().toLowerCase();
 const products=workspace.products.filter(p=>`${p.name} ${p.specification||''}`.toLowerCase().includes(term));
 const preps=workspace.recipes.filter(r=>r.id!==recipeId&&r.document.kind==='prep'&&r.document.name.toLowerCase().includes(term));
 const unresolved=doc.lines.filter((_,i)=>cost.lines[i]?.reason);
 useEffect(()=>{if(!focusLine.current)return;const target=root.current?.querySelector<HTMLInputElement>(`[data-quantity-id="${focusLine.current}"]`);target?.focus();target?.select();focusLine.current=null;},[doc.lines]);
 function updateLine(id:string,patch:Partial<RecipeLine>){onChange({lines:doc.lines.map(l=>l.id===id?{...l,...patch}:l)});}
 function add(name:string,unit:string,product_id?:string,recipe_id?:string){
  const existing=doc.lines.find(l=>product_id?l.product_id===product_id:recipe_id?l.recipe_id===recipe_id:!l.product_id&&!l.recipe_id&&l.name===name);
  const id=existing?.id||crypto.randomUUID();focusLine.current=id;
  onChange({lines:existing?[...doc.lines]:[...doc.lines,{id,name,unit:unit||'g',quantity:'',product_id,recipe_id}]});
  setPicking(false);setSearch('');
 }
 function remove(line:RecipeLine,index:number){removed.current={line,index};setCanUndo(true);onChange({lines:doc.lines.filter(l=>l.id!==line.id)});if(priceId===line.id)setPriceId(null);}
 function undo(){if(!removed.current)return;const lines=[...doc.lines];lines.splice(Math.min(removed.current.index,lines.length),0,removed.current.line);onChange({lines});removed.current=null;setCanUndo(false);}
 function selectKind(kind:RecipeDocument['kind']){if(doc.kind===kind)return;onChange({kind,...(doc.lines.length===0&&doc.yield==='1'&&doc.unit==='份'&&kind==='prep'?{yield:'',unit:'g'}:{})});}
 function beginPicking(){setPicking(true);searchInput.current?.focus();searchInput.current?.scrollIntoView({block:'nearest',behavior:'smooth'});}
 function goToLine(id:string){setPriceId(id);requestAnimationFrame(()=>root.current?.querySelector(`[data-line-id="${id}"]`)?.scrollIntoView({block:'nearest',behavior:'smooth'}));}
 return <div className="recipe-editor" ref={root}>
  <header className="recipe-editor-header"><button className="recipe-back" onClick={onBack}><ArrowLeft size={18}/>食譜清單</button><span className="recipe-save-state" role="status">{status||'填寫後自動儲存'}</span><button className="text-button" onClick={onCopy} disabled={saving}><Copy size={16}/>複製</button></header>
  <div className="recipe-editor-layout"><main className="recipe-main-column">
   <section className="recipe-panel recipe-basics" aria-label="配方資料">
    <div className="recipe-section-heading"><h1>{doc.name||'新增配方'}</h1><div className="recipe-type-switch" aria-label="配方類型"><button aria-pressed={doc.kind==='dish'} onClick={()=>selectKind('dish')}>出餐菜色</button><button aria-pressed={doc.kind==='prep'} onClick={()=>selectKind('prep')}>備料配方</button></div></div>
    <div className="recipe-basic-fields"><label>配方名稱<input placeholder="例如：大蒜美乃滋" value={doc.name} maxLength={160} onChange={e=>onChange({name:e.target.value})}/></label><label>{doc.kind==='prep'?'製成量':'這份配方可做'}<div className="recipe-quantity"><input aria-label="製成量" type="number" inputMode="decimal" min="0" value={doc.yield} placeholder={doc.kind==='prep'?'製成後重量':'份數'} onChange={e=>onChange({yield:e.target.value})}/><input aria-label="製成單位" list="recipe-units" value={doc.unit} onChange={e=>onChange({unit:e.target.value})}/></div></label></div>
    <small>{doc.kind==='prep'?'填製成後的重量或容量，引用時會依取用量換算。':'填食材與用量，系統自動帶入已核對進價。'}</small>
    {doc.source_name&&<p className="recipe-source">匯入：{doc.source_name} · 請核對名稱、用量與製成量</p>}
   </section>
   <section className="recipe-panel recipe-ingredients" aria-label="食材與用量">
    <div className="recipe-section-heading"><h2>食材與用量 <span className="recipe-count">{doc.lines.length}</span></h2><small>填用量，即時計算成本</small></div>
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
    {doc.lines.length>0&&<div className="recipe-table-head" aria-hidden="true"><span>食材／備料</span><span>用量／單位</span><span>參考單價</span><span>食材成本</span><span/></div>}
    <div className="recipe-rows">{doc.lines.map((line,index)=>{
     const result=cost.lines[index],selectedPrice=result.price;
     const unitPrice=selectedPrice?Number(selectedPrice.price)*recipeFactor(line.unit):null;
     return <article className={`recipe-row${result.reason?' recipe-row-pending':''}`} key={line.id} data-line-id={line.id}>
      <div className="recipe-row-main">
       <div className="recipe-row-name"><input aria-label={`第${index+1}項食材名稱`} value={line.name} maxLength={160} onChange={e=>updateLine(line.id,{name:e.target.value})}/><small>{line.recipe_id?'備料配方':selectedPrice?`${selectedPrice.source} · ${selectedPrice.effective_date}`:line.product_id?'已對應進貨食材':'待對應食材或補價'}</small></div>
       <div className="recipe-quantity"><input data-quantity-id={line.id} aria-label={`${line.name}用量`} type="number" inputMode="decimal" min="0" value={line.quantity} placeholder="用量" onChange={e=>updateLine(line.id,{quantity:e.target.value})}/><input aria-label={`${line.name}單位`} list="recipe-units" value={line.unit} onChange={e=>updateLine(line.id,{unit:e.target.value})}/></div>
       <div className="recipe-unit-price"><small>每 {line.unit||'單位'}</small><span>{line.recipe_id?'依製成量換算':unitPrice===null?'待補價格':recipeUnitMoney(unitPrice)}</span>{selectedPrice?.purchase&&<small>原價 {recipeMoney(selectedPrice.purchase.amount)}／{selectedPrice.purchase.quantity} {selectedPrice.purchase.unit}</small>}</div>
       <div className="recipe-row-cost"><strong>{result.amount===null?'待補齊':recipeMoney(result.amount)}</strong>{result.reason&&<small>{result.reason}</small>}{workspace.can_price&&!line.recipe_id&&<button className="text-button" aria-expanded={priceId===line.id} onClick={()=>setPriceId(priceId===line.id?null:line.id)}>{selectedPrice?'修改價格':'補價格'}</button>}</div>
       <button className="recipe-icon-button recipe-remove" aria-label={`移除${line.name}`} onClick={()=>remove(line,index)}><Trash2 size={17}/></button>
      </div>
      {priceId===line.id&&workspace.can_price&&!line.recipe_id&&<RecipePriceEditor line={line} workspace={workspace} onChange={patch=>updateLine(line.id,patch)} onSave={onPrice} onClose={()=>setPriceId(null)}/>}
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
  <datalist id="recipe-units">{units.map(unit=><option key={unit} value={unit}/>)}</datalist>
  <footer className="recipe-footer"><div><small>{doc.kind==='prep'&&doc.portion_quantity?'取用成本':`每 ${doc.unit||'份'} 成本`}</small><strong>{recipeMoney(doc.kind==='prep'&&doc.portion_quantity?portion:perUnit)}</strong></div><button className="shell-primary" disabled={saving} onClick={onSave}><Check size={18}/>{saving?'儲存中…':cost.total===null?'儲存草稿':'儲存配方'}</button></footer>
 </div>;
}
