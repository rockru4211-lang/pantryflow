'use client';
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {ChevronRight,Plus,Search} from 'lucide-react';
import {supabase} from '@/lib/supabase-browser';
import {canManageBusiness,canManageStores,type AppStore} from '@/lib/app-workspace';
import {receiptRead} from '@/lib/receipt-read';
import {filterPeople,functionLabels,workFunctions,type Person,type PeopleStore} from '@/lib/people-settings';
import PersonFunctionSettings from './person-function-settings';
import './people-settings.css';

type Props={anchorStore:AppStore;stores:AppStore[];onBack:()=>void;onOpenPartners:(storeId:string,startNew?:boolean)=>void;onOpenStore:(storeId:string)=>void};
type Workspace={partners:Person[];manageable_stores:PeopleStore[]};
const avatar=(name:string)=>name.trim().slice(0,1)||'人';

export default function PartnersStoresWorkspace({anchorStore,stores,onBack,onOpenPartners,onOpenStore}:Props){
 const [data,setData]=useState<Workspace>(),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [query,setQuery]=useState(''),[storeFilter,setStoreFilter]=useState('ALL'),[selected,setSelected]=useState<Person>(),[adding,setAdding]=useState(false);
 const [showRemoved,setShowRemoved]=useState(false);
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
 const people=useMemo(()=>filterPeople(data?.partners||[],query,storeFilter,showRemoved),[data,query,storeFilter,showRemoved]);
 const filterStores=useMemo(()=>[...new Map([...(data?.manageable_stores||[]),...(data?.partners||[]).flatMap(p=>p.stores)].map(s=>[s.id,s])).values()],[data]);
 const open=(p:Person)=>{if(loading||error)return;setNotice('');setSelected(p);};
 return <section className="partners-stores-workspace people-workspace">
  <button className="shell-back" type="button" onClick={onBack}>‹ 返回設定</button>
  <div className="partner-workspace-title"><div><h1>人員管理</h1><p>設定可用門市與工作功能，沿用個人帳號登入。</p></div><button type="button" className="partner-add-top" onClick={()=>setAdding(true)}><Plus/>新增人員</button></div>
  {notice&&<p className="count-notice" role="status">{notice}</p>}
  {error&&<p className="pilot-message" role="alert">{error}<button type="button" className="text-button" disabled={loading} onClick={()=>void load()}>重新讀取</button></p>}
  <div className="people-status-tabs" role="group" aria-label="人員狀態"><button type="button" aria-pressed={!showRemoved} onClick={()=>setShowRemoved(false)}>使用中 {data?.partners.filter(p=>!p.is_removed).length||0}</button><button type="button" aria-pressed={showRemoved} onClick={()=>setShowRemoved(true)}>已移除 {data?.partners.filter(p=>p.is_removed).length||0}</button></div>
  <div className="people-toolbar"><label className="people-search"><Search aria-hidden="true"/><input type="search" aria-label="搜尋姓名" placeholder="搜尋姓名" value={query} onChange={e=>setQuery(e.target.value)}/></label><select aria-label="篩選門市" value={storeFilter} onChange={e=>setStoreFilter(e.target.value)}><option value="ALL">全部門市</option>{filterStores.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
  {loading&&!data?<p role="status">正在讀取人員…</p>:<div className="people-table" role="table" aria-label="人員名單" aria-busy={loading}>
   <div className="people-table-head" role="row"><span role="columnheader">姓名</span><span role="columnheader">功能權限</span><span role="columnheader">可用門市</span><span role="columnheader" aria-label="設定"/></div>
   {people.map(p=><div key={p.user_id} role="row" className={'people-row'+(selected?.user_id===p.user_id?' selected':'')} onClick={()=>open(p)}>
    <span className="people-name" role="cell"><span className={'partner-avatar'+(p.is_owner?' owner':'')}>{avatar(p.display_name)}</span><button type="button" onClick={e=>{e.stopPropagation();open(p);}} disabled={loading||!!error} aria-label={`設定 ${p.display_name}`}>{p.display_name}</button></span>
    <span role="cell"><span className={'people-role'+(p.is_owner?' owner':'')}>{p.is_owner?'系統管理者':workFunctions(p).map(f=>functionLabels[f]).join('・')}</span></span>
    <span role="cell" className="people-store-chips">{p.is_owner?'全部門市':(p.is_removed?p.removed_stores||[]:p.stores).length?(p.is_removed?p.removed_stores||[]:p.stores).map(s=><span key={s.id}>{s.name}{s.access_mode==='VIEW'&&<small>僅查看</small>}</span>):<small>尚未分配門市</small>}</span><ChevronRight aria-hidden="true"/>
   </div>)}
   {!people.length&&!error&&<p className="shell-note">{query||storeFilter!=='ALL'?'沒有符合條件的人員。':'目前尚無人員。'}</p>}
  </div>}
  <details className="people-more"><summary>更多管理</summary><div>{activeStores.map(s=><div key={s.id}><strong>{s.name}</strong><button type="button" className="text-button" onClick={()=>onOpenPartners(s.id)}>邀請、PIN 與離職交接</button>{canManageStores(s)&&<button type="button" className="text-button" onClick={()=>onOpenStore(s.id)}>門市設定</button>}</div>)}</div></details>
  {(selected||adding)&&<PersonFunctionSettings key={selected?.user_id||'new'} person={selected} managementStoreIds={stores.filter(canManageBusiness).map(s=>s.id)} stores={data?.manageable_stores||[]} storeId={anchorStore.id} onClose={()=>{setSelected(undefined);setAdding(false);}} onSaved={async outcome=>{setNotice(outcome==='removed'?'人員已移除，登入與門市操作已停用，歷史紀錄保留。':'人員設定已儲存。');await load();}}/>}
 </section>;
}
