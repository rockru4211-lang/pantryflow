export const receiptCategoryDefaults=['食材','酒水','耗材'];
export function receiptCategories(value:unknown):string[]{return Array.isArray(value)?[...new Set(value.filter((v):v is string=>typeof v==='string').map(v=>v.trim()).filter(Boolean))]:[];}
export function receiptCategoryOptions(rows:{receipt_categories?:string[]}[]){return [...new Set([...receiptCategoryDefaults,...rows.flatMap(r=>receiptCategories(r.receipt_categories))])];}
export function lastSupplierReceiptCategories(rows:{batch_id:string;supplier_name:string;receipt_date?:string|null;uploaded_at?:string;record_state:string;edit_revision:number;receipt_categories?:string[]}[],supplier:string,exclude:string){
 return receiptCategories([...rows].filter(r=>r.batch_id!==exclude&&r.record_state==='LIVE'&&r.edit_revision>0&&r.supplier_name.trim()===supplier.trim()&&receiptCategories(r.receipt_categories).length>0).sort((a,b)=>(b.receipt_date||'').localeCompare(a.receipt_date||'')||(b.uploaded_at||'').localeCompare(a.uploaded_at||''))[0]?.receipt_categories);
}
export function matchesReceiptCategory(categories:unknown,filter:string){const values=receiptCategories(categories);return !filter||(filter==='__uncategorized'?values.length===0:values.includes(filter));}
