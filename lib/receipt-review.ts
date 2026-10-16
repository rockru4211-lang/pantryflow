import {clearReceiptIngredient} from './receipt-ingredient-matching.ts';
import {receiptAmountsMatch,receiptRoundingAdjustment,accountDate,parseAccountInput,type ReceiptAccount} from './receipt-accounting.ts';
export const receiptHandlingLabels={NORMAL:'一般進貨',FREIGHT:'運費／其他費用',CUSTODY_RELEASE:'寄庫領回'} as const;
export type ReceiptHandling=keyof typeof receiptHandlingLabels;
export function receiptHandling(line:{handling?:string;product_name?:string}):ReceiptHandling{return line.handling&&line.handling in receiptHandlingLabels?line.handling as ReceiptHandling:'NORMAL';}
export const isFreightName=(name:string)=>/^(?:其他)?(?:運費|運送費|配送費|宅配費)(?:[（(].*[）)])?$/.test(name.trim());
export type ReviewLine={custody_reminder_id?:string;custody_reminder_kind?:string;ingredient_id?:string|null;create_ingredient?:boolean;supplier_item_name?:string;supplier_item_unit?:string;supplier_item_specification?:string;ingredient_match_revision?:number;handling?:ReceiptHandling;custody_lot_id?:string;custody_event_id?:string;custody_posted?:boolean;custody_reference?:string;row_key:string;product_name:string;specification:string;unit:string;quantity:number|null;unit_price:number|null;subtotal:number|null;category:string;note:string;product_id?:string|null;product_code?:string|null};
export type ReviewAccount=ReceiptAccount&{review_completed?:boolean;finance_sent_at?:string|null;received_at?:string|null;entry_completed?:boolean;reviewed?:boolean;run_id:string|null;lines:ReviewLine[];edit_revision:number;adjustment:number;adjustment_note:string;source_changed:boolean;documents?:{id:string;name:string;path:string;mime_type:string;page_order:number}[]};
export type ReviewDraft={supplier:string;date:string;number:string;tax:string;total:string;note:string;adjustment:string;adjustmentNote:string;lines:(Omit<ReviewLine,'quantity'|'unit_price'|'subtotal'>&{quantity:string;unit_price:string;subtotal:string})[]};
export function reviewDraft(row:ReviewAccount):ReviewDraft{return {supplier:row.supplier_name,date:accountDate(row.receipt_date),number:row.document_number||'',tax:String(row.tax??''),total:String(row.total??''),note:row.note,adjustment:String(row.adjustment??0),adjustmentNote:row.adjustment_note||'',lines:row.lines.map(l=>({...l,quantity:String(l.quantity??''),unit_price:String(l.unit_price??''),subtotal:String(l.subtotal??'')}))};}
export function reviewNet(draft:ReviewDraft):number|null{const values=draft.lines.map(l=>receiptHandling(l)==='CUSTODY_RELEASE'?0:parseAccountInput(l.subtotal));const adjustment=parseAccountInput(draft.adjustment)??0;return !values.length||values.some(v=>v===null)||adjustment===null?null:Math.round((values.reduce<number>((s,n)=>s+(n??0),0)+adjustment)*10000)/10000;}
export function reviewTotal(draft:ReviewDraft):number|null{const net=reviewNet(draft),tax=parseAccountInput(draft.tax);return net===null||tax===null?null:Math.round((net+tax)*10000)/10000;}
/** Receipt entry keeps optional tax unknown and rounds only the net document sum. */
export function receiptEntryAmounts(draft:ReviewDraft){
 const net=reviewNet(draft),tax=parseAccountInput(draft.tax),entered=parseAccountInput(draft.total);
 const suggested=net===null?null:Math.round((Math.ceil(net)+(tax??0))*10000)/10000;
 const total=entered??suggested;
 const difference=net===null||total===null?null:Math.round((total-net-(tax??0))*10000)/10000;
 const roundedNet=net!==null&&total!==null&&difference!==null&&difference>0&&Math.abs(total-(suggested??0))<0.00001;
 return {total,suggested,difference,roundedNet,roundedTotal:receiptRoundingAdjustment(net,tax,total)!==null};
}
/** Editing tax applies the full known sum; incomplete/invalid amounts remain editable. */
export function changeReviewTax(draft:ReviewDraft,tax:string):ReviewDraft{
 const next={...draft,tax};
 try{const total=receiptEntryAmounts(next).suggested;return total===null?next:{...next,total:String(total)};}catch{return next;}
}
export function changeReviewLine(draft:ReviewDraft,index:number,key:string,value:string):ReviewDraft{
 const result={...draft,lines:draft.lines.map((line,i)=>{if(i!==index)return line;const next={...(['product_name','unit','specification'].includes(key)?clearReceiptIngredient(line):line),[key]:value};if(key==='handling'&&value!=='CUSTODY_RELEASE'){next.custody_lot_id='';next.custody_event_id='';}if(key==='quantity'||key==='unit_price'){try{const q=parseAccountInput(next.quantity),price=parseAccountInput(next.unit_price);next.subtotal=q===null||price===null?'':String(Math.round(q*price*10000)/10000);}catch{next.subtotal='';}}return next;})};
 // Do not silently alter a vendor's printed total: the user sees the difference.
 return result;
}
export function reviewPayload(row:ReviewAccount,draft:ReviewDraft,checked:boolean){
 const lines=draft.lines.map(l=>({...(l.custody_reminder_id!==undefined?{custody_reminder_id:l.custody_reminder_id}:{}),row_key:l.row_key,product_name:l.product_name.trim(),specification:l.specification,unit:l.unit.trim(),quantity:parseAccountInput(l.quantity),unit_price:receiptHandling(l)==='CUSTODY_RELEASE'?null:parseAccountInput(l.unit_price),subtotal:receiptHandling(l)==='CUSTODY_RELEASE'?0:parseAccountInput(l.subtotal),category:l.category,note:l.note,handling:receiptHandling(l),custody_lot_id:l.custody_lot_id||'',custody_event_id:l.custody_event_id||'',...(l.ingredient_id!==undefined||l.create_ingredient?{ingredient_id:l.ingredient_id||null,create_ingredient:!!l.create_ingredient,supplier_item_name:l.supplier_item_name||l.product_name,supplier_item_unit:l.supplier_item_unit??l.unit,supplier_item_specification:l.supplier_item_specification??l.specification,ingredient_match_revision:l.ingredient_match_revision||0}:{})}));
 const adjustment=parseAccountInput(draft.adjustment)??0,tax=parseAccountInput(draft.tax),total=checked?parseAccountInput(draft.total):receiptEntryAmounts(draft).total,net=reviewNet(draft);
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
  if(net!==null&&tax!==null&&total!==null&&!receiptAmountsMatch(net,tax,total))issues.push(`未稅合計 ${net} ＋稅額 ${tax} 與原單含稅金額 ${total} 不一致（差額 ${Math.round((net+tax-total)*10000)/10000}）`);
  if(issues.length)throw Error(issues.join('；'));
 }

 const removed_row_keys=row.lines.filter(l=>!lines.some(n=>n.row_key===l.row_key)).map(l=>l.row_key);
 const structural=removed_row_keys.length>0||lines.some(l=>l.row_key.startsWith('local-'));
 return {...(structural?{removed_row_keys}:{}),source_fingerprint:row.source_fingerprint,revision:row.revision,header:{supplier_name:draft.supplier.trim(),receipt_date:draft.date||null,document_number:draft.number.trim()},lines,adjustment,adjustment_note:draft.adjustmentNote,tax,total,note:draft.note,checked};
}
export function nextReviewId(rows:ReceiptAccount[],id:string){const index=rows.findIndex(r=>r.batch_id===id);return rows.slice(index+1).find(r=>r.record_state==='LIVE'&&r.can_edit&&r.status!=='CHECKED'&&!r.pending)?.batch_id??null;}
export function reviewError(e:unknown){const m=e&&typeof e==='object'&&'message' in e?String(e.message):String(e);if(/REQUEST_TIMEOUT|statement timeout|57014/.test(m))return '儲存逾時，輸入仍保留；請按原按鈕重試，同一筆操作不會重複入庫。';if(/RECEIPT_REVIEW_DATA_REQUIRED/.test(m))return '資料尚未填齊，請先儲存；核對品名、單位、數量與單價後再按完成。';if(/RECEIPT_REVIEW_REQUIRED/.test(m))return '請先查看貨單並按完成，再從首頁送對帳。';if(/RECEIPT_RECEIVED_LOCKED/.test(m))return '已收貨的品項、數量、單位與日期不可直接修改；仍可補價格及備註。';if(/RECEIPT_RECEIVE_REQUIRED/.test(m))return '請填供應商、日期、品名、單位與數量；價格可以後補。';if(/RECEIPT_PRODUCT_INACTIVE/.test(m))return '此品項已停用，請先確認要收貨的品項。';if(/SUPPLIER_NAME_REQUIRED/.test(m))return '請從快選選擇已建檔的供應商。';if(/REMINDER_INSUFFICIENT/.test(m))return '進貨數量超過寄庫剩餘量，請核對或改為一般進貨。';if(/REMINDER_MISMATCH/.test(m))return '寄庫的品項、供應商或單位不同，請重新選擇。';if(/INGREDIENT_MATCH_CONFLICT/.test(m))return '此供應商品名的對應已變更，請重新選擇食材後儲存。';if(/INGREDIENT_ALREADY_EXISTS/.test(m))return '已有同名食材，請從選單選取，避免重複建立。';if(/INGREDIENT_MATCH_INVALID/.test(m))return '對應食材已移除或資料不符，請重新選擇；也可清除對應後先儲存。';if(/REVISION_CONFLICT|RECEIPT_LINES_CHANGED/.test(m))return '貨單已由其他人或辨識程序更新。輸入仍保留，請先重新讀取比較，勿重複送出。';if(/PUBLISHED_RECEIPT_IMMUTABLE/.test(m))return '這張貨單已入庫，不能直接新增或刪除明細。';if(/RECEIPT_CUSTODY_LOCKED/.test(m))return '此列已關聯寄庫紀錄，不能直接刪除或變更數量、單位、日期及批次。';if(/CUSTODY_/.test(m))return '請核對寄庫批次、剩餘數量及領貨日期；若已領貨，請關聯既有領貨紀錄。';if(/INVALID_RECEIPT_AMOUNT/.test(m))return '金額格式有誤，請檢查數字。';if(/INVALID_RECEIPT_LINE/.test(m))return '請檢查數量、單價及金額的數字格式；未填資料可以後補。';if(/RECEIPT_ACCOUNT_INCOMPLETE/.test(m))return '資料未完整或金額不一致；請先儲存，保留待對帳。';if(/REQUIRED|FORBIDDEN|NOT_LIVE|READ_ONLY/.test(m))return '此身分或貨單狀態不能修改。';return '儲存未確認，輸入仍保留，請重試。';}

