'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase-browser';
import {canExportData,localMonth,type AppStore} from '@/lib/app-workspace';
import UnifiedOperationsWorkspace from './unified-operations-workspace';
import InventorySpotSheet from './inventory-spot-sheet';
import CustodyWorkspace from './custody-reminder-workspace';
import './inventory-monthly.css';
import './inventory-workspace.css';
type Tab='total'|'spot'|'supplier'|'reserved';
export default function InventoryWorkspace({store,userId,initialTab='total',initialId,registerLeave}:{store:AppStore;userId:string;initialTab?:Tab;initialId?:string;registerLeave?:(guard:(()=>Promise<boolean>)|null)=>void}){
 const [tab,setTab]=useState<Tab>(initialTab),[month,setMonth]=useState<string|null>(null),[error,setError]=useState(''),[loadedStore,setLoadedStore]=useState('');
 const guard=useRef<(()=>Promise<boolean>)|null>(null);
 const register=useCallback((fn:(()=>Promise<boolean>)|null)=>{guard.current=fn;registerLeave?.(fn);},[registerLeave]);
 useEffect(()=>{let active=true;const controller=new AbortController();void (supabase.rpc as unknown as (name:string,args:Record<string,unknown>)=>{abortSignal:(signal:AbortSignal)=>PromiseLike<{data:{month?:string}|null;error:unknown}>})('baihuayuan_latest_inventory',{p_store_id:store.id}).abortSignal(controller.signal).then(({data,error})=>{if(!active)return;if(error)setError('最近盤點月份讀取未完成，先顯示本月，可自行切換。');else setError('');setMonth(data?.month?.slice(0,7)||localMonth());setLoadedStore(store.id);});return()=>{active=false;controller.abort();};},[store.id]);
 async function change(next:Tab){if(next===tab||guard.current&&!await guard.current())return;setTab(next);}
 return <section className="inventory-unified"><h1>庫存</h1><nav className="inventory-tabs" aria-label="庫存分頁">{([['total','庫存明細'],['spot','抽盤'],['supplier','寄庫'],['reserved','保留貨']] as const).map(([id,label])=><button key={id} aria-current={tab===id?'page':undefined} onClick={()=>void change(id)}>{label}</button>)}</nav>{error&&<p role="status">{error}</p>}{(!month||loadedStore!==store.id)?<p role="status">讀取盤點月份…</p>:tab==='total'?<UnifiedOperationsWorkspace key={store.id} integrated initialMonth={month} userId={userId} store={store} kind="inventory" registerLeave={register} onSpecial={()=>{}}/>:tab==='spot'?<InventorySpotSheet store={store} userId={userId} initialMonth={month} initialId={initialId} registerLeave={register}/>:<CustodyWorkspace key={tab} storeId={store.id} kind={tab} canExport={canExportData(store)} registerGuard={register}/>}</section>;
}
