import {historicalRepair} from './repair-history.ts';
import type {AdministrativeRow} from './administrative-directory.ts';
import type {RepairJob,RepairStatus} from './equipment-workflow.ts';
import {repairVendor,withRepairVendor} from './equipment-selection.ts';
import {repairReported,repairCompletedDate} from './mobile-repair.ts';
export type RecordStatus=RepairStatus|'HISTORY';
export const recordStates={PENDING:'待處理',QUOTE:'等待報價',OTHER:'其他未完成',DONE:'已完成',HISTORY:'未註明'} as const;
export type EquipmentRecord={id:string;name:string;date:string;vendor:string;problem:string;result:string;status:RecordStatus;completed:string;job?:RepairJob;legacy?:AdministrativeRow};
export function equipmentRecords(jobs:RepairJob[],docs:AdministrativeRow[]):EquipmentRecord[]{
 const ids=new Set(jobs.map(j=>j.id));
 return [...jobs.map(job=>({id:job.id,name:job.name,date:new Date(job.created_at).toLocaleDateString('sv-SE',{timeZone:'Asia/Taipei'}),vendor:job.vendor,problem:job.problem,result:job.last_report,status:job.status,completed:job.status==='DONE'?job.report_date||'':'',job})),...docs.filter(r=>r.category==='維修紀錄'&&!r.archived&&!r.is_removed&&!ids.has(r.id)).map(legacy=>{
 const explicit=legacy.summary.match(/^維修狀態：(PENDING|QUOTE|OTHER|DONE)$/m)?.[1] as RepairStatus|undefined;
 return {id:legacy.id,name:legacy.name,date:legacy.repair_date||'',vendor:repairVendor(legacy.summary),problem:legacy.repair_reason||'',result:(legacy.repair_result||'').replace(/^已完成維修\n?/,''),status:repairReported(legacy)?'DONE' as const:explicit||'HISTORY' as const,completed:repairCompletedDate(legacy),legacy};
 })].sort((a,b)=>b.date.localeCompare(a.date));
}
export function recordOnlyRepair(record:EquipmentRecord){return historicalRepair(record.date);}
export function saveLegacyRepair(row:AdministrativeRow,values:{name:string;vendor:string;problem:string;result:string;status:RecordStatus;date:string;completed:string}):AdministrativeRow{
 const summary=row.summary.split('\n').filter(line=>!/^維修狀態：/.test(line)&&!/^完成日期：/.test(line)).join('\n');
 return {...row,name:values.name,repair_date:values.date||null,repair_reason:values.problem,repair_result:values.status==='DONE'?['已完成維修',values.result].filter(Boolean).join('\n'):values.result,summary:[withRepairVendor(summary,values.vendor),values.status!=='HISTORY'?`維修狀態：${values.status}`:'',values.completed?`完成日期：${values.completed}`:''].filter(Boolean).join('\n')};
}
