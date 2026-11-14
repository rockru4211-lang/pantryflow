import {purchaseUnitPrice,type CostQuote} from './cost-price.ts';
import {recipeUnit} from './recipe-model.ts';

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
export type InventoryPriceOffer={name:string;code:string;stopped:boolean;quote:InventoryValuationQuote};
export function inventoryWeightOption(q:InventoryValuationQuote,unit:string){
 return !!q.purchase&&recipeUnit(q.purchase.unit)==='g'&&!['g','ml'].includes(recipeUnit(unit));
}
