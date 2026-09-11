'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {appError,readWorkspace,writeOperation} from '@/lib/app-workspace';
import {workspaceStorage} from '@/lib/workspace-storage';

export function useWorkspace<T>(storeId:string,section:string,filter:Record<string,unknown>={}) {
 const [data,setData]=useState<T>();const [error,setError]=useState('');const [loading,setLoading]=useState(true);const sequence=useRef(0);const filterJson=JSON.stringify(filter);
 const refresh=useCallback(async()=>{const request=++sequence.current;setLoading(true);try{const next=await readWorkspace<T>(storeId,section,JSON.parse(filterJson));if(request===sequence.current){setData(next);setError('');}}catch(e){if(request===sequence.current)setError(appError(e));}finally{if(request===sequence.current)setLoading(false);}},[storeId,section,filterJson]);
 useEffect(()=>{let active=true;const counter=sequence;queueMicrotask(()=>{if(active)void refresh();});return()=>{active=false;counter.current++;};},[refresh]);
 return {data,error,loading,refresh};
}
export function useOperation(storeId:string,userId:string){
 const [busy,setBusy]=useState(false);const [error,setError]=useState('');const lock=useRef(false);const pending=useRef(new Map<string,{id:string;signature:string}>());
 const run=async<T=Record<string,unknown>>(action:string,data:Record<string,unknown>):Promise<T|undefined>=>{
  if(lock.current)return;lock.current=true;setBusy(true);setError('');
  const key=`app-request:${userId}:${storeId}:${action}`;const signature=JSON.stringify(data);let id=pending.current.get(key)?.signature===signature?pending.current.get(key)!.id:crypto.randomUUID();
  try{const old=JSON.parse(workspaceStorage(userId).getItem(key)||'null');if(old?.signature===signature&&typeof old.id==='string')id=old.id;workspaceStorage(userId).setItem(key,JSON.stringify({id,signature}));}catch{/* Retry token still works in memory for the in-flight request. */}
  pending.current.set(key,{id,signature});
  try{const result=await writeOperation<T>(storeId,action,data,id);pending.current.delete(key);try{workspaceStorage(userId).removeItem(key);}catch{}return result;}catch(e){setError(appError(e));return undefined;}finally{lock.current=false;setBusy(false);}
 };
 return {run,busy,error,setError};
}
export function useOperationDraft<T>(userId:string,storeId:string,name:string,empty:T){
 const key=`app-draft:${userId}:${storeId}:${name}`;const initial=useRef(empty);const [value,setValue]=useState(empty);const[loadedKey,setLoadedKey]=useState('');
 useEffect(()=>{try{const saved=workspaceStorage(userId).getItem(key);setValue(saved?JSON.parse(saved):initial.current);}catch{setValue(initial.current);}setLoadedKey(key);},[key,userId]);
 useEffect(()=>{if(loadedKey===key)try{workspaceStorage(userId).setItem(key,JSON.stringify(value));}catch{}},[key,loadedKey,value,userId]);
 const clear=()=>{setValue(initial.current);try{workspaceStorage(userId).removeItem(key);}catch{}};
 return [value,setValue,clear] as const;
}
