'use client';
import {useRef,useState} from 'react';
import {supabase} from '@/lib/supabase-browser';
import {operationDeadline} from '@/lib/operation-deadline';
import {appError} from '@/lib/app-workspace';
import {personHandoffs,type Person} from '@/lib/people-settings';

export default function PersonRemoval({person,storeId,onCancel,onRemoved,onBusyChange}:{person:Person;storeId:string;onCancel:()=>void;onRemoved:()=>Promise<void>;onBusyChange:(busy:boolean)=>void}){
 const [handoffs,setHandoffs]=useState<Record<string,string>>({}),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const lock=useRef(false),attempt=useRef<{signature:string;id:string}|undefined>(undefined);
 async function remove(){
  if(lock.current||person.can_remove!==true||person.is_removed||person.is_owner)return;
  const selection=personHandoffs(person,handoffs);
  if(!selection){setError('請為每家有待辦事項的門市選擇接手人。');return;}
  const payload={p_store_id:storeId,p_user_id:person.user_id,p_revision:person.revision,p_handoffs:selection};
  const signature=JSON.stringify(payload);if(attempt.current?.signature!==signature)attempt.current={signature,id:crypto.randomUUID()};
  lock.current=true;setBusy(true);onBusyChange(true);setError('');
  try{
   const r=await operationDeadline(signal=>supabase.rpc('remove_person_access',{...payload,p_request_id:attempt.current!.id}).abortSignal(signal));
   if(r.error)throw r.error;
   const result=r.data as unknown as {removed:boolean;user_id:string};
   if(!result?.removed||result.user_id!==person.user_id)throw Error('REMOVE_UNCONFIRMED');
   await onRemoved();
  }catch(e){setError(/HANDOFF_REQUIRED|INVALID_RESPONSIBLE|REVISION_CONFLICT/.test(String((e as {message?:string})?.message))?'人員或待辦資料已更新，請關閉後重新開啟，確認最新交接內容。':appError(e)+' 可重試；系統會避免重複移除。');}
  finally{lock.current=false;setBusy(false);onBusyChange(false);}
 }
 return <section className="person-removal-confirm" aria-labelledby="remove-person-title">
  <h3 id="remove-person-title">移除 {person.display_name}？</h3>
  <p>確認後停止此人員的門市登入與操作，並移至「已移除」。歷史紀錄、經手人資料與原 PIN 會保留。</p>
  <div className="removal-store-list">{(person.removal_stores||[]).map(store=><section key={store.id}><strong>{store.name}</strong><small>{store.pending_count>0?`${store.pending_count} 筆待交接事項`:'沒有待交接事項'}</small>{store.pending_count>0&&<label className="people-field">{store.name} 接手人<select value={handoffs[store.id]||''} disabled={busy} onChange={e=>setHandoffs(h=>({...h,[store.id]:e.target.value}))}><option value="">請選擇接手人</option>{store.handoff_candidates.map(p=><option key={p.user_id} value={p.user_id}>{p.display_name}</option>)}</select></label>}</section>)}</div>
  {error&&<p className="pilot-message" role="alert">{error}</p>}
  <div className="removal-actions"><button type="button" className="shell-secondary" disabled={busy} onClick={onCancel}>取消</button><button type="button" className="shell-primary danger" disabled={busy||!personHandoffs(person,handoffs)} onClick={()=>void remove()}>{busy?'移除中…':'確認移除'}</button></div>
 </section>;
}
