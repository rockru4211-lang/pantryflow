'use client';

import {useCallback,useEffect,useRef,useState} from 'react';
import {ArrowLeft} from 'lucide-react';
import {appError,readWorkspace,writeOperation,type AppStore} from '@/lib/app-workspace';
import type {RecipeWorkspace} from '@/lib/recipe-cost';
import type {RecipePriceInput} from './recipe-price-editor';
import RecipePriceRegister from './recipe-price-register';
import './recipes.css';

type Props={store:AppStore;onBack:()=>void;registerLeave?:(handler:(()=>Promise<boolean>)|null)=>void};
export default function IngredientPricesWorkspace({store,onBack,registerLeave}:Props){
 const [workspace,setWorkspace]=useState<RecipeWorkspace>({recipes:[],products:[],prices:[],can_price:false});
 const [loaded,setLoaded]=useState(false),[error,setError]=useState('');
 const mounted=useRef(false),sequence=useRef(0),request=useRef<{encoded:string;id:string}|null>(null);
 const reload=useCallback(async()=>{
  const current=++sequence.current;
  const data=await readWorkspace<RecipeWorkspace>(store.id,'recipes');
  if(mounted.current&&current===sequence.current){setWorkspace(data);setLoaded(true);setError('');}
 },[store.id]);
 useEffect(()=>{
  mounted.current=true;
  if(store.role==='STAFF')return()=>{mounted.current=false;};
  const refresh=()=>{void reload().catch(e=>{if(mounted.current)setError(appError(e));});};
  refresh();window.addEventListener('focus',refresh);const timer=setInterval(refresh,30000);
  return()=>{mounted.current=false;window.removeEventListener('focus',refresh);clearInterval(timer);};
 },[reload,store.role]);
 async function save(data:RecipePriceInput){
  const encoded=JSON.stringify(data);
  if(request.current?.encoded!==encoded)request.current={encoded,id:crypto.randomUUID()};
  await writeOperation(store.id,'recipe.price',data,request.current.id);
  await reload();request.current=null;return true;
 }
 if(store.role==='STAFF')return <p role="alert">請使用主管或行政帳號查看食材價格。</p>;
 return <div className="recipe-workspace ingredient-prices-workspace">
  <button className="recipe-back" onClick={onBack}><ArrowLeft size={18}/>返回首頁</button>
  <p className="price-page-context">{store.name} · 食材價格表</p>
  {error&&<div className="recipe-alert" role="alert">{error}<button className="text-button" onClick={()=>void reload().catch(e=>setError(appError(e)))}>重新同步</button></div>}
  <RecipePriceRegister workspace={workspace} loaded={loaded} onSave={save} registerLeave={registerLeave}/>
 </div>;
}
