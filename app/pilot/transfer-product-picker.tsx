'use client';
import {useId,useRef,useState} from 'react';
import {ChevronDown,Search} from 'lucide-react';
import './transfer-product-picker.css';
export type TransferProduct={id:string;name:string;unit:string;available_for_transfer?:boolean};
export default function TransferProductPicker({products,value,onSelect,onManual,disabled=false}:{products:TransferProduct[];value:string;onSelect:(p:TransferProduct)=>void;onManual:(name:string)=>void;disabled?:boolean}){
 const id=useId();const input=useRef<HTMLInputElement>(null);const[open,setOpen]=useState(false);const[query,setQuery]=useState('');const[active,setActive]=useState(-1);
 const matches=products.filter(p=>p.available_for_transfer!==false&&p.name.normalize('NFKC').toLocaleLowerCase().includes(query.trim().normalize('NFKC').toLocaleLowerCase()));
 function choose(p:TransferProduct){onSelect(p);setOpen(false);setQuery('');setActive(-1);}
 function expand(){setQuery('');setActive(-1);setOpen(true);}
 return <div className="transfer-picker" onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setOpen(false);}}>
  <label htmlFor={id}>品項</label><div className="transfer-picker-input"><Search size={19}/><input ref={input} id={id} role="combobox" aria-expanded={open} aria-controls={`${id}-options`} aria-autocomplete="list" aria-activedescendant={open&&active>=0?`${id}-${active}`:undefined} autoComplete="off" placeholder="選擇或搜尋品項" value={open?query:value} disabled={disabled} onFocus={expand} onChange={e=>{setQuery(e.target.value);setOpen(true);setActive(-1);}} onKeyDown={e=>{
   if(e.nativeEvent.isComposing)return;
   if(e.key==='Escape'){e.preventDefault();setOpen(false);}
   if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();setOpen(true);const n=Math.max(0,Math.min(matches.length-1,active+(e.key==='ArrowDown'?1:-1)));setActive(n);document.getElementById(`${id}-${n}`)?.scrollIntoView({block:'nearest'});}
   if(e.key==='Enter'&&open){e.preventDefault();if(matches[active])choose(matches[active]);}
  }}/><button type="button" aria-label="展開品項選單" disabled={disabled} onClick={()=>{input.current?.focus();expand();}}><ChevronDown size={20}/></button></div>
  {open&&<div className="transfer-picker-menu"><div id={`${id}-options`} role="listbox" aria-label="品項選單" className="transfer-picker-options">{matches.map((p,i)=><button type="button" role="option" aria-selected={active===i} id={`${id}-${i}`} key={p.id} onMouseDown={e=>e.preventDefault()} onClick={()=>choose(p)}><span>{p.name}</span><small>{p.unit}</small></button>)}{!matches.length&&<p role="status">找不到符合的品項</p>}</div><button type="button" className="transfer-picker-manual" onMouseDown={e=>e.preventDefault()} onClick={()=>{onManual(query.trim());setOpen(false);}}>＋ 找不到品項？手動輸入</button></div>}
 </div>;
}
