'use client';
import {useId} from 'react';
import {exactInboxSupplier,suggestInboxSuppliers} from '@/lib/receipt-supplier-inbox';

export default function SupplierNameInput({value,onChange,suppliers,disabled=false,allowCreate,onAllowCreate}:{value:string;onChange:(name:string)=>void;suppliers:{id:string;name:string;aliases?:string[]}[];disabled?:boolean;allowCreate:boolean;onAllowCreate:(value:boolean)=>void}){
 const id=useId(),existing=exactInboxSupplier(value,suppliers),suggestions=suggestInboxSuppliers(value,suppliers);
 function change(name:string){onChange(name);onAllowCreate(false);}
 return <>
  <label>正確供應商名稱<input aria-label="正確供應商名稱" list={id} maxLength={160} value={value} disabled={disabled} onChange={e=>change(e.target.value)} placeholder="直接修改名稱，或選擇既有供應商"/></label>
  <datalist id={id}>{suppliers.map(s=><option key={s.id} value={s.name}/>)}</datalist>
  {suggestions.length>0&&<div className="supplier-inbox-suggestions"><small>也可以直接選擇：</small>{suggestions.map(s=><button type="button" key={s.id} className="shell-secondary" disabled={disabled} onClick={()=>change(s.name)}>{s.name}</button>)}</div>}
  {existing?<p className="supplier-inbox-footnote" role="status">將使用既有供應商「{existing.name}」，不會重複新增。</p>:value.trim()&&<label className="supplier-name-create"><input type="checkbox" checked={allowCreate} disabled={disabled} onChange={e=>onAllowCreate(e.target.checked)}/>清單沒有此名稱，確認新增「{value.trim()}」</label>}
 </>;
}
