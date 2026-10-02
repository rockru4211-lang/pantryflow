import {normalizeRecipePurchase,recipeFactor,recipePurchaseUnitAmount,recipeUnit,recipeNoteBasis,type RecipeLine,type RecipePrice,type RecipePurchase,type RecipeWorkspace} from './recipe-cost';

export type RecipePriceDraft={amount:string;rawAmount:string|null;unit:string;content:string;contentUnit:string;source:string;date:string;amountEdited?:boolean;referenceId?:string;supplierName?:string;supplierId?:string|null};
export const recipePriceKey=(line:Pick<RecipeLine,'name'|'product_id'>)=>line.product_id?`p:${line.product_id}`:`n:${line.name.trim().toLowerCase()}`;
export function findRecipePrice(line:RecipeLine,workspace:RecipeWorkspace){const key=recipePriceKey(line);return workspace.prices.find(p=>p.key===key&&p.unit===recipeUnit(line.unit))||workspace.prices.find(p=>p.key===key);}
export function recipePriceDraft(line:RecipeLine,workspace:RecipeWorkspace,sourceText=''):RecipePriceDraft{
 const basis=recipeNoteBasis(line,sourceText);
 const found=(basis?workspace.prices.find(p=>p.key===recipePriceKey(line)&&p.unit===basis.countUnit):undefined)||findRecipePrice(line,workspace);
 const countMismatch=found&&['顆','片'].includes(recipeUnit(line.unit))&&found.unit!==recipeUnit(line.unit)&&recipeUnit(found.purchase?.unit||'')!==recipeUnit(line.unit);
 const previous=countMismatch?undefined:found;
 const purchase=previous?.purchase;
 const unit=(countMismatch?line.unit:'')||purchase?.unit||previous?.unit||basis?.countUnit||workspace.products.find(p=>p.id===line.product_id)?.unit||line.unit||'g';
 const raw=previous?recipePurchaseUnitAmount(previous):null;
 const cost=purchase?.cost_unit_price??(previous?.cost_price!=null&&previous.price>0&&raw!==null?raw*previous.cost_price/previous.price:previous?.cost_price??raw);
 return {amount:cost===null?'':String(cost),rawAmount:raw===null?null:String(raw),unit,content:purchase?.content_quantity?String(purchase.content_quantity):'',contentUnit:purchase?.content_unit||line.unit,source:previous?.source||'手動補價',referenceId:previous?.reference_id,supplierName:previous?.supplier_name||previous?.source_ref?.supplier_name,supplierId:previous?.source_ref?.supplier_id,date:previous?.reference_id?(previous.effective_date||''):previous?.effective_date||new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei'}).format(new Date())};
}
export function normalizeRecipeDraft(draft:RecipePriceDraft,targetUnit:string){
 if(!draft.amount.trim())throw Error('請填單價。');
 const amount=Number(draft.amount),raw=draft.rawAmount===null?amount:Number(draft.rawAmount);
 if(draft.rawAmount!==null&&!draft.rawAmount.trim())throw Error('請填原始進價，或選擇使用填寫單價。');
 if(!Number.isFinite(amount)||amount<0||!Number.isFinite(raw)||raw<0)throw Error('單價需為零或正數。');
 if(amount<raw)throw Error('成本單價低於原始進價，請在價格設定核對進價。');
 if(!draft.source.trim()||(!draft.date&&!draft.referenceId))throw Error('請填價格來源與日期。');
 const needsConversion=recipeUnit(draft.unit)!==recipeUnit(targetUnit);
 const purchase:RecipePurchase={amount:raw,quantity:1,unit:draft.unit,...(needsConversion?{content_quantity:Number(draft.content),content_unit:draft.contentUnit}:{}),...(amount>raw?{cost_unit_price:amount}:{})};
 return {...normalizeRecipePurchase(purchase,targetUnit),purchase};
}
export function changeRecipePriceUnit(draft:RecipePriceDraft,next:string):RecipePriceDraft{
 const same=recipeUnit(draft.unit)===recipeUnit(next),factor=recipeFactor(next)/recipeFactor(draft.unit);
 return {...draft,unit:next,amount:draft.amountEdited||draft.rawAmount===null?draft.amount:same&&draft.amount.trim()?String(Number(draft.amount)*factor):'',rawAmount:same&&draft.rawAmount!==null?String(Number(draft.rawAmount)*factor):null,content:same?draft.content:''};
}
export function normalizeRecipeLineDraft(line:RecipeLine,draft:RecipePriceDraft,sourceText=''){
 if(['顆','片'].includes(recipeUnit(draft.unit))&&recipeUnit(draft.unit)!==recipeUnit(line.unit)){
  const basis=recipeNoteBasis(line,sourceText);
  if(!basis||basis.countUnit!==recipeUnit(draft.unit)||recipeUnit(basis.unit)!==recipeUnit(line.unit))throw Error('請在食材備註填寫換算，例如：120g 使用 6顆。');
  return normalizeRecipeDraft(draft,draft.unit);
 }
 return normalizeRecipeDraft(draft,line.unit);
}
export function draftRecipePrice(line:RecipeLine,draft:RecipePriceDraft,sourceText=''):RecipePrice{
 const n=normalizeRecipeLineDraft(line,draft,sourceText);
 return {key:recipePriceKey(line),name:line.name,product_id:line.product_id||null,unit:n.unit,price:n.price,cost_price:n.costPrice,purchase:n.purchase,source:draft.source,effective_date:draft.date||null,reference_id:draft.referenceId};
}
