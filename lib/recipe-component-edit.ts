import type {RecipeDocument,RecipeWorkspace} from './recipe-model';

/** Recalculate the open recipe's path to a changed component; leave other saved recipes alone. */
export function recipeComponentEditPath(rootId:string,componentId:string,workspace:RecipeWorkspace,revision=crypto.randomUUID()):Map<string,RecipeDocument>{
 const changed=new Map<string,RecipeDocument>();
 const visit=(id:string,path:Set<string>):boolean=>{
  if(id===componentId)return true;
  if(path.has(id))return false;
  const document=workspace.recipes.find(card=>card.id===id)?.document;if(!document)return false;
  const next=new Set(path).add(id);
  const affected=new Set(document.lines.flatMap(line=>line.recipe_id&&visit(line.recipe_id,next)?[line.recipe_id]:[]));
  if(!affected.size)return false;
  changed.set(id,{...document,lines:document.lines.map(line=>line.recipe_id&&affected.has(line.recipe_id)?{...line,cost_revision:revision}:line)});return true;
 };visit(rootId,new Set());return changed;
}
