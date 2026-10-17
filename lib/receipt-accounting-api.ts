import type {SupabaseClient} from '@supabase/supabase-js';
import type {Database,Json} from './database.types';
import {supabase} from './supabase-browser';
import {writeOperation} from './app-workspace';
import {emptySupplier,supplierPayload} from './supplier-directory';
import {operationDeadline} from './operation-deadline';
import {receiptRead,receiptReadRows} from './receipt-read';
import type {ReceiptAccount} from './receipt-accounting';
// Narrow extension for the two additive RPCs; existing generated contracts are unchanged.
type AccountingDatabase=Omit<Database,'public'>&{public:Omit<Database['public'],'Functions'>&{Functions:Database['public']['Functions']&{
 create_receipt_same_photo:{Args:{p_store_id:string;p_batch_id:string;p_data:Json;p_request_id:string};Returns:Json};
 get_receipt_store_choices:{Args:{p_store_id:string};Returns:Json};
 correct_receipt_store:{Args:{p_store_id:string;p_batch_id:string;p_target_store_id:string;p_data:Json;p_request_id:string};Returns:Json};
 submit_baihuayuan_receipt_finance:{Args:{p_store_id:string;p_batch_id:string;p_revision:number;p_source:string;p_request_id:string};Returns:Json};
 retry_baihuayuan_receipt_ocr:{Args:{p_store_id:string;p_batch_id:string};Returns:Json};
 get_baihuayuan_ingredient_matching:{Args:{p_store_id:string};Returns:Json};
 add_baihuayuan_receipt_items:{Args:{p_store_id:string;p_batch_id:string;p_data:Json;p_items:Json;p_request_id:string};Returns:Json};
 begin_baihuayuan_receipt_manual_review:{Args:{p_store_id:string;p_batch_id:string};Returns:string};
 add_baihuayuan_receipt_draft_row:{Args:{p_store_id:string;p_batch_id:string;p_run_id:string;p_request_id:string};Returns:string};
 get_baihuayuan_receipt_accounts:{Args:{p_store_id:string;p_from?:string|null;p_to?:string|null;p_supplier?:string|null;p_batch_id?:string|null};Returns:Json};
 receive_baihuayuan_receipt:{Args:{p_store_id:string;p_batch_id:string;p_data:Json;p_request_id:string};Returns:Json};
 save_baihuayuan_receipt_entry:{Args:{p_store_id:string;p_batch_id:string;p_data:Json;p_request_id:string};Returns:Json};
 save_baihuayuan_receipt_review:{Args:{p_store_id:string;p_batch_id:string;p_data:Json;p_request_id:string};Returns:Json};
 get_baihuayuan_receipt_accounting:{Args:{p_store_id:string};Returns:Json};
 save_baihuayuan_receipt_reconciliation:{Args:{p_store_id:string;p_batch_id:string;p_data:Json;p_request_id:string};Returns:Json};
}}};
const client=supabase as unknown as SupabaseClient<AccountingDatabase>;
export async function readReceiptAccounts(storeId:string,signal:AbortSignal){const r=await receiptRead(s=>client.rpc('get_baihuayuan_receipt_accounting',{p_store_id:storeId}).abortSignal(s),signal);return receiptReadRows<ReceiptAccount>(r);}
export async function saveReceiptAccount(storeId:string,batchId:string,data:Json,requestId:string){const r=await client.rpc('save_baihuayuan_receipt_reconciliation',{p_store_id:storeId,p_batch_id:batchId,p_data:data,p_request_id:requestId});if(r.error)throw r.error;if(!r.data||typeof r.data!=='object'||Array.isArray(r.data)||r.data.saved!==true)throw Error('SAVE_NOT_CONFIRMED');return r.data;}

export async function readScopedReceiptAccounts(storeId:string,signal:AbortSignal,from:string,to:string,supplier:string,batchId?:string){const r=await receiptRead(s=>client.rpc('get_baihuayuan_receipt_accounts',{p_store_id:storeId,p_from:from||null,p_to:to||null,p_supplier:['ALL','__SUPPLIER__'].includes(supplier)?null:supplier||null,p_batch_id:batchId||null}).abortSignal(s),signal);return receiptReadRows<import('./receipt-review').ReviewAccount>(r);}
export async function saveReceiptReview(storeId:string,batchId:string,data:Json,requestId:string){const r=await operationDeadline(signal=>client.rpc(data&&typeof data==='object'&&!Array.isArray(data)&&data.confirm_received===true?'receive_baihuayuan_receipt':data&&typeof data==='object'&&!Array.isArray(data)&&'removed_row_keys' in data?'save_baihuayuan_receipt_entry':'save_baihuayuan_receipt_review',{p_store_id:storeId,p_batch_id:batchId,p_data:data,p_request_id:requestId}).abortSignal(signal));if(r.error)throw r.error;if(!r.data||typeof r.data!=='object'||Array.isArray(r.data)||r.data.saved!==true)throw Error('SAVE_NOT_CONFIRMED');if(typeof window!=='undefined')window.dispatchEvent(new Event('custody-reminder-change'));return r.data.account as unknown as import('./receipt-review').ReviewAccount;}

