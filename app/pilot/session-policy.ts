'use client';
import {useEffect,useRef} from 'react';
import {supabase} from '@/lib/supabase-browser';

// Background polling cannot extend the idle timeout. Only a real interaction
// touches the server timestamp; opening/focusing still validates membership.
export function useSessionPolicy(userId:string|undefined,storeId:string,onExpired:(fullLogin?:boolean)=>Promise<void>){
 const callback=useRef(onExpired);useEffect(()=>{callback.current=onExpired;},[onExpired]);
 useEffect(()=>{
  if(!userId||!storeId)return;
  let lastTouch=0;let busy=false;let stopped=false;
  async function validate(active=false){
   if(stopped||busy||(active&&Date.now()-lastTouch<30000))return;
   busy=true;
   const {error}=await supabase.rpc('touch_app_session',{p_store_id:storeId,p_active:active});
   busy=false;if(active&&!error)lastTouch=Date.now();
   if(!stopped&&error&&/AUTH_REAUTH_REQUIRED|APP_FORBIDDEN/.test(error.message)){stopped=true;await callback.current(error.message.includes('APP_FORBIDDEN'));}
  }
  const interact=()=>void validate(true);const focus=()=>void validate(false);
  void validate(false);window.addEventListener('pointerdown',interact);window.addEventListener('keydown',interact);window.addEventListener('focus',focus);
  const timer=window.setInterval(focus,60000);
  return()=>{stopped=true;window.clearInterval(timer);window.removeEventListener('pointerdown',interact);window.removeEventListener('keydown',interact);window.removeEventListener('focus',focus);};
 },[userId,storeId]);
}
