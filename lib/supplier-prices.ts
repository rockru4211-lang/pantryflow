export type SupplierProfile={id:string;name:string;supplier_code?:string;contact_name?:string|null;phone?:string|null;delivery_note?:string|null;order_method?:string|null;order_url?:string|null;cutoff_time?:string|null;order_note?:string|null;aliases?:string[];is_active:boolean;updated_at:string};
export type SupplierProduct={id:string;name:string;specification:string|null;base_unit:string;current_supplier_id:string|null;is_active:boolean;primary_category?:string;category_revision?:number};
export type SupplierReceiptLine={batch_id:string;row_key:string;product_id:string|null;product_name:string;source_product?:string;supplier_name:string;specification:string;unit:string;unit_price:number|null;quantity:number|null;receipt_date:string|null;uploaded_at:string;status:string;review_allowed:boolean;source_kind?:string};
export const supplierNameKey=(value:string)=>value.normalize('NFKC').trim().replace(/\s+/g,'').toLocaleLowerCase();
export function supplierMatches(supplier:SupplierProfile,name:string){return [supplier.name,...(supplier.aliases||[])].some(n=>supplierNameKey(n)===supplierNameKey(name));}
export function supplierForLine(suppliers:SupplierProfile[],line:SupplierReceiptLine){const matches=suppliers.filter(s=>supplierMatches(s,line.supplier_name));return matches.length===1?matches[0]:undefined;}
export function safeSupplierLink(value:string|undefined|null){try{const url=new URL(value||'');return url.protocol==='https:'||url.protocol==='http:'?url.href:null;}catch{return null;}}
export function supplierReceiptDate(value:string|null){
 if(!value)return null;
 const match=value.trim().match(/^(?:民國)?(\d{3,4})[年/.-](\d{1,2})[月/.-](\d{1,2})日?$/);if(!match)return null;
 const y=Number(match[1])+(match[1].length===3?1911:0),m=Number(match[2]),d=Number(match[3]);const date=new Date(Date.UTC(y,m-1,d));
 return date.getUTCFullYear()===y&&date.getUTCMonth()===m-1&&date.getUTCDate()===d?`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`:null;
}
export type SupplierPriceItem={key:string;productId:string|null;name:string;specification:string;unit:string;history:SupplierReceiptLine[];latest:number|null;previous:number|null;change:number|null;percent:number|null;pending:number;ambiguous:boolean;category:string;categoryRevision:number};
export function supplierPriceItems(supplier:SupplierProfile,products:SupplierProduct[],lines:SupplierReceiptLine[],suppliers:SupplierProfile[]):SupplierPriceItem[]{
 const groups=new Map<string,SupplierPriceItem>();
 const ensure=(id:string|null,name:string,spec:string,unit:string)=>{const key=JSON.stringify([id||supplierNameKey(name),spec.trim(),unit.trim()]);let item=groups.get(key);if(!item){item={key,productId:id,name,specification:spec,unit,history:[],latest:null,previous:null,change:null,percent:null,pending:0,ambiguous:false,category:products.find(p=>p.id===id)?.primary_category||'待分類',categoryRevision:products.find(p=>p.id===id)?.category_revision||0};groups.set(key,item);}return item;};
 for(const line of lines){if(supplierForLine(suppliers,line)?.id!==supplier.id)continue;ensure(line.product_id,line.product_name,line.specification,line.unit).history.push(line);}
 for(const product of products){if(product.current_supplier_id!==supplier.id||!product.is_active)continue;if([...groups.values()].some(item=>item.productId===product.id))continue;ensure(product.id,product.name,product.specification||'未提供',product.base_unit);}
 for(const item of groups.values()){
  item.history.sort((a,b)=>(supplierReceiptDate(b.receipt_date)||'').localeCompare(supplierReceiptDate(a.receipt_date)||'')||b.uploaded_at.localeCompare(a.uploaded_at)||b.row_key.localeCompare(a.row_key));
  item.pending=item.history.filter(row=>row.status!=='COMPLETE'||!row.product_id||row.unit_price===null||!row.unit||row.unit==='未提供'||!supplierReceiptDate(row.receipt_date)).length;
  const batches=new Map<string,number[]>();
  for(const row of item.history){if(row.status!=='COMPLETE'||!row.product_id||row.unit_price===null||!Number.isFinite(Number(row.unit_price))||Number(row.unit_price)<0||!row.unit||row.unit==='未提供'||!supplierReceiptDate(row.receipt_date))continue;const prices=batches.get(row.batch_id)||[];prices.push(Number(row.unit_price));batches.set(row.batch_id,prices);}
  const snapshots=[...batches.values()];const price=(values:number[]|undefined)=>values&&new Set(values).size===1?values[0]:null;
  item.ambiguous=!!snapshots[0]&&new Set(snapshots[0]).size>1;
  item.latest=price(snapshots[0]);item.previous=price(snapshots[1]);
  if(item.latest!==null&&item.previous!==null){item.change=Math.round((item.latest-item.previous)*10000)/10000;item.percent=item.previous===0?null:Math.round(item.change/item.previous*1000)/10;}
 }
 return [...groups.values()].sort((a,b)=>a.name.localeCompare(b.name,'zh-Hant'));
}
