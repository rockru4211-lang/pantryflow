'use client';
import {useState} from 'react';
import {SUPPLIER_CATEGORIES,supplierCategory,supplierCategoryTone,type SupplierCategory} from '@/lib/supplier-categories';
import {supplierDraft,supplierPayload,type DirectorySupplier as SupplierProfile} from '@/lib/supplier-directory';
import {useOperation} from './operation-hooks';
import './product-categories.css';

export function SupplierCategoryFilter({value,onChange,disabled}:{value:string;onChange:(value:string)=>void;disabled?:boolean}) {
 return <div className="product-category-filters" role="group" aria-label="供應商分類篩選">{['全部',...SUPPLIER_CATEGORIES].map(label=><button type="button" key={label} className={`category-${supplierCategoryTone(label)}`} aria-pressed={value===(label==='全部'?'':label)} disabled={disabled} onClick={()=>onChange(label==='全部'?'':label)}>{label}</button>)}</div>;
}
export function SupplierCategoryBadge({value}:{value?:string}) {
 return <span className={`product-category-badge category-${supplierCategoryTone(value)}`}>{supplierCategory(value)||'尚未設定'}</span>;
}
export function SupplierCategorySelect({storeId,userId,supplier,disabled,onSaved,onBusy,onReload}:{storeId:string;userId:string;supplier:SupplierProfile;disabled?:boolean;onSaved:(supplier:SupplierProfile)=>void;onBusy:(busy:boolean)=>void;onReload:()=>Promise<unknown>}) {
 const operation=useOperation(storeId,userId),[pending,setPending]=useState<SupplierCategory|null>(null);
 async function save(category:SupplierCategory) {
  setPending(category);onBusy(true);
  try {
   const result=await operation.run<{value:SupplierProfile}>('supplier.save',{...supplierPayload(supplierDraft(supplier)),supplier_category:category});
   if(result?.value){onSaved(result.value);setPending(null);}
  }finally{onBusy(false);}
 }
 return <div className="product-category-editor"><select aria-label={`${supplier.name}的供應商分類`} className={`category-${supplierCategoryTone(pending??supplier.supplier_category)}`} value={pending??supplierCategory(supplier.supplier_category)} disabled={disabled||operation.busy} onChange={e=>void save(e.target.value as SupplierCategory)}><option value="">未分類</option>{SUPPLIER_CATEGORIES.map(c=><option key={c}>{c}</option>)}</select>{operation.busy&&<small role="status">儲存中…</small>}{operation.error&&<div role="alert"><small>{operation.error}</small><button type="button" disabled={disabled||operation.busy} onClick={()=>pending!==null&&void save(pending)}>重試儲存</button><button type="button" disabled={disabled||operation.busy} onClick={()=>{setPending(null);operation.setError('');void onReload();}}>重新讀取</button></div>}</div>;
}
