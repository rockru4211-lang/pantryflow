export type CustodyReminder={id:string;store_id:string;product_id:string;name:string;supplier:string;unit:string;kind:'supplier'|'reserved';remaining:number;note:string;revision:number};
export type ReminderTag=Pick<CustodyReminder,'name'|'unit'|'kind'>;
export type ReminderState={tags?:ReminderTag[];rows:CustodyReminder[];products:{id:string;name:string;unit:string;supplier:string}[]};
export const reminderLabel=(kind:string)=>kind==='reserved'?'保留貨':'寄庫';
const key=(s:string)=>s.normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase();
export function matchingReminders(rows:CustodyReminder[],line:{product_name:string;unit:string},supplier:string){return rows.filter(r=>r.remaining>0&&key(r.name)===key(line.product_name)&&key(r.unit)===key(line.unit)&&key(r.supplier)===key(supplier));}
export function reminderError(error:unknown){const m=error&&typeof error==='object'&&'message' in error?String(error.message):String(error);if(/REMINDER_INSUFFICIENT/.test(m))return '進貨數量超過剩餘量，請核對數量或改為一般進貨。';if(/REMINDER_MISMATCH/.test(m))return '寄庫／保留貨的供應商、品項或單位不同，請重新連結或改為一般進貨。';if(/REMINDER_CHANGED/.test(m))return '資料已更新，請重新讀取後再儲存。';if(/REMINDER_FORBIDDEN/.test(m))return '此身分無法修改這個門市的寄庫／保留貨。';if(/REMINDER_INVALID/.test(m))return '請填寫品項、供應商、單位及有效的剩餘量。';return m;}
