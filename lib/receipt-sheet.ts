import {receiptValue} from './receipt-workflow';
import {editableReceiptDate,ledgerEditCard,ledgerEditError,type LedgerEditValues} from './receipt-ledger-edit';
import type {Detail,LedgerRow} from '../app/pilot/receiving-workspace';
export type SheetDraft={row:LedgerRow;detail:Detail;initial:LedgerEditValues;values:LedgerEditValues};
export function sheetValues(row:LedgerRow,detail:Detail):LedgerEditValues{
 const manual=detail.manual_lines?.find(m=>'manual-'+m.id===row.row_key);
 const v=(name:string,fallback:unknown)=>String(receiptValue(detail.fields,row.row_key,name)??fallback??'');
 return {date:editableReceiptDate(String(receiptValue(detail.fields,'document','receipt_date')||row.receipt_date||'')),supplier:String(receiptValue(detail.fields,'document','supplier_name')||row.supplier_name||''),name:manual?.product_name||v('product',row.product_name),specification:manual?.specification||v('specification',row.specification==='未提供'?'':row.specification),quantity:String(manual?.quantity??v('quantity',row.quantity)),unit:manual?.unit||v('unit',row.unit),price:manual?String(manual.unit_price_ex_tax??''):v('unit_price_ex_tax',row.unit_price),category:row.category||'待分類',note:row.note||manual?.note||''};
}
export const sheetDirty=(draft:SheetDraft)=>Object.keys(draft.values).some(k=>draft.values[k as keyof LedgerEditValues]!==draft.initial[k as keyof LedgerEditValues]);
export function sheetPayload(drafts:SheetDraft[]){
 const documents=new Set<string>();
 return {rows:drafts.filter(sheetDirty).map(({row,detail,initial,values:v})=>{
  const error=ledgerEditError(v);if(error)throw Error(`${v.name||'此筆明細'}：${error}`);
  if(!detail.run)throw Error('OCR_VERSION_CHANGED');
  const shared=v.supplier!==initial.supplier||v.date!==initial.date;
  const document=shared&&!documents.has(row.batch_id)?{...ledgerEditCard(row.batch_id,detail.run.id,'document',detail.fields,{supplier_name:v.supplier.trim(),receipt_date:v.date}),acknowledge:false}:null;
  if(document)documents.add(row.batch_id);
  const fields:Record<string,string>={product:v.name.trim(),specification:v.specification,quantity:v.quantity,unit:v.unit.trim(),unit_price_ex_tax:v.price};
  if(v.quantity!==initial.quantity||v.price!==initial.price)fields.subtotal_ex_tax=v.price.trim()?String(Number(v.quantity)*Number(v.price)):'';
  return {batch_id:row.batch_id,run_id:detail.run.id,row_key:row.row_key,review_revision:row.review_revision,annotation_revision:row.annotation_revision||0,document,category:v.category,note:v.note,...(row.row_key.startsWith('manual-')?{manual:{product_name:v.name.trim(),specification:v.specification,unit:v.unit.trim(),quantity:Number(v.quantity),unit_price:v.price.trim()?Number(v.price):null}}:{line:ledgerEditCard(row.batch_id,detail.run.id,row.row_key,detail.fields,fields,detail.mappings.find(m=>m.row_key===row.row_key))})};
 })};
}
