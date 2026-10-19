import type {SupabaseClient} from '@supabase/supabase-js';
import type {Database,Json} from './database.types';
import {supabase} from './supabase-browser';
import {operationDeadline} from './operation-deadline';
export type FieldProduct={id:string;name:string;unit:string;store_id?:string;created?:boolean};
export type FieldOptions={store_name:string;products:FieldProduct[];suppliers:{id:string;name:string;aliases?:string[]}[];units:string[]};
type FieldDatabase=Omit<Database,'public'>&{public:Omit<Database['public'],'Functions'>&{Functions:Database['public']['Functions']&{
 field_product_options:{Args:{p_store_id:string;p_target_store_id:string};Returns:Json};
 create_field_product:{Args:{p_store_id:string;p_target_store_id:string;p_data:Json;p_request_id:string};Returns:Json};
}}};
const client=supabase as unknown as SupabaseClient<FieldDatabase>;
export async function fieldOptions(store:string,target:string):Promise<FieldOptions>{
 const {data,error}=await operationDeadline(signal=>client.rpc('field_product_options',{p_store_id:store,p_target_store_id:target}).abortSignal(signal));
 if(error)throw error;return data as unknown as FieldOptions;
}
export async function saveFieldProduct(store:string,target:string,payload:Json,id:string):Promise<FieldProduct>{
 const {data,error}=await operationDeadline(signal=>client.rpc('create_field_product',{p_store_id:store,p_target_store_id:target,p_data:payload,p_request_id:id}).abortSignal(signal));
 if(error)throw error;const result=data as unknown as FieldProduct;if(!result?.id||!result.name||!result.unit)throw Error('尚未確認儲存結果，請重試。');return result;
}
export function fieldProductError(e:unknown){
 const message=e&&typeof e==='object'&&'message' in e?String(e.message):String(e);
 if(/FIELD_PRODUCT_REMOVED/.test(message))return '此品項已停用或移除，請由後勤確認是否恢復。';
 if(/FIELD_PRODUCT_EXISTS/.test(message))return '已有相同品項，請選用既有資料；供應商與價格可由後勤補填。';
 if(/FIELD_PRODUCT_AMBIGUOUS/.test(message))return '有多筆相同名稱與單位，請從既有品項中選擇。';
 if(/FIELD_PRODUCT_CHANGED/.test(message))return '品項資料已變更，請重新讀取後選擇。';
 if(/COUNT_ZONE_NOT_AVAILABLE/.test(message))return '此盤點區域已完成或無法加入，請回原畫面確認。';
 if(/APP_FORBIDDEN|STORE.*REQUIRED|STORE.*READ/.test(message))return '目前沒有此門市的新增權限。';
 if(/FIELD_PRODUCT_REQUIRED/.test(message))return '請填寫品名與單位。';
 if(/INVALID_PRICE/.test(message))return '請填有效進價，或留白之後補填。';
 return '尚未確認儲存結果，內容已保留。請重試，系統不會重複建檔。';
}
