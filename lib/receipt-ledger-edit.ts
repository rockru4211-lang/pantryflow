import {buildReceiptReviewPayload,createReceiptReviewDraft,updateReceiptReviewField} from './receipt-review-draft';
import type {ReceiptField} from './receipt-workflow';
export const receiptCategories=['食材','耗材','調料','酒水','待分類'] as const;
export type LedgerEditValues={date:string;supplier:string;name:string;specification:string;quantity:string;unit:string;price:string;category:string;note:string};
export function editableReceiptDate(value:string|null){
 const m=(value||'').match(/^(?:民國)?(\d{3,4})[年/.-](\d{1,2})[月/.-](\d{1,2})日?$/);
 if(!m)return '';const y=Number(m[1])+(m[1].length===3||m[1].startsWith('0')?1911:0),month=Number(m[2]),day=Number(m[3]),d=new Date(Date.UTC(y,month-1,day));
 return d.getUTCFullYear()===y&&d.getUTCMonth()===month-1&&d.getUTCDate()===day?`${y}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`:'';
}
export function ledgerEditError(v:LedgerEditValues){
 if(!v.supplier.trim()||!editableReceiptDate(v.date))return '請填寫供應商與有效進貨日期。';
 if(!v.name.trim()||!v.unit.trim())return '請填寫品名與單位。';
 if(!v.quantity.trim()||!Number.isFinite(Number(v.quantity))||Number(v.quantity)<=0)return '數量需大於 0。';
 if(v.price.trim()&&(!Number.isFinite(Number(v.price))||Number(v.price)<0))return '單價需為 0 或正數。';
 return '';
}
export function ledgerEditCard(batchId:string,runId:string,row:string,fields:ReceiptField[],values:Record<string,string>,mapping?:{product_id:string}|null){
 let draft=createReceiptReviewDraft({batchId,runId,row,fields,mapping});
 for(const field of draft.snapshot)if(Object.hasOwn(values,field.field_name))draft=updateReceiptReviewField(draft,field.id,values[field.field_name]);
 return {...buildReceiptReviewPayload(draft),acknowledge:true};
}
