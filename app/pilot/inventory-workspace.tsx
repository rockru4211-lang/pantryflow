'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase-browser';
import {localMonth,type AppStore} from '@/lib/app-workspace';
import {operationDeadline} from '@/lib/operation-deadline';
import UnifiedOperationsWorkspace from './unified-operations-workspace';
import InventorySpotSheet from './inventory-spot-sheet';
import ReceiptCountCandidatesNotice from './receipt-count-candidates';
import './inventory-monthly.css';
import './inventory-workspace.css';
type Tab='total'|'spot';
export default function InventoryWorkspace({store,userId,initialTab='total',initialId,initialMonth,onMonthChange,onTabChange,registerLeave}:{store:AppStore;userId:string;initialTab?:Tab;initialId?:string;initialMonth?:string;onMonthChange?:(month:string)=>void;onTabChange?:(tab:Tab)=>void;registerLeave?:(guard:(()=>Promise<boolean>)|null)=>void}){
 const [tab,setTab]=useState<Tab>(initialTab),[month,setMonth]=useState<string|null>(null),[error,setError]=useState(''),[loadedStore,setLoadedStore]=useState(''),[catalogRevision,setCatalogRevision]=useState(0);
 const guard=useRef<(()=>Promise<boolean>)|null>(null);
 const register=useCallback((fn:(()=>Promise<boolean>)|null)=>{guard.current=fn;registerLeave?.(fn);},[registerLeave]);
 const [requestedMonth]=useState(initialMonth);
 useEffect(()=>{
  if(requestedMonth||loadedStore===store.id)return;
  let active=true;
  const controller=new AbortController();
  const read=()=>operationDeadline(signal=>{
   const request=(supabase.rpc as unknown as (name:string,args:Record<string,unknown>)=>{abortSignal:(signal:AbortSignal)=>PromiseLike<{data:{month?:string}|null;error:unknown}>})('baihuayuan_latest_inventory',{p_store_id:store.id});
   return request.abortSignal(AbortSignal.any([signal,controller.signal]));
  },8000);
  void read().then(({data,error})=>{
   if(error)throw error;
   if(!active)return;
   setError('');
   setMonth(data?.month?.slice(0,7)||localMonth());
   setLoadedStore(store.id);
  }).catch(()=>{
   if(!active)return;
   setError('最近盤點月份讀取未完成，先顯示本月，可自行切換。');
   setMonth(localMonth());
   setLoadedStore(store.id);
  });
  return()=>{active=false;controller.abort();};
 },[store.id,requestedMonth,loadedStore]);
 const displayMonth=requestedMonth||(loadedStore===store.id?month:null);
 async function change(next:Tab){
  if(next===tab||guard.current&&!await guard.current())return;
  setTab(next);
  onTabChange?.(next);
 }
 return <section className="inventory-unified"><h1>庫存</h1><nav className="inventory-tabs" aria-label="庫存分頁">{([['total','庫存明細'],['spot','抽盤']] as const).map(([id,label])=><button key={id} aria-current={tab===id?'page':undefined} onClick={()=>void change(id)}>{label}</button>)}</nav>{tab==='total'&&<ReceiptCountCandidatesNotice key={store.id} storeId={store.id} onAdded={()=>setCatalogRevision(value=>value+1)}/>} {error&&<p role="status">{error}</p>}{!displayMonth?<p role="status">讀取盤點月份…</p>:tab==='total'?<UnifiedOperationsWorkspace key={store.id} integrated refreshRevision={catalogRevision} initialMonth={initialMonth||displayMonth} onMonthChange={onMonthChange} userId={userId} store={store} kind="inventory" registerLeave={register} onSpecial={()=>{}}/>:<InventorySpotSheet store={store} userId={userId} initialMonth={displayMonth} initialId={initialId} registerLeave={register}/>}</section>;
}
