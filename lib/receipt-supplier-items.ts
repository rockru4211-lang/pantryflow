import type {ReviewAccount,ReviewDraft} from './receipt-review.ts';
import {changeReviewLine} from './receipt-review.ts';
export type SupplierItem={name:string;unit:string;specification:string;price:number|null;date:string};
/** Recent reviewed/edited history only; never silently supplies a current price. */
export function supplierItems(rows:ReviewAccount[],supplier:string,currentBatch:string):SupplierItem[]{
 const items=new Map<string,SupplierItem>();
 for(const row of [...rows].filter(r=>r.batch_id!==currentBatch&&r.record_state==='LIVE'&&r.supplier_name.trim()===supplier.trim()&&(r.edit_revision>0||r.status==='CHECKED')).sort((a,b)=>(b.receipt_date||'').localeCompare(a.receipt_date||''))){
  for(const line of row.lines){if(!line.product_name.trim()||!line.unit.trim()||line.handling&&line.handling!=='NORMAL')continue;
   const key=JSON.stringify([line.product_name.trim(),line.unit.trim(),line.specification||'']);
   if(!items.has(key))items.set(key,{name:line.product_name.trim(),unit:line.unit.trim(),specification:line.specification||'',price:line.unit_price,date:row.receipt_date||''});
  }
 }
 return [...items.values()].slice(0,100);
}
export function applySupplierItem(draft:ReviewDraft,index:number,item:SupplierItem){
 let next=changeReviewLine(draft,index,'product_name',item.name);
 next=changeReviewLine(next,index,'unit',item.unit);
 return changeReviewLine(next,index,'specification',item.specification);
}
