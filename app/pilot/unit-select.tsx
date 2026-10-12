'use client';
import {useState} from 'react';
export default function UnitSelect({value,onChange,units,disabled=false,ariaLabel='單位',required=true}:{ariaLabel?:string;required?:boolean;value:string;onChange:(value:string)=>void;units:string[];disabled?:boolean}) {
 const[other,setOther]=useState(false);const options=[...new Set([...units,...(!other&&value?[value]:[])])];
 return <span className="custom-unit"><select aria-label={ariaLabel} value={other?'__other':value} disabled={disabled} required={required} onChange={e=>{setOther(e.target.value==='__other');onChange(e.target.value==='__other'?'':e.target.value);}}><option value="">單位</option>{options.map(u=><option key={u}>{u}</option>)}<option value="__other">其他</option></select>{other&&<input aria-label="自訂單位" placeholder="輸入單位" maxLength={30} value={value} disabled={disabled} required={required} onChange={e=>onChange(e.target.value)}/>}</span>;
}