/** A display-only partial subtotal must never replace an unknown accounting total. */
export function enteredSubtotal(draft:ReviewDraft){
 let subtotal=0,known=0,missing=0;
 for(const line of draft.lines){try{const amount=receiptHandling(line)==='CUSTODY_RELEASE'?0:parseAccountInput(line.subtotal);if(amount===null){missing++;continue;}subtotal+=amount;known++;}catch{missing++;}}
 return {subtotal:known?Math.round(subtotal*10000)/10000:null,missing};
}
export function taxExclusivePrice(gross:string,rate:string){
 const price=parseAccountInput(gross),percent=parseAccountInput(rate);
 if(price===null||percent===null||price<0||percent<0||percent>100)throw Error('請填寫含稅單價及有效稅率。');
 return Math.round(price/(1+percent/100)*10000)/10000;
}

export function receiptMissingPrices(lines:{handling?:string;unit_price:unknown}[]){return lines.filter(l=>receiptHandling(l)!=='CUSTODY_RELEASE'&&(l.unit_price===null||l.unit_price===undefined||String(l.unit_price).trim()==='')).length;}
export function receiptReceiveError(draft:ReviewDraft){
 if(!draft.supplier.trim()||!draft.date||!draft.lines.length)return '確認收貨前請填供應商、到貨日期與品項；也可先儲存待補。';
 for(const [i,l] of draft.lines.entries()){const q=parseAccountInput(l.quantity);if(!l.product_name.trim()||!l.unit.trim()||q===null||q<=0)return `第 ${i+1} 項請填品名、單位與有效數量；單價可以後補。`;}
 return '';
}

