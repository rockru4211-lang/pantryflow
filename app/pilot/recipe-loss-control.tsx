'use client';
import {useRef,useState} from 'react';
import {recipeNoteText,type RecipeLine} from '@/lib/recipe-model';
import {clearRecipeLoss,includedRecipeLoss,recipeLossInput,recipeLossPatch} from '@/lib/recipe-loss';

export type RecipeLinePanel='menu'|'loss'|'note'|null;
type Props={line:RecipeLine;notes:string;disabled:boolean;view:RecipeLinePanel;onViewChange:(view:RecipeLinePanel)=>void;onChange:(patch:Partial<RecipeLine>)=>void;onRemove:()=>void;onChoosePrep?:()=>void};
// The parent keys this control by its open panel, so cancelled inputs never leak into another edit.
export default function RecipeLossControl({line,notes,disabled,view,onViewChange,onChange,onRemove,onChoosePrep}:Props){
 const saved=line.loss_setting;
 const [mode,setMode]=useState<'percent'|'edible'|'weight'>(saved?.mode==='weight'||saved?.mode==='edible'?saved.mode:'percent');
 const [percent,setPercent]=useState(saved?.value??recipeLossInput(line,notes));
 const [gross,setGross]=useState(saved?.gross??''),[net,setNet]=useState(saved?.net??'');
 const [grossUnit,setGrossUnit]=useState(saved?.grossUnit??'g'),[netUnit,setNetUnit]=useState(saved?.netUnit??'g');
 const [included,setIncluded]=useState(saved?.mode==='included'&&line.quantity_basis==='gross');
 const [note,setNote]=useState(recipeNoteText(line,notes)),[error,setError]=useState('');
 const trigger=useRef<HTMLButtonElement>(null);
 function close(){onViewChange(null);trigger.current?.focus();}
 function apply(){if(disabled)return;try{onChange(included?includedRecipeLoss():recipeLossPatch(mode,percent,gross,net,grossUnit,netUnit));close();}catch(e){setError(e instanceof Error?e.message:'請檢查輸入');}}
 let preview:number|null=null;
 try{if(!included)preview=(1-Number(recipeLossPatch(mode,percent,gross,net,grossUnit,netUnit).edible_rate))*100;}catch{/* Unfinished settings stay local and never block saving the recipe. */}
 return <span className="recipe-loss-control recipe-line-actions" onBlur={e=>{if(view&&e.relatedTarget&&!e.currentTarget.contains(e.relatedTarget as Node))onViewChange(null);}} onKeyDown={e=>{if(e.key==='Escape'&&view){e.preventDefault();e.stopPropagation();close();}}}>
  <button ref={trigger} type="button" className="recipe-loss-trigger" disabled={disabled} aria-label={`${line.name}更多操作`} aria-haspopup="dialog" aria-expanded={!!view} onClick={()=>onViewChange(view?null:'menu')}>⋯</button>
  {view&&<span className={`recipe-loss-popover${view==='menu'?' recipe-line-menu':''}`} role="dialog" aria-label={`${line.name}${view==='menu'?'操作':view==='note'?'備註':'耗損設定'}`}>
   <span className="recipe-loss-heading"><strong>{view==='menu'?'食材操作':view==='note'?'備註':'耗損設定'}</strong><button type="button" disabled={disabled} aria-label="關閉食材操作" onClick={close}>×</button></span>
   {view==='menu'?<>
    {!line.recipe_id&&<button autoFocus type="button" disabled={disabled} onClick={()=>onViewChange('loss')}>設定耗損</button>}
    <button autoFocus={!!line.recipe_id} type="button" disabled={disabled} onClick={()=>onViewChange('note')}>{recipeNoteText(line,notes)?'編輯備註':'新增備註'}</button>
    {onChoosePrep&&<button type="button" disabled={disabled} onClick={()=>{onViewChange(null);onChoosePrep();}}>選擇配件來源</button>}
    <button type="button" className="recipe-line-remove" disabled={disabled} onClick={()=>{if(!disabled){onRemove();onViewChange(null);}}}>移除食材</button>
   </>:view==='note'?<>
    <textarea autoFocus rows={3} maxLength={800} aria-label={`${line.name}備註`} disabled={disabled} placeholder="例如：去筋膜、切厚片" value={note} onChange={e=>setNote(e.target.value)}/>
    <span className="recipe-loss-actions"><button type="button" disabled={disabled} onClick={close}>取消</button><button type="button" className="recipe-loss-apply" disabled={disabled} onClick={()=>{if(!disabled){onChange({note});close();}}}>套用備註</button></span>
   </>:!line.recipe_id?<>
    <select autoFocus aria-label="食譜提供的耗損資料" disabled={disabled||included} value={mode} onChange={e=>{setMode(e.target.value as typeof mode);setPercent('');setError('');}}>
     <option value="percent">食譜有耗損率</option><option value="edible">食譜有可食用率</option><option value="weight">食譜有進貨重、可食用重</option>
    </select>
    {!included&&(mode==='weight'?<>
     <label className="recipe-loss-field">進貨總重<span><input aria-label="耗損原料重量" inputMode="decimal" disabled={disabled} value={gross} onChange={e=>setGross(e.target.value)}/><select aria-label="耗損原料重量單位" disabled={disabled} value={grossUnit} onChange={e=>setGrossUnit(e.target.value)}>{['g','kg','台斤'].map(u=><option key={u}>{u}</option>)}</select></span></label>
     <label className="recipe-loss-field">可食用重<span><input aria-label="耗損可食用重量" inputMode="decimal" disabled={disabled} value={net} onChange={e=>setNet(e.target.value)}/><select aria-label="耗損可食用重量單位" disabled={disabled} value={netUnit} onChange={e=>setNetUnit(e.target.value)}>{['g','kg','台斤'].map(u=><option key={u}>{u}</option>)}</select></span></label>
    </>:<label className="recipe-loss-field">{mode==='edible'?'可食用率':'耗損率'}<span><input aria-label={mode==='edible'?'可食用率百分比':'耗損率百分比'} inputMode="decimal" disabled={disabled} placeholder={mode==='edible'?'例如 96':'例如 24'} value={percent} onChange={e=>setPercent(e.target.value)}/>%</span></label>)}
    {preview!==null&&mode==='weight'&&<small>自動換算：耗損 {preview.toLocaleString('zh-TW',{maximumFractionDigits:2})}%</small>}
    <label className="recipe-loss-included"><input type="checkbox" disabled={disabled} checked={included} onChange={e=>{setIncluded(e.target.checked);setError('');}}/>用量已含耗損，不再加算</label>
    <small>{included?'直接按目前用量計算成本。':'套用比例時，用量請填可食用重量。'}</small>
    {error&&<small role="alert" className="recipe-loss-error">{error}</small>}
    <span className="recipe-loss-actions"><button type="button" disabled={disabled} onClick={()=>{if(!disabled){onChange(clearRecipeLoss());close();}}}>不計耗損</button><button type="button" className="recipe-loss-apply" disabled={disabled} onClick={apply}>套用</button></span>
   </>:null}
  </span>}
 </span>;
}
