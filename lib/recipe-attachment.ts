import {recipeComponents, type RecipeDocument, type RecipeWorkspace} from './recipe-model.ts';

// The displayed dish ingredient keeps its identity; selecting an existing prep
// explicitly merges duplicate usage rows instead of adding the cost twice.
export function linkRecipeComponentUsage(document:RecipeDocument,lineId:string,childId:string){
 const target=document.lines.find(line=>line.id===lineId);
 if(!target)throw Error('找不到主表品項。');
 const usage={...target,recipe_id:childId,cost_revision:crypto.randomUUID()};
 delete usage.product_id;delete usage.ingredient_id;delete usage.edible_rate;delete usage.quantity_basis;
 delete (usage as typeof usage&{transfer_prices?:unknown}).transfer_prices;
 delete (usage as typeof usage&{transfer_price_at?:unknown}).transfer_price_at;
 return {...document,lines:document.lines.filter(line=>line.id===lineId||line.recipe_id!==childId).map(line=>line.id===lineId?usage:line),component_order:[...new Set([...(document.component_order||[]),childId])]};
}

export type RecipeAttachment={id:string;quantity:string;unit:string;replaceLineId?:string};
export function recipeCanAttach(parentId:string,childId:string,workspace:RecipeWorkspace){
 if(parentId===childId)return false;
 const seen=new Set<string>();
 const reaches=(id:string):boolean=>{
  if(id===parentId)return true;
  if(seen.has(id))return false;seen.add(id);
  const card=workspace.recipes.find(row=>row.id===id);
  return !!card&&[...(card.document.component_order||[]),...card.document.lines.flatMap(line=>line.recipe_id?[line.recipe_id]:[])].some(reaches);
 };
 return !!workspace.recipes.find(row=>row.id===childId)&&!reaches(childId);
}
// Explicit selection owns membership and usage; no name-based price inference.
export function attachRecipeComponents(parentId:string,items:RecipeAttachment[],workspace:RecipeWorkspace){
 const parent=workspace.recipes.find(row=>row.id===parentId);
 if(!parent||parent.document.kind!=='dish')throw Error('請選擇主食譜。');
 if(!items.length)throw Error('請勾選要移入的配件。');
 const ids=new Set<string>(),replaced=new Set<string>(),documents=new Map<string,RecipeDocument>();
 let lines=[...parent.document.lines];
 for(const item of items){
  if(ids.has(item.id)||!recipeCanAttach(parentId,item.id,workspace))throw Error('配件不可重複或循環引用。');
  ids.add(item.id);
  const child=workspace.recipes.find(row=>row.id===item.id)!;
  if(!item.replaceLineId&&lines.some(line=>line.recipe_id===item.id))throw Error('這份配件已加入主食譜，請選擇對應的主表品項。');
  const usage={id:crypto.randomUUID(),name:child.document.name,quantity:item.quantity,unit:item.unit||child.document.unit,recipe_id:item.id};
  if(item.replaceLineId){
   const index=lines.findIndex(line=>line.id===item.replaceLineId&&!line.recipe_id);
   if(index<0||replaced.has(item.replaceLineId))throw Error('請重新選擇要取代的原料。');
   replaced.add(item.replaceLineId);
   const original=lines[index];
   lines=linkRecipeComponentUsage({...parent.document,lines},original.id,item.id).lines;
  }else lines.push(usage);
  documents.set(item.id,{...child.document,kind:'prep'});
 }
 documents.set(parentId,{...parent.document,lines,component_order:[...new Set([...(parent.document.component_order||[]),...ids])]});
 return documents;
}
// Child drafts appear under their main recipe, including unsaved membership.
export function recipeRootCards(workspace:RecipeWorkspace){
 const children=new Set(workspace.recipes.flatMap(card=>[
  ...(card.document.component_order||[]),...card.document.lines.flatMap(line=>line.recipe_id?[line.recipe_id]:[]),
  ...(card.document.kind==='dish'?recipeComponents(card,workspace).flatMap(c=>c.recipe?[c.recipe.id]:[]):[])
 ]));
 return workspace.recipes.filter(card=>!children.has(card.id));
}
