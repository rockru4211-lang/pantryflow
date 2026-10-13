import {priceCandidate,type PriceSheetData} from './ingredient-price-sheet.ts';
import {contractDue,type AdministrativeRow} from './administrative-directory.ts';
import type {ReceiptInboxRow} from './receipt-supplier-inbox.ts';
export function pendingOverviewReceipts(rows:ReceiptInboxRow[],flags:{entity_id:string;state:string}[]){
 const hidden=new Set(flags.filter(f=>f.state!=='LIVE').map(f=>f.entity_id));
 return rows.filter((r,i)=>!hidden.has(r.batch_id)&&!r.review_complete&&!r.has_goods_receipt&&r.state!=='COMPLETE'&&rows.findIndex(x=>x.batch_id===r.batch_id)===i);
}
export function overviewPriceRises(data:PriceSheetData){
 return data.ingredients.flatMap(row=>{const candidate=priceCandidate(row,data.supply_states);const old=Number(row.cost_price),next=Number(candidate?.price);return row.cost_price!==null&&old>0&&candidate?.price!=null&&Number.isFinite(next)&&next>old?[{id:row.id,name:row.name,unit:row.unit,old,next,percent:(next-old)/old*100}]:[];}).sort((a,b)=>b.percent-a.percent);
}
export function overviewContracts(rows:AdministrativeRow[],today=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Taipei'})){
 return rows.filter(r=>contractDue(r,today)).sort((a,b)=>a.contract_end!.localeCompare(b.contract_end!)).map(r=>({...r,days:Math.round((Date.parse(r.contract_end!)-Date.parse(today))/86400000)}));
}

export const OVERVIEW_LIMIT=5;
// Compare after merging stores so one store cannot crowd out higher-priority work.
export function prioritizeOverviewRows<T extends {id:string;storeId:string;priority?:number;order?:string}>(rows:T[]):T[]{
 return [...rows].sort((a,b)=>(a.priority??0)-(b.priority??0)||
  (a.order||'9999').localeCompare(b.order||'9999')||a.storeId.localeCompare(b.storeId)||a.id.localeCompare(b.id));
}
