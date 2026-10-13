import type {AdministrativeRow} from './administrative-directory';
export function repairReported(row:Pick<AdministrativeRow,'repair_result'>){return /^已完成維修(?:\n|$)/.test(row.repair_result||'');}
export function completedRepair(row:AdministrativeRow):AdministrativeRow{
 return {...row,name:row.name.trim(),category:'維修紀錄',repair_reason:row.repair_reason?.trim()||'',repair_result:repairReported(row)?row.repair_result:['已完成維修',row.repair_result?.trim()].filter(Boolean).join('\n')};
}

export function repairCompletedDate(row:Pick<AdministrativeRow,'summary'>){return row.summary.match(/^完成日期：(\d{4}-\d{2}-\d{2})$/m)?.[1]||'';}
export function finishRepair(row:AdministrativeRow,today=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Taipei'})){
 const completed=completedRepair(row);
 return {...completed,summary:repairCompletedDate(row)?row.summary:[row.summary,`完成日期：${today}`].filter(Boolean).join('\n')};
}
