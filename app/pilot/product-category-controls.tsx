'use client';
import {useState} from 'react';
import {PRODUCT_CATEGORIES,categoryTone,productCategory,type ProductCategory} from '@/lib/product-categories';
import {useOperation} from './operation-hooks';
import './product-categories.css';
export function CategoryFilter({value,onChange,disabled=false}:{value:string;onChange:(value:string)=>void;disabled?:boolean}){return <div className="product-category-filters" role="group" aria-label="品項分類篩選">{['全部',...PRODUCT_CATEGORIES].map(label=><button type="button" key={label} className={`category-${categoryTone(label)}`} aria-pressed={value===(label==='全部'?'':label)} disabled={disabled} onClick={()=>onChange(label==='全部'?'':label)}>{label}</button>)}</div>;}
export function CategoryBadge({value}:{value:string}){return <span className={`product-category-badge category-${categoryTone(value)}`}>{productCategory(value)}</span>;}
export function CategorySelect({storeId,userId,id,name,value,revision,disabled,onSaved,onBusy}:{storeId:string;userId:string;id:string;name:string;value:string;revision:number;disabled?:boolean;onSaved:(category:ProductCategory,revision:number)=>void;onBusy?:(busy:boolean)=>void}){
 const operation=useOperation(storeId,userId),[pending,setPending]=useState<ProductCategory|null>(null);
 async function save(category:ProductCategory){setPending(category);onBusy?.(true);try{const saved=await operation.run<{primary_category:ProductCategory;category_revision:number}>('product.category',{id,category,revision});if(saved){onSaved(saved.primary_category,saved.category_revision);setPending(null);}}finally{onBusy?.(false);}}
 return <div className="product-category-editor"><select aria-label={`${name}的分類`} className={`category-${categoryTone(pending||value)}`} value={pending||productCategory(value)} disabled={disabled||operation.busy} onChange={e=>void save(e.target.value as ProductCategory)}>{PRODUCT_CATEGORIES.map(c=><option key={c}>{c}</option>)}</select>{operation.busy&&<small role="status">儲存中…</small>}{operation.error&&<div role="alert"><small>{operation.error}</small><button type="button" disabled={disabled||operation.busy} onClick={()=>pending&&void save(pending)}>重試儲存</button></div>}</div>;
}
