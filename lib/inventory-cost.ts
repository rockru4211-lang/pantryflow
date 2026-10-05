import type {InventoryMonth,InventoryRow,InventoryReceiptLine} from './inventory-monthly.ts';
import {accountDate} from './receipt-accounting.ts';
import {isFreightName,receiptHandling,type ReviewAccount} from './receipt-review.ts';

export type InventoryCostCandidate={row_key:string;name:string;unit:string;old_price:number|null;price:number;date:string;supplier:string;batch_id:string;line_key:string;receipt_unit:string;receipt_price:number;fingerprint:string};
const marker=/\n?〔庫存進價：[^\n]*〕/g;
export function withoutInventoryCostSource(note:string){return note.replace(marker,'').trim();}
export function inventoryPriceSource(row:InventoryRow){
 if(row.unit_price==null)return '待補成本';
 return row.review_note?.match(/〔庫存進價：([^\n]*)〕/)?.[1]||(row.reviewed_by?'行政設定（本月）':'盤點保存單價');
}
function unitMeasure(value:string):{dimension:string;factor:number}{
 const u=value.normalize('NFKC').trim().toLowerCase();
 if(['kg','公斤','千克'].includes(u))return {dimension:'mass',factor:1000};
 if(['g','公克','克'].includes(u))return {dimension:'mass',factor:1};
 if(['l','公升','升'].includes(u))return {dimension:'volume',factor:1000};
 if(['ml','毫升','毫公升','cc'].includes(u))return {dimension:'volume',factor:1};
 return {dimension:u?`each:${u}`:'',factor:1};
}
export function inventoryCostRatio(from:string,to:string){const a=unitMeasure(from),b=unitMeasure(to);return a.dimension&&a.dimension===b.dimension?b.factor/a.factor:null;}
export function inventoryMonthEnd(month:string){const [y,m]=month.slice(0,7).split('-').map(Number);return `${y}-${String(m).padStart(2,'0')}-${new Date(Date.UTC(y,m,0)).getUTCDate()}`;}
export function inventoryAccountVerified(a:ReviewAccount){return a.record_state==='LIVE'&&!a.pending&&!a.source_changed&&!a.amount_conflict&&a.status!=='RECHECK'&&!!(a.reviewed||a.status==='CHECKED'||a.receipt_status==='COMPLETED'&&!a.edit_revision);}
export function inventoryAccountLines(accounts:ReviewAccount[]):InventoryReceiptLine[]{return accounts.filter(a=>a.record_state==='LIVE').flatMap(a=>a.lines.filter(l=>receiptHandling(l)==='NORMAL'&&!isFreightName(l.product_name)).map(l=>({batch_id:a.batch_id,row_key:l.row_key,product_id:l.product_id||null,unit:l.unit,quantity:l.quantity,status:inventoryAccountVerified(a)?'COMPLETE':'PENDING',receipt_date:a.receipt_date})));}
/** Use confirmed identities, never fuzzy names. Prices are snapshots, not live replacements. */
export function inventoryCostCandidates(rows:InventoryRow[],accounts:ReviewAccount[],month:string):InventoryCostCandidate[]{
 const end=inventoryMonthEnd(month),candidates:InventoryCostCandidate[]=[];
 const unique=new Map(accounts.map(a=>[a.batch_id,a]));
 for(const row of rows){
  if(!row.product_id||row.current_quantity==null||row.correction_conflict)continue;
  const matches:InventoryCostCandidate[]=[];
  for(const a of unique.values()){
   const date=accountDate(a.receipt_date);
   if(!date||date>end||!inventoryAccountVerified(a))continue;
   const seen=new Set<string>();
   for(const l of a.lines){
    if(seen.has(l.row_key))continue;seen.add(l.row_key);
    if(l.product_id!==row.product_id||receiptHandling(l)!=='NORMAL'||isFreightName(l.product_name)||l.quantity==null||!Number.isFinite(l.quantity)||l.quantity<=0||l.unit_price==null||!Number.isFinite(l.unit_price)||l.unit_price<0)continue;
    const ratio=inventoryCostRatio(l.unit,row.unit);if(ratio===null)continue;
    const price=Number((l.unit_price*ratio).toFixed(6));if(price>=1e9)continue;
    matches.push({row_key:row.row_key,name:row.name,unit:row.unit,old_price:row.unit_price,price,date,supplier:a.supplier_name,batch_id:a.batch_id,line_key:l.row_key,receipt_unit:l.unit,receipt_price:l.unit_price,fingerprint:a.source_fingerprint});
   }
  }
  matches.sort((a,b)=>b.date.localeCompare(a.date)||a.batch_id.localeCompare(b.batch_id)||a.line_key.localeCompare(b.line_key));
  const latest=matches[0];
  // Different prices on the latest date need manual selection, not an arbitrary winner.
  if(latest&&!matches.some(c=>c.date===latest.date&&c.price!==latest.price)&&latest.price!==row.unit_price)candidates.push(latest);
 }
 return candidates;
}
export function inventoryCostNote(row:InventoryRow,candidate:InventoryCostCandidate){
 const supplier=candidate.supplier.replace(/[\n\r〔〕]/g,' ');
 const label=`〔庫存進價：${candidate.date}・${supplier}・未稅 ${candidate.receipt_price}/${candidate.receipt_unit} → ${candidate.price}/${candidate.unit}・貨單 ${candidate.batch_id}/${candidate.line_key}〕`;
 const note=[withoutInventoryCostSource(row.review_note||''),label].filter(Boolean).join('\n');
 if(note.length>2000)throw Error('INVENTORY_COST_NOTE_TOO_LONG');
 return note;
}
export function sameInventoryCost(a:InventoryCostCandidate,b:InventoryCostCandidate){return a.row_key===b.row_key&&a.old_price===b.old_price&&a.price===b.price&&a.batch_id===b.batch_id&&a.line_key===b.line_key&&a.fingerprint===b.fingerprint&&a.date===b.date;}
/** Each existing RPC is revision-checked and audited. Stop on the first uncertain write; never retry. */
export async function applyInventoryCosts(state:InventoryMonth,candidates:InventoryCostCandidate[],write:(data:Record<string,string|number|boolean|null>)=>Promise<InventoryMonth>,onSaved:(state:InventoryMonth,count:number)=>void){
 if(state.closed||state.historical||!state.source_id)throw Error('INVENTORY_MONTH_CLOSED');
 let current=state,count=0;
 for(const c of candidates){
  const row=current.rows.find(r=>r.row_key===c.row_key);
  if(!row||row.unit_price!==c.old_price||row.current_quantity==null)throw Error('INVENTORY_REVISION_CHANGED');
  current=await write({session_id:current.source_id,revision:current.revision,row_key:c.row_key,unit_price:c.price,acknowledged:row.acknowledged,note:inventoryCostNote(row,c)});
  count++;onSaved(current,count);
 }
 return current;
}
