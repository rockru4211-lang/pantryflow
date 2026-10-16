import {useState} from 'react';
import {formatPurchaseSpecification} from '@/lib/purchase-specification';
type Props={value:string;unit:string;label:string;disabled?:boolean;onChange:(value:string)=>void};
export default function ReceiptPackageInput({value,unit,label,disabled,onChange}:Props){
 const [emptyUnit,setEmptyUnit]=useState('克');
 const match=value.match(/^([0-9]+(?:\.[0-9]*)?|\.[0-9]*)\s*(公斤|公克|台斤|臺斤|斤|克|kg|g|毫升|公升|ml|cc|l|L|升|包|瓶|罐|盒|袋|支|顆|個|片|卷|份)$/);
 const parts=match?{quantity:match[1],unit:match[2]}:null;
 if(value&&!parts)return <input aria-label={label} title="保留原單規格，可直接修改" placeholder="例如 454克" value={value} disabled={disabled} maxLength={500} onChange={e=>onChange(e.target.value)}/>;
 return <div className="receipt-package-input"><div><input aria-label={`${label} 數量`} inputMode="decimal" placeholder="例如 454" value={parts?.quantity||''} disabled={disabled} onChange={e=>onChange(e.target.value?formatPurchaseSpecification(e.target.value,parts?.unit||emptyUnit):'')}/><select aria-label={`${label} 單位`} value={parts?.unit||emptyUnit} disabled={disabled} onChange={e=>{setEmptyUnit(e.target.value);if(parts)onChange(formatPurchaseSpecification(parts.quantity,e.target.value));}}>{[...new Set(['克','公斤','毫升','公升','包','瓶','罐','盒','袋','個','片',...(parts?[parts.unit]:[])])].map(u=><option key={u}>{u}</option>)}</select></div>{value&&<small>每{unit||'單位'} {value}</small>}</div>;
}
