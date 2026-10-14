// One-time history boundary requested on 2026-10-14; never advance with the clock.
export const REPAIR_HISTORY_BEFORE='2026-10-14';
export function historicalRepair(date:string|null|undefined){return !!date&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&date<REPAIR_HISTORY_BEFORE;}
export function repairCreatedDate(timestamp:string){return new Date(timestamp).toLocaleDateString('sv-SE',{timeZone:'Asia/Taipei'});}
