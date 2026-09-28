'use client';
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {ChevronRight,Plus,Search,Store as StoreIcon,Trash2,Users,X} from 'lucide-react';
import {supabase} from '@/lib/supabase-browser';
import {appError,type AppStore} from '@/lib/app-workspace';
import {receiptRead} from '@/lib/receipt-read';
import {operationDeadline} from '@/lib/operation-deadline';
import {filterPeople,hasPersonChanges,personChanges,personDraft,personTitle,type Person,type PeopleStore,type PersonDraft} from '@/lib/people-settings';
import type {StoreAccessMode} from '@/lib/store-access';
import './people-settings.css';

type Props={anchorStore:AppStore;stores:AppStore[];onBack:()=>void;onOpenPartners:(storeId:string,startNew?:boolean)=>void;onOpenStore:(storeId:string)=>void};
type Workspace={partners:Person[];manageable_stores:PeopleStore[]};
const avatar=(name:string)=>name.trim().slice(0,1)||'人';

export default function PartnersStoresWorkspace({anchorStore,stores,onBack,onOpenPartners,onOpenStore}:Props){
 const [data,setData]=useState<Workspace>(),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [query,setQuery]=useState(''),[storeFilter,setStoreFilter]=useState('ALL'),[selected,setSelected]=useState<Person>(),[adding,setAdding]=useState(false);
 const sequence=useRef(0),flight=useRef<AbortController|null>(null);
 const activeStores=stores.filter(s=>s.is_active!==false&&['BeApe','Gras'].includes(s.name));
 const load=useCallback(async()=>{
  flight.current?.abort();const controller=new AbortController();flight.current=controller;const request=++sequence.current;
  setLoading(true);setError('');
  try{
   const r=await receiptRead(signal=>supabase.rpc('get_baihuayuan_people',{p_store_id:anchorStore.id}).abortSignal(signal),controller.signal);
   if(r.error)throw r.error;
   const next=r.data as unknown as Workspace;
   if(!Array.isArray(next?.partners)||!Array.isArray(next?.manageable_stores))throw Error('INVALID_PEOPLE_RESPONSE');
   if(request===sequence.current&&!controller.signal.aborted){setData(next);return next;}
  }catch(e){if(request===sequence.current&&!controller.signal.aborted)setError(/TIMEOUT/.test(String(e))?'人員資料讀取逾時，請重新讀取。':'人員資料未能讀取，請重新讀取。');}
  finally{if(request===sequence.current)setLoading(false);}
 },[anchorStore.id]);
 useEffect(()=>{let live=true;const seq=sequence;queueMicrotask(()=>{if(live)void load();});return()=>{live=false;seq.current++;flight.current?.abort();};},[load]);
 const people=useMemo(()=>filterPeople(data?.partners||[],query,storeFilter),[data,query,storeFilter]);
 const filterStores=useMemo(()=>[...new Map([...(data?.manageable_stores||[]),...(data?.partners||[]).flatMap(p=>p.stores)].map(s=>[s.id,s])).values()],[data]);
 const open=(p:Person)=>{if(loading||error)return;setNotice('');setSelected(p);};
 const saved=async(person:Person)=>{setData(old=>old?{...old,partners:old.partners.map(p=>p.user_id===person.user_id?person:p)}:old);setSelected(undefined);setNotice('人員設定已儲存。');await load();};
 if(adding)return <section className="partners-stores-workspace people-workspace">
  <button className="shell-back" type="button" onClick={()=>setAdding(false)}>‹ 返回人員管理</button>
  <div className="workspace-heading"><h1>新增人員</h1><p>選擇人員的工作位置。</p></div>
  <div className="partner-add-choice">
   <button type="button" className="shell-card" onClick={()=>onOpenPartners(anchorStore.id,true)}><Users/><span><strong>公司管理人員</strong><small>營運、行政、財務</small></span><ChevronRight/></button>
   {activeStores.map(s=><button type="button" className="shell-card" key={s.id} onClick={()=>onOpenPartners(s.id,true)}><StoreIcon/><span><strong>{s.name} 門市人員</strong><small>主管、員工</small></span><ChevronRight/></button>)}
  </div>
 </section>;
 return <section className="partners-stores-workspace people-workspace">
  <button className="shell-back" type="button" onClick={onBack}>‹ 返回設定</button>
  <div className="partner-workspace-title"><div><h1>人員管理</h1><p>管理職務與可用門市。</p></div><button type="button" className="partner-add-top" onClick={()=>setAdding(true)}><Plus/>新增人員</button></div>
  {notice&&<p className="count-notice" role="status">{notice}</p>}
  {error&&<p className="pilot-message" role="alert">{error}<button type="button" className="text-button" disabled={loading} onClick={()=>void load()}>重新讀取</button></p>}
  <div className="people-toolbar"><label className="people-search"><Search aria-hidden="true"/><input type="search" aria-label="搜尋姓名" placeholder="搜尋姓名" value={query} onChange={e=>setQuery(e.target.value)}/></label><select aria-label="篩選門市" value={storeFilter} onChange={e=>setStoreFilter(e.target.value)}><option value="ALL">全部門市</option>{filterStores.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
  {loading&&!data?<p role="status">正在讀取人員…</p>:<div className="people-table" role="table" aria-label="人員名單" aria-busy={loading}>
   <div className="people-table-head" role="row"><span role="columnheader">姓名</span><span role="columnheader">職務</span><span role="columnheader">可用門市</span><span role="columnheader" aria-label="設定"/></div>
   {people.map(p=><div key={p.user_id} role="row" className={'people-row'+(selected?.user_id===p.user_id?' selected':'')} onClick={()=>open(p)}>
    <span className="people-name" role="cell"><span className={'partner-avatar'+(p.is_owner?' owner':'')}>{avatar(p.display_name)}</span><button type="button" onClick={e=>{e.stopPropagation();open(p);}} disabled={loading||!!error} aria-label={`設定 ${p.display_name}`}>{p.display_name}</button></span>
    <span role="cell"><span className={'people-role'+(p.is_owner?' owner':'')}>{personTitle(p)}</span></span>
    <span role="cell" className="people-store-chips">{p.is_owner?'全部門市':p.stores.length?p.stores.map(s=><span key={s.id}>{s.name}{s.access_mode==='VIEW'&&<small>僅查看</small>}</span>):<small>尚未分配門市</small>}</span><ChevronRight aria-hidden="true"/>
   </div>)}
   {!people.length&&!error&&<p className="shell-note">{query||storeFilter!=='ALL'?'沒有符合條件的人員。':'目前尚無人員。'}</p>}
  </div>}
  <details className="people-more"><summary>更多管理</summary><div>{activeStores.map(s=><div key={s.id}><strong>{s.name}</strong><button type="button" className="text-button" onClick={()=>onOpenPartners(s.id)}>邀請、PIN 與離職交接</button><button type="button" className="text-button" onClick={()=>onOpenStore(s.id)}>門市設定</button></div>)}</div></details>
  {selected&&<PersonSettings key={selected.user_id} person={selected} stores={data?.manageable_stores||[]} storeId={anchorStore.id} onClose={()=>setSelected(undefined)} onSaved={saved} onReload={async()=>{const next=await load();return next?.partners.find(p=>p.user_id===selected.user_id);}} onRemoved={async()=>{setSelected(undefined);setNotice('人員已移除，原有營運紀錄仍保留。');await load();}}/>}
 </section>;
}

function PersonSettings({person,stores,storeId,onClose,onSaved,onReload,onRemoved}:{person:Person;stores:PeopleStore[];storeId:string;onClose:()=>void;onSaved:(p:Person)=>Promise<void>;onReload:()=>Promise<Person|undefined>;onRemoved:()=>Promise<void>}){
 const dialog=useRef<HTMLDialogElement>(null),lock=useRef(false),attempt=useRef<{signature:string;id:string}|undefined>(undefined);
 const [source,setSource]=useState(person),[draft,setDraft]=useState(()=>personDraft(person)),[busy,setBusy]=useState(false),[error,setError]=useState(''),[failed,setFailed]=useState(false),[confirmRemove,setConfirmRemove]=useState(false);
 const changed=hasPersonChanges(source,draft),editable=source.can_manage_access||source.can_edit_profile;
 const listedStores=[...new Map([...stores,...source.stores].map(s=>[s.id,s])).values()];
 useEffect(()=>{dialog.current?.showModal();},[]);
 useEffect(()=>{if(!changed&&!failed)return;const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[changed,failed]);
 const close=()=>{if(lock.current)return;if((changed||failed)&&!window.confirm(failed?'儲存結果尚未確認，關閉後請重新讀取核對。是否關閉？':'尚未儲存，確定捨棄修改？'))return;onClose();};
 async function save(){
  if(lock.current||!editable||!changed)return;
  const changes=personChanges(source,draft);
  if(changes.profile&&!changes.profile.display_name){setError('請填寫姓名。');return;}
  if(!Object.values(draft.access).some(mode=>mode!=='NONE')){setError('請至少保留一家可用門市；離職請至「更多管理」辦理交接。');return;}
  const payload={p_store_id:storeId,p_user_id:source.user_id,p_revision:source.revision,p_profile:changes.profile,p_access:changes.access};
  const signature=JSON.stringify(payload);if(attempt.current?.signature!==signature)attempt.current={signature,id:crypto.randomUUID()};
  lock.current=true;setBusy(true);setError('');
  try{
   const r=await operationDeadline(signal=>supabase.rpc('save_baihuayuan_person',{...payload,p_request_id:attempt.current!.id}).abortSignal(signal));
   if(r.error)throw r.error;
   const result=r.data as unknown as {saved:boolean;person:Person};
   if(!result?.saved||result.person?.user_id!==source.user_id)throw Error('SAVE_UNCONFIRMED');
   await onSaved(result.person);
  }catch(e){setFailed(true);setError(appError(e)+' 修改內容已保留，可重試儲存。');}
  finally{lock.current=false;setBusy(false);}
 }
 async function reload(){
  if(lock.current||!window.confirm('重新讀取會以最新資料取代此視窗中的修改，是否繼續？'))return;
  lock.current=true;setBusy(true);
  try{const next=await onReload();if(!next){setError('未能讀取最新人員資料，修改內容仍保留。');return;}setSource(next);setDraft(personDraft(next));attempt.current=undefined;setFailed(false);setError('');}finally{lock.current=false;setBusy(false);}
 }
 async function remove(){
  if(lock.current||!source.company_member||!source.can_edit_profile)return;
  lock.current=true;setBusy(true);setError('');
  try{const r=await operationDeadline(signal=>supabase.rpc('remove_baihuayuan_partner',{p_store_id:storeId,p_user_id:source.user_id}).abortSignal(signal));if(r.error)throw r.error;await onRemoved();}
  catch(e){setError(String((e as {message?:string})?.message).includes('PARTNER_HAS_HISTORY')?'此人員已有營運紀錄，請改用離職交接。':appError(e));setConfirmRemove(false);}finally{lock.current=false;setBusy(false);}
 }
 const disabled=busy||failed;
 const set=<K extends keyof PersonDraft>(key:K,value:PersonDraft[K])=>setDraft(d=>({...d,[key]:value}));
 return <dialog ref={dialog} className="people-drawer" aria-labelledby="person-settings-title" onCancel={e=>{e.preventDefault();close();}}>
  <header><h2 id="person-settings-title">人員設定</h2><button type="button" className="text-button" aria-label="關閉人員設定" disabled={busy} onClick={close}><X/></button></header>
  <div className="people-drawer-body">
   {error&&<p className="pilot-message" role="alert">{error}{failed&&<button type="button" className="text-button" disabled={busy} onClick={()=>void reload()}>重新讀取最新設定</button>}</p>}
   <label className="people-field">姓名<input value={draft.name} maxLength={80} disabled={disabled||!source.can_edit_profile} onChange={e=>set('name',e.target.value)}/></label>
   <label className="people-field">職務<select value={draft.title} disabled={disabled||!source.can_edit_profile||!source.allowed_titles.length} onChange={e=>set('title',e.target.value)}>{!source.allowed_titles.includes(personTitle(source))&&<option value={personTitle(source)}>{personTitle(source)}</option>}{source.allowed_titles.map(t=><option key={t} value={t}>{t}</option>)}</select></label>
   {draft.title!==personTitle(source)&&<p className="people-help">變更職務會套用至此人員的可用門市。</p>}
   {source.is_owner?<p className="people-help">老闆權限固定，適用全部門市。</p>:!source.can_edit_profile&&<p className="people-help">目前帳號可查看此人員的職務；職務調整需由有權限的管理者處理。</p>}
   <fieldset className="people-access"><legend>可用門市</legend>{listedStores.map(s=>{
    const mode=draft.access[s.id]||'NONE',allowed=source.can_manage_access&&source.access_store_ids.includes(s.id);
    return <div className="people-access-row" key={s.id}><label><input type="checkbox" aria-label={`授權 ${s.name}`} checked={source.is_owner||mode!=='NONE'} disabled={disabled||!allowed} onChange={e=>set('access',{...draft.access,[s.id]:e.target.checked?'VIEW':'NONE'})}/><strong>{s.name}</strong></label><select aria-label={`${s.name}操作權限`} value={source.is_owner?'EDIT':mode==='NONE'?'VIEW':mode} disabled={disabled||!allowed||mode==='NONE'} onChange={e=>set('access',{...draft.access,[s.id]:e.target.value as StoreAccessMode})}><option value="EDIT">可操作</option><option value="VIEW">僅查看</option></select></div>;
   })}<p className="people-help">可操作的功能依職務決定。</p></fieldset>
   {source.company_member&&source.can_edit_profile&&<details className="people-advanced"><summary>進階權限設定</summary><label className="people-field">資料匯出<select value={draft.exportMode} disabled={disabled} onChange={e=>set('exportMode',e.target.value as PersonDraft['exportMode'])}><option value="KEEP">保留各店現有設定</option><option value="ALLOW" disabled={!source.can_grant_export}>允許所有已勾選門市</option><option value="REMOVE">移除額外匯出授權</option></select></label><button type="button" className="people-remove" disabled={busy||changed||failed} onClick={()=>setConfirmRemove(true)}><Trash2/>移除人員</button></details>}
   {confirmRemove&&<section className="people-remove-confirm" role="alert"><strong>確定移除 {source.display_name}？</strong><p>已有營運歷史的人員需辦理離職交接，系統會阻止刪除。</p><button type="button" className="shell-secondary" disabled={busy} onClick={()=>setConfirmRemove(false)}>保留人員</button><button type="button" className="shell-primary danger" disabled={busy} onClick={()=>void remove()}>確認移除</button></section>}
  </div>
  <footer><button type="button" className="shell-secondary" disabled={busy} onClick={close}>{editable?'取消':'關閉'}</button>{editable&&<button type="button" className="shell-primary" disabled={busy||!changed||!draft.name.trim()} onClick={()=>void save()}>{busy?'儲存中…':failed?'重試儲存':'儲存設定'}</button>}</footer>
 </dialog>;
}
