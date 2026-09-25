export type CustodyKind = 'supplier' | 'reserved';
export type CustodyLot = {id:string;label:string;quantity:number;remaining:number;expires_on:string|null;reference:string;created_at:string};
export type CustodyEvent = {id:string;action:string;quantity:number|null;occurred_on:string;handler:string;note:string;created_at:string;lot_id:string|null;actor:string};
export type CustodyAccount = {id:string;product_id:string;name:string;unit:string;party:string;kind:CustodyKind;minimum:number;warning_days:number;followup:string;note:string;revision:number;remaining:number;original:number;lots:CustodyLot[];events:CustodyEvent[]};
export type CustodyState = {store_id:string;kind:CustodyKind;accounts:CustodyAccount[];products:{id:string;name:string;unit:string;supplier:string}[]};
export const custodyToday = (date=new Date())=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
export function custodyWarnings(account:CustodyAccount,today=custodyToday()) {
 const warnings:string[]=[];
 if(account.kind==='supplier'&&account.remaining<account.minimum)warnings.push(`低於安全水位 ${account.minimum} ${account.unit}，請聯絡補購`);
 const horizon=new Date(`${today}T00:00:00Z`);horizon.setUTCDate(horizon.getUTCDate()+account.warning_days);
 const limit=horizon.toISOString().slice(0,10);
 for(const lot of account.lots.filter(l=>l.remaining>0&&l.expires_on)) {
  if(lot.expires_on!<today)warnings.push(`${lot.label} 已到期（${lot.expires_on}）`);
  else if(lot.expires_on!<=limit)warnings.push(`${lot.label} 即將到期（${lot.expires_on}）`);
 }
 return warnings;
}
export function custodyError(error:unknown) {
 const message=error&&typeof error==='object'&&'message' in error?String(error.message):String(error);
 const known:Record<string,string>={CUSTODY_ADMIN_REQUIRED:'您沒有此門市的寄庫與保留貨管理權限。',CUSTODY_CHANGED:'此筆資料已由其他人更新。請重新讀取，再核對您的輸入後儲存。',CUSTODY_INSUFFICIENT:'領取數量超過這個批次的剩餘數量。',CUSTODY_EXPIRED:'此批次已到期，不能領取。請先聯絡供應商處理。',CUSTODY_REQUEST_REUSED:'此操作已送出，請重新讀取確認紀錄。',CUSTODY_EXISTS:'此品項與對象已有紀錄，請使用「新增批次」。',INSUFFICIENT_STOCK:'門市可用庫存不足，請先核對現場庫存與單位，再登記取貨。',CUSTODY_INVALID:'請確認品項、數量、日期及必填欄位。',CUSTODY_NOT_FOUND:'找不到這筆寄庫或保留貨，請重新讀取。'};
 return Object.entries(known).find(([code])=>message.includes(code))?.[1]||'暫時無法完成操作，您的輸入仍保留，請稍後重試。';
}
