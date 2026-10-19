import type {RecipeCard,RecipeCost,RecipeDocument,RecipeLine} from './recipe-model.ts';

// A partial sum is useful, but must never masquerade as a complete unit cost.
export function recipeCostSummary(document:RecipeDocument,cost:RecipeCost){
 const amount=cost.total??(cost.lines.some(line=>line.amount!==null)?cost.subtotal:null);
 const quantity=Number(document.yield);
 const hasYield=Number.isFinite(quantity)&&quantity>0;
 return {amount,partial:cost.total===null&&amount!==null,hasYield,
  unitAmount:hasYield&&amount!==null?amount/quantity:null};
}

// Saved rows can arrive in a different order. Match identities, never array offsets.
export function recipeSavedLineCost(card:RecipeCard,line:RecipeLine){
 return card.cost.lines.find(saved=>saved.id===line.id)?.amount??null;
}

export function recipeUsageSummary(parent:RecipeCard,componentId:string){
 const lines=parent.document.lines.filter(line=>line.recipe_id===componentId);
 const amounts=lines.map(line=>recipeSavedLineCost(parent,line));
 return {lines,amount:lines.length&&amounts.every(value=>value!==null)?amounts.reduce<number>((sum,value)=>sum+(value??0),0):null};
}
