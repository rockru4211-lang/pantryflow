export type AdministrativeRow = {id:string;name:string;category:string;summary:string;link:string;note:string;archived:boolean;revision:number};
export const ADMIN_CATEGORIES = ['公司與門市','合約文件','設備資料','常用連結','其他'];
export function safeAdministrativeLink(value:string){try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)?url.href:null;}catch{return null;}}
export function administrativeName(value:string){return value.trim().normalize('NFKC').toLocaleLowerCase();}
export function validateAdministrativeRows(rows:AdministrativeRow[]){
 if(rows.length>500)return '一次最多儲存 500 筆，請分批處理。';
 for(const row of rows){
  if(!row.name.trim()||row.name.trim().length>160)return '請填寫資料名稱（最多 160 字），其他資料可後補。';
  if(row.category.length>80||row.summary.length>8000||row.note.length>8000)return `「${row.name}」的分類或文字過長。`;
  if(row.link.length>2000||(row.link&&!safeAdministrativeLink(row.link)))return `「${row.name}」請使用完整的 http 或 https 連結。`;
 }
 return '';
}
export function prepareAdministrativeImport(values:Record<string,unknown>[],existing:AdministrativeRow[],makeId:()=>string){
 const names=new Set(existing.map(row=>administrativeName(row.name)));const rows:AdministrativeRow[]=[];let skipped=0;
 for(const value of values){
  const name=String(value['資料名稱']??'').trim();
  if(!name||names.has(administrativeName(name))){skipped++;continue;}
  names.add(administrativeName(name));
  rows.push({id:makeId(),name,category:String(value['分類']??''),summary:String(value['內容摘要']??''),link:String(value['附件／連結']??value['連結']??''),note:String(value['備註']??''),archived:false,revision:0});
 }
 return {rows,skipped};
}
