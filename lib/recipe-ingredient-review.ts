import {recipeCost,recipeLinePrices,type RecipePrice,type RecipeCost,type RecipeDocument,type RecipeWorkspace} from './recipe-cost.ts';
import {recipePriceKey} from './recipe-price-draft.ts';
export type IngredientMovement={key:string;name:string;before:RecipePrice|null;after:RecipePrice;percent:number|null;recipeIds:string[]};
export function recipeIngredientMovements(workspace:RecipeWorkspace):IngredientMovement[]{
 if(workspace.pricing_loaded===false)return [];
 const groups=new Map<string,IngredientMovement>(),uses=new Map<string,Set<string>>();
 const scan=(root:string,doc:RecipeDocument,cost:RecipeCost,path:string[])=>{for(const line of doc.lines){
  const old=cost.lines.find(row=>row.id===line.id);
  if(line.recipe_id){
   if(path.includes(line.recipe_id)||path.length>=20)continue;
   const child=workspace.recipes.find(row=>row.id===line.recipe_id),snapshot=(old as typeof old&{child_snapshot?:{document:RecipeDocument;cost:RecipeCost}})?.child_snapshot;
   if(snapshot)scan(root,snapshot.document,snapshot.cost,[...path,line.recipe_id]);else if(child)scan(root,child.document,child.cost,[...path,line.recipe_id]);continue;
  }
  const quote=recipeLinePrices(line,workspace).find(p=>p.key===recipePriceKey(line));if(!quote)continue;
  const master=(quote.source_ref as {ingredient_id?:string}|undefined)?.ingredient_id;
  const key=master?`i:${master}`:recipePriceKey(line),ids=uses.get(key)||new Set<string>();ids.add(root);uses.set(key,ids);
  const trial=recipeCost({...doc,lines:[line]},{...workspace,cost_mode:'latest'},path).lines[0];
  if(old?.amount==null||trial.amount==null||Math.abs(old.amount-trial.amount)<0.000001)continue;
  const percent=old.amount>0?(trial.amount/old.amount-1)*100:null,existing=groups.get(key);
  if(existing){if(existing.percent!==null&&percent!==null&&Math.abs(existing.percent-percent)>0.000001)existing.percent=null;}
  else groups.set(key,{key,name:quote.name||line.name,before:old.price||null,after:trial.price||quote,percent,recipeIds:[]});
 }};
 for(const card of workspace.recipes)scan(card.id,card.document,card.cost,[card.id]);
 for(const group of groups.values()){
  const ids=uses.get(group.key)!;let changed=true;
  while(changed){changed=false;for(const card of workspace.recipes)if(!ids.has(card.id)&&card.document.lines.some(line=>line.recipe_id&&ids.has(line.recipe_id))){ids.add(card.id);changed=true;}}
  group.recipeIds=[...ids];
 }
 return [...groups.values()].sort((a,b)=>a.name.localeCompare(b.name,'zh-TW'));
}
