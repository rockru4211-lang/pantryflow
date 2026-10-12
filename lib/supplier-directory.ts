import {safeSupplierLink,supplierNameKey,type SupplierProfile} from './supplier-prices.ts';
export const supplierFields=[['primary_supplies','主要供應'],['contact_name','聯絡人'],['phone','電話'],['billing_cycle','報帳週期'],['payment_terms','匯款日期／付款條件'],['company_name','公司抬頭'],['tax_id','統一編號'],['address','地址'],['bank_name','銀行／分行'],['bank_account','銀行帳號'],['account_name','戶名'],['order_method','訂貨方式'],['line_id','LINE ID'],['line_group','LINE 群組／社群名稱'],['order_url','LINE／訂貨連結'],['cutoff_time','收單時間'],['delivery_note','配送日／配送說明'],['minimum_order','最低訂購條件'],['order_note','訂貨備註'],['supply_note','品項供貨提醒'],['cooperation_note','合作備註']] as const;
export type DirectoryKey=typeof supplierFields[number][0];
export const officeFields=new Set<DirectoryKey>(['billing_cycle','payment_terms','company_name','tax_id','address','bank_name','bank_account','account_name','cooperation_note']);
export type DirectorySupplier=SupplierProfile & Partial<Record<DirectoryKey,string|null>> & {cooperation_status?:'COMMON'|'BACKUP'};
export type SupplierDraft={clientKey:string;id:string;name:string;code:string;updated_at:string;is_active:boolean;supplier_category:string;cooperation_status:'COMMON'|'BACKUP';aliases:string} & Record<DirectoryKey,string>;
export const emptySupplier:SupplierDraft={...Object.fromEntries(supplierFields.map(([key])=>[key,''])),clientKey:'new',id:'',name:'',code:'',updated_at:'',is_active:true,supplier_category:'待分類',cooperation_status:'COMMON',aliases:''} as SupplierDraft;
export function supplierDraft(s:DirectorySupplier):SupplierDraft{return {...emptySupplier,...Object.fromEntries(supplierFields.map(([key])=>[key,s[key]||''])),clientKey:s.id,id:s.id,name:s.name,code:s.supplier_code||'',updated_at:s.updated_at,is_active:s.is_active,supplier_category:s.supplier_category||'待分類',cooperation_status:s.cooperation_status||'COMMON',aliases:(s.aliases||[]).join('、')};}
export function supplierStatus(s:{is_active:boolean;cooperation_status?:string}){return !s.is_active?'暫停合作':s.cooperation_status==='BACKUP'?'備用':'常用';}
export function supplierPayload(d:SupplierDraft){const {clientKey,...data}=d;void clientKey;return {...data,name:d.name.trim(),id:d.id||null,aliases:d.aliases.split(/[、,\n]/).map(s=>s.trim()).filter(Boolean)};}
export function supplierValidation(d:SupplierDraft){if(!d.name.trim()||d.name.length>160)return '供應商名稱須為 1 至 160 字。';if(d.order_url&&!safeSupplierLink(d.order_url))return '請填寫完整的 http 或 https 訂貨連結。';const aliases=d.aliases.split(/[、,\n]/).map(s=>s.trim()).filter(Boolean);if(aliases.length>50||aliases.some(s=>s.length>160))return '其他名稱最多 50 個，每個最多 160 字。';for(const [key,label] of supplierFields){if(d[key].length>supplierFieldLimit(key))return `${label}字數過長。`;}return '';}
export function supplierFieldLimit(key:DirectoryKey){return key==='order_method'?80:key==='cutoff_time'?160:['order_note','supply_note','cooperation_note'].includes(key)?4000:2000;}
export function supplierExport(rows:DirectorySupplier[]){return rows.map(s=>({'供應商名稱':s.name,'分類':s.supplier_category||'待分類','合作狀態':supplierStatus(s),'其他名稱':(s.aliases||[]).join('、'),...Object.fromEntries(supplierFields.map(([key,label])=>[label,s[key]||'']))}));}
export function supplierImport(rows:Record<string,unknown>[],existing:DirectorySupplier[]){
 if(!rows.length||rows.length>500)throw Error('請匯入 1 至 500 筆資料。');
 const seen=new Set<string>(),matched=new Set<string>();
 return rows.map((row,index)=>{
  const name=String(row['供應商名稱']||'').trim(),key=supplierNameKey(name);
  if(!name||seen.has(key))throw Error(`第 ${index+2} 列名稱空白或重複。`);seen.add(key);
  const matches=existing.filter(s=>[s.name,...(s.aliases||[])].some(n=>supplierNameKey(n)===key));
  if(matches.length>1)throw Error(`「${name}」對應多家供應商，請先整理名稱。`);
  if(matches[0]&&matched.has(matches[0].id))throw Error(`「${name}」與另一列對應同一家供應商。`);if(matches[0])matched.add(matches[0].id);
  const draft=matches[0]?supplierDraft(matches[0]):{...emptySupplier,clientKey:`import-${index}`,name};
  for(const [field,label] of supplierFields)if(Object.hasOwn(row,label))draft[field]=String(row[label]??'');
  if(Object.hasOwn(row,'分類')){const category=String(row['分類']||'待分類');if(!['食材','耗材','調料','酒類','待分類'].includes(category))throw Error(`「${name}」分類不正確。`);draft.supplier_category=category;}
  if(Object.hasOwn(row,'合作狀態')){const status=String(row['合作狀態']||'常用');if(!['常用','備用','暫停合作'].includes(status))throw Error(`「${name}」合作狀態不正確。`);draft.is_active=status!=='暫停合作';if(status!=='暫停合作')draft.cooperation_status=status==='備用'?'BACKUP':'COMMON';}
  if(Object.hasOwn(row,'其他名稱'))draft.aliases=String(row['其他名稱']||'');
  const error=supplierValidation(draft);if(error)throw Error(`「${name}」${error}`);return draft;
 });
}
