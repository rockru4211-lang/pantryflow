'use client';
import {useState} from 'react';
import {recipeDisplayName,type RecipeWorkspace} from '@/lib/recipe-cost';
import {recipeCanAttach,type RecipeAttachment} from '@/lib/recipe-attachment';
import RecipeModal from './recipe-modal';

export default function RecipeAttachModal({workspace,initialParent='',onClose,onApply}:{workspace:RecipeWorkspace;initialParent?:string;onClose:()=>void;onApply:(parentId:string,items:RecipeAttachment[])=>Promise<void>}){
 const [parentId,setParentId]=useState(initialParent),[items,setItems]=useState<RecipeAttachment[]>([]),[search,setSearch]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const parent=workspace.recipes.find(card=>card.id===parentId);
 const candidates=workspace.recipes.filter(card=>card.document.name.trim()&&recipeCanAttach(parentId,card.id,workspace));
 const update=(id:string,patch:Partial<RecipeAttachment>)=>setItems(current=>current.map(item=>item.id===id?{...item,...patch}:item));
 const apply=async()=>{setBusy(true);setError('');try{await onApply(parentId,items);onClose();}catch(e){setError(e instanceof Error?e.message:'尚未移入，原有內容已保留。');}finally{setBusy(false);}};
 return <RecipeModal title="移入主食譜" busy={busy} onClose={onClose}>
  <div className="recipe-attach-form">
   <label>主食譜<select aria-label="選擇主食譜" value={parentId} disabled={busy} onChange={e=>{setParentId(e.target.value);setItems([]);setError('');}}><option value="">選擇主食譜</option>{workspace.recipes.filter(card=>card.document.kind==='dish'&&card.document.name.trim()).map(card=><option key={card.id} value={card.id}>{recipeDisplayName(card.document)}</option>)}</select></label>
   {parent&&<><label>選擇配件<input type="search" placeholder="搜尋醃肉、內餡等配方" value={search} onChange={e=>setSearch(e.target.value)}/></label>
    <p className="recipe-muted">材料、用量與已存價格保留。主表已有相同原料時，選擇取代，避免重複計價；不確定的用量可留白。</p>
    {candidates.filter(card=>items.some(item=>item.id===card.id)||recipeDisplayName(card.document).includes(search.trim())).map(card=>{
     const selected=items.find(item=>item.id===card.id);
     return <section className="recipe-attach-item" key={card.id}>
      <label className="recipe-attach-check"><input type="checkbox" disabled={busy} checked={!!selected} onChange={e=>setItems(current=>e.target.checked?[...current,{id:card.id,quantity:card.document.yield==='1'&&card.document.unit==='份'?'1':'',unit:card.document.unit,replaceLineId:'__choose__'}]:current.filter(item=>item.id!==card.id))}/><strong>{recipeDisplayName(card.document)}</strong><small>製成 {card.document.yield||'待填'} {card.document.unit}</small></label>
      {selected&&<div className="recipe-attach-fields"><label>對應主表品項<select aria-label={`${card.document.name}加入方式`} disabled={busy} value={selected.replaceLineId||''} onChange={e=>update(card.id,{replaceLineId:e.target.value})}><option value="__choose__" disabled>選擇主表原有品項</option><option value="" disabled={parent.document.lines.some(line=>line.recipe_id===card.id)}>額外用料，新增一行</option>{parent.document.lines.filter(line=>!line.recipe_id).map(line=><option key={line.id} value={line.id} disabled={items.some(item=>item.id!==card.id&&item.replaceLineId===line.id)}>使用於：{line.name} {line.quantity} {line.unit}</option>)}</select></label>{!selected.replaceLineId&&<label>主表使用量<input aria-label={`${card.document.name}使用量`} inputMode="decimal" placeholder="可後補" value={selected.quantity} disabled={busy} onChange={e=>update(card.id,{quantity:e.target.value})}/></label>}{!selected.replaceLineId&&<label>單位<input aria-label={`${card.document.name}使用單位`} value={selected.unit} disabled={busy} onChange={e=>update(card.id,{unit:e.target.value})}/></label>}{selected.replaceLineId&&selected.replaceLineId!=='__choose__'&&<small>保留主表名稱與用量；已列入的同一配件會合併。</small>}</div>}
     </section>;
    })}
    {!candidates.length&&<p>沒有可移入的配方。可返回主食譜新增配件。</p>}
   </>}
   {error&&<p role="alert" className="recipe-alert">{error}</p>}
   <footer className="recipe-modal-footer"><small>套用後按「儲存至食譜」，整份成本一起保存。</small><button className="shell-primary" disabled={busy||!parentId||!items.length||items.some(item=>item.replaceLineId==='__choose__')} onClick={()=>void apply()}>{busy?'套用中…':'套用至主食譜'}</button></footer>
  </div>
 </RecipeModal>;
}
