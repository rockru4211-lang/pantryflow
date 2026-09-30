export type RecipeLine={id:string;name:string;quantity:string;unit:string;product_id?:string;recipe_id?:string;note?:string};
export type RecipeDocument={name:string;kind:'dish'|'prep';yield:string;unit:string;lines:RecipeLine[];notes:string;photo?:string;source_name?:string;portion_quantity?:string;portion_unit?:string};
export type RecipePrice={key:string;name:string;product_id:string|null;unit:string;price:number;source:string;effective_date:string;supplier_name?:string;cost_price?:number|null;purchase?:RecipePurchase|null};
export type RecipeCost={total:number|null;subtotal:number;missing:number;lines:{id:string;amount:number|null;reason:string|null;price:RecipePrice|null}[]};
export type RecipeCard={id:string;revision:number;document:RecipeDocument;updated_at:string;cost:RecipeCost};
export type RecipeWorkspace={recipes:RecipeCard[];products:{id:string;name:string;unit:string;specification?:string}[];prices:RecipePrice[];can_price:boolean};
export function recipeUnit(unit:string){const u=unit.trim().toLowerCase();return ['g','kg','公克','克','公斤','斤','台斤','臺斤'].includes(u)?'g':['ml','l','毫升','公升'].includes(u)?'ml':['顆','個','pc','pcs'].includes(u)?'顆':u==='box'?'盒':u;}
export function recipeFactor(unit:string){const u=unit.trim().toLowerCase();return ['kg','公斤','l','公升'].includes(u)?1000:['斤','台斤','臺斤'].includes(u)?600:1;}
const recipeName=(name:string)=>name.normalize('NFKC').trim().toLowerCase();
// A different output unit still identifies a prep. Costing validates its conversion.
export function recipePrepOptions(line:RecipeLine,workspace:RecipeWorkspace,excludedIds:string[]=[]):RecipeCard[]{
 const blocked=new Set(excludedIds),cards=new Map(workspace.recipes.map(r=>[r.id,r]));
 const unsafe=(id:string,path:string[]=[]):boolean=>{
  if(blocked.has(id)||path.includes(id)||path.length>=20)return true;
  const card=cards.get(id);if(!card)return true;
  return card.document.lines.some(l=>l.recipe_id&&unsafe(l.recipe_id,[...path,id]));
 };
 return workspace.recipes.filter(r=>r.document.kind==='prep'&&!unsafe(r.id)).sort((a,b)=>Number(recipeUnit(b.document.unit)===recipeUnit(line.unit))-Number(recipeUnit(a.document.unit)===recipeUnit(line.unit)));
}
// Store the recipe ID, not a rounded/copied price. Existing choices and quotes win.
export function linkRecipePreps(doc:RecipeDocument,workspace:RecipeWorkspace,excludedIds:string[]=[],pendingPriceIds:string[]=[]):RecipeDocument{
 let changed=false;
 const lines=doc.lines.map(line=>{
  if(line.recipe_id||line.product_id||pendingPriceIds.includes(line.id)||workspace.prices.some(p=>p.key===`n:${line.name.trim().toLowerCase()}`))return line;
  const named=recipePrepOptions(line,workspace,excludedIds).filter(r=>recipeName(r.document.name)===recipeName(line.name));
  const compatible=named.filter(r=>line.unit.trim()&&recipeUnit(r.document.unit)===recipeUnit(line.unit));
  const matches=compatible.length?compatible:named;
  if(matches.length!==1)return line;
  const child=matches[0];
  changed=true;return {...line,recipe_id:child.id};
 });
 return changed?{...doc,lines}:doc;
}
// An explicit named output is a suggestion only; it never rewrites entered yields.
export function recipeYieldHint(doc:RecipeDocument):{name:string;quantity:string;unit:string}|null{
 const matches=[...doc.notes.matchAll(/製成\s*([^\d\n，,。；;:：]{1,30}?)\s*(\d[\d,]*(?:\.\d+)?)\s*(公斤|公克|毫升|公升|kg|ml|g|L|克|份)(?![a-z])/gi)];
 if(matches.length!==1)return null;
 const m=matches[0],quantity=m[2].replaceAll(',','');
 return Number.isFinite(Number(quantity))&&Number(quantity)>0?{name:m[1].trim(),quantity,unit:m[3]}:null;
}
export function recipeCost(doc:RecipeDocument,workspace:RecipeWorkspace,visited:string[]=[]):RecipeCost{
 const lines:RecipeCost['lines']=doc.lines.map(line=>{
  let amount:number|null=null,reason:string|null=null,price:RecipePrice|null=null;
  const q=Number(line.quantity);
  if(!Number.isFinite(q)||q<=0||!line.unit.trim())reason='待填用量';
  else if(line.recipe_id){
   const child=workspace.recipes.find(r=>r.id===line.recipe_id);
   if(!child||visited.includes(child.id)||visited.length>20)reason='備料引用無效或循環';
   else{
    const cost=recipeCost(child.document,workspace,[...visited,child.id]);const yieldQty=Number(child.document.yield);
    if(cost.total===null)reason='備料成本未完整';
    else if(!Number.isFinite(yieldQty)||yieldQty<=0)reason='待填製成量';
    else if(recipeUnit(child.document.unit)!==recipeUnit(line.unit))reason='待確認單位換算';
    else amount=cost.total*q*recipeFactor(line.unit)/(yieldQty*recipeFactor(child.document.unit));
   }
  }else{
   const key=line.product_id?`p:${line.product_id}`:`n:${line.name.trim().toLowerCase()}`;
   const basis=recipeNoteBasis(line,doc.notes);
   const compatible=basis&&recipeUnit(basis.unit)===recipeUnit(line.unit)&&basis.countUnit!==recipeUnit(line.unit);
   const piece=compatible?(workspace.prices.find(p=>p.key===key&&p.unit===basis.countUnit)||workspace.prices.find(p=>p.key===key&&p.unit===recipeUnit(line.unit)&&recipeUnit(p.purchase?.unit||'')===basis.countUnit)):undefined;
   price=piece||workspace.prices.find(p=>p.key===key&&p.unit===recipeUnit(line.unit))||null;
   if(piece&&compatible){const each=piece.unit===basis.countUnit?Number(piece.cost_price??piece.price):Number(piece.purchase?.cost_unit_price??recipePurchaseUnitAmount(piece));if(Number.isFinite(each)&&each>=0)amount=each*q*recipeFactor(line.unit)*basis.count/(basis.quantity*recipeFactor(basis.unit));else reason='待補價格或換算';}
   else if(!price||!Number.isFinite(Number(price.cost_price??price.price))||Number(price.cost_price??price.price)<0)reason='待補價格或換算';
   else if(['顆','片'].includes(recipeUnit(price.purchase?.unit||''))&&recipeUnit(line.unit)!==recipeUnit(price.purchase?.unit||''))reason='備註待補換算';
   else amount=Number(price.cost_price??price.price)*q*recipeFactor(line.unit);
  }
  return{id:line.id,amount,reason,price};
 });
 const missing=lines.length?lines.filter(l=>l.amount===null).length:1;
 const subtotal=lines.reduce((n,l)=>n+(l.amount??0),0);
 return{lines,missing,subtotal,total:missing?null:subtotal};
}
export const emptyRecipe=():RecipeDocument=>({name:'',kind:'dish',yield:'1',unit:'份',lines:[],notes:''});
// Import is an editable draft. Preserve source text; never silently infer yields or discard unresolved text.
export function parseRecipeText(text:string,name:string):RecipeDocument[]{
 const sections=text.split(/(?=【[^】]+】)/).filter(s=>s.trim());
 const docs:RecipeDocument[]=[];
 for(const section of sections){
  const heading=section.match(/^【([^】]+)】/);const yieldMatch=section.match(/製成\s*([\d,.]+)\s*(g|ml|公斤|公克|克|份)/i);
  const body=section.replace(/^【[^】]+】/,'').replace(/製成\s*[\d,.]+\s*(?:g|ml|公斤|公克|克|份)/i,'').replace(/一份(?:量)?\s*[\d,.]+\s*(?:g|ml|份)/gi,'');
  const lines:RecipeLine[]=[];
  for(const raw of body.split(/\n/)){
   const m=raw.trim().match(/^(.+?)\s*([\d,.]+)\s*(kg|ml|g|公克|公斤|克|顆|片|份|瓶|包|L)(?:\s*\([^)]*\))?\s*$/i);
   if(m)lines.push({id:crypto.randomUUID(),name:m[1].trim(),quantity:m[2].replaceAll(',',''),unit:m[3]});
  }
  if(!heading&&!lines.length)continue;
  docs.push({name:heading?heading[1]:name,kind:yieldMatch?'prep':'dish',yield:yieldMatch?yieldMatch[1].replaceAll(',',''):'',unit:yieldMatch?yieldMatch[2]:'份',lines,notes:section.trim(),source_name:name});
 }
 return docs.length?docs:[{...emptyRecipe(),name,notes:text,source_name:name}];
}

