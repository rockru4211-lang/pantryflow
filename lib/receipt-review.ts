import {accountDate,parseAccountInput,type ReceiptAccount} from './receipt-accounting.ts';
export const receiptHandlingLabels={NORMAL:'一般進貨',FREIGHT:'運費／其他費用',CUSTODY_RELEASE:'寄庫領回'} as const;
export type ReceiptHandling=keyof typeof receiptHandlingLabels;
export function receiptHandling(line:{handling?:string;product_name?:string}):ReceiptHandling{return line.handling&&line.handling in receiptHandlingLabels?line.handling as ReceiptHandling:'NORMAL';}
export const isFreightName=(name:string)=>/^(?:其他)?(?:運費|運送費|配送費|宅配費)(?:[（(].*[）)])?$/.test(name.trim());
export type ReviewLine={handling?:ReceiptHandling;custody_lot_id?:string;custody_event_id?:string;custody_posted?:boolean;custody_reference?:string;row_key:string;product_name:string;specification:string;unit:string;quantity:number|null;unit_price:number|null;subtotal:number|null;category:string;note:string;product_id?:string|null;product_code?:string|null};
export type ReviewAccount=ReceiptAccount&{reviewed?:boolean;run_id:string|null;lines:ReviewLine[];edit_revision:number;adjustment:number;adjustment_note:string;source_changed:boolean;documents?:{id:string;name:string;path:string;mime_type:string;page_order:number}[]};
export type ReviewDraft={supplier:string;date:string;number:string;tax:string;total:string;note:string;adjustment:string;adjustmentNote:string;lines:(Omit<ReviewLine,'quantity'|'unit_price'|'subtotal'>&{quantity:string;unit_price:string;subtotal:string})[]};
export function reviewDraft(row:ReviewAccount):ReviewDraft{return {supplier:row.supplier_name,date:accountDate(row.receipt_date),number:row.document_number||'',tax:String(row.tax??''),total:String(row.total??''),note:row.note,adjustment:String(row.adjustment??0),adjustmentNote:row.adjustment_note||'',lines:row.lines.map(l=>({...l,quantity:String(l.quantity??''),unit_price:String(l.unit_price??''),subtotal:String(l.subtotal??'')}))};}
export function reviewNet(draft:ReviewDraft):number|null{const values=draft.lines.map(l=>receiptHandling(l)==='CUSTODY_RELEASE'?0:parseAccountInput(l.subtotal));const adjustment=parseAccountInput(draft.adjustment)??0;return !values.length||values.some(v=>v===null)||adjustment===null?null:Math.round((values.reduce<number>((s,n)=>s+(n??0),0)+adjustment)*10000)/10000;}
export function reviewTotal(draft:ReviewDraft):number|null{const net=reviewNet(draft),tax=parseAccountInput(draft.tax);return net===null||tax===null?null:Math.round((net+tax)*10000)/10000;}
export function changeReviewLine(draft:ReviewDraft,index:number,key:string,value:string):ReviewDraft{
 const result={...draft,lines:draft.lines.map((line,i)=>{if(i!==index)return line;const next={...line,[key]:value};if(key==='handling'&&value!=='CUSTODY_RELEASE'){next.custody_lot_id='';next.custody_event_id='';}if(key==='quantity'||key==='unit_price'){try{const q=parseAccountInput(next.quantity),price=parseAccountInput(next.unit_price);next.subtotal=q===null||price===null?'':String(Math.round(q*price*10000)/10000);}catch{next.subtotal='';}}return next;})};
 // Do not silently alter a vendor's printed total: the user sees the difference.
 return result;
}
export function reviewPayload(row:ReviewAccount,draft:ReviewDraft,checked:boolean){
 const lines=draft.lines.map(l=>({row_key:l.row_key,product_name:l.product_name.trim(),specification:l.specification,unit:l.unit.trim(),quantity:parseAccountInput(l.quantity),unit_price:receiptHandling(l)==='CUSTODY_RELEASE'?null:parseAccountInput(l.unit_price),subtotal:receiptHandling(l)==='CUSTODY_RELEASE'?0:parseAccountInput(l.subtotal),category:l.category,note:l.note,handling:receiptHandling(l),custody_lot_id:l.custody_lot_id||'',custody_event_id:l.custody_event_id||''}));
 const adjustment=parseAccountInput(draft.adjustment)??0,tax=parseAccountInput(draft.tax),total=parseAccountInput(draft.total),net=reviewNet(draft);
 for(const l of lines){const prior=row.lines.find(p=>p.row_key===l.row_key);if(prior?.custody_posted&&(l.handling!=='CUSTODY_RELEASE'||l.custody_lot_id!==prior.custody_lot_id||l.quantity!==prior.quantity||l.unit!==prior.unit||draft.date!==accountDate(row.receipt_date)))throw Error('已登記的寄庫領回不可直接變更數量、單位、批次或日期。');}
 if(draft.date&&!accountDate(draft.date))throw Error('請填寫有效日期。');
 if(checked){
  const issues:string[]=[];
  if(row.pending)issues.push('貨單尚未完成建檔');
  if(!lines.length)issues.push('沒有品項明細');
  if(!draft.supplier.trim())issues.push('缺供應商');
  if(!draft.date)issues.push('缺到貨日期');
  lines.forEach((l,index)=>{const missing:string[]=[];if(!l.product_name)missing.push('品名');if(!l.unit)missing.push('單位');if(l.quantity===null||l.quantity<=0)missing.push('有效數量');if(l.handling==='CUSTODY_RELEASE'){if(!l.custody_lot_id)missing.push('寄庫批次');}else{if(l.unit_price===null)missing.push('未稅單價');if(l.subtotal===null)missing.push('未稅金額');}if(missing.length)issues.push(`第 ${index+1} 列「${l.product_name||'未命名'}」缺${missing.join('、')}`);});
  if(tax===null)issues.push('缺稅額（確認無稅才填 0）');
  if(total===null)issues.push('缺原單含稅金額');
  if(net!==null&&tax!==null&&total!==null&&Math.abs(net+tax-total)>0.010001)issues.push(`未稅合計 ${net} ＋稅額 ${tax} 與原單含稅金額 ${total} 不一致（差額 ${Math.round((net+tax-total)*10000)/10000}）`);
  if(issues.length)throw Error(issues.join('；'));
 }

 return {source_fingerprint:row.source_fingerprint,revision:row.revision,header:{supplier_name:draft.supplier.trim(),receipt_date:draft.date||null,document_number:draft.number.trim()},lines,adjustment,adjustment_note:draft.adjustmentNote,tax,total,note:draft.note,checked};
}
export function nextReviewId(rows:ReceiptAccount[],id:string){const index=rows.findIndex(r=>r.batch_id===id);return rows.slice(index+1).find(r=>r.record_state==='LIVE'&&r.can_edit&&r.status!=='CHECKED'&&!r.pending)?.batch_id??null;}
export function reviewError(e:unknown){const m=e&&typeof e==='object'&&'message' in e?String(e.message):String(e);if(/REVISION_CONFLICT|RECEIPT_LINES_CHANGED/.test(m))return '貨單已由其他人或辨識程序更新。輸入仍保留，請先重新讀取比較，勿重複送出。';if(/RECEIPT_CUSTODY_LOCKED/.test(m))return '此列已登記領回，不能變更數量、單位、日期或寄庫批次。';if(/CUSTODY_/.test(m))return '請核對寄庫批次、剩餘數量及領貨日期；若已領貨，請關聯既有領貨紀錄。';if(/INVALID_RECEIPT_AMOUNT/.test(m))return '金額格式有誤，請檢查數字。';if(/INVALID_RECEIPT_LINE/.test(m))return '請檢查數量、單價及金額的數字格式；未填資料可以後補。';if(/RECEIPT_ACCOUNT_INCOMPLETE/.test(m))return '資料未完整或金額不一致；請先儲存，保留待對帳。';if(/REQUIRED|FORBIDDEN|NOT_LIVE|READ_ONLY/.test(m))return '此身分或貨單狀態不能修改。';return '儲存未確認，輸入仍保留，請重試。';}
