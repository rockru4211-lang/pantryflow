'use client';
import {useEffect,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase-browser';
import {receiptRead,receiptReadError} from '@/lib/receipt-read';
import {retryReceiptRecognition} from '@/lib/receipt-accounting-api';
import {recognitionState,recognitionError,type RecognitionDetail} from '@/lib/receipt-recognition';
export default function ReceiptRecognitionStatus({storeId,batchId,disabled,hasSavedData,onResult}:{storeId:string;batchId:string;disabled:boolean;hasSavedData:boolean;onResult:()=>void}){
 const [detail,setDetail]=useState<RecognitionDetail|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[refresh,setRefresh]=useState(0);
 const callback=useRef(onResult);useEffect(()=>{callback.current=onResult;},[onResult]);
 const seen=useRef(''),locked=useRef(false);
 useEffect(()=>{const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;seen.current='';
  async function check(){try{const result=await receiptRead(signal=>supabase.rpc('get_pilot_receipt',{p_batch_id:batchId}).abortSignal(signal),controller.signal);if(controller.signal.aborted)return;if(result.error)throw result.error;if(!result.data)throw Error('INVALID_RESPONSE');
   const next=result.data as unknown as RecognitionDetail;setDetail(next);setError('');const state=recognitionState(next);
   if(state.ready&&next.run?.id&&seen.current!==next.run.id){seen.current=next.run.id;callback.current();}
   if(state.active)timer=setTimeout(()=>void check(),5000);
  }catch(e){if(!controller.signal.aborted)setError(receiptReadError(e));}}
  void check();return()=>{controller.abort();clearTimeout(timer);};
 },[batchId,storeId,refresh]);
 async function retry(){if(locked.current||disabled||hasSavedData)return;locked.current=true;setBusy(true);setError('');try{await retryReceiptRecognition(storeId,batchId);setDetail(old=>({...old,job:{status:'QUEUED'}}));setRefresh(n=>n+1);}catch(e){setError(recognitionError(e));}finally{locked.current=false;setBusy(false);}}
 const state=detail?recognitionState(detail):null;
 return <div className="receipt-recognition-status" role="status"><span>{error||state?.label||'正在查詢辨識狀態…'}</span>{state?.retry&&!hasSavedData&&<button type="button" className="text-button" disabled={disabled||busy} onClick={()=>void retry()}>{busy?'排入中…':'重試辨識'}</button>}<button type="button" className="text-button" disabled={disabled||busy} onClick={()=>setRefresh(n=>n+1)}>查看狀態</button>{state?.ready&&<button type="button" className="text-button" disabled={disabled||busy} onClick={onResult}>讀取辨識明細</button>}</div>;
}
