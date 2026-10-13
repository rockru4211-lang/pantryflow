import {administrativeName,administrativeSection,equipmentContact,type AdministrativeRow} from './administrative-directory.ts';

export function repairVendor(summary:string){return summary.match(/^(?:維修廠商|維修／設備廠商)[：:][ \t]*(.*)$/m)?.[1]?.trim()||'';}
export function withRepairVendor(summary:string,vendor:string){
 const rest=summary.split('\n').filter(line=>!/^(?:維修廠商|維修／設備廠商)[：:]/.test(line)).join('\n');
 return vendor.trim()?`維修廠商：${vendor.trim()}${rest?'\n'+rest:''}`:rest;
}
export function equipmentChoices(rows:AdministrativeRow[]){
 const equipment=rows.filter(r=>administrativeSection(r.category)==='equipment');
 const blocked=new Set(equipment.filter(r=>r.category!=='維修紀錄'&&(r.archived||r.is_removed)).map(r=>administrativeName(r.name)));
 const active=equipment.filter(r=>!r.archived&&!r.is_removed);
 const unique=(values:string[])=>[...new Map(values.map(v=>v.trim()).filter(v=>v&&!blocked.has(administrativeName(v))).map(v=>[administrativeName(v),v])).values()].sort((a,b)=>a.localeCompare(b,'zh-Hant'));
 return {names:unique(active.filter(r=>r.category==='維修紀錄'||!equipmentContact(r.summary).service).map(r=>r.name)),vendors:unique(active.flatMap(r=>r.category==='維修紀錄'?[repairVendor(r.summary)]:[r.name])),directoryNames:unique(active.filter(r=>r.category!=='維修紀錄').map(r=>r.name))};
}
export function selectRepairEquipment(row:AdministrativeRow,name:string,rows:AdministrativeRow[]){
 const current=repairVendor(row.summary);
 const last=rows.filter(r=>r.id!==row.id&&r.category==='維修紀錄'&&!r.archived&&!r.is_removed&&administrativeName(r.name)===administrativeName(name)&&repairVendor(r.summary)).sort((a,b)=>(b.repair_date||'').localeCompare(a.repair_date||''))[0];
 const matches=rows.filter(r=>r.category!=='維修紀錄'&&administrativeSection(r.category)==='equipment'&&!r.archived&&!r.is_removed&&equipmentContact(r.summary).service.split(/[／/、,，;；\n]+/).some(service=>administrativeName(service)===administrativeName(name)));
 const vendor=matches.length===1?matches[0].name:matches.length>1?'':last?repairVendor(last.summary):'';
 const disabled=rows.some(r=>r.category!=='維修紀錄'&&(r.archived||r.is_removed)&&administrativeName(r.name)===administrativeName(vendor));
 return {...row,name,summary:!current&&vendor&&!disabled?withRepairVendor(row.summary,vendor):row.summary};
}