/** Compare printed line amounts without replacing them or inventing missing values. */
export function receiptLineDifference(line:ReviewDraft['lines'][number]):number|null{
 if(receiptHandling(line)==='CUSTODY_RELEASE')return null;
 try{const q=parseAccountInput(line.quantity),price=parseAccountInput(line.unit_price),amount=parseAccountInput(line.subtotal);if(q===null||price===null||amount===null)return null;const difference=Math.round((amount-q*price)*10000)/10000;return Math.abs(difference)>0.010001?difference:null;}catch{return null;}
}

/** Handoff does not post stock or interpret blank tax as zero. */
export const receiptFinanceSent=(row:ReviewAccount)=>!!row.finance_sent_at||!!row.reviewed||row.status==='CHECKED';
export function receiptFinanceReady(row:ReviewAccount){
 return row.can_edit&&row.record_state==='LIVE'&&!receiptFinanceSent(row)&&row.review_completed===true&&row.edit_revision>0&&!!row.supplier_name.trim()&&!!accountDate(row.receipt_date)&&row.lines.length>0&&row.lines.every(l=>!!l.product_name.trim()&&!!l.unit.trim()&&l.quantity!==null&&l.quantity>0&&(receiptHandling(l)==='CUSTODY_RELEASE'||l.unit_price!==null&&l.unit_price>=0&&l.subtotal!==null));
}

