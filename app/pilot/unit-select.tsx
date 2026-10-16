'use client';
import {useState} from 'react';
export default function UnitSelect({value,onChange,units,disabled=false,ariaLabel='單位',required=true,onUnitAdded}:{onUnitAdded?:(unit:string)=>void;ariaLabel?:string;required?:boolean;value:string;onChange:(value:string)=>void;units:string[];disabled?:boolean}) {
 const[other,setOther]=useState(false),[added,setAdded]=useState<string[]>([]);
 const options=[...new Set([...units,...added,...(!other&&value?[value]:[])].map(u=>u.trim()).filter(Boolean))];
 function commit(){const unit=value.trim();if(!unit||disabled)return;setAdded(old=>[...new Set([...old,unit])]);onChange(unit);onUnitAdded?.(unit);setOther(false);}
 return <span className="custom-unit"><select aria-label={ariaLabel} value={other?'__other':value} disabled={disabled} required={required} onChange={e=>{setOther(e.target.value==='__other');onChange(e.target.value==='__other'?'':e.target.value);}}><option value="">單位</option>{options.map(u=><option key={u}>{u}</option>)}<option value="__other">＋ 新增單位</option></select>{other&&<input aria-label="自訂單位" placeholder="輸入新單位，按 Enter 加入" maxLength={30} value={value} disabled={disabled} required={required} onChange={e=>onChange(e.target.value)} onBlur={commit} onKeyDown={e=>{if(e.key==='Enter'&&!e.nativeEvent.isComposing){e.preventDefault();commit();}}}/>}</span>;
}
