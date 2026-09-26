export type ReceiptInboxState='FILE_MISSING'|'OCR_FAILED'|'PROCESSING'|'NEEDS_REVIEW'|'COMPLETE'|'RECEIVED';
export type ReceiptInboxRow={
 batch_id:string;batch_number:string;uploaded_at:string;work_date:string;status:string;
 page_count:number;stored_page_count:number;job_status:string|null;run_status:string|null;attempt_count:number;
 last_error:string|null;supplier_name:string;raw_supplier_name?:string;supplier_id?:string|null;receipt_date:string;
 line_count:number;complete_line_count:number;review_complete:boolean;has_goods_receipt:boolean;state:ReceiptInboxState;
};
export const inboxNameKey=(value:string)=>value.normalize('NFKC').trim().replace(/\s+/g,'').toLocaleLowerCase();
export type ReceiptSupplierGroup={key:string;name:string;supplierId:string|null;names:string[];rows:ReceiptInboxRow[]};
export function inboxMonth(row:ReceiptInboxRow){
 const match=(row.receipt_date||'').match(/^(?:民國)?(\d{3,4})[年/.-](\d{1,2})[月/.-](\d{1,2})日?$/);
 if(match){const year=Number(match[1])+(match[1].length===3?1911:0),month=Number(match[2]),day=Number(match[3]);const date=new Date(Date.UTC(year,month-1,day));if(date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day)return `${year}-${String(month).padStart(2,'0')}`;}
 const date=new Date(row.uploaded_at);if(Number.isNaN(date.getTime()))return '';
 return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit'}).format(date);
}
export function groupSupplierInbox(rows:ReceiptInboxRow[],month:string,search=''):ReceiptSupplierGroup[]{
 const groups=new Map<string,ReceiptSupplierGroup>(),seen=new Set<string>();
 for(const row of rows){
  if(seen.has(row.batch_id)||month&&inboxMonth(row)!==month)continue;seen.add(row.batch_id);
  const name=row.supplier_name?.trim()||'尚未識別供應商',key=row.supplier_id||`name:${inboxNameKey(name)}`;
  let group=groups.get(key);if(!group){group={key,name,supplierId:row.supplier_id||null,names:[],rows:[]};groups.set(key,group);}
  group.rows.push(row);const original=row.raw_supplier_name??row.supplier_name;
  if(original&&!group.names.includes(original))group.names.push(original);
 }
 const query=inboxNameKey(search);
 return [...groups.values()].filter(group=>!query||[group.name,...group.names,...group.rows.map(r=>r.batch_number)].some(value=>inboxNameKey(value).includes(query)))
  .sort((a,b)=>a.name.localeCompare(b.name,'zh-Hant')).map(group=>({...group,rows:group.rows.sort((a,b)=>b.uploaded_at.localeCompare(a.uploaded_at))}));
}
export function unresolvedSupplierNames(rows:ReceiptInboxRow[]){
 const groups=new Map<string,{name:string;count:number;batchIds:Set<string>}>();
 for(const row of rows){const name=(row.raw_supplier_name??row.supplier_name)?.trim();
  if(row.supplier_id||!name||name==='未提供'||row.run_status!=='SUCCEEDED'||row.state==='PROCESSING')continue;
  const key=inboxNameKey(name);let group=groups.get(key);if(!group){group={name,count:0,batchIds:new Set()};groups.set(key,group);}
  group.batchIds.add(row.batch_id);group.count=group.batchIds.size;
 }
 return [...groups.values()];
}
export function inboxRecognitionLabel(row:ReceiptInboxRow){
 if(row.state==='FILE_MISSING')return '原圖缺失';if(row.state==='OCR_FAILED')return '辨識失敗';
 if(row.state==='PROCESSING')return '辨識中';if(row.run_status==='SUCCEEDED'||row.state==='COMPLETE')return '辨識完成';return '等待辨識';
}
/** Suggestions only; an approximate match never changes identity without a selection. */
export function suggestInboxSuppliers<T extends {name:string}>(name:string,suppliers:T[]):T[]{
 const key=inboxNameKey(name);return suppliers.filter(s=>{const other=inboxNameKey(s.name);if(key===other)return true;
  if(key.length<3||Math.abs(key.length-other.length)>1)return false;
  let i=0,j=0,difference=0;while(i<key.length&&j<other.length){if(key[i]===other[j]){i++;j++;continue;}if(++difference>1)return false;if(key.length>=other.length)i++;if(other.length>=key.length)j++;}
  return difference+(key.length-i)+(other.length-j)<=1;
 }).slice(0,5);
}
