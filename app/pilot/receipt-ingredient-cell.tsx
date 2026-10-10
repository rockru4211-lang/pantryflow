'use client';
import {useEffect,useId,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {bindingFor,chooseReceiptIngredient,clearReceiptIngredient,ingredientLabel,matchReceiptIngredient,matchText,type IngredientMatching} from '@/lib/receipt-ingredient-matching';
import type {ReviewDraft} from '@/lib/receipt-review';
type Props={line:ReviewDraft['lines'][number];supplier:string;catalog:IngredientMatching;editable:boolean;disabled:boolean;details?:boolean;onChange:(line:ReviewDraft['lines'][number])=>void};
export default function ReceiptIngredientCell({line,supplier,catalog,editable,disabled,details=false,onChange}:Props){
 const [open,setOpen]=useState(false),[query,setQuery]=useState(''),[position,setPosition]=useState({left:0,top:0,width:340,maxHeight:320});
 const anchor=useRef<HTMLDivElement>(null),popup=useRef<HTMLDivElement>(null),id=useId();
 const matched=matchReceiptIngredient(catalog,supplier,line),remembered=bindingFor(catalog,supplier,line);
 const visible=open&&!disabled&&(editable||details);
 useEffect(()=>{
  if(!visible)return;
  const place=()=>{const r=anchor.current?.getBoundingClientRect();if(!r)return;const width=Math.min(360,window.innerWidth-24),below=window.innerHeight-r.bottom-20;const height=Math.min(340,Math.max(160,below>180?below:r.top-20));setPosition({left:Math.max(12,Math.min(r.left,window.innerWidth-width-12)),top:below>180?r.bottom+4:Math.max(12,r.top-height-4),width,maxHeight:height});};
  const close=(e:PointerEvent)=>{if(!anchor.current?.contains(e.target as Node)&&!popup.current?.contains(e.target as Node))setOpen(false);};
  const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){setOpen(false);anchor.current?.querySelector('button')?.focus();}};
  place();window.addEventListener('resize',place);window.addEventListener('scroll',place,true);document.addEventListener('pointerdown',close);document.addEventListener('keydown',key);
  return()=>{window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',key);};
 },[visible]);
 const knownNames=(ingredientId:string)=>catalog.bindings.filter(b=>b.ingredient_id===ingredientId&&matchText(b.supplier)===matchText(supplier)).map(b=>b.name);
 const options=catalog.ingredients.filter(i=>[ingredientLabel(i.name),...i.aliases,...knownNames(i.id)].some(n=>matchText(n).includes(matchText(query)))).slice(0,30);
 const label=matched?'已對應':line.create_ingredient?'將建立':'需選擇';
 return <div className="receipt-ingredient-cell" ref={anchor}>
  {details?<button type="button" disabled={disabled} aria-expanded={open} onClick={()=>setOpen(!open)}>更多 ⌄</button>:<>
   {editable?<input aria-label={`${line.product_name} 品名`} value={line.product_name} disabled={disabled} onChange={e=>onChange({...clearReceiptIngredient(line),product_name:e.target.value})}/>:<span title={line.product_name}>{matched?ingredientLabel(matched.name):line.product_name}</span>}
   {(!line.handling||line.handling==='NORMAL')&&<button type="button" className={`receipt-match-state ${matched?'matched':''}`} aria-label={`${line.product_name} ${label}`} aria-expanded={open} aria-controls={id} disabled={disabled||!editable} onClick={()=>{setQuery('');setOpen(!open);}}>{matched?'✓ ':''}{label}</button>}
  </>}
  {visible&&createPortal(<div ref={popup} id={id} className="receipt-ingredient-popup" role="dialog" aria-label={details?'食材對應資料':'選擇對應食材'} style={{position:'fixed',...position}}>
   {details?<><strong>{matched?ingredientLabel(matched.name):line.product_name}</strong><p>原貨單品名：{line.supplier_item_name||line.product_name}</p><p>其他名稱：{(matched?[...new Set([...matched.aliases,...knownNames(matched.id)])].filter(a=>a!==ingredientLabel(matched.name)).join('、'):'')||'尚無別名'}</p><p>規格：{line.specification}</p><p>備註：{line.note}</p><p>{remembered?'已記住此供應商品名':matched?'依現有品名對應':line.create_ingredient?'儲存時建立新食材':'尚未對應，可先儲存貨單'}</p>{editable&&(matched||line.ingredient_id||line.create_ingredient)&&<button type="button" disabled={disabled} onClick={()=>{onChange(clearReceiptIngredient(line));setOpen(false);}}>清除本列對應</button>}</>:<>
    <input autoFocus type="search" aria-label="搜尋既有食材" placeholder="搜尋既有食材、別名" value={query} onChange={e=>setQuery(e.target.value)}/>
    <div className="receipt-ingredient-options">{options.map(i=><button type="button" key={i.id} disabled={disabled} onClick={()=>{onChange(chooseReceiptIngredient(line,i,catalog,supplier));setOpen(false);}}><strong>{ingredientLabel(i.name)}</strong><small>{i.purchase?.content_quantity?`${i.purchase.content_quantity}${i.purchase.content_unit}／`:''}{i.purchase?.unit||i.unit}</small></button>)}{!options.length&&<p>找不到符合的食材</p>}</div>
    <button type="button" className="receipt-create-ingredient" disabled={disabled||!line.product_name.trim()} onClick={()=>{onChange(chooseReceiptIngredient(line,null,catalog,supplier));setOpen(false);}}>＋ 建立新食材</button><small>儲存後記住此供應商品名；尚未對應也可先儲存。</small>
   </>}
  </div>,document.body)}
 </div>;
}
