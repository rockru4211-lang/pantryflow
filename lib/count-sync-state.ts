import type {CountCardDraft} from './count-card-drafts';
export type CountRecovery = {drafts:Record<string,CountCardDraft>;versions:Record<string,string|null>;requests:[string,string][];zone:string};
type StorageLike = Pick<Storage,'getItem'|'setItem'|'removeItem'>;
export const countRecoveryKey=(user:string,store:string,session:string)=>`count-recovery:v1:${user}:${store}:${session}`;
export function writeCountRecovery(storage:StorageLike,key:string,value:CountRecovery):boolean {
 try{if(Object.keys(value.drafts).length)storage.setItem(key,JSON.stringify(value));else storage.removeItem(key);return true;}catch{return false;}
}
export function readCountRecovery(storage:StorageLike,key:string):CountRecovery|null {
 const raw=storage.getItem(key);if(!raw)return null;
 const value=JSON.parse(raw) as CountRecovery;
 if(!value||!value.drafts||!value.versions||!Array.isArray(value.requests)||typeof value.zone!=='string')throw Error('INVALID_COUNT_RECOVERY');
 for(const [id,draft] of Object.entries(value.drafts))if(!id.includes(':')||!draft||typeof draft.quantity!=='string'||typeof draft.note!=='string'||!(value.versions[id]===null||typeof value.versions[id]==='string'))throw Error('INVALID_COUNT_RECOVERY');
 if(value.requests.some(row=>!Array.isArray(row)||row.length!==2||row.some(v=>typeof v!=='string')))throw Error('INVALID_COUNT_RECOVERY');
 return value;
}
export function countAuthRequired(error:unknown):boolean {
 const value=error as {code?:string;message?:string}|null;
 return /PGRST30[123]|JWT.*(expired|invalid)|refresh_token_not_found|AUTH_REQUIRED|SESSION_EXPIRED|REAUTH_REQUIRED/i.test(`${value?.code||''} ${value?.message||''}`);
}
export function countSyncState(input:{pending:number;invalid:boolean;failed:boolean;unavailable:boolean;auth:boolean;ready:boolean;storageFailed:boolean}) {
 const attention=input.invalid||input.failed||input.unavailable||input.auth||input.storageFailed;
 const label=input.auth?'登入需更新':input.storageFailed?'暫存需處理':input.pending?`待同步 ${input.pending} 筆`:input.unavailable?'連線待恢復':!input.ready?'讀取中…':'✓ 已同步';
 return {label,attention};
}