export function recipePortionCost(doc:RecipeDocument,cost:RecipeCost):number|null {
 const quantity=Number(doc.portion_quantity),yieldQty=Number(doc.yield);
 if(cost.total===null||!Number.isFinite(quantity)||quantity<=0||!Number.isFinite(yieldQty)||yieldQty<=0||recipeUnit(doc.portion_unit||doc.unit)!==recipeUnit(doc.unit))return null;
 return cost.total*quantity*recipeFactor(doc.portion_unit||doc.unit)/(yieldQty*recipeFactor(doc.unit));
}

export type RecipePurchase={amount:number;quantity:number;unit:string;content_quantity?:number;content_unit?:string;cost_unit_price?:number};
export function normalizeRecipePurchase(purchase:RecipePurchase,targetUnit:string){
 if(!Number.isFinite(purchase.amount)||purchase.amount<0||!Number.isFinite(purchase.quantity)||purchase.quantity<=0||!purchase.unit.trim()||!targetUnit.trim())throw Error('請填採購金額、數量與單位。');
 const unit=recipeUnit(targetUnit);
 let baseQuantity=purchase.quantity*recipeFactor(purchase.unit);
 if(recipeUnit(purchase.unit)!==unit){
  if(!purchase.content_unit||recipeUnit(purchase.content_unit)!==unit||!Number.isFinite(purchase.content_quantity)||Number(purchase.content_quantity)<=0)throw Error(`請確認每 1 ${purchase.unit} 可換算多少 ${targetUnit}。`);
  baseQuantity=purchase.quantity*Number(purchase.content_quantity)*recipeFactor(purchase.content_unit);
 }
 const price=purchase.amount/baseQuantity;
 if(!Number.isFinite(baseQuantity)||baseQuantity<=0||!Number.isFinite(price))throw Error('換算數量無效，請重新確認。');
 let costPrice:number|null=null;
 if(purchase.cost_unit_price!==undefined){
  if(!Number.isFinite(purchase.cost_unit_price)||purchase.cost_unit_price<purchase.amount/purchase.quantity)throw Error('高估單價不可低於採購單價。');
  costPrice=purchase.cost_unit_price*purchase.quantity/baseQuantity;
  if(!Number.isFinite(costPrice))throw Error('高估單價無效。');
 }
 return {unit,price,baseQuantity,costPrice};
}

