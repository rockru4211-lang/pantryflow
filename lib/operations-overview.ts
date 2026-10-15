import {repairStates,type RepairJob} from './equipment-workflow.ts';
import {historicalRepair,repairCreatedDate} from './repair-history.ts';
import {purchaseStates,type PurchaseNote} from './purchase-notes.ts';
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

export type OverviewTask={id:string;name:string;detail:string;status:string;view:'equipment'|'purchase-notes'|'incidents';taskKind:'repair'|'purchase';priority:number;order?:string};
export function overviewTasks(jobs:RepairJob[],purchases:PurchaseNote[],incidents:{id:string;category:string|null;status:string;title:string;created_at:string}[]=[],today=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Taipei'})):OverviewTask[]{
 const priority=(date:string|undefined,waiting:boolean)=>date&&date<today?0:waiting?2:1;
 const repairs:OverviewTask[]=jobs.filter(j=>j.status!=='DONE'&&!historicalRepair(repairCreatedDate(j.created_at))).map(j=>{
  const date=j.scheduled_at?repairCreatedDate(j.scheduled_at):undefined;
  return {id:`repair:${j.id}`,name:j.name,detail:date||'尚未安排',status:repairStates[j.status]+(j.last_report?`・${j.last_report}`:''),view:'equipment',taskKind:'repair',priority:priority(date,j.status==='QUOTE'),order:date};
 });
 const orders:OverviewTask[]=purchases.filter(p=>p.status==='PENDING'||p.status==='SENT').map(p=>{
  const date=p.arrival_date||p.desired_date||undefined;
  return {id:`purchase:${p.id}`,name:p.name,detail:date||'日期未定',status:purchaseStates[p.status],view:'purchase-notes',taskKind:'purchase',priority:priority(date,p.status==='SENT'),order:date};
 });
 const reports:OverviewTask[]=incidents.filter(r=>r.category==='設備'&&(r.status==='OPEN'||r.status==='IN_PROGRESS')).map(r=>({id:`incident:${r.id}`,name:r.title,detail:'尚未安排',status:r.status==='IN_PROGRESS'?'處理中':'待處理',view:'incidents',taskKind:'repair',priority:1}));
 return [...repairs,...orders,...reports];
}
