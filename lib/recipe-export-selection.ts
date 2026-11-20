import {recipeDisplayName,type RecipeCard} from './recipe-model.ts';
import {recipeLifecycle,type RecipeLifecycle} from './recipe-organization.ts';

export type RecipeExportStatus='all'|RecipeLifecycle;
export function initialRecipeExportSelection(recipes:RecipeCard[]){
 const serving=recipes.filter(card=>card.document.kind==='dish'&&recipeLifecycle(card.document)==='serving');
 return {status:(serving.length?'serving':'all') as RecipeExportStatus,selected:serving.map(card=>card.id)};
}
export function recipeExportChoices(recipes:RecipeCard[],status:RecipeExportStatus,search=''){
 const query=search.normalize('NFKC').trim().toLocaleLowerCase();
 return recipes.filter(card=>card.document.kind==='dish'
  &&(status==='all'||recipeLifecycle(card.document)===status)
  &&(!query||[recipeDisplayName(card.document),card.recipe_code||''].some(value=>value.normalize('NFKC').toLocaleLowerCase().includes(query))));
}
export function selectRecipeExportChoices(selected:string[],visibleIds:string[],checked:boolean){
 const visible=new Set(visibleIds);
 return checked?[...new Set([...selected,...visibleIds])]:selected.filter(id=>!visible.has(id));
}
