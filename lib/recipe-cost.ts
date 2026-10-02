export * from './recipe-model.ts';
import {normalizeRecipePurchase,recipeFactor,recipeUnit,recipeNoteBasis,recipePurchaseUnitAmount,type RecipeDocument,type RecipeWorkspace,type RecipeCost,type RecipeLine,type RecipePrice} from './recipe-model.ts';
export type TransferredRecipeLine=RecipeLine&{transfer_prices?:RecipePrice[];transfer_price_at?:string};
export function recipeLinePrices(line:RecipeLine,workspace:RecipeWorkspace):RecipePrice[]{
 const saved=line as TransferredRecipeLine,key=line.product_id?`p:${line.product_id}`:`n:${line.name.trim().toLowerCase()}`;
 let prices=workspace.prices;
 if(Array.isArray(saved.transfer_prices)&&saved.transfer_price_at){
  const newer=prices.filter(p=>p.key===key&&!!p.recorded_at&&Date.parse(p.recorded_at)>Date.parse(saved.transfer_price_at!));
  const units=new Set(newer.map(p=>p.unit));
  prices=[...newer,...saved.transfer_prices.filter(p=>p.key===key&&!units.has(p.unit))];
 }
 // A confirmed 500g box quote can also price a whole box, without re-entering its weight.
 if(!prices.some(p=>p.key===key&&p.unit===recipeUnit(line.unit))){
  const original=prices.filter(p=>p.key===key&&p.purchase&&recipeUnit(p.purchase.unit)===recipeUnit(line.unit)).sort((a,b)=>(b.recorded_at||b.effective_date||'').localeCompare(a.recorded_at||a.effective_date||''))[0];
  if(original?.purchase)try{const n=normalizeRecipePurchase(original.purchase,line.unit);prices=[{...original,unit:n.unit,price:n.price,cost_price:n.costPrice},...prices];}catch{/* Incomplete source quotes stay pending. */}
 }
 return prices;
}
export function recipeCost(doc:RecipeDocument,workspace:RecipeWorkspace,visited:string[]=[]):RecipeCost{
 const lines:RecipeCost['lines']=doc.lines.map(line=>{
  let amount:number|null=null,reason:string|null=null,price:RecipePrice|null=null;
  const q=Number(line.quantity);
  if(!Number.isFinite(q)||q<=0||!line.unit.trim())reason='待填用量';
  else if(line.recipe_id){
   const child=workspace.recipes.find(r=>r.id===line.recipe_id);
   if(!child||visited.includes(child.id)||visited.length>=20)reason='備料引用無效或循環';
   else{
    const cost=recipeCost(child.document,workspace,[...visited,child.id]),yieldQty=Number(child.document.yield);
    if(cost.total===null)reason='備料成本未完整';
    else if(!Number.isFinite(yieldQty)||yieldQty<=0)reason='待填製成量';
    else if(recipeUnit(child.document.unit)!==recipeUnit(line.unit))reason='待確認單位換算';
    else amount=cost.total*q*recipeFactor(line.unit)/(yieldQty*recipeFactor(child.document.unit));
   }
  }else{
   const key=line.product_id?`p:${line.product_id}`:`n:${line.name.trim().toLowerCase()}`;
   const prices=recipeLinePrices(line,workspace),basis=recipeNoteBasis(line,doc.notes);
   const direct=prices.find(p=>p.key===key&&p.unit===recipeUnit(line.unit));
   const explicit=(direct?.purchase as {conversion_basis?:string}|null)?.conversion_basis==='package'&&Number(direct?.purchase?.content_quantity)>0&&recipeUnit(direct?.purchase?.content_unit||'')===recipeUnit(line.unit);
   const compatible=!explicit&&basis&&recipeUnit(basis.unit)===recipeUnit(line.unit)&&basis.countUnit!==recipeUnit(line.unit);
   const piece=compatible?(prices.find(p=>p.key===key&&p.unit===basis.countUnit)||prices.find(p=>p.key===key&&p.unit===recipeUnit(line.unit)&&recipeUnit(p.purchase?.unit||'')===basis.countUnit)):undefined;
   price=piece||direct||null;
   if(piece&&compatible){
    const each=piece.unit===basis.countUnit?Number(piece.cost_price??piece.price):Number(piece.purchase?.cost_unit_price??recipePurchaseUnitAmount(piece));
    if(Number.isFinite(each)&&each>=0)amount=each*q*recipeFactor(line.unit)*basis.count/(basis.quantity*recipeFactor(basis.unit));else reason='待補價格或換算';
   }else if(!price||!Number.isFinite(Number(price.cost_price??price.price))||Number(price.cost_price??price.price)<0)reason='待補價格或換算';
   else if(['顆','片'].includes(recipeUnit(price.purchase?.unit||''))&&recipeUnit(line.unit)!==recipeUnit(price.purchase?.unit||'')&&!explicit)reason='待確認單位換算';
   else amount=Number(price.cost_price??price.price)*q*recipeFactor(line.unit);
  }
  if(amount!==null&&!Number.isFinite(amount)){amount=null;reason='金額超出可計算範圍';}
  return{id:line.id,amount,reason,price};
 });
 const missing=lines.length?lines.filter(l=>l.amount===null).length:1,subtotal=lines.reduce((n,l)=>n+(l.amount??0),0);
 return{lines,missing,subtotal,total:missing?null:subtotal};
}
