'use client';
import {useState} from 'react';
import type {RecipeLine} from '@/lib/recipe-model';
import {clearRecipeLoss,recipeLossInput,recipeLossPatch,recipeLossPercent} from '@/lib/recipe-loss';

type Props={line:RecipeLine;notes:string;disabled:boolean;onChange:(patch:Partial<RecipeLine>)=>void};
export default function RecipeLossControl({line,notes,disabled,onChange}:Props){
 const [open,setOpen]=useState(false),[mode,setMode]=useState<'percent'|'weight'>('percent');
 const [percent,setPercent]=useState(''),[gross,setGross]=useState(''),[net,setNet]=useState('');
 const [grossUnit,setGrossUnit]=useState('g'),[netUnit,setNetUnit]=useState('g'),[error,setError]=useState('');
 if(line.recipe_id)return null;
 const loss=recipeLossPercent(line);
 function begin(){setPercent(recipeLossInput(line,notes));setMode('percent');setGross('');setNet('');setGrossUnit('g');setNetUnit('g');setError('');setOpen(true);}
 function apply(){try{onChange(recipeLossPatch(mode,percent,gross,net,grossUnit,netUnit));setOpen(false);setError('');}catch(e){setError(e instanceof Error?e.message:'請檢查輸入');}}
 let preview:number|null=null;
 try{const patch=recipeLossPatch(mode,percent,gross,net,grossUnit,netUnit);preview=(1-Number(patch.edible_rate))*100;}catch{/* Incomplete inputs stay local until applied. */}
 return <span className="recipe-loss-control" onKeyDown={e=>{if(e.key==='Escape'&&open){e.preventDefault();e.stopPropagation();setOpen(false);}}}>
  <button type="button" className={loss===null?'recipe-loss-trigger':'recipe-loss-badge'} disabled={disabled} aria-label={`${line.name}${loss===null?'設定':'修改'}耗損`} aria-expanded={open} onClick={()=>open?setOpen(false):begin()}>{loss===null?'⋯':`耗損 ${loss.toLocaleString('zh-TW',{maximumFractionDigits:2})}%`}</button>
  {open&&<span className="recipe-loss-popover" role="dialog" aria-label={`${line.name}耗損設定`}>
   <span className="recipe-loss-heading"><strong>耗損設定</strong><button type="button" disabled={disabled} aria-label="關閉耗損設定" onClick={()=>setOpen(false)}>×</button></span>
   <span className="recipe-loss-modes"><button type="button" disabled={disabled} aria-pressed={mode==='percent'} onClick={()=>{setMode('percent');setError('');}}>填耗損率</button><button type="button" disabled={disabled} aria-pressed={mode==='weight'} onClick={()=>{setMode('weight');setError('');}}>重量換算</button></span>
   {mode==='percent'?<label className="recipe-loss-field">耗損率<span><input autoFocus aria-label="耗損率百分比" inputMode="decimal" disabled={disabled} placeholder="例如 24" value={percent} onChange={e=>setPercent(e.target.value)}/>%</span></label>:<>
    <label className="recipe-loss-field">原料<span><input autoFocus aria-label="耗損原料重量" inputMode="decimal" disabled={disabled} value={gross} onChange={e=>setGross(e.target.value)}/><select aria-label="耗損原料重量單位" disabled={disabled} value={grossUnit} onChange={e=>setGrossUnit(e.target.value)}>{['g','kg','台斤'].map(u=><option key={u}>{u}</option>)}</select></span></label>
    <label className="recipe-loss-field">可食用<span><input aria-label="耗損可食用重量" inputMode="decimal" disabled={disabled} value={net} onChange={e=>setNet(e.target.value)}/><select aria-label="耗損可食用重量單位" disabled={disabled} value={netUnit} onChange={e=>setNetUnit(e.target.value)}>{['g','kg','台斤'].map(u=><option key={u}>{u}</option>)}</select></span></label>
   </>}
   {preview!==null&&<small>耗損 {preview.toLocaleString('zh-TW',{maximumFractionDigits:2})}% · 可食用 {(100-preview).toLocaleString('zh-TW',{maximumFractionDigits:2})}%</small>}
   <small>套用後，用量按可食用重量計算。</small>
   {error&&<small role="alert" className="recipe-loss-error">{error}</small>}
   <span className="recipe-loss-actions"><button type="button" disabled={disabled} onClick={()=>{onChange(clearRecipeLoss());setOpen(false);}}>清除耗損</button><button type="button" className="recipe-loss-apply" disabled={disabled} onClick={apply}>套用</button></span>
  </span>}
 </span>;
}
