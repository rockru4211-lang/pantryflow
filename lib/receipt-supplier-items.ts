import type {ReviewAccount,ReviewDraft} from './receipt-review.ts';
import {changeReviewLine} from './receipt-review.ts';
export type SupplierItem={name:string;unit:string;specification:string;price:number|null;date:string;supplier?:string};
/** Saved history only; never mix removed records or raw, unreviewed OCR. */
export function supplierItems(rows:ReviewAccount[],supplier:string,currentBatch:string):SupplierItem[]{
 const items=new Map<string,SupplierItem>();
 for(const row of [...rows].filter(r=>r.batch_id!==currentBatch&&r.record_state==='LIVE'&&(!supplier.trim()||r.supplier_name.trim()===supplier.trim())&&(r.edit_revision>0||r.status==='CHECKED')).sort((a,b)=>(b.receipt_date||'').localeCompare(a.receipt_date||''))){
  for(const line of row.lines){if(!line.product_name.trim()||!line.unit.trim()||line.handling&&line.handling!=='NORMAL')continue;
   const key=JSON.stringify([row.supplier_name.trim(),line.product_name.trim(),line.unit.trim(),line.specification||'']);
   if(!items.has(key))items.set(key,{name:line.product_name.trim(),unit:line.unit.trim(),specification:line.specification||'',price:line.unit_price,date:row.receipt_date||'',supplier:row.supplier_name});
  }
 }
 return [...items.values()];
}
export function applySupplierItem(draft:ReviewDraft,index:number,item:SupplierItem){
 let next=changeReviewLine(draft,index,'product_name',item.name);
 next=changeReviewLine(next,index,'unit',item.unit);
 next=changeReviewLine(next,index,'specification',item.specification);
 if(!draft.lines[index].unit_price.trim()&&item.price!==null&&Number.isFinite(item.price)&&item.price>=0&&(!draft.lines[index].handling||draft.lines[index].handling==='NORMAL'))next=changeReviewLine(next,index,'unit_price',String(item.price));
 return next;
}

export function matchSupplierItems(items:SupplierItem[],query:string):SupplierItem[]{
 const words=query.normalize("NFKC").toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
 return items.filter(item=>words.every(word=>`${item.name} ${item.specification} ${item.supplier||""}`.normalize("NFKC").toLocaleLowerCase().includes(word))).slice(0,8);
}
