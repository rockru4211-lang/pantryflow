'use client';
import {useEffect,useRef,useState} from 'react';
import {Trash2,X} from 'lucide-react';
import {supabase} from '@/lib/supabase-browser';
import {appError} from '@/lib/app-workspace';
import {operationDeadline} from '@/lib/operation-deadline';
import {functionLabels,workFunctions,type Person,type PeopleStore,type WorkFunction} from '@/lib/people-settings';
import PersonRemoval from './person-removal';
import PersonPinSettings from './person-pin-settings';
import StaffInvitationCard from './staff-invitation-card';

type Draft={name:string;identifier:string;stores:Record<string,'EDIT'|'VIEW'>;functions:WorkFunction[];defaultStore:string};
function initial(person:Person|undefined,stores:PeopleStore[]):Draft{return {name:person?.display_name||'',identifier:'',stores:person?Object.fromEntries(person.stores.map(s=>[s.id,s.access_mode||'EDIT'])):{},functions:person?workFunctions(person):['FIELD'],defaultStore:person?.default_store_id||person?.stores[0]?.id||stores[0]?.id||''};}
export default function PersonFunctionSettings({person,stores,storeId,managementStoreIds,onClose,onSaved}:{person?:Person;managementStoreIds:string[];stores:PeopleStore[];storeId:string;onClose:()=>void;onSaved:(outcome?:'removed'|'pin')=>Promise<unknown>}){
 const dialog=useRef<HTMLDialogElement>(null),lock=useRef(false),attempt=useRef<{signature:string;id:string}|undefined>(undefined);
 const [draft,setDraft]=useState(()=>initial(person,stores)),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [removing,setRemoving]=useState(false);
 const [receipt,setReceipt]=useState<{activationCode:string;expiresInDays:number;loginIdentifier:string}>();
 const editable=!person||(!person.is_removed&&person.can_edit_functions===true);
 const changed=JSON.stringify(draft)!==JSON.stringify(initial(person,stores));
 const listed=[...new Map([...stores,...(person?.stores||[])].map(s=>[s.id,s])).values()];
 useEffect(()=>{dialog.current?.showModal();},[]);
 useEffect(()=>{if(!changed||receipt)return;const warn=(e:BeforeUnloadEvent)=>e.preventDefault();window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[changed,receipt]);
 const close=()=>{if(lock.current||busy)return;if(changed&&!receipt&&!window.confirm('尚未儲存，確定捨棄修改？'))return;onClose();};
 const update=<K extends keyof Draft>(key:K,value:Draft[K])=>setDraft(d=>({...d,[key]:value}));
 const toggleFunction=(fn:WorkFunction)=>update('functions',draft.functions.includes(fn)?draft.functions.filter(f=>f!==fn):[...draft.functions,fn]);
 async function save(){
  if(lock.current||!editable||receipt)return;
  const selected=Object.entries(draft.stores).map(([store_id,access_mode])=>({store_id,access_mode}));
  if(!draft.name.trim()||!selected.length||!draft.functions.some(f=>f==='FIELD'||f==='OFFICE')||!draft.stores[draft.defaultStore]){setError('請填寫姓名、至少一家門市與一項作業功能，並選擇已授權的預設門市。');return;}
  const payload={p_store_id:storeId,p_user_id:person?.user_id||'',p_revision:person?.revision||'',p_name:draft.name.trim(),p_stores:selected,p_functions:draft.functions,p_default_store_id:draft.defaultStore};
  const signature=JSON.stringify(payload);if(attempt.current?.signature!==signature)attempt.current={signature,id:crypto.randomUUID()};
  lock.current=true;setBusy(true);setError('');
  try{
   if(person){
    const r=await operationDeadline(signal=>supabase.rpc('save_person_function_access',{...payload,p_request_id:attempt.current!.id}).abortSignal(signal));
    if(r.error)throw r.error;if(!(r.data as unknown as {saved:boolean})?.saved)throw Error('SAVE_UNCONFIRMED');
    await onSaved();onClose();
   }else{
    const first=selected[0].store_id;
    const r=await supabase.functions.invoke('manage-staff',{body:{action:'create',storeId:first,displayName:draft.name.trim(),loginIdentifier:draft.identifier.trim()||draft.name.trim(),workFunctions:draft.functions,stores:selected,defaultStoreId:draft.defaultStore}});
    if(r.error){const detail=r.error.context instanceof Response?await r.error.context.json().catch(()=>null):null;throw Error(detail?.error||r.data?.error||'CREATE_UNCONFIRMED');}
    if(!r.data?.staffId||!r.data?.login?.activationCode)throw Error('CREATE_UNCONFIRMED');
    setReceipt(r.data.login);await onSaved();
   }
  }catch(e){setError(/STAFF_ALREADY_EXISTS/.test(String(e))?'此登入識別已存在，請先確認人員名單；同名人員請使用不同的登入識別。':appError(e)+(person?' 修改內容已保留；若資料已更新，請關閉後重新開啟核對。':' 若建立結果未確認，請先重新讀取人員名單，避免重複建立。'));}
  finally{lock.current=false;setBusy(false);}
 }
 const disabled=busy||!editable||!!receipt;
 const canGrantManagement=managementStoreIds.includes(storeId)&&Object.keys(draft.stores).every(id=>managementStoreIds.includes(id));
 const functionOption=(fn:WorkFunction,description:string)=><label className="function-option" key={fn}><input type="checkbox" checked={draft.functions.includes(fn)} disabled={disabled||(fn==='MANAGE'&&!canGrantManagement)} onChange={()=>toggleFunction(fn)}/><span><strong>{functionLabels[fn]}</strong><small>{description}</small></span></label>;
 return <dialog ref={dialog} className="people-drawer" aria-labelledby="person-function-title" onCancel={e=>{e.preventDefault();close();}}>
  <header><h2 id="person-function-title">{person?'人員設定':'新增人員'}</h2><button type="button" className="text-button" aria-label="關閉" disabled={busy} onClick={close}><X/></button></header>
  <div className="people-drawer-body">
   {error&&<p className="pilot-message" role="alert">{error}</p>}
   {receipt?<section><h3>人員已建立</h3><p>登入識別：{receipt.loginIdentifier}</p><p>請將邀請連結交給本人，完成首次 PIN 設定。</p><StaffInvitationCard token={receipt.activationCode} days={receipt.expiresInDays} collapsed/></section>:person?.is_removed?<section><h3>{person.display_name}・已移除</h3><p>停止登入與門市操作，歷史作業紀錄仍保留。</p><p>原授權門市：{person.removed_stores?.map(s=>s.name).join('、')||'未分配門市'}</p><p className="people-help">如需恢復，可至「更多管理」查看已停用授權。</p></section>:removing&&person?<PersonRemoval person={person} storeId={storeId} onCancel={()=>setRemoving(false)} onBusyChange={setBusy} onRemoved={async()=>{await onSaved('removed');onClose();}}/>:<>
    {person&&<div className="person-profile-heading"><span className="partner-avatar">{person.display_name.trim().slice(0,1)}</span><strong>{person.display_name}</strong></div>}
    <label className="people-field">姓名<input value={draft.name} maxLength={64} disabled={disabled} onChange={e=>update('name',e.target.value)}/></label>
    {!person&&<label className="people-field">登入識別（選填）<input value={draft.identifier} maxLength={64} placeholder="預設使用姓名；同名時請另設識別" disabled={disabled} onChange={e=>update('identifier',e.target.value)}/></label>}
    <fieldset className="people-access"><legend>可操作門市</legend>{listed.map(s=><div className="people-access-row" key={s.id}><label><input type="checkbox" checked={!!draft.stores[s.id]} disabled={disabled||!stores.some(x=>x.id===s.id)} onChange={e=>{const next={...draft.stores};if(e.target.checked)next[s.id]='EDIT';else delete next[s.id];setDraft(d=>({...d,stores:next,defaultStore:next[d.defaultStore]?d.defaultStore:Object.keys(next)[0]||''}));}}/><strong>{s.name}</strong></label>{draft.stores[s.id]&&<select aria-label={`${s.name}操作權限`} value={draft.stores[s.id]} disabled={disabled} onChange={e=>update('stores',{...draft.stores,[s.id]:e.target.value as 'EDIT'|'VIEW'})}><option value="EDIT">可操作</option><option value="VIEW">僅查看</option></select>}</div>)}</fieldset>
    <fieldset className="people-access"><legend>作業功能</legend>{functionOption('FIELD','貨單上傳、調撥單、廢棄單、月底盤點')}{functionOption('OFFICE','貨單明細、核對、庫存、人員管理與後續行政作業')}</fieldset>
    <label className="people-field">預設門市<select value={draft.defaultStore} disabled={disabled} onChange={e=>update('defaultStore',e.target.value)}><option value="">請選擇</option>{listed.filter(s=>draft.stores[s.id]).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select><small>首次登入開啟預設門市；之後回到上次使用的門市。</small></label>
    {(canGrantManagement||draft.functions.includes('MANAGE'))&&<details className="people-advanced"><summary>更多權限</summary>{functionOption('MANAGE','門市與系統設定，由系統管理者授予')}</details>}
    {person&&<PersonPinSettings person={person} disabled={busy||changed} onBusyChange={setBusy} onChanged={()=>onSaved('pin')}/>}
    {person&&!editable&&<p className="people-help">{person.stores.some(s=>s.uses_pin)?'沿用原帳號與 PIN，儲存不會重設 PIN。':'沿用既有帳號登入方式。'}{!editable&&' 此帳號由具有完整管理權限的其他管理者維護。'}</p>}

   </>}
  </div>
  <footer><div className="people-save-actions"><button type="button" className="shell-secondary" disabled={busy} onClick={close}>{receipt?'完成':'關閉'}</button>{editable&&!receipt&&!removing&&<button type="button" className="shell-primary" disabled={busy||(!!person&&!changed)} onClick={()=>void save()}>{busy?'儲存中…':person?'儲存設定':'建立人員'}</button>}</div>{!receipt&&!removing&&(person?.can_remove&&!person.is_owner&&<div className="person-remove-entry"><button type="button" className="people-remove" disabled={busy||changed} onClick={()=>{setError('');setRemoving(true);}}><Trash2/>移除人員</button>{changed&&<small>請先儲存或捨棄目前修改，再移除人員。</small>}</div>)}</footer>
 </dialog>;
}
