export * from './recipe-drafts-core';
import {RecipeDraftBook as BaseRecipeDraftBook} from './recipe-drafts-core';
import type {RecipeWorkspace} from './recipe-cost';
export class RecipeDraftBook extends BaseRecipeDraftBook {
 override refresh(workspace:RecipeWorkspace){
  // Only a server-confirmed move may retire a clean cache; an old fetch cannot erase a new save.
  const moved=new Set((workspace as RecipeWorkspace&{moved_recipe_ids?:string[]}).moved_recipe_ids||[]);
  const live=new Set(workspace.recipes.map(card=>card.id));
  for(const [id,draft]of this.drafts){
   if(!moved.has(id)||live.has(id)||this.busy(id))continue;
   if(this.dirty(id)){this.drafts.set(id,{...draft,error:'此食譜已更改歸屬；本機修改已保留，請确认後另存副本。'.replace('确认','確認')});continue;}
   this.drafts.delete(id);this.tabs=this.tabs.filter(tab=>tab!==id);if(this.active===id)this.active='';
   this.imports=this.imports.map(item=>({...item,recipeIds:item.recipeIds.filter(key=>key!==id)})).filter(item=>item.state!=='ready'||item.recipeIds.length>0);
  }
  super.refresh(workspace);
 }
}
