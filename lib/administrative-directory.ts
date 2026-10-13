export type AdministrativeRow = {id:string;name:string;category:string;summary:string;link:string;note:string;archived:boolean;is_removed?:boolean;revision:number;contract_start?:string|null;contract_end?:string|null;repair_date?:string|null;repair_reason?:string;repair_result?:string;notified_at?:string|null};
export const ADMIN_CATEGORIES = ['公司與門市','合約文件','設備資料','常用連結','其他'];
export function safeAdministrativeLink(value:string){try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)?url.href:null;}catch{return null;}}
export function administrativeName(value:string){return value.trim().normalize('NFKC').toLocaleLowerCase();}
export type EquipmentContact = {service:string;contact:string;phone:string;method:string;details:string};
const equipmentLabels:Record<string,keyof EquipmentContact>={'服務事項':'service','聯絡人':'contact','電話':'phone','聯絡方式':'method','補充說明':'details'};
// Keep existing summaries compatible with the save RPC and preserve unlabelled history.
export function equipmentContact(summary:string):EquipmentContact{
 const result:EquipmentContact={service:'',contact:'',phone:'',method:'',details:''};
 let current:keyof EquipmentContact='details';
 for(const line of summary.split('\n')){
  const match=line.match(/^(服務事項|聯絡人|電話|聯絡方式|補充說明)[：:]\s?(.*)$/);
  if(match){current=equipmentLabels[match[1]];result[current]+=(result[current]?'\n':'')+match[2];}
  else result[current]+=(result[current]?'\n':'')+line;
 }
 return result;
}
export function updateEquipmentContact(summary:string,key:keyof EquipmentContact,value:string){
 const parts={...equipmentContact(summary),[key]:value};
 return Object.entries(equipmentLabels).filter(([,key])=>parts[key]).map(([label,key])=>`${label}：${parts[key]}`).join('\n');
}
export function validateAdministrativeRows(rows:AdministrativeRow[]){
 if(rows.length>500)return '一次最多儲存 500 筆，請分批處理。';
 for(const row of rows){
  if(!row.name.trim()||row.name.trim().length>160)return '請填寫資料名稱（最多 160 字），其他資料可後補。';
  if(row.category.length>80||row.summary.length>8000||row.note.length>8000)return `「${row.name}」的分類或文字過長。`;
  if(row.contract_start&&row.contract_end&&row.contract_start>row.contract_end)return `「${row.name}」的到期日不可早於起始日。`;
  if((row.repair_reason?.length||0)>8000||(row.repair_result?.length||0)>8000)return `「${row.name}」的維修文字過長。`;
  if(row.link.length>2000||(row.link&&!safeAdministrativeLink(row.link)))return `「${row.name}」請使用完整的 http 或 https 連結。`;
 }
 return '';
}
export function prepareAdministrativeImport(values:Record<string,unknown>[],existing:AdministrativeRow[],makeId:()=>string){
 const identity=(r:{name:string;category:string;repair_date?:string|null;repair_reason?:string;repair_result?:string})=>r.category==='維修紀錄'?[administrativeName(r.name),r.category,r.repair_date||'',r.repair_reason||'',r.repair_result||''].join('\u001f'):administrativeName(r.name);
 const names=new Set(existing.map(identity));const rows:AdministrativeRow[]=[];let skipped=0;
 for(const value of values){
  const name=String(value['資料名稱']??'').trim();
  const key=identity({name,category:String(value['分類']??''),repair_date:String(value['維修日期']??''),repair_reason:String(value['維修原因']??''),repair_result:String(value['處理結果']??'')});
  if(!name||names.has(key)||value['狀態']==='已移除'){skipped++;continue;}
  names.add(key);
  let summary=String(value['內容摘要']??'');
  for(const [label,key] of Object.entries(equipmentLabels))if(Object.hasOwn(value,label))summary=updateEquipmentContact(summary,key,String(value[label]??''));
  if(Object.hasOwn(value,'維修廠商')){const vendor=String(value['維修廠商']??'').trim();summary=summary.split('\n').filter(line=>!/^維修廠商：/.test(line)).join('\n');if(vendor)summary=`維修廠商：${vendor}${summary?'\n'+summary:''}`;}
  rows.push({id:makeId(),name,category:String(value['分類']??''),contract_start:String(value['合約起日']??'')||null,contract_end:String(value['合約到期日']??'')||null,repair_date:String(value['維修日期']??'')||null,repair_reason:String(value['維修原因']??''),repair_result:String(value['處理結果']??''),summary,link:String(value['附件／連結']??value['連結']??''),note:String(value['備註']??''),archived:['已停用','已封存'].includes(String(value['狀態']??'')),revision:0});
 }
 return {rows,skipped};
}

export function administrativeSection(category:string):'equipment'|'contracts'|undefined {if(/設備|維修|報修|保養/.test(category))return 'equipment';if(/合約|合同|契約/.test(category))return 'contracts';}

export function contractReminderDate(end:string){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(end))return '';
 const [year,month,day]=end.split('-').map(Number);
 const date=new Date(Date.UTC(year,month-4,1));
 date.setUTCDate(Math.min(day,new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).getUTCDate()));
 return date.toISOString().slice(0,10);
}
export function contractDue(row:AdministrativeRow,today=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Taipei'})){
 return !row.is_removed&&!row.archived&&administrativeSection(row.category)==='contracts'&&!!row.contract_end&&contractReminderDate(row.contract_end)<=today;
}

// Group history by its repair date; missing dates stay accessible without inventing a year.
export function repairYear(row:Pick<AdministrativeRow,'repair_date'>){return row.repair_date?.match(/^(\d{4})-\d{2}-\d{2}$/)?.[1]||'undated';}
