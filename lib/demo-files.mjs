// The isolated demo keeps originals on this device only. Nothing reaches Supabase.
const name='pantryflow-isolated-demo-files';
const fallback=new Map();
const urls=new Set();
function open(){return new Promise((resolve,reject)=>{const request=indexedDB.open(name,1);request.onupgradeneeded=()=>request.result.createObjectStore('files',{keyPath:'path'});request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
async function transaction(mode,run){const db=await open();try{return await new Promise((resolve,reject)=>{const tx=db.transaction('files',mode),store=tx.objectStore('files');let value;run(store,v=>{value=v;});tx.oncomplete=()=>resolve(value);tx.onabort=()=>reject(tx.error||Error('示範檔案未能保存，請重試。'));tx.onerror=()=>reject(tx.error);});}finally{db.close();}}
export async function saveDemoFile(path,bytes){const row={path,blob:new Blob([bytes]),expires:Date.now()+7*86400000};if(typeof indexedDB==='undefined'){fallback.set(path,row);return;}await transaction('readwrite',(store)=>{store.put(row);});}
export async function loadDemoFile(path){const row=typeof indexedDB==='undefined'?fallback.get(path):await transaction('readonly',(store,done)=>{const request=store.get(path);request.onsuccess=()=>done(request.result);});if(!row||row.expires<=Date.now())throw Error('示範原檔已到期或已清除，請重新選擇同一檔案。');return row.blob;}
export async function clearDemoFiles(){for(const url of urls)URL.revokeObjectURL(url);urls.clear();fallback.clear();if(typeof indexedDB!=='undefined')await transaction('readwrite',store=>{store.clear();});}

export async function demoFileUrl(path,seconds=60){const blob=await loadDemoFile(path);const url=URL.createObjectURL(blob);urls.add(url);const timer=setTimeout(()=>{URL.revokeObjectURL(url);urls.delete(url);},Math.min(3600,Math.max(1,seconds))*1000);timer.unref?.();return url;}