export function receiptCompletionError(draft:ReviewDraft){
 if(!draft.supplier.trim()||!accountDate(draft.date)||!draft.lines.length)return '請填供應商、到貨日期與品項後再完成；也可先儲存。';
 for(const [i,l] of draft.lines.entries()){
  const q=parseAccountInput(l.quantity),price=parseAccountInput(l.unit_price),amount=parseAccountInput(l.subtotal);
  if(!l.product_name.trim()||!l.unit.trim()||q===null||q<=0)return `第 ${i+1} 項請填品名、單位與有效數量；也可先儲存。`;
  if(receiptHandling(l)!=='CUSTODY_RELEASE'&&(price===null||price<0||amount===null))return `第 ${i+1} 項單價或金額尚未填齊，可先儲存，核對後再按完成。`;
 }
 return '';
}

export type ReceiptSortField='date'|'supplier'|'name';
export type ReceiptSortDirection='asc'|'desc';
/** Sort whole documents; original invoice line order and source arrays are immutable. */
export function sortReceiptDocuments<T extends ReviewAccount>(rows:T[],field:ReceiptSortField,direction:ReceiptSortDirection):T[]{
 const compare=(a:string,b:string)=>a.localeCompare(b,'zh-Hant',{numeric:true,sensitivity:'base'});
 const value=(row:T)=>field==='date'?accountDate(row.receipt_date):field==='supplier'?row.supplier_name.trim():row.lines[0]?.product_name.trim()||'';
 return [...rows].sort((a,b)=>{
  const left=value(a),right=value(b);
  if(!left||!right){const missing=Number(!left)-Number(!right);if(missing)return missing;}
  return compare(left,right)*(direction==='asc'?1:-1)||compare(a.supplier_name,b.supplier_name)||accountDate(b.receipt_date).localeCompare(accountDate(a.receipt_date))||a.batch_id.localeCompare(b.batch_id);
 });
}
