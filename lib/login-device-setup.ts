import type {DevicePolicy} from './login-device';

type PolicyResult={data:unknown;error:{message:string}|null};
export type DeviceSetupActions={authorize:()=>Promise<void>;choose:(personal:boolean)=>Promise<PolicyResult>};
// Presentation never grants trust. Only an explicit checkbox selection may call
// the existing manager-only authorization operation. Server guards still decide.
export async function settleLoginDevice(policy:DevicePolicy,requestedPersonal:boolean|undefined,actions:DeviceSetupActions):Promise<DevicePolicy>{
 if(!policy.choice_required)return policy;
 let personal=!!policy.personal_allowed&&requestedPersonal!==false;
 if(requestedPersonal===true&&!personal&&policy.can_authorize_personal){await actions.authorize();personal=true;}
 const result=await actions.choose(personal);
 // A tab left on the removed prompt may be older than the fresh-login window.
 // Keep its existing server policy; do not force another sign-in just for setup.
 if(result.error?.message.includes('FRESH_LOGIN_REQUIRED'))return policy;
 if(result.error)throw result.error;
 return result.data as DevicePolicy;
}

const oauthPreferenceKey='pantryflow:oauth-device-preference';
type Storage=Pick<globalThis.Storage,'getItem'|'setItem'|'removeItem'>;
export function rememberOAuthDevice(personal:boolean,storage:Storage,now=Date.now()){
 try{storage.setItem(oauthPreferenceKey,JSON.stringify({personal,expires:now+10*60*1000}));}catch{}
}
export function takeOAuthDevice(storage:Storage,now=Date.now()):boolean|undefined{
 try{const raw=storage.getItem(oauthPreferenceKey);storage.removeItem(oauthPreferenceKey);const value=JSON.parse(raw||'null');return value&&typeof value.personal==='boolean'&&value.expires>now?value.personal:undefined;}catch{return undefined;}
}
