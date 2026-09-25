/** Bound reads even when auth/token acquisition or a transport ignores abort. Writes never use this helper. */
export async function receiptRead<T>(run:(signal:AbortSignal)=>PromiseLike<T>,parent:AbortSignal,milliseconds=12000):Promise<T> {
 const controller=new AbortController();
 let timer:ReturnType<typeof setTimeout>|undefined;
 let cancel:()=>void=()=>{};
 try {
  return await Promise.race([
   new Promise<never>((_resolve,reject)=>{
    cancel=()=>{reject(new Error('RECEIPT_READ_CANCELLED'));controller.abort();};
    if(parent.aborted){cancel();return;}
    parent.addEventListener('abort',cancel,{once:true});
    timer=setTimeout(()=>{reject(new Error('RECEIPT_READ_TIMEOUT'));controller.abort();},milliseconds);
   }),
   Promise.resolve().then(()=>{if(controller.signal.aborted)throw new Error('RECEIPT_READ_CANCELLED');return run(controller.signal);}),
  ]);
 } finally {clearTimeout(timer);parent.removeEventListener('abort',cancel);}
}

export function receiptReadError(error:unknown) {
 const message=error&&typeof error==='object'&&'message' in error?String(error.message):String(error);
 if(/TIMEOUT|57014|statement timeout|AbortError/i.test(message))return '讀取逾時，請重新讀取。原始進貨資料仍保留。';
 if(/42501|REQUIRED|DENIED|FORBIDDEN|JWT|token.*expired/i.test(message))return '目前無法確認此門市的存取權限，請重新登入後再試。';
 return '暫時無法讀取，請檢查網路後重試。原始進貨資料仍保留。';
}

export function receiptReadRows<T>(response:{data:unknown;error:unknown}):T[] {
 if(response.error)throw response.error;
 // A null/invalid payload is not evidence of an empty ledger.
 if(!Array.isArray(response.data))throw new Error('RECEIPT_READ_INVALID');
 return response.data as T[];
}
