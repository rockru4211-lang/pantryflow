import {supabase} from '@/lib/supabase-browser';
import {operationDeadline} from '@/lib/operation-deadline';
import type {ReminderState} from '@/lib/custody-reminders';
export async function reminderRequest(storeId:string,action='read',data:Record<string,unknown>={},requestId=crypto.randomUUID()){
 const result=await operationDeadline(signal=>(supabase.rpc as unknown as (name:string,args:Record<string,unknown>)=>{abortSignal:(s:AbortSignal)=>PromiseLike<{data:unknown;error:{message:string}|null}>})('baihuayuan_custody_reminders',{p_store_id:storeId,p_action:action,p_data:data,p_request_id:requestId}).abortSignal(signal));
 if(result.error)throw result.error;return result.data as ReminderState;
}
