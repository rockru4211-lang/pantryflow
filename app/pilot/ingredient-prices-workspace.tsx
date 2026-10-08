'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {ArrowLeft} from 'lucide-react';
import {appError,canExportData,type AppStore} from '@/lib/app-workspace';
import {supabase} from '@/lib/supabase-browser';
import {emptyPriceSheet,type PriceSheetData} from '@/lib/ingredient-price-sheet';
import IngredientPriceSheet from './ingredient-price-sheet';
import './recipes.css';
import './ingredient-catalog.css';
type Props={store:AppStore;onBack:()=>void;registerLeave?:(handler:(()=>Promise<boolean>)|null)=>void};
export default function IngredientPricesWorkspace(props:Props){return <IngredientSession key={props.store.id} {...props}/>;}
function IngredientSession({store,onBack,registerLeave}:Props){
 const [catalog,setCatalog]=useState<PriceSheetData>(emptyPriceSheet),[loaded,setLoaded]=useState(false),[error,setError]=useState(''),[user,setUser]=useState('');
 const mounted=useRef(false),sequence=useRef(0);
 const rpc=useCallback(async(action:string,payload:Record<string,unknown>={},request:string|null=null)=>{const {data,error}=await supabase.rpc('baihuayuan_ingredient_prices' as never,{p_store_id:store.id,p_action:action,p_data:payload,p_request_id:request} as never);if(error)throw error;return data;},[store.id]);
 const reload=useCallback(async()=>{const current=++sequence.current;const data=await rpc('read') as PriceSheetData;if(mounted.current&&current===sequence.current){setCatalog(data);setLoaded(true);setError('');}},[rpc]);
 useEffect(()=>{mounted.current=true;void supabase.auth.getUser().then(({data})=>{if(mounted.current)setUser(data.user?.id||'');});if(store.role==='STAFF')return()=>{mounted.current=false;};const refresh=()=>{void reload().catch(e=>{if(mounted.current)setError(appError(e));});};refresh();window.addEventListener('focus',refresh);const timer=setInterval(refresh,30000);return()=>{mounted.current=false;window.removeEventListener('focus',refresh);clearInterval(timer);};},[reload,store.role]);
 async function save(action:string,data:Record<string,unknown>,request:string){try{await rpc(action,data,request);await reload();}catch(e){const raw=e instanceof Error?e.message:String((e as {message?:string})?.message||e);if(/SUPPLY_STOPPED_REVIEW_REQUIRED/.test(raw))throw Error('此食材或供應商曾停用，請先查看紀錄並確認恢復。');if(/REVISION_CONFLICT/.test(raw))throw Error('資料已由其他人修改，請重新同步後核對；您的輸入仍保留。');throw Error(appError(e));}}
 if(store.role==='STAFF')return <p role="alert">請使用主管或行政帳號查看食材價格。</p>;
 return <div className="recipe-workspace ingredient-prices-workspace"><button className="recipe-back" onClick={onBack}><ArrowLeft size={18}/>返回首頁</button><p className="price-page-context">{store.name} · 食材價格表</p>{error&&<div className="recipe-alert" role="alert">{error}<button className="text-button" onClick={()=>void reload().catch(e=>setError(appError(e)))}>重新同步</button></div>}{user&&<IngredientPriceSheet key={`${store.id}:${user}`} draftKey={`ingredient-sheet:${store.id}:${user}`} data={catalog} loaded={loaded} failed={!!error} canExport={canExportData(store)} save={save} registerLeave={registerLeave}/>}</div>;
}
