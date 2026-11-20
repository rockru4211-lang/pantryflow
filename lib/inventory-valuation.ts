import {purchaseUnitPrice,type CostQuote} from './cost-price.ts';
import {moneyAmount,type SheetValues} from './operations-sheet.ts';
import {recipeUnit} from './recipe-model.ts';
import type {InventoryMonth,InventoryRow} from './inventory-monthly.ts';
import type {SheetRow} from './operations-sheet.ts';
import {inventoryOriginalPurchaseLabel,inventoryPriceSource} from './inventory-cost.ts';

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
/** Apply only the server-confirmed row; keep other prices, counts and report baselines. */
export function inventoryWithSavedValuation(month:InventoryMonth,saved:InventoryRow):InventoryMonth {
 const rows=month.rows.map(row=>row.row_key===saved.row_key?{...row,...saved}:row);
 const amounts=rows.flatMap(row=>row.amount===null?[]:[row.amount]);
 const subtotal=amounts.length?Math.round(amounts.reduce((sum,amount)=>sum+amount,0)*100)/100:null;
 const missing=rows.filter(row=>row.missing_price).length;
 const previous=month.summary.previous_subtotal;
 return {...month,rows,summary:{...month.summary,subtotal,missing_prices:missing,
  pending:rows.filter(row=>row.needs_review).length,
  amount_difference:subtotal!==null&&previous!==null&&!missing&&!month.summary.previous_missing_prices
   ?Math.round((subtotal-previous)*100)/100:null}};
}
export function inventorySavedValuationRow(row:SheetRow,saved:InventoryRow):SheetRow {
 const meta=row.meta as {row?:InventoryRow}|undefined;
 const latest={...meta?.row,...saved};
 return {...row,values:{...row.values,name:saved.name,unit:saved.unit,
  quantity:saved.current_quantity===null?'':String(saved.current_quantity),
  opening:saved.previous_quantity===null?'':String(saved.previous_quantity),
  price:saved.unit_price===null?'':String(saved.unit_price),amount:saved.amount===null?'':String(saved.amount),
  note:saved.review_note,price_source:inventoryPriceSource(saved),price_batch_id:saved.price_batch_id||'',
  original_purchase:inventoryOriginalPurchaseLabel(saved.price_purchase),price_pending:'',
 },meta:{...meta,row:latest}};
}
export function inventoryWeightOption(q:InventoryValuationQuote,unit:string){
 return !!q.purchase&&recipeUnit(q.purchase.unit)==='g'&&!['g','ml'].includes(recipeUnit(unit));
}
