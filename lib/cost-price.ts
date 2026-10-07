import {recipeUnit,recipeFactor,type RecipePurchase} from './recipe-model.ts';
import type {SheetRow} from './operations-sheet.ts';
export type CostQuote={price:number|null;source?:string;date?:string|null;reason?:string;reference_id?:string;basis?:string};
// Purchase amounts are per stated package, never per the spreadsheet column heading.
export function purchaseUnitPrice(p:RecipePurchase|null|undefined,target:string):number|null{
 if(!p||!Number.isFinite(p.amount)||p.amount<0||!Number.isFinite(p.quantity)||p.quantity<=0)return null;
 let denominator=p.quantity*recipeFactor(p.unit);
 if(recipeUnit(p.unit)!==recipeUnit(target)){
  if(!p.content_quantity||p.content_quantity<=0||recipeUnit(p.content_unit||'')!==recipeUnit(target))return null;
  denominator=p.quantity*p.content_quantity*recipeFactor(p.content_unit||'');
 }
 return p.amount/denominator*recipeFactor(target);
}
export function applyCostQuotes(rows:SheetRow[],quotes:CostQuote[]){
 if(rows.length!==quotes.length)throw Error('價格回應不完整，請重試。');
 return rows.map((r,i)=>{const q=quotes[i],valid=q.price!==null&&Number.isFinite(q.price)&&q.price>=0;
  return {...r,requestId:r.requestId||crypto.randomUUID(),values:{...r.values,...(valid?{price:String(q.price),amount:r.values.quantity!==''?String(Number(r.values.quantity)*q.price!):''}:{}),price_source:valid?[q.source,q.date].filter(Boolean).join(' · '):q.reason||'名稱或計價單位尚未完成對應'},meta:{...r.meta as object,costQuote:q}};
 });
}
