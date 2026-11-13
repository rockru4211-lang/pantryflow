'use client';

import {useCallback,useEffect,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase-browser';
import {appError} from '@/lib/app-workspace';
import {operationDeadline} from '@/lib/operation-deadline';
import {drinkPosCost,drinkPosFormats,posBottleCapacity,type DrinkPosMapping,type PosMapping} from '@/lib/pos-cost';
import type {RecipePurchase} from '@/lib/recipe-model';
import RecipeModal from './recipe-modal';
import './pos-cost-mappings.css';

type Mapping = string | DrinkPosMapping;
export function usePosCostMappings<T extends Mapping>(storeId:string,kind:'recipe'|'drink',enabled=true){
 const [snapshot,setSnapshot]=useState<{storeId:string;rows:PosMapping<T>[];ready:boolean;error:string}>({
  storeId,rows:[],ready:false,error:'',
 });
 const sequence=useRef(0);
 const requests=useRef(new Map<string,string>());
 const cancelRead=useCallback(()=>{sequence.current++;},[]);
 const rpc=useCallback(async(payload?:Record<string,unknown>,request?:string)=>operationDeadline(async signal=>{
  const result=await supabase.rpc('beape_pos_cost_mappings' as never,{
   p_store_id:storeId,p_kind:kind,...(payload?{p_data:payload,p_request_id:request}:{}),
  } as never).abortSignal(signal);
  if(result.error)throw result.error;
  return result.data;
 }),[storeId,kind]);
 const reload=useCallback(async()=>{
  const version=++sequence.current;
  try{
   const rows=await rpc() as unknown as PosMapping<T>[];
   if(version===sequence.current)setSnapshot({storeId,rows,ready:true,error:''});
  }catch{
   if(version===sequence.current)setSnapshot(old=>({storeId,rows:old.storeId===storeId?old.rows:[],ready:false,error:'POS 對應暫時無法讀取。'}));
  }
 },[rpc,storeId]);
 useEffect(()=>{
  let active=true;
  if(enabled)void Promise.resolve().then(()=>{if(active)return reload();});
  return()=>{active=false;cancelRead();};
 },[enabled,reload,cancelRead]);
 async function save(targetId:string,scope:string,mapping:T,revision:number){
  const payload={target_id:targetId,scope,mapping,revision};
  const key=JSON.stringify([storeId,kind,payload]);
  const request=requests.current.get(key)||crypto.randomUUID();
  requests.current.set(key,request);
  try{
   const saved=await rpc(payload,request) as unknown as PosMapping<T>;
   sequence.current++;
   setSnapshot(old=>old.storeId===storeId?{...old,rows:[
    ...old.rows.filter(row=>row.target_id!==targetId||row.scope!==scope),saved,
   ]}:old);
   requests.current.delete(key);
  }catch(e){
   if(String((e as {message?:string})?.message).includes('REVISION_CONFLICT')){
    await reload();
    throw Error('對應已由其他人更新。請關閉後重新開啟核對。');
   }
   throw Error(appError(e));
  }
 }
 return {...(snapshot.storeId===storeId?snapshot:{rows:[],ready:false,error:''}),reload,save};
}

const money=new Intl.NumberFormat('zh-TW',{style:'currency',currency:'TWD',minimumFractionDigits:2,maximumFractionDigits:2});
export function DrinkPosFields({mapping,purchase,editable,onChange}:{
 mapping:DrinkPosMapping;purchase:RecipePurchase|null|undefined;editable:boolean;onChange?:(value:DrinkPosMapping)=>void;
}){
 const capacity=posBottleCapacity(purchase);
 return <>
  {editable&&<div className="pos-capacity-fields">
   <label>瓶容量（ml）<input type="number" min="0.01" max="100000" step="any" placeholder={capacity?String(capacity):'請填瓶容量'}
    value={mapping.bottleMl??''} onChange={e=>onChange?.({...mapping,bottleMl:e.target.value===''?undefined:e.target.valueAsNumber})}/></label>
   <label>出杯量（ml）<input type="number" min="0.01" max={mapping.bottleMl??capacity??100000} step="any"
    value={mapping.glassMl??''} onChange={e=>onChange?.({...mapping,glassMl:e.target.value===''?undefined:e.target.valueAsNumber})}/></label>
  </div>}
  <table className="pos-drink-table"><thead><tr><th scope="col">POS 名稱</th><th scope="col">販售規格</th><th scope="col">每份成本</th></tr></thead>
   <tbody>{drinkPosFormats.map(({key,label})=>{
    const cost=drinkPosCost(purchase,mapping,key);
    return <tr key={key}>
     <td>{editable?<input data-initial-focus={key==='bottle'||undefined} aria-label={`${label} POS 名稱`} value={mapping[key]??''} maxLength={200}
      onChange={e=>onChange?.({...mapping,[key]:e.target.value})}/>:mapping[key]}</td>
     <td>{label}</td>
     <td>{cost===null?'':money.format(cost)}</td>
    </tr>;
   })}</tbody>
  </table>
  {mapping.glass&&(drinkPosCost(purchase,mapping,'glass')===null)&&(!(mapping.bottleMl??capacity)||!mapping.glassMl)&&<small>單杯待補瓶容量或出杯量</small>}
 </>;
}

export function PosMappingEditor({name,scopeLabel,mapping,purchase,onSave,onClose}:{
 name:string;scopeLabel?:string;mapping:Mapping;purchase?:RecipePurchase|null;
 onSave:(value:Mapping)=>Promise<void>;onClose:()=>void;
}){
 const [value,setValue]=useState(mapping);
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const saving=useRef(false);
 async function save(){
  if(saving.current)return;
  if(typeof value!=='string'&&value.glassMl&&value.glassMl>(value.bottleMl??posBottleCapacity(purchase)??Infinity)){
   setError('單杯出杯量需小於或等於瓶容量。');return;
  }
  saving.current=true;setBusy(true);setError('');
  try{
   await onSave(typeof value==='string'?value.trim():{
    ...value,bottle:value.bottle?.trim(),half:value.half?.trim(),glass:value.glass?.trim(),
   });
   onClose();
  }catch(e){setError(e instanceof Error?e.message:'儲存失敗，請重試。');}
  finally{saving.current=false;setBusy(false);}
 }
 return <RecipeModal title="編輯 POS 對應" className="pos-mapping-modal" busy={busy} onClose={onClose}>
  <form onSubmit={e=>{e.preventDefault();void save();}}>
   <div className="pos-mapping-title"><strong>{name}</strong>{scopeLabel&&<small>{scopeLabel}</small>}</div>
   <fieldset disabled={busy}>
    {typeof value==='string'?<label>POS 名稱<input data-initial-focus value={value} maxLength={200}
     onChange={e=>setValue(e.target.value)}/></label>:
     <DrinkPosFields editable mapping={value} purchase={purchase} onChange={setValue}/>}
   </fieldset>
   {error&&<p role="alert" className="recipe-alert">{error}</p>}
   <div className="recipe-actions"><button type="button" className="recipe-secondary" disabled={busy} onClick={onClose}>取消</button>
    <button type="submit" className="shell-primary" disabled={busy}>{busy?'儲存中…':'儲存對應'}</button></div>
  </form>
 </RecipeModal>;
}
