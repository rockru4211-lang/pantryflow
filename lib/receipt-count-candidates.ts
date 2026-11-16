import {supabase} from './supabase-browser';
import {operationDeadline} from './operation-deadline';

export type ReceiptCountCandidate = {
 id:string;name:string;unit:string;specification:string;supplier:string|null;receipt_date:string;
 receipt_name?:string;purchase_unit?:string;revision?:string;
};
export type ReceiptCountCandidates = {rows:ReceiptCountCandidate[];zones:{id:string;name:string}[];editable:boolean};
export type ReceiptCountTarget = {
 id:string;name:string;units:string[];supplier:string;specification:string;code:string;
 can_remember:boolean;revision:string;
};
type CandidateResult = {
 list:ReceiptCountCandidates;
 'match-options':{items:ReceiptCountTarget[]};
 add:{saved:true;count:number};
 dismiss:{saved:true;count:number};
 match:{saved:true;target_name:string};
};
type CandidateAction = keyof CandidateResult;
const rpc=supabase.rpc as unknown as (name:string,args:Record<string,unknown>)=>{abortSignal:(signal:AbortSignal)=>PromiseLike<{data:unknown;error:unknown}>};

export async function receiptCountCandidates<Action extends CandidateAction = 'list'>(
 store:string,action:Action='list' as Action,data:Record<string,unknown>={},request:string|null=null,signal?:AbortSignal,
):Promise<CandidateResult[Action]>{
 const result=await operationDeadline(deadline=>rpc('baihuayuan_receipt_count_candidates',{
  p_store_id:store,p_action:action,p_data:data,p_request_id:request,
 }).abortSignal(signal?AbortSignal.any([deadline,signal]):deadline));
 if(result.error)throw result.error;
 const response=result.data as {rows?:unknown;items?:unknown;saved?:boolean}|null;
 if(action==='list'?!Array.isArray(response?.rows):action==='match-options'?!Array.isArray(response?.items):response?.saved!==true)
  throw Error('SAVE_NOT_CONFIRMED');
 return result.data as CandidateResult[Action];
}
export function receiptCandidateError(e:unknown){
 const m=e&&typeof e==='object'&&'message'in e?String(e.message):String(e);
 if(/COUNT_ALIAS_CONFLICT/.test(m))return '此進貨別名已對應其他食材，請核對後重新選擇。';
 if(/COUNT_ALIAS_STOPPED/.test(m))return '此品項已停用這個供應商。可取消記住別名，再確認配對。';
 if(/COUNT_ALIAS_UNAVAILABLE/.test(m))return '目前無法記住這個供應商別名，可取消勾選後確認配對。';
 if(/CHANGED/.test(m))return '清單已更新，請重新讀取後選取。';
 if(/ZONE_REQUIRED/.test(m))return '請選擇本店儲物區。';
 if(/FORBIDDEN|REQUIRED|READ_ONLY/.test(m))return '目前身分無法修改這份盤點清單。';
 return '暫時無法完成，選取仍保留，可重試。';
}
