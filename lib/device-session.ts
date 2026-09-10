import type {Session} from '@supabase/supabase-js';
type StorePolicy={settings:Record<string,string|number|boolean>};
type SessionStorage=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
export const openSessionKey=(userId:string)=>`pantryflow:open-session:${userId}`;
export function markAppSession(session:Session,storage:SessionStorage=sessionStorage){
 try{storage.setItem(openSessionKey(session.user.id),'active');}catch{/* Storage denial requires login on a new opening. */}
}
export function requiresDeviceLogin(userId:string,stores:StorePolicy[],storage:SessionStorage=sessionStorage){
 const restricted=stores.some(({settings:s})=>s.remember_device===false||s.device_type==='SHARED'||s.reauth_days===0);
 if(!restricted)return false;
 try{return storage.getItem(openSessionKey(userId))!=='active';}catch{return true;}
}
