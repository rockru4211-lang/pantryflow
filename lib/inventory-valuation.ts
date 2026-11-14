import {purchaseUnitPrice,type CostQuote} from './cost-price.ts';
import {inventoryOriginalPurchaseLabel} from './inventory-cost.ts';
import {ingredientReceiptPrices,isIngredientStopped,priceSearch,type PriceSheetData} from './ingredient-price-sheet.ts';
import {recipeUnit} from './recipe-model.ts';
import {supplierNameKey} from './supplier-prices.ts';

export type InventoryValuationQuote=CostQuote&{specification?:string;conversion_rate?:number};
export type InventoryValuationChoice={quote:InventoryValuationQuote;automatic:boolean;count_per_unit?:number;weight_kg?:number};
export function inventoryValuationPrice(choice:InventoryValuationChoice,unit:string,quantity:number) {
 const {purchase}=choice.quote;
 if(!purchase||quantity<=0||
  (choice.count_per_unit!==undefined&&!(choice.count_per_unit>0&&choice.count_per_unit<1e9))||
  (choice.weight_kg!==undefined&&!(choice.weight_kg>0&&choice.weight_kg<1e9)))return null;
 const raw=purchaseUnitPrice(purchase,purchase.unit);
 const price=choice.count_per_unit!==undefined
  ?raw===null?null:raw/choice.count_per_unit
  :choice.weight_kg!==undefined
   ?(purchaseUnitPrice(purchase,'公斤')??NaN)*choice.weight_kg/quantity
   :purchaseUnitPrice(purchase,unit);
 return price!==null&&Number.isFinite(price)&&price>=0&&price<1e9?Number(price.toFixed(10)):null;
}
export function inventoryLookup(data:PriceSheetData,term:string,cutoff:string,supplier:string,preferredCode:string) {
 if(!term.trim())return [];
 const matches=data.ingredients.filter(row=>priceSearch(row,term)&&!isIngredientStopped(row,data.supply_states));
 const candidates=matches.flatMap(row=>{
  const name=row.name;
  const code=row.canonical_code||row.ingredient_code||'';
  const quote=(q:InventoryValuationQuote)=>({name,code,quote:q});
  const stopped=(key:string)=>data.supply_states.some(state=>state.stopped&&state.supplier_key===key&&
   (state.ingredient_id===row.id||state.ingredient_id===row.canonical_ingredient_id));
  const receipts=ingredientReceiptPrices([row],'',data.supply_states).map(r=>quote({
   price:null,basis:'receipt',date:r.date,purchase:r.purchase,reference_id:r.id,supplier_name:r.supplier,source:'已確認建檔進貨',
   specification:row.sources?.find(s=>s.id===r.id)?.source_ref?.specification,
  }));
  const references=(row.sources||[]).filter(s=>s.review_status==='confirmed'&&s.can_apply!==false&&s.source_kind==='purchase'&&!s.source_ref?.batch_id&&!s.source_ref?.missing_price&&!s.source.includes('進貨明細')&&!stopped(s.supplier_key)).map(s=>quote({
   price:null,basis:'purchase',date:s.effective_date,purchase:s.purchase||(s.price==null?null:{amount:s.price,quantity:1,unit:s.unit}),
   reference_id:s.id,supplier_name:s.supplier_name,source:s.source,specification:s.source_ref?.specification,
  }));
  const standard=(data.price_history||[]).filter(h=>h.ingredient_id===row.id&&h.snapshot.review_status==='confirmed'&&!(h.supplier_key&&stopped(h.supplier_key)))
    .map(h=>quote({price:null,basis:'standard',date:h.effective_date,purchase:h.snapshot.purchase||
     (h.snapshot.cost_price==null?null:{amount:h.snapshot.cost_price,quantity:1,unit:h.snapshot.unit}),reference_id:h.id,
     supplier_name:h.supplier_name,source:'食材價格表 · 標準價'}));
  return [...receipts,...references,...standard];
 }).filter(({quote:q})=>!!q.date&&q.date<=cutoff&&!!inventoryOriginalPurchaseLabel(q.purchase));
 candidates.sort((a,b)=>Number(b.code===preferredCode&&!!preferredCode)-Number(a.code===preferredCode&&!!preferredCode)||
  Number(supplierNameKey(b.quote.supplier_name||'')===supplierNameKey(supplier))-Number(supplierNameKey(a.quote.supplier_name||'')===supplierNameKey(supplier))||
  (b.quote.date||'').localeCompare(a.quote.date||''));
 const seen=new Set<string>();
 return candidates.filter(({name,code,quote:q})=>{
  const key=JSON.stringify([code||name,q.supplier_name,q.date,q.specification,inventoryOriginalPurchaseLabel(q.purchase)]);
  if(seen.has(key))return false;
  seen.add(key);
  return true;
 }).slice(0,30);
}
export function inventoryWeightOption(q:InventoryValuationQuote,unit:string){
 return !!q.purchase&&recipeUnit(q.purchase.unit)==='g'&&!['g','ml'].includes(recipeUnit(unit));
}
