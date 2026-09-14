// Demo drafts and retry tokens are isolated from real accounts, including invited staff.
const prefix='pantryflow:isolated-demo-draft:';
const fallback=new Map<string,string>();
function storage(){try{return typeof localStorage==='undefined'?null:localStorage;}catch{return null;}}
const demo={
 getItem(key:string){const s=storage();if(!s)return fallback.get(key)??null;try{const raw=s.getItem(prefix+key);if(!raw)return null;const saved=JSON.parse(raw);if(saved.expires>Date.now()&&typeof saved.value==='string')return saved.value;s.removeItem(prefix+key);}catch{}return null;},
 setItem(key:string,value:string){const s=storage();if(!s){fallback.set(key,value);return;}s.setItem(prefix+key,JSON.stringify({value,expires:Date.now()+7*86400000}));},
 removeItem(key:string){fallback.delete(key);storage()?.removeItem(prefix+key);}
};
export function workspaceStorage(userId:string){return userId.startsWith('demo-')?demo:localStorage;}
export function clearDemoDrafts(){fallback.clear();const s=storage();if(!s)return;for(let i=s.length-1;i>=0;i--){const key=s.key(i);if(key?.startsWith(prefix))s.removeItem(key);}}
