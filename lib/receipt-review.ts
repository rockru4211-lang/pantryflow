import {accountDate,parseAccountInput,type ReceiptAccount} from './receipt-accounting.ts';
export type ReviewLine={row_key:string;product_name:string;specification:string;unit:string;quantity:number|null;unit_price:number|null;subtotal:number|null;category:string;note:string;product_id?:string|null;product_code?:string|null};
export type ReviewAccount=ReceiptAccount&{run_id:string|null;lines:ReviewLine[];edit_revision:number;adjustment:number;adjustment_note:string;source_changed:boolean;documents?:{id:string;name:string;path:string;mime_type:string;page_order:number}[]};
export type ReviewDraft={supplier:string;date:string;number:string;tax:string;total:string;note:string;adjustment:string;adjustmentNote:string;lines:(Omit<ReviewLine,'quantity'|'unit_price'|'subtotal'>&{quantity:string;unit_price:string;subtotal:string})[]};
export function reviewDraft(row:ReviewAccount):ReviewDraft{return {supplier:row.supplier_name,date:accountDate(row.receipt_date),number:row.document_number||'',tax:String(row.tax??''),total:String(row.total??''),note:row.note,adjustment:String(row.adjustment??0),adjustmentNote:row.adjustment_note||'',lines:row.lines.map(l=>({...l,quantity:String(l.quantity??''),unit_price:String(l.unit_price??''),subtotal:String(l.subtotal??'')}))};}
export function reviewNet(draft:ReviewDraft):number|null{const values=draft.lines.map(l=>parseAccountInput(l.subtotal));const adjustment=parseAccountInput(draft.adjustment);return !values.length||values.some(v=>v===null)||adjustment===null?null:Math.round((values.reduce<number>((s,n)=>s+(n??0),0)+adjustment)*10000)/10000;}
export function reviewTotal(draft:ReviewDraft):number|null{const net=reviewNet(draft),tax=parseAccountInput(draft.tax);return net===null||tax===null?null:Math.round((net+tax)*10000)/10000;}
export function changeReviewLine(draft:ReviewDraft,index:number,key:string,value:string):ReviewDraft{
 const result={...draft,lines:draft.lines.map((line,i)=>{if(i!==index)return line;const next={...line,[key]:value};if(key==='quantity'||key==='unit_price'){try{const q=parseAccountInput(next.quantity),price=parseAccountInput(next.unit_price);next.subtotal=q===null||price===null?'':String(Math.round(q*price*10000)/10000);}catch{next.subtotal='';}}return next;})};
 // Do not silently alter a vendor's printed total: the user sees the difference.
 return result;
}
export function reviewPayload(row:ReviewAccount,draft:ReviewDraft,checked:boolean){
 const lines=draft.lines.map(l=>({row_key:l.row_key,product_name:l.product_name.trim(),specification:l.specification,unit:l.unit.trim(),quantity:parseAccountInput(l.quantity),unit_price:parseAccountInput(l.unit_price),subtotal:parseAccountInput(l.subtotal),category:l.category,note:l.note}));
 const adjustment=parseAccountInput(draft.adjustment),tax=parseAccountInput(draft.tax),total=parseAccountInput(draft.total),net=reviewNet(draft);
 if(adjustment===null)throw Error('請填寫調整金額，沒有調整請填 0。');
 if(adjustment!==0&&!draft.adjustmentNote.trim())throw Error('折讓、運費或尾差請填寫調整說明。');
 if(draft.date&&!accountDate(draft.date))throw Error('請填寫有效日期。');
 if(checked&&(row.pending||!lines.length||!draft.supplier.trim()||!draft.date||lines.some(l=>!l.product_name||!l.unit||l.quantity===null||l.quantity<=0||l.unit_price===null||l.subtotal===null)||net===null||tax===null||total===null||Math.abs(net+tax-total)>0.010001))throw Error('尚有資料未完整或含稅金額不一致。可先儲存，不會遺失修正。');
 return {source_fingerprint:row.source_fingerprint,revision:row.revision,header:{supplier_name:draft.supplier.trim(),receipt_date:draft.date||null,document_number:draft.number.trim()},lines,adjustment,adjustment_note:draft.adjustmentNote,tax,total,note:draft.note,checked};
}
export function nextReviewId(rows:ReceiptAccount[],id:string){const index=rows.findIndex(r=>r.batch_id===id);return rows.slice(index+1).find(r=>r.record_state==='LIVE'&&r.can_edit&&r.status!=='CHECKED'&&!r.pending)?.batch_id??null;}
export function reviewError(e:unknown){const m=e&&typeof e==='object'&&'message' in e?String(e.message):String(e);if(/REVISION_CONFLICT|RECEIPT_LINES_CHANGED/.test(m))return '貨單已由其他人或辨識程序更新。輸入仍保留，請先重新讀取比較，勿重複送出。';if(/INVALID_RECEIPT_AMOUNT/.test(m))return '金額或調整說明有誤，請核對。';if(/INVALID_RECEIPT_LINE/.test(m))return '請檢查數量、單價、金額與備註；小計與數量乘單價不同時需填備註。';if(/RECEIPT_ACCOUNT_INCOMPLETE/.test(m))return '資料未完整或金額不一致；請先儲存，保留待對帳。';if(/REQUIRED|FORBIDDEN|NOT_LIVE|READ_ONLY/.test(m))return '此身分或貨單狀態不能修改。';return '儲存未確認，輸入仍保留，請重試。';}
