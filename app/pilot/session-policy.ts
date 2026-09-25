'use client';
import {useEffect,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase-browser';

// Only real interaction extends inactivity. A network failure is never a logout.
export function useSessionPolicy(userId:string|undefined,storeId:string,sessionToken:string|undefined,onExpired:(fullLogin?:boolean,expectedUserId?:string,expectedStoreId?:string,expectedToken?:string)=>Promise<void>){
 const [connectionLost,setConnectionLost]=useState(false);
 const callback=useRef(onExpired);useEffect(()=>{callback.current=onExpired;},[onExpired]);
 useEffect(()=>{
  if(!userId||!storeId)return;
  let lastTouch=0;let busy=false;let stopped=false;let controller:AbortController|undefined;
  async function validate(active=false){
   if(stopped||busy||(active&&Date.now()-lastTouch<30000))return;
   if(!navigator.onLine){setConnectionLost(true);return;}
   busy=true;controller=new AbortController();
   const timeout=window.setTimeout(()=>controller?.abort(),12000);
   try{
    const {error}=await supabase.rpc('touch_app_session',{p_store_id:storeId,p_active:active}).abortSignal(controller.signal);
    if(stopped)return;
    if(error&&/AUTH_REAUTH_REQUIRED|APP_FORBIDDEN/.test(error.message)){
     await callback.current(error.message.includes('APP_FORBIDDEN'),userId,storeId,sessionToken);
    }else{
     setConnectionLost(!!error);
     if(active&&!error)lastTouch=Date.now();
    }
   }catch{if(!stopped)setConnectionLost(true);}
   finally{window.clearTimeout(timeout);busy=false;}
  }
  const interact=()=>void validate(true);
  const focus=()=>{if(document.visibilityState!=='hidden')void validate(false);};
  const offline=()=>setConnectionLost(true);
  void validate(false);
  window.addEventListener('pointerdown',interact);window.addEventListener('keydown',interact);
  window.addEventListener('focus',focus);window.addEventListener('online',focus);window.addEventListener('offline',offline);
  document.addEventListener('visibilitychange',focus);
  const timer=window.setInterval(focus,60000);
  return()=>{stopped=true;controller?.abort();window.clearInterval(timer);
   window.removeEventListener('pointerdown',interact);window.removeEventListener('keydown',interact);
   window.removeEventListener('focus',focus);window.removeEventListener('online',focus);window.removeEventListener('offline',offline);
   document.removeEventListener('visibilitychange',focus);
  };
 },[userId,storeId,sessionToken]);
 return connectionLost;
}
