import type {SupabaseClient} from '@supabase/supabase-js';
import type {Database,Json} from './database.types';
import {supabase} from './supabase-browser';
import {receiptRead,receiptReadRows} from './receipt-read';
import type {ReceiptAccount} from './receipt-accounting';
// Narrow extension for the two additive RPCs; existing generated contracts are unchanged.
type AccountingDatabase=Omit<Database,'public'>&{public:Omit<Database['public'],'Functions'>&{Functions:Database['public']['Functions']&{
 get_baihuayuan_receipt_accounting:{Args:{p_store_id:string};Returns:Json};
 save_baihuayuan_receipt_reconciliation:{Args:{p_store_id:string;p_batch_id:string;p_data:Json;p_request_id:string};Returns:Json};
}}};
const client=supabase as unknown as SupabaseClient<AccountingDatabase>;
export async function readReceiptAccounts(storeId:string,signal:AbortSignal){const r=await receiptRead(s=>client.rpc('get_baihuayuan_receipt_accounting',{p_store_id:storeId}).abortSignal(s),signal);return receiptReadRows<ReceiptAccount>(r);}
export async function saveReceiptAccount(storeId:string,batchId:string,data:Json,requestId:string){const r=await client.rpc('save_baihuayuan_receipt_reconciliation',{p_store_id:storeId,p_batch_id:batchId,p_data:data,p_request_id:requestId});if(r.error)throw r.error;if(!r.data||typeof r.data!=='object'||Array.isArray(r.data)||r.data.saved!==true)throw Error('SAVE_NOT_CONFIRMED');return r.data;}
