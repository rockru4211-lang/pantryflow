import {supabase} from './supabase-browser';
import {operationDeadline} from './operation-deadline';
export type ReceiptCountCandidate={id:string;name:string;unit:string;specification:string;supplier:string|null;receipt_date:string};
export type ReceiptCountCandidates={rows:ReceiptCountCandidate[];zones:{id:string;name:string}[];editable:boolean};
const rpc=supabase.rpc as unknown as (name:string,args:Record<string,unknown>)=>{abortSignal:(signal:AbortSignal)=>PromiseLike<{data:unknown;error:unknown}>};
export async function receiptCountCandidates(store:string,action='list',data:Record<string,unknown>={},request:string|null=null,signal?:AbortSignal){
 const run=(s:AbortSignal)=>rpc('baihuayuan_receipt_count_candidates',{p_store_id:store,p_action:action,p_data:data,p_request_id:request}).abortSignal(s);
 const result=await (signal?run(signal):operationDeadline(run));if(result.error)throw result.error;
 if(!result.data||typeof result.data!=='object'||(action==='list'?!Array.isArray((result.data as ReceiptCountCandidates).rows):(result.data as {saved?:boolean}).saved!==true))throw Error('SAVE_NOT_CONFIRMED');
 return result.data as ReceiptCountCandidates;
}
export function receiptCandidateError(e:unknown){const m=e&&typeof e==='object'&&'message'in e?String(e.message):String(e);if(/CHANGED/.test(m))return '清單已更新，請重新讀取後選取。';if(/ZONE_REQUIRED/.test(m))return '請選擇本店儲物區。';if(/FORBIDDEN|REQUIRED|READ_ONLY/.test(m))return '目前身分無法修改這份盤點清單。';return '暫時無法完成，選取仍保留，可重試。';}