// A suggestion only: existing recipe quantities change after explicit user confirmation.
export function recipeCountHint(name:string){
 const match=name.trim().match(/^(.+?)\s*[(（]\s*([\d]+(?:\.\d+)?)\s*(顆|個|pcs?|片|份|包|瓶|盒)\s*[)）]$/i);
 return match&&Number(match[2])>0?{name:match[1].trim(),quantity:match[2],unit:recipeUnit(match[3])}:null;
}
export function recipePurchaseUnitAmount(price:RecipePrice):number{
 return price.purchase&&price.purchase.quantity>0?price.purchase.amount/price.purchase.quantity:Number(price.price);
}

// Use an explicit count from the original recipe only when it describes this exact
// ingredient and current amount. Never reinterpret a weight as a piece count.
export function recipeSourceCount(line:RecipeLine,sourceText:string){
 const named=recipeCountHint(line.name),baseName=(named?.name||line.name).replace(/\s+/g,'');
 const matches=sourceText.split(/\n/).flatMap(raw=>{
  const m=raw.trim().match(/^(.+?)\s*([\d]+(?:\.\d+)?)\s*(kg|g|公克|公斤|克|台斤|臺斤|斤|ml|l|公升|毫升)\s*[(（]\s*([\d]+(?:\.\d+)?)\s*(顆|個|pcs?|片|份|包|瓶|盒)\s*[)）]\s*$/i);
  return m&&m[1].replace(/\s+/g,'')===baseName?[{name:m[1].trim(),amount:Number(m[2]),amountUnit:m[3],quantity:m[4],unit:recipeUnit(m[5])}]:[];
 });
 if(matches.length){
  const first=matches[0];
  if(named&&(Number(named.quantity)!==Number(first.quantity)||named.unit!==first.unit))return null;
  if(!line.quantity.trim()||!Number.isFinite(Number(line.quantity)))return null;
  if(matches.some(m=>m.amount*recipeFactor(m.amountUnit)!==first.amount*recipeFactor(first.amountUnit)||recipeUnit(m.amountUnit)!==recipeUnit(first.amountUnit)||m.quantity!==first.quantity||m.unit!==first.unit))return null;
  if(Number(first.quantity)<=0||Number(first.amount)<=0||recipeUnit(line.unit)!==recipeUnit(first.amountUnit)||Math.abs(Number(line.quantity)*recipeFactor(line.unit)-first.amount*recipeFactor(first.amountUnit))>1e-9)return null;
  return {name:named?.name||line.name,quantity:first.quantity,unit:first.unit};
 }
 return named&&recipeUnit(line.unit)!==named.unit?named:null;
}
// Notes describe a costing equivalence. They never replace the recipe quantity.
export type RecipeNoteBasis={quantity:number;unit:string;count:number;countUnit:string};
export function recipeNoteBasis(line:RecipeLine,sourceText=''):RecipeNoteBasis|null{
 const pattern=/^([\d]+(?:\.\d+)?)\s*(kg|g|公克|公斤|克|台斤|臺斤|斤|ml|l|公升|毫升)\s*(?:[（(]\s*|(?:使用|約用|約需|需|用|=|＝)\s*)([\d]+(?:\.\d+)?)\s*(顆|個|pcs?|片)(?:蛋黃|雞蛋|蛋)?\s*[)）]?\s*$/i;
 const parse=(text:string):RecipeNoteBasis|null=>{const m=text.trim().match(pattern);return m&&Number(m[1])>0&&Number(m[3])>0?{quantity:Number(m[1]),unit:m[2],count:Number(m[3]),countUnit:recipeUnit(m[4])}:null;};
 if(line.note!==undefined)return parse(line.note);
 const name=(recipeCountHint(line.name)?.name||line.name).replace(/\s+/g,'');
 const matches=sourceText.split(/\n/).flatMap(raw=>{const m=raw.trim().match(/^(.+?)\s*([\d].*)$/);const parsed=m&&m[1].replace(/\s+/g,'')===name?parse(m[2]):null;return parsed?[parsed]:[];});
 if(!matches.length)return null;
 const first=matches[0];return matches.every(m=>m.quantity*recipeFactor(m.unit)===first.quantity*recipeFactor(first.unit)&&recipeUnit(m.unit)===recipeUnit(first.unit)&&m.count===first.count&&m.countUnit===first.countUnit)?first:null;
}
export function recipeNoteText(line:RecipeLine,sourceText=''){
 const basis=recipeNoteBasis(line,sourceText);return line.note??(basis?`${basis.quantity} ${basis.unit} 使用 ${basis.count} ${basis.countUnit}`:'');
}
