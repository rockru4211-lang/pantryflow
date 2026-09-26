export type HistorySource={id:string;file:string;location:string;date:string|null;raw_quantity:string|null;unit:string|null;note:string|null;issues:{field:string;reason:string;deferred:boolean}[];identity_pending?:boolean};
export type InventoryZone = {id:string;zone_id:string;zone:string;quantity:number;note:string|null;entered_by:string;entered_at:string};
export type InventoryRow = {
 row_key:string;source_signature:string;product_id:string;name:string;unit:string;supplier:string;category:string;category_revision?:number;zones:InventoryZone[];
 current_quantity:number|null;previous_quantity:number|null;difference:number|null;
 history_source?:HistorySource|null;baseline_source?:HistorySource|null;quantity_pending?:boolean;
 comparison:'PENDING_BASELINE'|'MATCHED'|'NEW'|'MISSING'|'UNIT_CHANGED'|'NO_BASELINE';unit_price:number|null;amount:number|null;previous_amount:number|null;
 original_quantity:number|null;corrected:boolean;correction_conflict:boolean;missing_price:boolean;needs_review:boolean;acknowledged:boolean;review_note:string;reviewed_by:string|null;
};
export type InventoryMonth = {
 historical?:boolean;source_file?:string|null;baseline_file?:string|null;baseline_pending?:boolean;
 month:string;store_id:string;closed:boolean;confirmed_at?:string;confirmed_by?:string;
 sessions:{id:string;completed_at:string;status:string;label?:string}[];source_id:string|null;completed_at:string|null;source_complete:boolean;has_active_count:boolean;
 previous_source_id:string|null;previous_completed_at:string|null;previous_month:string;previous_closed:boolean;has_previous:boolean;revision:string;rows:InventoryRow[];
 summary:{items:number;subtotal:number|null;missing_prices:number;pending:number;previous_subtotal:number|null;previous_missing_prices:number;amount_difference:number|null};
};
export type InventoryFilter = {search:string;zone:string;pending:boolean;category?:string};
export function taipeiMonth(now=new Date()) {return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit'}).format(now).slice(0,7);}
export function inventoryNumber(value:number|null|undefined,sign=false) {return value==null?'—':`${sign&&value>0?'+':''}${value.toLocaleString('zh-TW',{maximumFractionDigits:4})}`;}
export function inventoryMoney(value:number|null|undefined,sign=false) {return value==null?'—':`${sign&&value>0?'+':''}NT$ ${value.toLocaleString('zh-TW',{minimumFractionDigits:0,maximumFractionDigits:2})}`;}
export function comparisonLabel(row:InventoryRow) {
 if(row.comparison==='PENDING_BASELINE')return '期初待確認';
 if(row.comparison==='NO_BASELINE')return '無上月資料';
 if(row.comparison==='NEW')return '本月新增';
 if(row.comparison==='MISSING')return '本月未盤';
 if(row.comparison==='UNIT_CHANGED')return '單位變更';
 return inventoryNumber(row.difference,true);
}
export function reviewLabel(row:InventoryRow) {
 if(row.quantity_pending)return '歷史待確認';
 if(row.correction_conflict)return '更正資料待釐清';
 if(row.missing_price)return '待補單價';
 if(row.needs_review)return '待核對';
 return row.acknowledged?'已核對':'無待核對事項';
}
export function filterInventory(rows:InventoryRow[],filter:InventoryFilter) {
 const q=filter.search.trim().toLocaleLowerCase();
 return rows.filter(r=>(!filter.category||r.category===filter.category)&&(!q||`${r.name} ${r.supplier}`.toLocaleLowerCase().includes(q))&&(!filter.zone||r.zones.some(z=>z.zone_id===filter.zone))&&(!filter.pending||r.needs_review));
}
export function inventoryCategories(rows:InventoryRow[]) {
 const groups=new Map<string,{name:string;items:number;amount:number;missing:number}>();
 for(const row of rows){if(row.current_quantity===null)continue;const name=row.category||'其他';const g=groups.get(name)||{name,items:0,amount:0,missing:0};g.items++;g.amount+=row.amount??0;g.missing+=Number(row.missing_price);groups.set(name,g);}
 return [...groups.values()].map(g=>({...g,amount:g.items===g.missing?null:Math.round(g.amount*100)/100})).sort((a,b)=>(b.amount??-1)-(a.amount??-1)||a.name.localeCompare(b.name,'zh-TW'));
}
export function inventoryExportRows(rows:InventoryRow[]) {return rows.map(r=>({
 '品項':r.name,'供應商':r.supplier,'分類':r.category,'儲物區':[...new Set(r.zones.map(z=>z.zone))].join('、'),'單位':r.unit,
 '期初':r.previous_quantity??'未提供','本月數量':r.current_quantity??'未盤','數量增減':r.difference??comparisonLabel(r),
 '單價':r.unit_price??'未提供','本月金額':r.amount??'未計入','核對狀態':reviewLabel(r),'核對備註':r.review_note,
 '含合計更正':r.corrected?'是':'否',
}));}
export function inventoryError(error:unknown) {
 const message=error&&typeof error==='object'&&'message' in error?String(error.message):String(error);
 if(/HISTORY_READ_ONLY/.test(message))return '歷史資料保留原值，暫不在此修改。';
 if(/INVENTORY_REVISION_CHANGED/.test(message))return '資料已由其他人更新，您的輸入仍保留。請先重新載入並核對最新資料。';
 if(/INVENTORY_MONTH_CLOSED/.test(message))return '這個月份已確認，請重新載入查看封存結果。';
 if(/INVENTORY_ADMIN_REQUIRED|DATA_EXPORT_REQUIRED|permission denied/.test(message))return '目前身分沒有此門市的操作權限。';
 if(/INVENTORY_REVIEW_NOTE_REQUIRED/.test(message))return '請填寫差異核對備註。';
 if(/INVALID_INVENTORY_PRICE/.test(message))return '單價請填入大於或等於 0、且小於十億元的數字。';
 if(/INVENTORY_COUNT_INCOMPLETE/.test(message))return '此份盤點範圍尚未完整完成，請先確認各區盤點。';
 if(/INVENTORY_REVIEW_REQUIRED/.test(message))return '還有待核對項目，處理完成後才能確認月份。';
 if(/INVENTORY_SOURCE/.test(message))return '找不到這個月份的已完成盤點，請重新選擇。';
 return '暫時無法完成，請稍後重試。尚未儲存的輸入已保留。';
}

export function inventoryCategorySummary(rows:InventoryRow[],hasPrevious:boolean):InventoryMonth['summary'] {
 const current=rows.filter(r=>r.current_quantity!==null),previous=rows.filter(r=>r.previous_quantity!==null);
 const subtotal=current.some(r=>r.amount!==null)?Math.round(current.reduce((n,r)=>n+(r.amount??0),0)*100)/100:null;
 const previous_subtotal=hasPrevious&&previous.some(r=>r.previous_amount!==null)?Math.round(previous.reduce((n,r)=>n+(r.previous_amount??0),0)*100)/100:null;
 return {items:current.length,subtotal,missing_prices:current.filter(r=>r.missing_price).length,pending:rows.filter(r=>r.needs_review).length,previous_subtotal,previous_missing_prices:previous.filter(r=>r.previous_amount===null).length,amount_difference:subtotal===null||previous_subtotal===null||current.some(r=>r.missing_price)||previous.some(r=>r.previous_amount===null)?null:Math.round((subtotal-previous_subtotal)*100)/100};
}
