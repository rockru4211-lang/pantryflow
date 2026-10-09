import type {SupabaseClient} from '@supabase/supabase-js';
import type {Database,Json} from './database.types';
import {supabase} from './supabase-browser';
import {operationDeadline} from './operation-deadline';
import {receiptRead,receiptReadRows} from './receipt-read';
import type {ReceiptAccount} from './receipt-accounting';
// Narrow extension for the two additive RPCs; existing generated contracts are unchanged.
type AccountingDatabase=Omit<Database,'public'>&{public:Omit<Database['public'],'Functions'>&{Functions:Database['public']['Functions']&{
 begin_baihuayuan_receipt_manual_review:{Args:{p_store_id:string;p_batch_id:string};Returns:string};
 add_baihuayuan_receipt_draft_row:{Args:{p_store_id:string;p_batch_id:string;p_run_id:string;p_request_id:string};Returns:string};
 get_baihuayuan_receipt_accounts:{Args:{p_store_id:string;p_from?:string|null;p_to?:string|null;p_supplier?:string|null;p_batch_id?:string|null};Returns:Json};
 save_baihuayuan_receipt_review:{Args:{p_store_id:string;p_batch_id:string;p_data:Json;p_request_id:string};Returns:Json};
 get_baihuayuan_receipt_accounting:{Args:{p_store_id:string};Returns:Json};
 save_baihuayuan_receipt_reconciliation:{Args:{p_store_id:string;p_batch_id:string;p_data:Json;p_request_id:string};Returns:Json};
}}};
const client=supabase as unknown as SupabaseClient<AccountingDatabase>;
export async function readReceiptAccounts(storeId:string,signal:AbortSignal){const r=await receiptRead(s=>client.rpc('get_baihuayuan_receipt_accounting',{p_store_id:storeId}).abortSignal(s),signal);return receiptReadRows<ReceiptAccount>(r);}
export async function saveReceiptAccount(storeId:string,batchId:string,data:Json,requestId:string){const r=await client.rpc('save_baihuayuan_receipt_reconciliation',{p_store_id:storeId,p_batch_id:batchId,p_data:data,p_request_id:requestId});if(r.error)throw r.error;if(!r.data||typeof r.data!=='object'||Array.isArray(r.data)||r.data.saved!==true)throw Error('SAVE_NOT_CONFIRMED');return r.data;}

export async function readScopedReceiptAccounts(storeId:string,signal:AbortSignal,from:string,to:string,supplier:string,batchId?:string){const r=await receiptRead(s=>client.rpc('get_baihuayuan_receipt_accounts',{p_store_id:storeId,p_from:from||null,p_to:to||null,p_supplier:['ALL','__SUPPLIER__'].includes(supplier)?null:supplier||null,p_batch_id:batchId||null}).abortSignal(s),signal);return receiptReadRows<import('./receipt-review').ReviewAccount>(r);}
export async function saveReceiptReview(storeId:string,batchId:string,data:Json,requestId:string){const r=await operationDeadline(signal=>client.rpc('save_baihuayuan_receipt_review',{p_store_id:storeId,p_batch_id:batchId,p_data:data,p_request_id:requestId}).abortSignal(signal));if(r.error)throw r.error;if(!r.data||typeof r.data!=='object'||Array.isArray(r.data)||r.data.saved!==true)throw Error('SAVE_NOT_CONFIRMED');return r.data.account as unknown as import('./receipt-review').ReviewAccount;}

export async function beginReceiptManualReview(storeId:string,batchId:string){const r=await operationDeadline(signal=>client.rpc('begin_baihuayuan_receipt_manual_review',{p_store_id:storeId,p_batch_id:batchId}).abortSignal(signal));if(r.error)throw r.error;return r.data;}
export async function addReceiptDraftRow(storeId:string,batchId:string,runId:string,requestId:string){const r=await operationDeadline(signal=>client.rpc('add_baihuayuan_receipt_draft_row',{p_store_id:storeId,p_batch_id:batchId,p_run_id:runId,p_request_id:requestId}).abortSignal(signal));if(r.error)throw r.error;return r.data;}
