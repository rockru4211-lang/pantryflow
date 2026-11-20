import {purchaseUnitPrice,type CostQuote} from './cost-price.ts';
import {moneyAmount,type SheetValues} from './operations-sheet.ts';
import {recipeUnit} from './recipe-model.ts';

export type InventoryValuationQuote=CostQuote&{specification?:string;conversion_rate?:number};
export type InventoryValuationChoice={quote:InventoryValuationQuote;automatic:boolean;count_per_unit?:number;weight_kg?:number};
/** Imported package labels describe one counted package, including legacy headings such as g/包. */
export function inventoryCountUnit(unit:string){
 const label=unit.normalize('NFKC').trim();
 const match=label.match(/^(?:\d+(?:\.\d+)?\s*)?(?:kg|g|ml|l|公斤|公克|克|毫升|公升)\s*\/\s*(包|袋|盒|罐|瓶|桶|箱)$/i);
 return match?.[1]||unit;
}
export function inventoryValuationPrice(choice:InventoryValuationChoice,unit:string,quantity:number) {
 const {purchase}=choice.quote;
 if(!purchase||!Number.isFinite(quantity)||quantity<0||!unit.trim()||
  (choice.count_per_unit!==undefined&&!(choice.count_per_unit>0&&choice.count_per_unit<1e9))||
  (choice.weight_kg!==undefined&&!(quantity>0&&choice.weight_kg>0&&choice.weight_kg<1e9)))return null;
 const raw=purchaseUnitPrice(purchase,purchase.unit);
 const price=choice.count_per_unit!==undefined
  ?raw===null?null:raw/choice.count_per_unit
  :choice.weight_kg!==undefined
   ?(purchaseUnitPrice(purchase,'公斤')??NaN)*choice.weight_kg/quantity
   :purchaseUnitPrice(purchase,inventoryCountUnit(unit));
 return price!==null&&Number.isFinite(price)&&price>=0&&price<1e9?Number(price.toFixed(10)):null;
}
export function inventoryValuationDraft(values:SheetValues,choice:InventoryValuationChoice):SheetValues {
 const unit=inventoryCountUnit(values.unit||'');
 const price=inventoryValuationPrice(choice,unit,values.quantity?.trim()?Number(values.quantity):NaN);
 const unitPrice=price===null?'':String(price);
 return {...values,unit,price:unitPrice,purchase_price:unitPrice,price_unit:unit,
  purchase_specification:'',content_quantity:'',content_unit:'',price_pending:'',
  amount:moneyAmount(values.quantity||'',unitPrice),
  price_source:[choice.quote.source,choice.quote.date].filter(Boolean).join(' · ')||'食材價格表',
  price_batch_id:choice.quote.batch_id||''};
}
export type InventoryPriceOffer={name:string;code:string;stopped:boolean;quote:InventoryValuationQuote};
export function inventoryWeightOption(q:InventoryValuationQuote,unit:string){
 return !!q.purchase&&recipeUnit(q.purchase.unit)==='g'&&!['g','ml'].includes(recipeUnit(unit));
}
