import { supabase } from './supabase-browser';
import type {Json} from './database.types';

export type AppRole = 'STAFF' | 'SUPERVISOR' | 'LOGISTICS' | 'OWNER';
export type AppStore = {
  id: string; organization_id: string; name: string; store_code: string; staff_login_mode: string;login_identifier?:string|null;
  business_type: 'SINGLE_RESTAURANT' | 'CHAIN_RESTAURANT'; has_erp: boolean;
  store_mode: 'SINGLE' | 'MULTI'; role: AppRole; can_manage_business?: boolean; is_business_responsible?: boolean; permissions?: {reports_view:boolean;data_export:boolean}; linked_store_count: number;
  settings: Record<string, string | number | boolean>; settings_revision: number;
};
export function parseAppContext(value: unknown): {user_id:string;stores:AppStore[]} {
  if (!value || typeof value !== 'object') throw Error('INVALID_APP_CONTEXT');
  const data = value as {user_id?:unknown; stores?:unknown};
  if(typeof data.user_id !== 'string' || !Array.isArray(data.stores)) throw Error('INVALID_APP_CONTEXT');
  for (const store of data.stores) {
    if (!store || typeof store.id !== 'string' || typeof store.organization_id !== 'string' || !['STAFF','SUPERVISOR','LOGISTICS','OWNER'].includes(store.role)) throw Error('INVALID_APP_CONTEXT');
  }
  return data as {user_id:string;stores:AppStore[]};
}
export function roleLabel(role:AppRole, businessType:string) {
  if(role==='STAFF') return '員工';
  if(role==='OWNER') return '老闆';
  if(role==='LOGISTICS') return businessType==='CHAIN_RESTAURANT'?'區主管':'行政／後勤';
  return businessType==='CHAIN_RESTAURANT'?'店長':'主管';
}
export function canManageBusiness(store:AppStore) { return store.can_manage_business === true; }
export function canViewReports(store:AppStore) { return store.permissions?.reports_view ?? store.role!=='STAFF'; }
export function canExportData(store:AppStore) { return store.permissions?.data_export ?? store.role!=='STAFF'; }
export function hasCrossStore(store:AppStore) { return store.store_mode==='MULTI' && store.linked_store_count>1; }
export function appError(error:unknown):string {
  const raw = error && typeof error==='object' && 'message' in error ? String(error.message) : String(error);
  if(/DEMO_UNAVAILABLE/.test(raw)) return '這項操作未開放免登入體驗。請使用其他示範功能，或登入正式帳號操作。';
  if(/MEMBER_ALREADY_ASSIGNED/.test(raw)) return '此成員已有門市授權，請從成員清單調整，不必重新邀請。';
  if(/INVITE_ROLE_CHANGED/.test(raw)) return '此 Email 已有待接受的邀請，若要更換身分，請先撤銷原邀請。';
  if(/ACTIVE_MANAGER_REQUIRED/.test(raw)) return '請選擇已啟用、已驗證且具有本店權限的管理成員。';
  if(/BUSINESS_ADMIN_REQUIRED|BUSINESS_RESPONSIBLE_REQUIRED|FORBIDDEN|ROLE_REQUIRED|OWNER_REQUIRED|CANNOT_CHANGE_OWNER_OR_SELF|permission denied/.test(raw)) return '目前身分沒有這項操作權限，請洽商家管理者。';
  if(/REVISION_CONFLICT|REQUEST_CONFLICT/.test(raw)) return '資料已由其他人更新。請重新讀取最新紀錄，再確認本次修改。';
  if(/RETURN_EXCEEDS/.test(raw)) return '本次歸還數量超過尚未歸還數量，請重新確認。';
  if(/ALREADY_CLOSED/.test(raw)) return '這筆借貸已結清，請重新開啟查看結果。';
  if(/MULTI_STORE_REQUIRED/.test(raw)) return '此商家目前沒有可串聯的其他門市。';
  if(/UNIT_CONVERSION_REQUIRED/.test(raw)) return '請確認貨單單位與正式商品的換算數量。';
  if(/HANDOFF_REQUIRED/.test(raw)) return '這位成員仍有待接續事項，請從離職交接指定接手人後停用。';
  if(/INVALID|23514|not-null/.test(raw)) return '請確認必填資料、數量與日期是否正確。';
  if(/NOT_FOUND/.test(raw)) return '找不到這筆資料，或目前身分已無法操作。';
  if(/23505|duplicate key/.test(raw)) return '此名稱、編碼或登入識別已被使用，請確認既有資料。';
  return '目前無法完成，輸入內容已保留，請稍後再試。';
}
export async function readWorkspace<T>(storeId:string,section:string,filter:Record<string,unknown>={}) {
  const {data,error}=await supabase.rpc('app_workspace',{p_store_id:storeId,p_section:section,p_filter:filter as Json});
  if(error) throw error; return data as T;
}
export async function writeOperation<T=Record<string,unknown>>(storeId:string,action:string,data:Record<string,unknown>,requestId:string) {
  const result=await supabase.rpc('app_operation',{p_store_id:storeId,p_action:action,p_data:data as Json,p_request_id:requestId});
  if(result.error) throw result.error; return result.data as T;
}
export function monthRange(month:string) {
  const [y,m]=month.split('-').map(Number);
  return {from:new Date(y,m-1,1).toISOString(),to:new Date(y,m,1).toISOString()};
}
export function localMonth() {const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;}
export function groupedQuantities<T extends {name:string;unit:string;quantity:number|string}>(rows:T[]) {
 const totals=new Map<string,{name:string;unit:string;quantity:number}>();
 for(const row of rows){const key=JSON.stringify([row.name,row.unit]);const qty=Number(row.quantity);if(!Number.isFinite(qty))continue;const previous=totals.get(key);totals.set(key,{name:row.name,unit:row.unit,quantity:(previous?.quantity||0)+qty});}
 return [...totals.values()];
}
