export const receiptCategoryDefaults=['食材','酒水','耗材'];
export function receiptCategories(value:unknown):string[]{return Array.isArray(value)?[...new Set(value.filter((v):v is string=>typeof v==='string').map(v=>v.trim()).filter(Boolean))]:[];}
export function receiptCategoryOptions(rows:{receipt_categories?:string[]}[]){return [...new Set([...receiptCategoryDefaults,...rows.flatMap(r=>receiptCategories(r.receipt_categories))])];}
export function lastSupplierReceiptCategories(rows:{batch_id:string;supplier_name:string;receipt_date?:string|null;uploaded_at?:string;edited_at?:string|null;record_state:string;edit_revision:number;receipt_categories?:string[]}[],supplier:string,exclude:string,aliases:string[]=[]){
 const key=(name:string)=>name.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g,'');
 const names=new Set([supplier,...aliases].map(key).filter(Boolean));
 return receiptCategories([...rows].filter(r=>r.batch_id!==exclude&&r.record_state==='LIVE'&&r.edit_revision>0&&names.has(key(r.supplier_name))&&receiptCategories(r.receipt_categories).length>0).sort((a,b)=>(Date.parse(b.edited_at||'')||0)-(Date.parse(a.edited_at||'')||0)||(b.receipt_date||'').localeCompare(a.receipt_date||'')||(b.uploaded_at||'').localeCompare(a.uploaded_at||''))[0]?.receipt_categories);
}
export function matchesReceiptCategory(categories:unknown,filter:string){const values=receiptCategories(categories);return !filter||(filter==='__uncategorized'?values.length===0:values.includes(filter));}

export type ReceiptCategorySource='manual'|'item'|'receipt'|'supplier';
/** Item masters still use these categories; arbitrary invoice tags are not item categories. */
export function knownReceiptItemCategory(value:unknown):string{
 const category=typeof value==='string'?value.trim():'';
 return ['食材','酒水','耗材','調料'].includes(category)?category:'';
}
export function hasReceiptItemCategory(value:unknown):boolean{
 return typeof value==='string'&&!!value.trim()&&!['待分類','未分類'].includes(value.trim());
}
/** A mixed/custom-labelled document is ambiguous: never pick its first tag or fall through to its supplier. */
export function receiptItemCategoryDefault(itemCategory:unknown,categories:unknown,supplierCategory:unknown):{category:string;categorySource?:ReceiptCategorySource}{
 const item=knownReceiptItemCategory(itemCategory);if(item)return {category:item,categorySource:'item'};
 const document=receiptCategories(categories);
 if(document.length){const category=document.length===1?knownReceiptItemCategory(document[0]):'';return category?{category,categorySource:'receipt'}:{category:'待分類'};}
 const supplier=knownReceiptItemCategory(supplierCategory);
 return supplier?{category:supplier,categorySource:'supplier'}:{category:'待分類'};
}
