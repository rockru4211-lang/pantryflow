import {normalizeRecipePurchase,recipeFactor,recipePurchaseUnitAmount,recipeUnit,recipeNoteBasis,recipeLinePrices,type RecipeDocument,type RecipeLine,type RecipePrice,type RecipePurchase,type RecipeWorkspace} from './recipe-cost.ts';
export type RecipePriceDraft={amount:string;rawAmount:string|null;unit:string;content:string;contentUnit:string;source:string;date:string;amountEdited?:boolean;referenceId?:string;supplierName?:string;supplierId?:string|null};
export const recipePriceKey=(line:Pick<RecipeLine,'name'|'product_id'|'ingredient_id'>)=>line.ingredient_id?`i:${line.ingredient_id}`:line.product_id?`p:${line.product_id}`:`n:${line.name.trim().toLowerCase()}`;
export function findRecipePrice(line:RecipeLine,workspace:RecipeWorkspace){const key=recipePriceKey(line),prices=recipeLinePrices(line,workspace);return prices.find(p=>p.key===key&&p.unit===recipeUnit(line.unit))||prices.find(p=>p.key===key);}
export function recipePriceDraft(line:RecipeLine,workspace:RecipeWorkspace,sourceText=''):RecipePriceDraft{
 const basis=recipeNoteBasis(line,sourceText),prices=recipeLinePrices(line,workspace);
 const found=(basis?prices.find(p=>p.key===recipePriceKey(line)&&p.unit===basis.countUnit):undefined)||findRecipePrice(line,workspace);
 const countMismatch=found&&['顆','片'].includes(recipeUnit(line.unit))&&found.unit!==recipeUnit(line.unit)&&recipeUnit(found.purchase?.unit||'')!==recipeUnit(line.unit);
 const previous=countMismatch?undefined:found,purchase=previous?.purchase;
 const unit=(countMismatch?line.unit:'')||purchase?.unit||previous?.unit||basis?.countUnit||workspace.products.find(p=>p.id===line.product_id)?.unit||line.unit||'g';
 const legacyBasis=basis&&purchase&&(purchase as {conversion_basis?:string}).conversion_basis!=='package'&&basis.countUnit===recipeUnit(purchase.unit)&&recipeUnit(basis.unit)===recipeUnit(line.unit)?basis:null;
 const raw=previous?recipePurchaseUnitAmount(previous):null;
 const cost=purchase?.cost_unit_price??(previous?.cost_price!=null&&previous.price>0&&raw!==null?raw*previous.cost_price/previous.price:previous?.cost_price??raw);
 return {amount:cost===null?'':String(cost),rawAmount:raw===null?null:String(raw),unit,content:legacyBasis?String(legacyBasis.quantity/legacyBasis.count):purchase?.content_quantity?String(purchase.content_quantity):'',contentUnit:legacyBasis?.unit||purchase?.content_unit||line.unit,source:previous?.source||'手動補價',referenceId:previous?.reference_id,supplierName:previous?.supplier_name||previous?.source_ref?.supplier_name,supplierId:previous?.source_ref?.supplier_id,date:previous?.reference_id?(previous.effective_date||''):previous?.effective_date||new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei'}).format(new Date())};
}
export function normalizeRecipeDraft(draft:RecipePriceDraft,targetUnit:string){
 if(!draft.amount.trim())throw Error('請填單價。');
 const amount=Number(draft.amount),raw=draft.rawAmount===null?amount:Number(draft.rawAmount);
 if(draft.rawAmount!==null&&!draft.rawAmount.trim())throw Error('請填原始進價，或選擇使用填寫單價。');
 if(!Number.isFinite(amount)||amount<0||!Number.isFinite(raw)||raw<0)throw Error('單價需為零或正數。');
 if(amount<raw)throw Error('成本單價低於原始進價，請在價格設定核對進價。');
 if(!draft.source.trim()||(!draft.date&&!draft.referenceId))throw Error('請填價格來源與日期。');
 const needsConversion=recipeUnit(draft.unit)!==recipeUnit(targetUnit);
 const purchase:RecipePurchase&{conversion_basis?:string}={amount:raw,quantity:1,unit:draft.unit,...(needsConversion?{content_quantity:Number(draft.content),content_unit:draft.contentUnit,conversion_basis:'package'}:{}),...(amount>raw?{cost_unit_price:amount}:{})};
 return {...normalizeRecipePurchase(purchase,targetUnit),purchase};
}
export function changeRecipePriceUnit(draft:RecipePriceDraft,next:string):RecipePriceDraft{
 const same=recipeUnit(draft.unit)===recipeUnit(next),factor=recipeFactor(next)/recipeFactor(draft.unit);
 // A roll is not a sheet. Never carry a typed price across unrelated units.
 // For compatible weight/volume units retain a newly typed amount; convert an untouched quote.
 const amount=same&&draft.amount.trim()?(draft.amountEdited||draft.rawAmount===null?draft.amount:String(Number(draft.amount)*factor)):'';
 return {...draft,unit:next,amount,rawAmount:same&&draft.rawAmount!==null?String(Number(draft.rawAmount)*factor):null,content:same?draft.content:'',amountEdited:same?draft.amountEdited:false};
}
export function normalizeRecipeLineDraft(line:RecipeLine,draft:RecipePriceDraft,sourceText=''){
 if(recipeUnit(draft.unit)!==recipeUnit(line.unit)&&!draft.content.trim()){
  const basis=recipeNoteBasis(line,sourceText);
  if(basis&&basis.countUnit===recipeUnit(draft.unit)&&recipeUnit(basis.unit)===recipeUnit(line.unit))return normalizeRecipeDraft(draft,draft.unit);
 }
 return normalizeRecipeDraft(draft,line.unit);
}
export function draftRecipePrice(line:RecipeLine,draft:RecipePriceDraft,sourceText=''):RecipePrice{
 const n=normalizeRecipeLineDraft(line,draft,sourceText);
 return {key:recipePriceKey(line),name:line.name,product_id:line.product_id||null,unit:n.unit,price:n.price,cost_price:n.costPrice,purchase:n.purchase,source:draft.source,effective_date:draft.date||null,reference_id:draft.referenceId,recorded_at:new Date().toISOString()};
}

// The editor previews entered/current prices; it must never read a saved cost lock.
// The original workspace and approvals remain untouched for lists, exports and confirmation.
export function recipeEditorPreview(document:RecipeDocument,workspace:RecipeWorkspace,drafts:Record<string,RecipePriceDraft>):RecipeWorkspace{
 const preview:RecipeWorkspace={...workspace,cost_mode:'latest',prices:[...workspace.prices]};
 for(const line of document.lines){
  const draft=drafts[line.id];if(!draft||line.recipe_id)continue;
  const key=recipePriceKey(line),units=[recipeUnit(line.unit),recipeUnit(draft.unit),recipeNoteBasis(line,document.notes)?.countUnit];
  preview.prices=preview.prices.filter(price=>!(price.key===key&&units.includes(price.unit)));
  try{preview.prices.unshift(draftRecipePrice(line,draft,document.notes));}
  catch{/* Invalid input stays pending instead of falling back to an old price. */}
 }
 return preview;
}

// Rank comparable records first without adopting a quote or changing its value.
export function recipePriceCandidates(line:RecipeLine,workspace:RecipeWorkspace){
 const rank=(p:RecipePrice)=>(!p.conversion_pending&&recipeUnit(p.unit)===recipeUnit(line.unit)?4:0)+(!p.source_ref?.missing_price&&Number.isFinite(p.price)&&p.price>=0?2:0)+(p.effective_date?1:0);
 const sorted=(workspace.price_candidates||[]).filter(p=>p.key===recipePriceKey(line)).slice().sort((a,b)=>rank(b)-rank(a)||(b.effective_date||'').localeCompare(a.effective_date||'')||(b.recorded_at||'').localeCompare(a.recorded_at||''));
 const seen=new Set<string>();return sorted.filter(p=>{const key=JSON.stringify([p.name,p.unit,p.price,p.cost_price,p.purchase,p.supplier_name||p.source_ref?.supplier_name,p.source_ref?.specification,p.source,p.conversion_pending]);if(seen.has(key))return false;seen.add(key);return true;});
}