export async function beginReceiptManualReview(storeId:string,batchId:string){const r=await operationDeadline(signal=>client.rpc('begin_baihuayuan_receipt_manual_review',{p_store_id:storeId,p_batch_id:batchId}).abortSignal(signal));if(r.error)throw r.error;return r.data;}
export async function addReceiptDraftRow(storeId:string,batchId:string,runId:string,requestId:string){const r=await operationDeadline(signal=>client.rpc('add_baihuayuan_receipt_draft_row',{p_store_id:storeId,p_batch_id:batchId,p_run_id:runId,p_request_id:requestId}).abortSignal(signal));if(r.error)throw r.error;return r.data;}

export async function readIngredientMatching(storeId:string,signal:AbortSignal){const r=await receiptRead(s=>client.rpc('get_baihuayuan_ingredient_matching',{p_store_id:storeId}).abortSignal(s),signal);if(r.error)throw r.error;return r.data as unknown as import('./receipt-ingredient-matching').IngredientMatching;}

export async function addReceiptItems(storeId:string,batchId:string,data:Json,items:Json,requestId:string){
 const r=await operationDeadline(signal=>client.rpc('add_baihuayuan_receipt_items',{p_store_id:storeId,p_batch_id:batchId,p_data:data,p_items:items,p_request_id:requestId}).abortSignal(signal));
 if(r.error)throw r.error;if(!r.data||typeof r.data!=='object'||Array.isArray(r.data)||r.data.saved!==true)throw Error('SAVE_NOT_CONFIRMED');
 return r.data.account as unknown as import('./receipt-review').ReviewAccount;
}

export async function createReceiptSupplier(storeId:string,name:string,requestId:string){
 const result=await operationDeadline(signal=>writeOperation<{id:string;value:{name:string;is_active:boolean}}>(storeId,'supplier.save',supplierPayload({...emptySupplier,name}),requestId,signal));
 if(!result?.id||!result.value?.name)throw Error('SAVE_NOT_CONFIRMED');
 return {id:result.id,name:result.value.name,is_active:result.value.is_active};
}

export async function retryReceiptRecognition(storeId:string,batchId:string){const r=await operationDeadline(signal=>client.rpc('retry_baihuayuan_receipt_ocr',{p_store_id:storeId,p_batch_id:batchId}).abortSignal(signal));if(r.error)throw r.error;if(!r.data||typeof r.data!=='object'||Array.isArray(r.data)||r.data.queued!==true)throw Error('RETRY_NOT_CONFIRMED');return r.data;}

export async function submitReceiptFinance(storeId:string,row:import('./receipt-review').ReviewAccount,requestId:string){
 const r=await operationDeadline(signal=>client.rpc('submit_baihuayuan_receipt_finance',{p_store_id:storeId,p_batch_id:row.batch_id,p_revision:row.revision,p_source:row.source_fingerprint,p_request_id:requestId}).abortSignal(signal));
 if(r.error)throw r.error;
 if(!r.data||typeof r.data!=='object'||Array.isArray(r.data)||r.data.saved!==true)throw Error('SAVE_NOT_CONFIRMED');
 return r.data.account as unknown as import('./receipt-review').ReviewAccount;
}

export async function readReceiptStoreChoices(storeId:string,signal:AbortSignal){const r=await receiptRead(s=>client.rpc('get_receipt_store_choices',{p_store_id:storeId}).abortSignal(s),signal);if(r.error)throw r.error;if(!Array.isArray(r.data))throw Error('INVALID_RESPONSE');return r.data as {id:string;name:string}[];}
export async function correctReceiptStore(storeId:string,batchId:string,targetStoreId:string,data:Json,requestId:string){const r=await operationDeadline(signal=>client.rpc('correct_receipt_store',{p_store_id:storeId,p_batch_id:batchId,p_target_store_id:targetStoreId,p_data:data,p_request_id:requestId}).abortSignal(signal));if(r.error)throw r.error;if(!r.data||typeof r.data!=='object'||Array.isArray(r.data)||r.data.saved!==true||!r.data.account)throw Error('SAVE_NOT_CONFIRMED');return r.data.account as unknown as import('./receipt-review').ReviewAccount;}

export async function createReceiptSamePhoto(storeId:string,batchId:string,data:Json,requestId:string){
 const r=await operationDeadline(signal=>client.rpc('create_receipt_same_photo',{p_store_id:storeId,p_batch_id:batchId,p_data:data,p_request_id:requestId}).abortSignal(signal));
 if(r.error)throw r.error;if(!r.data||typeof r.data!=='object'||Array.isArray(r.data)||r.data.saved!==true||!r.data.account||!r.data.source_account)throw Error('SAVE_NOT_CONFIRMED');
 return r.data as unknown as {account:import('./receipt-review').ReviewAccount;source_account:import('./receipt-review').ReviewAccount};
}
