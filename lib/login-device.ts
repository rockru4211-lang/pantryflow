// Device memory contains display/login hints only, never a PIN, password or token.
export type DevicePolicy = { authorized: boolean; device_type: 'PERSONAL'|'SHARED'; remember_device: boolean; reauth_days: number };
export type LoginMemory = { storeCode:string; loginMode:string; storeName:string; policy:DevicePolicy; identifier?:string; displayName?:string; email?:string };
export const loginMemoryKey='pantryflow:login-device-memory';
export function deviceId(storage:Storage=localStorage){let id=storage.getItem('pantryflow:device-id');if(!id){id=crypto.randomUUID();storage.setItem('pantryflow:device-id',id);}return id;}
export function readLoginMemory(storage:Storage=localStorage):LoginMemory|null {try{const value=JSON.parse(storage.getItem(loginMemoryKey)||'null');return value&&typeof value.storeCode==='string'&&value.policy?value:null;}catch{return null;}}
export function writeLoginMemory(value:LoginMemory,storage:Storage=localStorage){try{const personal=value.policy.authorized&&value.policy.remember_device&&value.policy.device_type==='PERSONAL';storage.setItem(loginMemoryKey,JSON.stringify(personal?value:{storeCode:value.storeCode,storeName:value.storeName,loginMode:value.loginMode,policy:value.policy}));}catch{/* Login remains available with storage blocked. */}}
export function clearLoginMemory(storage:Storage=localStorage){try{storage.removeItem(loginMemoryKey);}catch{/* Private browsing. */}}
export function devicePolicySummary(policy?:DevicePolicy){if(!policy)return '登入裝置政策由主管管理。';const time=policy.reauth_days===0?'每次':`未使用 ${policy.reauth_days} 天`;return `${policy.authorized&&policy.remember_device?(policy.device_type==='PERSONAL'?'個人裝置記住門市與身分':'共用裝置只記住門市'):'此裝置不記住身分'}；${time}重新驗證。`;}
