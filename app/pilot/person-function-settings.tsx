'use client';
import {useEffect,useRef,useState} from 'react';
import {Trash2,X} from 'lucide-react';
import {supabase} from '@/lib/supabase-browser';
import {appError} from '@/lib/app-workspace';
import {operationDeadline} from '@/lib/operation-deadline';
import {functionLabels,workFunctions,type Person,type PeopleStore,type WorkFunction} from '@/lib/people-settings';
import PersonRemoval from './person-removal';
import PersonPinSettings from './person-pin-settings';
import {savePersonPin} from './person-pin-settings';

type Draft={name:string;identifier:string;stores:Record<string,'EDIT'|'VIEW'>;functions:WorkFunction[];defaultStore:string};
function initial(person:Person|undefined,stores:PeopleStore[]):Draft{return {name:person?.display_name||'',identifier:'',stores:person?Object.fromEntries(person.stores.map(s=>[s.id,s.access_mode||'EDIT'])):{},functions:person?workFunctions(person):['FIELD'],defaultStore:person?.default_store_id||person?.stores[0]?.id||stores[0]?.id||''};}
export default function PersonFunctionSettings({person,stores,storeId,managementStoreIds,onClose,onSaved,initialMode='edit'}:{initialMode?:'edit'|'pin'|'remove';person?:Person;managementStoreIds:string[];stores:PeopleStore[];storeId:string;onClose:()=>void;onSaved:(outcome?:'removed'|'pin')=>Promise<unknown>}){
 const panel=useRef<HTMLElement>(null),lock=useRef(false),attempt=useRef<{signature:string;id:string}|undefined>(undefined);
 const [draft,setDraft]=useState(()=>initial(person,stores)),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [removing,setRemoving]=useState(initialMode==='remove');
 const [pin,setPin]=useState('');
 const createdId=useRef(''),pinRequest=useRef('');
 const [receipt,setReceipt]=useState<{activationCode:string;expiresInDays:number;loginIdentifier:string}>();
 const editable=!person||(!person.is_removed&&person.can_edit_functions===true);
 const changed=JSON.stringify(draft)!==JSON.stringify(initial(person,stores));
 const listed=[...new Map([...stores,...(person?.stores||[])].map(s=>[s.id,s])).values()];
 useEffect(()=>{panel.current?.scrollIntoView({behavior:'smooth',block:'nearest'});},[]);
 useEffect(()=>{if(!changed||receipt)return;const warn=(e:BeforeUnloadEvent)=>e.preventDefault();window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[changed,receipt]);
 const close=()=>{if(lock.current||busy)return;if(changed&&!receipt&&!window.confirm('尚未儲存，確定捨棄修改？'))return;onClose();};
 const update=<K extends keyof Draft>(key:K,value:Draft[K])=>setDraft(d=>({...d,[key]:value}));
 const toggleFunction=(fn:WorkFunction)=>update('functions',draft.functions.includes(fn)?draft.functions.filter(f=>f!==fn):[...draft.functions,fn]);
 async function save(){
  if(lock.current||!editable)return;
  if(!person&&!/^\d{6}$/.test(pin)){setError('請輸入 6 位數字 PIN。');return;}
  const selected=Object.entries(draft.stores).map(([store_id,access_mode])=>({store_id,access_mode}));
  if(!draft.name.trim()||!selected.length||!draft.functions.some(f=>f==='FIELD'||f==='OFFICE')||!draft.stores[draft.defaultStore]){setError('請填寫姓名、至少一家門市與一項作業功能。');return;}
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
    if(!createdId.current){
    const r=await supabase.functions.invoke('manage-staff',{body:{action:'create',storeId:first,displayName:draft.name.trim(),loginIdentifier:draft.identifier.trim()||draft.name.trim(),workFunctions:draft.functions,stores:selected,defaultStoreId:draft.defaultStore}});
    if(r.error){const detail=r.error.context instanceof Response?await r.error.context.json().catch(()=>null):null;throw Error(detail?.error||r.data?.error||'CREATE_UNCONFIRMED');}
    if(!r.data?.staffId||!r.data?.login?.activationCode)throw Error('CREATE_UNCONFIRMED');
    createdId.current=r.data.staffId;setReceipt(r.data.login);
    }
    pinRequest.current||=crypto.randomUUID();
    await savePersonPin(first,createdId.current,pin,pinRequest.current);
    setPin('');await onSaved();onClose();
   }
  }catch(e){setError(/STAFF_ALREADY_EXISTS/.test(String(e))?'此登入識別已存在，請先確認人員名單；同名人員請使用不同的登入識別。':appError(e)+(person?' 修改內容已保留；若資料已更新，請關閉後重新開啟核對。':' 若建立結果未確認，請先重新讀取人員名單，避免重複建立。'));}
  finally{lock.current=false;setBusy(false);}
 }
 const disabled=busy||!editable||!!receipt;
 const canGrantManagement=managementStoreIds.includes(storeId)&&Object.keys(draft.stores).every(id=>managementStoreIds.includes(id));
 const functionOption=(fn:WorkFunction,description:string)=><label className="function-option" key={fn}><input type="checkbox" checked={draft.functions.includes(fn)} disabled={disabled||(fn==='MANAGE'&&!canGrantManagement)} onChange={()=>toggleFunction(fn)}/><span><strong>{functionLabels[fn]}</strong><small>{description}</small></span></label>;
 return <section ref={panel} className="people-inline-form" aria-labelledby="person-function-title">
  <header><h2 id="person-function-title">{person?'人員設定':'新增人員'}</h2><button type="button" className="text-button" aria-label="關閉" disabled={busy} onClick={close}><X/></button></header>
  <div className="people-drawer-body">
   {error&&<p className="pilot-message" role="alert">{error}</p>}
   {person?.is_removed?<section><h3>{person.display_name}・已停用</h3><p>此人員已停止登入，歷史作業紀錄保留。</p></section>:removing&&person?<PersonRemoval person={person} storeId={storeId} onCancel={()=>setRemoving(false)} onBusyChange={setBusy} onRemoved={async()=>{await onSaved('removed');onClose();}}/>:<>
    {person&&<div className="person-profile-heading"><span className="partner-avatar">{person.display_name.trim().slice(0,1)}</span><strong>{person.display_name}</strong></div>}
    <label className="people-field">姓名<input value={draft.name} maxLength={64} disabled={disabled} onChange={e=>update('name',e.target.value)}/></label>

    <fieldset className="people-access"><legend>可操作門市</legend>{listed.map(s=><div className="people-access-row" key={s.id}><label><input type="checkbox" checked={!!draft.stores[s.id]} disabled={disabled||!stores.some(x=>x.id===s.id)} onChange={e=>{const next={...draft.stores};if(e.target.checked)next[s.id]='EDIT';else delete next[s.id];setDraft(d=>({...d,stores:next,defaultStore:next[d.defaultStore]?d.defaultStore:Object.keys(next)[0]||''}));}}/><strong>{s.name}</strong></label>{draft.stores[s.id]&&<select aria-label={`${s.name}操作權限`} value={draft.stores[s.id]} disabled={disabled} onChange={e=>update('stores',{...draft.stores,[s.id]:e.target.value as 'EDIT'|'VIEW'})}><option value="EDIT">可操作</option><option value="VIEW">僅查看</option></select>}</div>)}</fieldset>
    <fieldset className="people-access"><legend>功能權限</legend><div className="people-presets"><button type="button" className="people-edit" disabled={disabled} onClick={()=>update('functions',['FIELD',...draft.functions.filter(f=>f==='MANAGE')])}>套用現場</button><button type="button" className="people-edit" disabled={disabled} onClick={()=>update('functions',['FIELD','OFFICE',...draft.functions.filter(f=>f==='MANAGE')])}>套用後勤</button></div>{functionOption('FIELD','貨單上傳、調撥單、廢棄單、月底盤點')}{functionOption('OFFICE','貨單明細、核對、庫存、人員管理與後續行政作業')}</fieldset>

    {(canGrantManagement||draft.functions.includes('MANAGE'))&&<fieldset className="people-access"><legend>系統權限</legend>{functionOption('MANAGE','門市與系統設定，由系統管理者授予')}</fieldset>}
    {!person&&<label className="people-field">PIN 碼<input type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} placeholder="6 位數字" value={pin} disabled={busy} onChange={e=>{setPin(e.target.value.replace(/\D/g,''));pinRequest.current='';}}/>{receipt&&<small>人員已建立，請儲存 PIN 完成設定；重試不會重複建立。</small>}</label>}
    {person&&<PersonPinSettings initialOpen={initialMode==='pin'} person={person} disabled={busy||changed} onBusyChange={setBusy} onChanged={()=>onSaved('pin')}/>}
    {person&&!editable&&<p className="people-help">{person.stores.some(s=>s.uses_pin)?'沿用原帳號與 PIN，儲存不會重設 PIN。':'沿用既有帳號登入方式。'}{!editable&&' 此帳號由具有完整管理權限的其他管理者維護。'}</p>}

   </>}
  </div>
  <footer><div className="people-save-actions"><button type="button" className="shell-secondary" disabled={busy} onClick={close}>取消</button>{editable&&!removing&&!person?.is_removed&&<button type="button" className="shell-primary" disabled={busy||(!!person&&!changed)} onClick={()=>void save()}>{busy?'儲存中…':receipt?'儲存 PIN':'儲存'}</button>}</div>{!receipt&&!removing&&(person?.can_remove&&!person.is_owner&&<div className="person-remove-entry"><button type="button" className="people-remove" disabled={busy||changed} onClick={()=>{setError('');setRemoving(true);}}><Trash2/>停用人員</button>{changed&&<small>請先儲存或捨棄目前修改，再停用人員。</small>}</div>)}</footer>
 </section>;
}
