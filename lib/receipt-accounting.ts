export type AccountAmounts = {net:number|null;tax:number|null;total:number|null};
export type ReceiptAccount = AccountAmounts & {
 batch_id:string;batch_number:string|null;receipt_date:string|null;work_date:string;uploaded_at:string;
 supplier_name:string;document_number:string|null;products:string|null;line_count:number;line_net:number|null;pages:number;
 source_net:number|null;source_tax:number|null;source_total:number|null;amount_override:AccountAmounts|null;
 note:string;revision:number;source_fingerprint:string;checked_at:string|null;pending:boolean;amount_conflict:boolean;
 receipt_status?:string;
 status:'CHECKED'|'UNCHECKED'|'RECHECK'|'PENDING'|'MISSING';record_state:'LIVE'|'TEST'|'REMOVED';can_edit:boolean;
};
export type AccountLine = {batch_id:string;category?:string;status:string;issues?:string[];document_issues?:string[]};
export type AccountFilters = {batchId?:string;from:string;to:string;supplier:string;supplierNames:string[];query:string;category:string;scope:string};
export const accountStatusLabels:Record<ReceiptAccount['status'],string>={CHECKED:'已對帳',UNCHECKED:'待對帳',RECHECK:'需重新對帳',PENDING:'待建檔',MISSING:'待補資料'};
export const accountMoney=(value:number|null)=>value===null?'待確認':`NT$ ${value.toLocaleString('zh-TW',{maximumFractionDigits:4})}`;
export function accountDate(value:string|null){
 const match=value?.trim().match(/^(?:民國)?(\d{3,4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/);
 if(!match)return '';
 const year=Number(match[1])+(match[1].length===3?1911:0),month=Number(match[2]),day=Number(match[3]);
 const d=new Date(Date.UTC(year,month-1,day));
 return year>=1900&&d.getUTCFullYear()===year&&d.getUTCMonth()===month-1&&d.getUTCDate()===day?`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`:'';
}
const supplierKey=(value:string)=>value.normalize('NFKC').replace(/\s+/g,'').toLocaleLowerCase();
export function filterReceiptAccounts(accounts:ReceiptAccount[],lines:AccountLine[],filters:AccountFilters,status='ALL'){
 const byBatch=new Map<string,AccountLine[]>();for(const line of lines){const group=byBatch.get(line.batch_id)||[];group.push(line);byBatch.set(line.batch_id,group);}
 const record=filters.scope==='TEST'?'TEST':filters.scope==='REMOVED'?'REMOVED':'LIVE';
 const unique=new Map(accounts.map(a=>[a.batch_id,a]));
 return [...unique.values()].filter(a=>{
  if(a.record_state!==record||status!=='ALL'&&a.status!==status||filters.batchId&&a.batch_id!==filters.batchId)return false;
  const date=accountDate(a.receipt_date);
  // Missing arrival dates remain visible as exceptions, never fabricated upload dates.
  if(date&&(filters.from&&date<filters.from||filters.to&&date>filters.to))return false;
  if(filters.supplier==='__SUPPLIER__'&&!filters.supplierNames.some(n=>supplierKey(n)===supplierKey(a.supplier_name)))return false;
  if(!['ALL','__SUPPLIER__'].includes(filters.supplier)&&a.supplier_name!==filters.supplier)return false;
  const rows=byBatch.get(a.batch_id)||(a as ReceiptAccount&{lines?:{category?:string}[]}).lines?.map(l=>({batch_id:a.batch_id,category:l.category,status:a.receipt_status==='COMPLETED'?'COMPLETE':'PENDING',issues:[],document_issues:[]}))||[];
  if(filters.category!=='ALL'&&!rows.some(r=>(r.category||'待分類')===filters.category))return false;
  if(filters.scope==='COMPLETE'&&!rows.some(r=>r.status==='COMPLETE'))return false;
  if(filters.scope==='UNCONFIRMED'&&rows.length>0&&rows.every(r=>r.status==='COMPLETE'))return false;
  if(filters.scope==='ACTION'&&!rows.some(r=>(r.issues?.length||0)+(r.document_issues?.length||0)>0))return false;
  const q=filters.query.trim().toLocaleLowerCase();
  return !q||[a.supplier_name,a.document_number,a.batch_number,a.receipt_date,a.products].some(v=>v?.toLocaleLowerCase().includes(q));
 }).sort((a,b)=>Number(!a.supplier_name)-Number(!b.supplier_name)||a.supplier_name.localeCompare(b.supplier_name,'zh-Hant')||accountDate(b.receipt_date).localeCompare(accountDate(a.receipt_date))||a.batch_id.localeCompare(b.batch_id));
}
export function accountSummary(accounts:ReceiptAccount[]){
 const rows=[...new Map(accounts.map(a=>[a.batch_id,a])).values()];
 const field=(name:keyof AccountAmounts)=>{const known=rows.filter(a=>!a.pending&&!a.amount_conflict&&a.status!=='RECHECK'&&a[name]!==null);return {value:Math.round(known.reduce((s,a)=>s+(a[name]??0),0)*10000)/10000,missing:rows.length-known.length};};
 return {count:rows.length,checked:rows.filter(a=>a.status==='CHECKED').length,pending:rows.filter(a=>a.pending).length,net:field('net'),tax:field('tax'),total:field('total')};
}
export function parseAccountInput(value:string):number|null{
 if(!value.trim())return null;
 if(!/^-?\d+(?:\.\d{1,4})?$/.test(value.trim()))throw Error('請輸入有效金額，最多四位小數。');
 const n=Number(value);if(!Number.isFinite(n)||Math.abs(n)>=1e9)throw Error('金額超出可輸入範圍。');return n;
}
export function accountPayload(row:ReceiptAccount,amounts:AccountAmounts|null,note:string,checked:boolean){
 if(note.length>2000)throw Error('備註最多 2000 字。');
 const v=amounts||{net:row.source_net,tax:row.source_tax,total:row.source_total};
 const total=v.total??(v.net!==null&&v.tax!==null?v.net+v.tax:null);
 if(checked&&(row.pending||!row.supplier_name||!accountDate(row.receipt_date)||v.net===null||v.tax===null||total===null||Math.abs(v.net+v.tax-total)>0.010001||!amounts&&row.line_net!==null&&Math.abs(v.net-row.line_net)>1))throw Error('請先確認日期、供應商及未稅／稅額／含稅金額，再完成對帳。');
 return {revision:row.revision,source_fingerprint:row.source_fingerprint,amount_override:amounts,note,checked};
}
export function accountExportRows(rows:ReceiptAccount[]){return rows.map(a=>({'到貨日期':accountDate(a.receipt_date)||'日期待確認','供應商':a.supplier_name||'供應商待確認','貨單號碼':a.document_number||'未提供','系統編號':a.batch_number||a.batch_id,'未稅金額':a.net??'待確認','稅額':a.tax??'待確認','含稅金額':a.total??'待確認','狀態':accountStatusLabels[a.status],'金額來源':a.amount_override?'行政確認（對帳）':'貨單資料','對帳時間':a.checked_at||'','備註':a.note}));}
export function accountingError(e:unknown){const message=e&&typeof e==='object'&&'message' in e?String(e.message):String(e);if(/REVISION_CONFLICT/.test(message))return '資料已更新。請先關閉此視窗重新讀取，再核對最新金額。';if(/RECEIPT_ACCOUNT_INCOMPLETE/.test(message))return '資料尚未完整或金額不一致，無法完成對帳。';if(/REQUIRED|DENIED|FORBIDDEN|READ_ONLY|NOT_LIVE|42501/.test(message))return '此身分或資料狀態不能修改此貨單。';return '儲存未完成，輸入仍保留，請重試。';}
