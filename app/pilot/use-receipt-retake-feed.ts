'use client';
import {useEffect,useState} from 'react';
import type {AppStore} from '@/lib/app-workspace';
import {isDemoPath} from '@/lib/demo-client.mjs';
import {receiptRetakeEntries,type ReceiptPhotoTask} from '@/lib/receipt-photo-quality';
import {receiptRead,receiptReadRows} from '@/lib/receipt-read';
import {supabase} from '@/lib/supabase-browser';
import type {WorkEntry} from '@/lib/workflow-rules';

export async function readReceiptPhotoTasks(storeId:string,signal:AbortSignal,batchId?:string){
 const result=await receiptRead(readSignal=>supabase.rpc('baihuayuan_receipt_photo',{
  p_action:'list',p_store:storeId,p_data:batchId?{batch_id:batchId}:{},
 }).abortSignal(readSignal),signal);
 const tasks=receiptReadRows<ReceiptPhotoTask>(result);
 return batchId?tasks.filter(task=>task.batch_id===batchId):tasks;
}

export function useReceiptRetakeFeed(store:AppStore,enabled=true,uploaderId?:string){
 const storeId=store.id;
 const active=enabled&&store.is_active!==false&&store.access_mode!=='VIEW'&&
  store.business_type==='SINGLE_RESTAURANT'&&['BeApe','Gras'].includes(store.name);
 const scope=`${storeId}:${store.role}:${uploaderId||''}`;
 const [snapshot,setSnapshot]=useState<{scope:string;rows:WorkEntry[];error:string}>();
 const [revision,setRevision]=useState(0);
 useEffect(()=>{
  if(!active||isDemoPath(window.location.pathname))return;
  let flight:AbortController|undefined;
  const refresh=async()=>{
   flight?.abort();
   const controller=new AbortController();
   flight=controller;
   const signal=controller.signal;
   try{
    let tasks=await readReceiptPhotoTasks(storeId,signal);
    if(uploaderId&&tasks.length){
     // Reuse the existing receipt visibility rules and select only IDs uploaded by this account.
     const ids=[...new Set(tasks.map(task=>task.batch_id))];
     const ownIds=new Set<string>();
     for(let i=0;i<ids.length;i+=100){
      const result=await receiptRead(readSignal=>supabase.from('receipt_upload_batches').select('id')
       .eq('store_id',storeId).eq('uploaded_by',uploaderId).in('id',ids.slice(i,i+100)).abortSignal(readSignal),signal);
      for(const row of receiptReadRows<{id:string}>(result))ownIds.add(row.id);
     }
     tasks=tasks.filter(task=>ownIds.has(task.batch_id));
    }
    if(!signal.aborted)setSnapshot({scope,rows:receiptRetakeEntries(tasks),error:''});
   }catch{
    if(!signal.aborted)setSnapshot(old=>({scope,rows:old?.scope===scope?old.rows:[],error:'貨單重拍提醒暫時無法讀取。'}));
   }
  };
  void refresh();
  const timer=setInterval(()=>{if(document.visibilityState==='visible')void refresh();},30000);
  window.addEventListener('focus',refresh);
  window.addEventListener('receipt-retake-change',refresh);
  return()=>{
   flight?.abort();clearInterval(timer);
   window.removeEventListener('focus',refresh);
   window.removeEventListener('receipt-retake-change',refresh);
  };
 },[active,storeId,scope,uploaderId,revision]);
 const current=active&&snapshot?.scope===scope?snapshot:undefined;
 return {rows:current?.rows||[],error:current?.error||'',refresh:()=>setRevision(value=>value+1)};
}
