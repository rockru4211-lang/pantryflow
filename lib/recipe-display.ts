import type {RecipeCard,RecipeCost,RecipeDocument,RecipeLine,RecipeWorkspace} from './recipe-model.ts';

// A partial sum is useful, but must never masquerade as a complete unit cost.
export function recipeCostSummary(document:RecipeDocument,cost:RecipeCost){
 const amount=cost.total??(cost.lines.some(line=>line.amount!==null)?cost.subtotal:null);
 const quantity=Number(document.yield);
 const hasYield=Number.isFinite(quantity)&&quantity>0;
 return {amount,partial:cost.total===null&&amount!==null,hasYield,
  unitAmount:hasYield&&amount!==null?amount/quantity:null};
}

// References remain visible while missing usage lines stay unresolved.
// These amounts are display references, never inputs to the cost comparison.
export function recipeDirectoryCost(card:RecipeCard){
 const baseline=card.approved_cost?.cost??card.cost;
 const valid=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
 if(baseline.missing===0&&valid(baseline.total))return {amount:baseline.total,label:'整份配方',locked:true};
 const original=card.document.source_cost_per_portion;
 if(valid(original))return {amount:original,label:'原食譜每份成本',locked:false};
 const single=card.document.lines.length===1?card.document.lines[0]:null;
 const price=single?.ingredient_id?baseline.lines.find(line=>line.id===single.id)?.price:null;
 if(price&&valid(price.cost_price??price.price))return {amount:price.cost_price??price.price,label:`進貨單價／${price.unit}`,locked:false};
 const summary=recipeCostSummary(card.document,baseline);
 return {amount:summary.amount,label:summary.partial?'已知成本小計':'待補成本',locked:false};
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

// Display aliases without rewriting saved name-based cost identities.
export function recipeKitchenLineName(line:RecipeLine,workspace:RecipeWorkspace){
 if(line.recipe_id||!line.ingredient_id)return line.name;
 const ingredient=workspace.ingredients?.find(row=>row.id===line.ingredient_id);
 if(!ingredient||line.name!==ingredient.name)return line.name;
 return ingredient.recipe_aliases?.find(name=>name.trim())||line.name;
}
