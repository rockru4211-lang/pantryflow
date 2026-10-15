import {historicalRepair,repairCreatedDate} from './repair-history.ts';
import type {WorkEntry} from './workflow-rules';
export const repairStates={PENDING:'待維修',QUOTE:'等待報價',OTHER:'處理中',DONE:'已完成'} as const;
export type RepairStatus=keyof typeof repairStates;
export type RepairEvent={id:string;job_id:string;action:'create'|'plan'|'report';status:RepairStatus;body:string;reported_on:string|null;actor_name:string;created_at:string};
export type RepairJob={id:string;store_id:string;name:string;problem:string;vendor:string;scheduled_at:string|null;status:RepairStatus;last_report:string;report_date:string|null;reporter_name:string;revision:number;created_at:string;updated_at:string;events:RepairEvent[]};
export type RepairData={jobs:RepairJob[]};
export function repairWorkEntries(jobs:RepairJob[]):WorkEntry[]{return jobs.flatMap(j=>[
 ...(!historicalRepair(repairCreatedDate(j.created_at))&&j.status!=='DONE'?[{key:`equipment-task:${j.id}`,id:j.id,category:'equipment',title:j.name,copy:repairStates[j.status]+(j.last_report?`・${j.last_report}`:''),at:j.updated_at,pending:true,target:'equipment'}]:[]),
 ...j.events.map(e=>({key:`equipment-event:${e.id}`,id:j.id,category:'equipment',title:`${j.name}・${e.action==='create'?'新增維修':e.action==='plan'?'安排維修':repairStates[e.status]}`,copy:`${e.body}・${e.actor_name}`,at:e.created_at,pending:false,target:'equipment'}))
]);}
export function repairYearOf(job:RepairJob){return (job.report_date||job.updated_at).slice(0,4);}
export function repairDateTime(value:string|null){return value?new Date(value).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false,month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'時間待確認';}
export function repairLocalTime(value:string|null){if(!value)return '';const date=new Date(Date.parse(value)+8*3600000);return date.toISOString().slice(0,16);}
