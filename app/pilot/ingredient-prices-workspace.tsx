'use client';
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {ArrowLeft} from 'lucide-react';
import {appError,canExportData,type AppStore} from '@/lib/app-workspace';
import {supabase} from '@/lib/supabase-browser';
import {emptyPriceSheet,type PriceSheetData,type PriceSheetEdit} from '@/lib/ingredient-price-sheet';
import IngredientPriceSheet from './ingredient-price-sheet';
import {coalescedRead} from '@/lib/coalesced-read';
import {operationDeadline} from '@/lib/operation-deadline';
import './recipes.css';
import './ingredient-catalog.css';
type Props={store:AppStore;onBack:()=>void;registerLeave?:(handler:(()=>Promise<boolean>)|null)=>void};
export default function IngredientPricesWorkspace(props:Props){return <IngredientSession key={props.store.id} {...props}/>;}
function IngredientSession({store,onBack,registerLeave}:Props){
 const [catalog,setCatalog]=useState<PriceSheetData>(emptyPriceSheet),[loaded,setLoaded]=useState(false),[error,setError]=useState(''),[user,setUser]=useState(''),[syncing,setSyncing]=useState(false);
 const cloudDraft=useMemo(()=>({read:async()=>{const {data,error}=await supabase.rpc('baihuayuan_sheet_draft' as never,{p_store_id:store.id,p_scope:'ingredient',p_month:'all'} as never);if(error)throw error;const d=data as unknown as {token:string;rows:[string,PriceSheetEdit][]}|null;return d?{token:d.token,edits:Object.fromEntries(d.rows)}:null;},save:async(edits:Record<string,PriceSheetEdit>,expected:string|null,token:string)=>{const {data,error}=await supabase.rpc('baihuayuan_sheet_draft' as never,{p_store_id:store.id,p_scope:'ingredient',p_month:'all',p_action:'save',p_rows:Object.entries(edits),p_expected:expected,p_token:token} as never);if(error)throw error;return data as unknown as {token:string};}}),[store.id]);
 const mounted=useRef(false),lastRead=useRef(0);
 const rpc=useCallback(async(action:string,payload:Record<string,unknown>={},request:string|null=null)=>{const {data,error}=await supabase.rpc('baihuayuan_ingredient_prices' as never,{p_store_id:store.id,p_action:action,p_data:payload,p_request_id:request} as never);if(error)throw error;return data;},[store.id]);
 const readLatest=useCallback(async()=>{
  if(mounted.current)setSyncing(true);
  try {
   const data=await operationDeadline(async signal=>{const result=await supabase.rpc('baihuayuan_ingredient_prices' as never,{p_store_id:store.id,p_action:'read'} as never).abortSignal(signal);if(result.error)throw result.error;return result.data as unknown as PriceSheetData;});
   if(mounted.current){setCatalog(data);setLoaded(true);setError('');lastRead.current=Date.now();}
  } catch(e) {
   if(mounted.current)setError('食材資料暫時讀取不到，已顯示的資料與編輯內容仍保留，請重新同步。');
   throw e;
  } finally {if(mounted.current)setSyncing(false);}
 },[store.id]);
 // This factory stores the callback; it never invokes it or reads refs during render.
 // eslint-disable-next-line react-hooks/refs
 const reload=useMemo(()=>coalescedRead(readLatest),[readLatest]);
 useEffect(()=>{
  mounted.current=true;
  void supabase.auth.getUser().then(({data})=>{if(mounted.current)setUser(data.user?.id||'');});
  if(store.role==='STAFF')return()=>{mounted.current=false;};
  const refresh=()=>{if(document.visibilityState==='visible'&&Date.now()-lastRead.current>=30000)void reload().catch(()=>{});};
  void reload().catch(()=>{});
  window.addEventListener('focus',refresh);
  const timer=setInterval(refresh,60000);
  return()=>{mounted.current=false;window.removeEventListener('focus',refresh);clearInterval(timer);};
 },[reload,store.role]);
 async function save(action:string,data:Record<string,unknown>,request:string){
  try{await rpc(action,data,request);}
  catch(e){const raw=e instanceof Error?e.message:String((e as {message?:string})?.message||e);if(/SUPPLY_STOPPED_REVIEW_REQUIRED/.test(raw))throw Error('此食材或供應商曾停用，請先查看紀錄並確認恢復。');if(/REVISION_CONFLICT/.test(raw))throw Error('資料已由其他人修改，請重新同步後核對；您的輸入仍保留。');throw Error(appError(e));}
  // A committed write is successful even when the follow-up read fails.
  await reload(true).catch(()=>{if(mounted.current)setError('修改已儲存，但最新資料尚未讀取成功，請重新同步。');});
 }
 if(store.role==='STAFF')return <p role="alert">請使用主管或行政帳號查看食材價格。</p>;
 return <div className="recipe-workspace ingredient-prices-workspace"><button className="recipe-back" onClick={onBack}><ArrowLeft size={18}/>返回首頁</button><p className="price-page-context">{store.name} · 食材價格表</p>{error&&<div className="recipe-alert" role="alert">{error}<button className="text-button" disabled={syncing} onClick={()=>void reload().catch(()=>{})}>{syncing?'同步中…':'重新同步'}</button></div>}{user&&<IngredientPriceSheet cloudDraft={cloudDraft} key={`${store.id}:${user}`} draftKey={`ingredient-sheet:${store.id}:${user}`} data={catalog} loaded={loaded} failed={!!error} canExport={canExportData(store)} save={save} registerLeave={registerLeave}/>}</div>;
}
