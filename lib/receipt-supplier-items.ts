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

export function matchSupplierItems(items:SupplierItem[],query:string,limit=8):SupplierItem[]{
 const words=query.normalize("NFKC").toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
 return items.filter(item=>words.every(word=>`${item.name} ${item.specification} ${item.supplier||""}`.normalize("NFKC").toLocaleLowerCase().includes(word))).slice(0,limit);
}

export type ReceiptSupplierChoice={id:string;name:string;aliases?:string[];is_active?:boolean;is_removed?:boolean};
const keywordKey=(value:string)=>value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g,'');
export function matchReceiptSuppliers(rows:ReceiptSupplierChoice[],query:string){
 const key=keywordKey(query);
 return rows.filter(row=>row.is_active!==false&&!row.is_removed&&[row.name,...row.aliases||[]].some(name=>keywordKey(name).includes(key))).slice(0,8);
}
export function receiptItemQuery(value:string){return value==='未命名品項'?'':value;}
export function itemsForSupplier(items:SupplierItem[],supplier:string){
 const key=keywordKey(supplier);if(!key)return items;
 const exact=items.filter(item=>keywordKey(item.supplier||'')===key);
 return exact.length?exact:items.filter(item=>keywordKey(item.supplier||'').includes(key));
}

export function exactReceiptSupplier(rows:ReceiptSupplierChoice[],name:string){
 const key=keywordKey(name);return key?rows.find(row=>[row.name,...row.aliases||[]].some(n=>keywordKey(n)===key)):undefined;
}

/** Saved unit choices include freight units and exclude raw OCR/test/removed records. */
export function receiptSavedUnits(rows:ReviewAccount[]){
 return [...new Set(rows.filter(r=>r.record_state==='LIVE'&&(r.edit_revision>0||r.status==='CHECKED')).flatMap(r=>r.lines.map(l=>l.unit.trim())).filter(Boolean))];
}
