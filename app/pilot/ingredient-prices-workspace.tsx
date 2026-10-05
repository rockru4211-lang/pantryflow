'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {ArrowLeft} from 'lucide-react';
import {appError,readWorkspace,writeOperation,type AppStore} from '@/lib/app-workspace';
import type {IngredientCatalog,IngredientSource} from '@/lib/ingredient-catalog';
import IngredientCatalogView from './ingredient-catalog';
import './recipes.css';
import './ingredient-catalog.css';
type Props={store:AppStore;onBack:()=>void;registerLeave?:(handler:(()=>Promise<boolean>)|null)=>void};
export default function IngredientPricesWorkspace(props:Props){return <IngredientSession key={props.store.id} {...props}/>;}
function IngredientSession({store,onBack,registerLeave}:Props){
 const [catalog,setCatalog]=useState<IngredientCatalog>({ingredients:[],can_price:false}),[loaded,setLoaded]=useState(false),[error,setError]=useState('');
 const mounted=useRef(false),sequence=useRef(0),request=useRef<{encoded:string;id:string}|null>(null);
 const reload=useCallback(async()=>{const current=++sequence.current;const data=await readWorkspace<IngredientCatalog>(store.id,'ingredients');if(mounted.current&&current===sequence.current){setCatalog(data);setLoaded(true);setError('');}},[store.id]);
 useEffect(()=>{mounted.current=true;if(store.role==='STAFF')return()=>{mounted.current=false;};const refresh=()=>{void reload().catch(e=>{if(mounted.current)setError(appError(e));});};refresh();window.addEventListener('focus',refresh);const timer=setInterval(refresh,30000);return()=>{mounted.current=false;window.removeEventListener('focus',refresh);clearInterval(timer);};},[reload,store.role]);
 async function save(action:string,data:Record<string,unknown>){const encoded=JSON.stringify({action,data});if(request.current?.encoded!==encoded)request.current={encoded,id:crypto.randomUUID()};try{await writeOperation(store.id,action,data,request.current.id);request.current=null;try{await reload();}catch{setError('資料已儲存，列表尚未更新，請按重新同步。');}return true;}catch(e){throw Error(appError(e));}}
 if(store.role==='STAFF')return <p role="alert">請使用主管或行政帳號查看食材價格。</p>;
 return <div className="recipe-workspace ingredient-prices-workspace"><button className="recipe-back" onClick={onBack}><ArrowLeft size={18}/>返回首頁</button><p className="price-page-context">{store.name} · 食材價格表</p>{error&&<div className="recipe-alert" role="alert">{error}<button className="text-button" onClick={()=>void reload().catch(e=>setError(appError(e)))}>重新同步</button></div>}<IngredientCatalogView draftKey={`ingredient-drafts:${store.id}`} catalog={catalog} loaded={loaded} failed={!!error} onSave={save} onSources={id=>readWorkspace<IngredientSource[]>(store.id,'ingredient.sources',{id})} registerLeave={registerLeave}/></div>;
}
