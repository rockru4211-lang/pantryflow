import type {ReviewDraft} from './receipt-review';
export type ReplenishmentStatus='OK'|'LOW'|'WAITING_DATE'|'ORDERED'|'OVERDUE';
export type CustodyOrder={id:string;ordered_quantity:number;received_quantity:number;expected_on:string|null;status:'ORDERED'|'RECEIVED'|'CANCELLED';note:string;revision:number;created_at:string;updated_at:string};
export type CustodyReminder={id:string;store_id:string;product_id:string;name:string;supplier:string;unit:string;kind:'supplier'|'reserved';remaining:number;note:string;revision:number;code?:string;names?:string[];count_name?:string;safety_stock?:number|null;responsible_user_id?:string|null;status?:ReplenishmentStatus;order?:CustodyOrder|null;orders?:CustodyOrder[];notified_at?:string|null};
export type ReminderTag=Pick<CustodyReminder,'name'|'unit'|'kind'>;
export type ReminderState={tags?:ReminderTag[];rows:CustodyReminder[];products:{id:string;name:string;unit:string;supplier:string}[];can_edit?:boolean;recipients?:{id:string;name:string}[]};
const reminderLabels:Record<string,string>={supplier:'寄庫',reserved:'寄庫'};
export const reminderLabel=(kind:string)=>reminderLabels[kind]||'寄庫';
const key=(s:string)=>s.normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase();
export function matchingReminders(rows:CustodyReminder[],line:{product_name:string;unit:string},supplier:string){return rows.filter(r=>r.remaining>0&&key(r.name)===key(line.product_name)&&key(r.unit)===key(line.unit)&&key(r.supplier)===key(supplier));}
export function searchCustodyReminders(rows:CustodyReminder[],query:string,supplier:string){const q=key(query);return !q?[]:rows.filter(r=>(!supplier.trim()||key(r.supplier)===key(supplier))&&[r.name,r.count_name||'',r.code||'',...(r.names||[])].some(n=>key(n).includes(q))).slice(0,8);}
export function applyCustodyReminder(draft:ReviewDraft,index:number,reminder:CustodyReminder):ReviewDraft{
 // Picking is explicit. No quantity conversion or inference across suppliers.
 if(draft.supplier.trim()&&key(draft.supplier)!==key(reminder.supplier))return draft;
 return {...draft,supplier:draft.supplier.trim()||reminder.supplier,lines:draft.lines.map((line,i)=>i!==index?line:{...line,product_name:reminder.name,unit:reminder.unit,ingredient_id:null,create_ingredient:false,supplier_item_name:undefined,supplier_item_unit:undefined,supplier_item_specification:undefined,ingredient_match_revision:undefined,remember_ingredient_alias:false,custody_reminder_id:reminder.id,custody_reminder_kind:reminder.kind,handling:'NORMAL',custody_lot_id:'',custody_event_id:''})};
}
export function custodyStatus(row:CustodyReminder,today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei'}).format(new Date())):ReplenishmentStatus{
 if(row.order?.status==='ORDERED')return !row.order.expected_on?'WAITING_DATE':row.order.expected_on<today?'OVERDUE':'ORDERED';
 return row.safety_stock!=null&&row.remaining<row.safety_stock?'LOW':'OK';
}
export const custodyStatusLabel=(status:ReplenishmentStatus)=>({OK:'充足',LOW:'待下單',WAITING_DATE:'待確認交期',ORDERED:'補貨中',OVERDUE:'到貨逾期'})[status];
export function custodyNotificationEntries(rows:CustodyReminder[]){return rows.flatMap(r=>{
 const status=custodyStatus(r);if(!r.notified_at||!['LOW','WAITING_DATE','OVERDUE'].includes(status))return [];
 return [{key:`custody:${r.id}`,id:r.id,category:'custody',title:`${r.count_name||r.name}・${custodyStatusLabel(status)}`,copy:`寄庫 ${r.remaining} ${r.unit}・${status==='LOW'?'請確認下單':status==='WAITING_DATE'?'已下單，請確認到貨時間':`預計 ${r.order?.expected_on} 到貨，請追蹤`}`,at:r.notified_at,pending:true,target:'inventory-monthly',page:'supplier'}];
});}
export function reminderError(error:unknown){const m=error&&typeof error==='object'&&'message' in error?String(error.message):String(error);if(/REMINDER_INSUFFICIENT/.test(m))return '進貨數量超過剩餘量，請核對數量或改為一般進貨。';if(/REMINDER_MISMATCH/.test(m))return '寄庫的供應商、品項或單位不同，請重新連結或改為一般進貨。';if(/REMINDER_CHANGED|REQUEST_CONFLICT/.test(m))return '資料已更新，輸入仍保留；請重新讀取後再儲存。';if(/REMINDER_FORBIDDEN/.test(m))return '此身分無法修改這個門市的寄庫。';if(/REMINDER_INVALID|22007|22008/.test(m))return '請核對品項、數量、安全水位與到貨日期。';return m;}
