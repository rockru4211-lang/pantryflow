export * from './recipe-drafts-core.ts';
import {RecipeDraftBook as BaseRecipeDraftBook} from './recipe-drafts-core.ts';
import type {RecipeWorkspace} from './recipe-cost.ts';
export class RecipeDraftBook extends BaseRecipeDraftBook {
 override refresh(workspace:RecipeWorkspace){
  // Retire only IDs the server confirms have moved out of this store.
  const moved=new Set((workspace as RecipeWorkspace&{moved_recipe_ids?:string[]}).moved_recipe_ids||[]);
  const live=new Set(workspace.recipes.map(card=>card.id));
  for(const [id,draft]of this.drafts){
   if(!moved.has(id)||live.has(id)||this.busy(id))continue;
   // Preserve unsent edits privately for recovery, without listing them in the old store.
   const archiveKey=`${this.key}:moved-archive`,priceKey=`${this.key.replace(/:workspace-v2$/,'')}:${id}:prices`;
   try{
    const archive=JSON.parse(this.storage.getItem(archiveKey)||'{}');
    archive[id]={draft,prices:this.storage.getItem(priceKey)};
    this.storage.setItem(archiveKey,JSON.stringify(archive));
    this.storage.removeItem(priceKey);
   }catch{this.drafts.set(id,{...draft,error:'已移至其他門市；本機備份未完成，請保留此頁。'});continue;}
   this.drafts.delete(id);this.tabs=this.tabs.filter(tab=>tab!==id);if(this.active===id)this.active='';
   this.imports=this.imports.map(item=>({...item,recipeIds:item.recipeIds.filter(key=>key!==id)})).filter(item=>item.state!=='ready'||item.recipeIds.length>0);
  }
  super.refresh(workspace);
 }
}
