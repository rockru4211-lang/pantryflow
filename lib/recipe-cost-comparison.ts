import {recipeCost,recipeEdibleFactor,recipeFactor,recipeUnit,type RecipeCard,type RecipeCost,type RecipePrice,type RecipeWorkspace} from './recipe-cost.ts';
export function recipeCostComparison(card:RecipeCard,workspace?:RecipeWorkspace){
 const latest=card.latest_cost??workspace?.latest_costs?.find(row=>row.id===card.id)?.latest_cost??null;
 const baseline=card.approved_cost?.cost??card.cost;
 const before=completeTotal(baseline),after=latest?completeTotal(latest):null;
 const delta=before!==null&&after!==null?after-before:null;
 return {baseline,latest,before,after,delta,percent:delta!==null&&before!==null&&before>0?delta/before*100:null};
}
export function completeTotal(cost:RecipeCost){return cost.missing===0&&cost.total!==null&&Number.isFinite(cost.total)?cost.total:null;}
export function signedCost(value:number|null,suffix=''){return value===null?'—':`${value>0?'+':''}${value.toFixed(2)}${suffix}`;}
export type RecipeTrialSource={key:string;name:string;quantity:number;unit:string;amount:number|null;reason:string|null;price:RecipeCost['lines'][number]['price']};
// Explanatory leaves use actual usage and existing yield/loss rules, never an additional total.
export function recipeComponentSources(card:RecipeCard,lineId:string,workspace:RecipeWorkspace):RecipeTrialSource[]{
 const rows:RecipeTrialSource[]=[];
 function walk(parent:RecipeCard,id:string,scale:number,path:string[]){
  const line=parent.document.lines.find(row=>row.id===id);if(!line)return;
  const factor=recipeEdibleFactor(line),quantity=Number(line.quantity);
  if(!line.recipe_id){
   const {transfer_prices:_prices,transfer_price_at:_at,...currentLine}=line as typeof line&{transfer_prices?:unknown;transfer_price_at?:unknown};void _prices;void _at;
   const prices=(workspace.current_prices||[]).filter((price):price is RecipePrice=>price.price!==null&&price.price!==undefined&&Number.isFinite(price.price)&&price.cost_price!==null);
   const cost=recipeCost({...parent.document,lines:[currentLine]},{...workspace,prices,cost_mode:'latest'},path).lines[0];
   rows.push({key:[...path,id].join('/'),name:line.name,quantity:quantity*scale,unit:line.unit,amount:cost.amount===null?null:cost.amount*scale,reason:cost.reason,price:cost.price});return;
  }
  const child=workspace.recipes.find(row=>row.id===line.recipe_id),yieldQty=Number(child?.document.yield);
  if(!child||path.includes(child.id)||path.length>=20||factor===null||!Number.isFinite(quantity)||quantity<=0||!Number.isFinite(yieldQty)||yieldQty<=0||recipeUnit(line.unit)!==recipeUnit(child.document.unit)){
   rows.push({key:[...path,id].join('/'),name:line.name,quantity:quantity*scale,unit:line.unit,amount:null,reason:'配件用量、單位或引用待確認',price:null});return;
  }
  const next=scale*quantity*recipeFactor(line.unit)*factor/(yieldQty*recipeFactor(child.document.unit));
  for(const nested of child.document.lines)walk(child,nested.id,next,[...path,child.id]);
 }
 walk(card,lineId,1,[card.id]);return rows;
}
// Original receipt values are not the normalized calculation purchase.
export function recipeTrialPriceDetails(price:RecipePrice){
 const purchase=price.source_ref?.receipt_purchase;
 const valid=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);
 const original=purchase&&valid(purchase.amount)&&purchase.amount>=0&&valid(purchase.quantity)&&purchase.quantity>0&&purchase.unit?.trim()?`原始進價 NT$ ${purchase.amount}／${purchase.quantity} ${purchase.unit}`:'原始進價／購買單位未提供';
 const content=purchase&&valid(purchase.content_quantity)&&purchase.content_quantity>0&&purchase.content_unit?.trim()?`每 ${purchase.unit} ${purchase.content_quantity} ${purchase.content_unit}`:null;
 const specification=[content,price.source_ref?.specification?.trim()].filter(Boolean).join(' · ')||'原始規格未提供';
 const amount=price.cost_price??price.price;
 const converted=valid(amount)&&amount>=0&&price.unit?.trim()?`食譜換算成本 NT$ ${amount}／${price.unit}`:'食譜單位換算待確認';
 return {original,specification,converted};
}
