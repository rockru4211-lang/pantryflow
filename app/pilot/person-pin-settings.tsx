'use client';
import {useRef,useState} from 'react';
import {ShieldCheck} from 'lucide-react';
import {supabase} from '@/lib/supabase-browser';
import {personPinLabel,type Person} from '@/lib/people-settings';
import StaffInvitationCard from './staff-invitation-card';

export default function PersonPinSettings({person,disabled,onBusyChange,onChanged}:{person:Person;disabled:boolean;onBusyChange:(busy:boolean)=>void;onChanged:()=>Promise<unknown>}) {
 const lock=useRef(false);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[invitation,setInvitation]=useState<{token:string;days:number;reset:boolean}>();
 const canIssue=!!person.pin_reset_store_id&&!person.is_removed&&!person.is_owner;
 async function issue(){
  if(lock.current||disabled||!canIssue)return;
  const reset=person.pin_status==='SET';
  if(reset&&!window.confirm(`重設 ${person.display_name} 的 PIN？原 PIN 將停止使用，需由本人透過新連結設定。`))return;
  lock.current=true;setBusy(true);onBusyChange(true);setError('');
  try{
   const {data,error:failure}=await supabase.functions.invoke('manage-staff',{body:{action:'reset_pin',staffId:person.user_id,storeId:person.pin_reset_store_id}});
   if(failure||data?.staffId!==person.user_id||!data?.activationCode)throw Error('PIN_LINK_UNCONFIRMED');
   setInvitation({token:data.activationCode,days:data.expiresInDays||7,reset});
   await onChanged();
  }catch{setError('設定連結未能確認，請重新讀取人員狀態後再試。');}
  finally{lock.current=false;setBusy(false);onBusyChange(false);}
 }
 return <section className="person-pin-card" aria-label="登入 PIN">
  <div className="person-pin-heading"><ShieldCheck aria-hidden="true"/><strong>{invitation?'等待本人設定 PIN':personPinLabel(person)}</strong>
   {canIssue&&!invitation&&<button type="button" className="text-button" disabled={disabled||busy} onClick={()=>void issue()}>{busy?'產生中…':person.pin_status==='SET'?'重設 PIN':'產生設定連結'}</button>}
  </div>
  <p>{person.pin_status==='OTHER'?'沿用既有帳號登入方式。':'調整門市與功能不影響原 PIN。'}</p>
  {error&&<p className="pilot-message" role="alert">{error}</p>}
  {invitation&&<StaffInvitationCard token={invitation.token} days={invitation.days} purpose={invitation.reset?'reset':'first'}/>}
 </section>;
}
