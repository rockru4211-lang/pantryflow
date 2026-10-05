export * from './recipe-model.ts';
import {normalizeRecipePurchase,recipeFactor,recipeUnit,recipeNoteBasis,recipePurchaseUnitAmount,type RecipeDocument,type RecipeWorkspace,type RecipeCost,type RecipeLine,type RecipePrice} from './recipe-model.ts';
export type RecipeIngredientOption={key:string;name:string;unit:string;product_id?:string;ingredient_id?:string;specification?:string;price?:RecipePrice;pending:boolean;aliases?:string[]};
// The price register also contains historical ingredients that have never been inventory products.
export function recipeIngredientOptions(workspace:RecipeWorkspace):RecipeIngredientOption[]{
 if(workspace.ingredients?.length)return workspace.ingredients.map(row=>{const price=workspace.prices.find(p=>p.key===`i:${row.id}`&&p.unit===row.unit)||workspace.prices.find(p=>p.key===`n:${row.name.trim().toLowerCase()}`&&p.unit===row.unit);return {key:`i:${row.id}`,ingredient_id:row.id,name:row.name,unit:row.unit,aliases:row.aliases.map(a=>a.name),price,pending:row.cost_price===null||row.review_status==='pending'};}).sort((a,b)=>a.name.localeCompare(b.name,'zh-TW'));
 const options=new Map<string,RecipeIngredientOption>();
 for(const p of workspace.products)options.set(`p:${p.id}`,{key:`p:${p.id}`,name:p.name,unit:recipeUnit(p.unit),product_id:p.id,specification:p.specification,pending:true});
 const add=(p:RecipePrice,confirmed:boolean)=>{
  const old=options.get(p.key),name=p.name||old?.name;if(!name)return;
  if(old?.price&&(!confirmed||old.unit==='g'||old.unit===recipeUnit(p.unit)))return;
  const productId=p.product_id||old?.product_id||(p.key.startsWith('p:')?p.key.slice(2):undefined);
  options.set(p.key,{key:p.key,name,unit:recipeUnit(p.unit)||old?.unit||'待確認',product_id:productId,specification:p.source_ref?.specification||old?.specification,price:confirmed?p:undefined,pending:!confirmed});
 };
 for(const p of workspace.prices)add(p,true);
 for(const p of workspace.price_references||workspace.price_candidates||[])if(!options.has(p.key))add(p,false);
 const namedQuotes=new Set([...options.values()].filter(p=>!p.product_id&&p.price).map(p=>p.name.trim().toLowerCase()));
 return [...options.values()].filter(p=>!p.product_id||!namedQuotes.has(p.name.trim().toLowerCase())).sort((a,b)=>a.name.localeCompare(b.name,'zh-TW'));
}
export type TransferredRecipeLine=RecipeLine&{transfer_prices?:RecipePrice[];transfer_price_at?:string};
export function recipeLinePrices(line:RecipeLine,workspace:RecipeWorkspace):RecipePrice[]{
 const saved=line as TransferredRecipeLine,key=line.ingredient_id?`i:${line.ingredient_id}`:line.product_id?`p:${line.product_id}`:`n:${line.name.trim().toLowerCase()}`;
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
 const approved=workspace.cost_mode==='latest'?null:workspace.recipes?.find(card=>card.id===visited.at(-1))?.approved_cost;
 const lines:RecipeCost['lines']=doc.lines.map(line=>{
  const savedLine=approved?.document.lines.find(saved=>saved.id===line.id);
  const savedCost=approved?.cost.lines.find(saved=>saved.id===line.id);
  // Preserve saved prices, including nested preparations and explicit missing values.
  if(savedLine&&savedCost&&savedCost.amount!==null&&approved?.document.notes===doc.notes&&
   ['name','unit','product_id','ingredient_id','recipe_id','note'].every(key=>savedLine[key as keyof RecipeLine]===line[key as keyof RecipeLine])&&
   Number(savedLine.quantity)>0&&Number(line.quantity)>0&&Number.isFinite(Number(line.quantity))){
   const amount=savedLine.quantity===line.quantity?savedCost.amount:savedCost.amount*Number(line.quantity)/Number(savedLine.quantity);
   return {...savedCost,amount:!Number.isFinite(amount)?null:amount};
  }
  // A saved missing line is not a locked zero. Once a real shared price or
  // conversion becomes available, calculate that line while retaining every
  // previously saved non-null line cost above.
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
   const key=line.ingredient_id?`i:${line.ingredient_id}`:line.product_id?`p:${line.product_id}`:`n:${line.name.trim().toLowerCase()}`;
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
