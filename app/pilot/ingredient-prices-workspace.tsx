'use client';
import './cost-directory-theme.css';
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {ArrowLeft} from 'lucide-react';
import {appError,canExportData,type AppStore} from '@/lib/app-workspace';
import {supabase} from '@/lib/supabase-browser';
import {emptyPriceSheet,type PriceSheetData,type PriceSheetEdit,type PriceSupplierProfile} from '@/lib/ingredient-price-sheet';
import {canData} from '@/lib/data-access';
import CodeManagement from './code-management';
import {SupplyRecords,PriceChanges} from './ingredient-hub-records';
import './code-management.css';
import IngredientPriceSheet from './ingredient-price-sheet';
import {coalescedRead} from '@/lib/coalesced-read';
import {recipeAliasUpdate,usageNamesError,type IngredientUsageNames} from '@/lib/ingredient-usage-names';
import {operationDeadline} from '@/lib/operation-deadline';
import './recipes.css';
import './ingredient-catalog.css';
type Props={store:AppStore;onBack:()=>void;initialTab?:'prices'|'codes';registerLeave?:(handler:(()=>Promise<boolean>)|null)=>void};
export default function IngredientPricesWorkspace(props:Props){return <IngredientSession key={props.store.id} {...props}/>;}
function IngredientSession({store,onBack,registerLeave,initialTab='prices'}:Props){
 const [tab,setTab]=useState<string>(initialTab);
 const [catalog,setCatalog]=useState<PriceSheetData>(emptyPriceSheet),[loaded,setLoaded]=useState(false),[error,setError]=useState(''),[user,setUser]=useState(''),[syncing,setSyncing]=useState(false);
 const [supplierProfiles,setSupplierProfiles]=useState<PriceSupplierProfile[]>([]);
 const cloudDraft=useMemo(()=>({read:async()=>{const {data,error}=await supabase.rpc('baihuayuan_sheet_draft' as never,{p_store_id:store.id,p_scope:'ingredient',p_month:'all'} as never);if(error)throw error;const d=data as unknown as {token:string;rows:[string,PriceSheetEdit][]}|null;return d?{token:d.token,edits:Object.fromEntries(d.rows)}:null;},save:async(edits:Record<string,PriceSheetEdit>,expected:string|null,token:string)=>{const {data,error}=await supabase.rpc('baihuayuan_sheet_draft' as never,{p_store_id:store.id,p_scope:'ingredient',p_month:'all',p_action:'save',p_rows:Object.entries(edits),p_expected:expected,p_token:token} as never);if(error)throw error;return data as unknown as {token:string};}}),[store.id]);
 const mounted=useRef(false),lastAttempt=useRef(0);
 const rpc=useCallback(async(action:string,payload:Record<string,unknown>={},request:string|null=null)=>{const {data,error}=await supabase.rpc('baihuayuan_ingredient_prices' as never,{p_store_id:store.id,p_action:action,p_data:payload,p_request_id:request} as never);if(error)throw error;return data;},[store.id]);
 const readLatest=useCallback(async()=>{
  lastAttempt.current=Date.now();
  if(mounted.current)setSyncing(true);
  try {
   const data=await operationDeadline(async signal=>{const result=await supabase.rpc('baihuayuan_ingredient_prices' as never,{p_store_id:store.id,p_action:'read'} as never).abortSignal(signal);if(result.error)throw result.error;return result.data as unknown as PriceSheetData;});
   if(mounted.current){setCatalog(data);setLoaded(true);setError('');}
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
  const refresh=()=>{if(document.visibilityState==='visible'&&Date.now()-lastAttempt.current>=30000)void reload().catch(()=>{});};
  void reload().catch(()=>{});
  window.addEventListener('focus',refresh);
  const timer=setInterval(refresh,60000);
  return()=>{mounted.current=false;window.removeEventListener('focus',refresh);clearInterval(timer);};
 },[reload,store.role]);
 useEffect(()=>{
  if(store.role==='STAFF'||!canData(store,'SUPPLIERS'))return;
  const controller=new AbortController();
  const refresh=async()=>{
   try{
    const result=await operationDeadline(signal=>supabase.rpc('app_workspace',{
     p_store_id:store.id,p_section:'suppliers',p_filter:{},
    }).abortSignal(AbortSignal.any([signal,controller.signal])));
    if(result.error||controller.signal.aborted)return;
    const data=result.data as unknown as {suppliers?:PriceSupplierProfile[]};
    if(Array.isArray(data?.suppliers))setSupplierProfiles(data.suppliers.map(({id,name,aliases,supplier_category})=>({id,name,aliases,supplier_category})));
   }catch{/* Ingredient prices remain available independently of directory metadata. */}
  };
  const refreshOnFocus=()=>{if(document.visibilityState==='visible')void refresh();};
  void refresh();
  window.addEventListener('focus',refreshOnFocus);
  return()=>{controller.abort();window.removeEventListener('focus',refreshOnFocus);};
 },[store]);
 async function save(action:string,data:Record<string,unknown>,request:string){
  try{await rpc(action,data,request);}
  catch(e){const raw=e instanceof Error?e.message:String((e as {message?:string})?.message||e);if(/SUPPLY_STOPPED_REVIEW_REQUIRED/.test(raw))throw Error('此食材或供應商曾停用，請先查看紀錄並確認恢復。');if(/INGREDIENT_DUPLICATE_LINK_CONFLICT/.test(raw))throw Error('此編碼已有共用連結或停供紀錄，請先核對編碼管理。');if(/INVALID_INGREDIENT_DUPLICATE/.test(raw))throw Error('兩筆資料的單位或分類需先核對。');if(/REVISION_CONFLICT/.test(raw))throw Error('資料已由其他人修改，請重新同步後核對；您的輸入仍保留。');throw Error(appError(e));}
  // A committed write is successful even when the follow-up read fails.
  await reload(true).catch(()=>{if(mounted.current)setError('修改已儲存，但最新資料尚未讀取成功，請重新同步。');});
 }
 async function saveRecipeAlias(id:string,alias:string,previous:string|undefined,requestId:string){
  async function names(payload?:ReturnType<typeof recipeAliasUpdate>){
   try{
    return await operationDeadline(async signal=>{
     const result=await supabase.rpc('baihuayuan_ingredient_names' as never,{
      p_store_id:store.id,p_ingredient_id:id,...(payload?{p_data:payload,p_request_id:requestId}:{}),
     } as never).abortSignal(signal);
     if(result.error)throw result.error;
     return result.data as unknown as IngredientUsageNames;
    });
   }catch(e){throw Error(usageNamesError(e));}
  }
  const current=await names();
  const payload=recipeAliasUpdate(current,alias,previous);
  const saved=payload?await names(payload):current;
  if(mounted.current)setCatalog(old=>({...old,ingredients:old.ingredients.map(row=>
   (row.canonical_ingredient_id||row.id)===saved.id?{...row,recipe_aliases:saved.recipe_aliases}:row)}));
  await reload(true).catch(()=>{if(mounted.current)setError('別名已儲存，最新食材資料暫時讀取不到。');});
 }
 if(store.role==='STAFF')return <p role="alert">請使用主管或行政帳號查看食材價格。</p>;
 return <div className="recipe-workspace ingredient-prices-workspace"><div className={tab==='prices'?'price-hub-reading':undefined}>
 <div className="code-tabs" role="tablist" aria-label="食材價格表功能">{[['prices','食材價格'],['codes','編碼管理'],['supply','供應紀錄'],['changes','價格漲跌']].map(([id,label])=><button key={id} role="tab" aria-selected={tab===id} onClick={()=>{setTab(id);void reload().catch(()=>{});}}>{label}</button>)}</div>
 <header className="price-hub-heading"><h1>食材價格表</h1><button className="recipe-back" onClick={onBack}><ArrowLeft size={16}/>返回首頁</button></header>
 {error&&!syncing&&<div className="recipe-alert" role="alert">{loaded?error:'食材資料讀取失敗。'}<button className="text-button" onClick={()=>void reload().catch(()=>{})}>重新同步</button></div>}
 {tab==='codes'&&<CodeManagement embedded store={store} onBack={onBack} onPrices={()=>setTab('prices')} onRecipes={()=>{}} onProducts={()=>{}}/>}
 {!loaded&&(!error||syncing)&&tab!=='prices'&&tab!=='codes'&&<p role="status">讀取紀錄中…</p>}
 <div hidden={tab!=='supply'}>{loaded&&<SupplyRecords data={catalog} save={save} disabled={!!error}/>}</div>
 {tab==='changes'&&loaded&&<PriceChanges data={catalog}/>}
 <div hidden={tab!=='prices'}>{user&&<IngredientPriceSheet posStoreId={store.business_type==='SINGLE_RESTAURANT'&&['BeApe','Gras'].includes(store.name)?store.id:undefined} cloudDraft={cloudDraft} key={`${store.id}:${user}`} draftKey={`ingredient-sheet:${store.id}:${user}`} data={catalog} supplierProfiles={supplierProfiles} loaded={loaded} failed={!!error} syncing={syncing} canExport={canExportData(store)} save={save} saveRecipeAlias={saveRecipeAlias} registerLeave={registerLeave}/>}</div>
 </div></div>;
}
