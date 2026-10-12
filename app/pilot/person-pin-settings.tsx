'use client';
import {useRef,useState} from 'react';
import {supabase} from '@/lib/supabase-browser';
import {operationDeadline} from '@/lib/operation-deadline';
import {personPinLabel,type Person} from '@/lib/people-settings';
export async function savePersonPin(storeId:string,userId:string,pin:string,requestId:string){
 const r=await operationDeadline(signal=>(supabase.rpc as unknown as (name:string,args:Record<string,string>)=>ReturnType<typeof supabase.rpc>)('set_person_pin',{p_store_id:storeId,p_user_id:userId,p_pin:pin,p_request_id:requestId}).abortSignal(signal));
 if(r.error)throw r.error;
 const result=r.data as unknown as {saved:boolean;user_id:string};
 if(!result?.saved||result.user_id!==userId)throw Error('PIN_SAVE_UNCONFIRMED');
}
export default function PersonPinSettings({person,disabled,onBusyChange,onChanged,initialOpen=false}:{person:Person;disabled:boolean;onBusyChange:(busy:boolean)=>void;onChanged:()=>Promise<unknown>;initialOpen?:boolean}){
 const lock=useRef(false),request=useRef('');
 const [editing,setEditing]=useState(initialOpen),[pin,setPin]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false);
 const canSet=!!person.pin_reset_store_id&&!person.is_removed&&!person.is_owner;
 async function save(){
  if(lock.current||disabled||!canSet)return;
  if(!/^\d{6}$/.test(pin)){setError('請輸入 6 位數字 PIN。');return;}
  lock.current=true;setBusy(true);onBusyChange(true);setError('');request.current||=crypto.randomUUID();
  try{await savePersonPin(person.pin_reset_store_id!,person.user_id,pin,request.current);setPin('');setEditing(false);setSaved(true);request.current='';await onChanged();}
  catch{setError('PIN 未能確認儲存，請重試。');}
  finally{lock.current=false;setBusy(false);onBusyChange(false);}
 }
 return <section className="person-pin-card" aria-label="登入 PIN"><div className="person-pin-heading"><strong>{saved?'PIN 已更新':personPinLabel(person)}</strong>{canSet&&!editing&&<button type="button" className="text-button" disabled={disabled||busy} onClick={()=>setEditing(true)}>重設 PIN</button>}</div><p>調整權限不影響原 PIN。重設後，原 PIN 失效，該人員需重新登入。</p>{editing&&canSet&&<div className="people-pin-edit"><label className="people-field">新 PIN<input type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} value={pin} disabled={disabled||busy} onChange={e=>{setPin(e.target.value.replace(/\D/g,''));request.current='';}}/></label><button type="button" className="people-edit" disabled={disabled||busy} onClick={()=>void save()}>{busy?'儲存中…':'儲存 PIN'}</button><button type="button" className="text-button" disabled={busy} onClick={()=>{setEditing(false);setPin('');}}>取消</button></div>}{error&&<p role="alert">{error}</p>}</section>;
}
