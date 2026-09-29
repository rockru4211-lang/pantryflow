'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {X} from 'lucide-react';
import {supabase} from '@/lib/supabase-browser';
import {receiptRead,receiptReadError} from '@/lib/receipt-read';
import {useOperation} from './operation-hooks';
import {receiptError,receiptValue} from '@/lib/receipt-workflow';
import {receiptDetailPage} from '@/lib/receipt-ledger';
import ReceiptDesktopReview from './receipt-desktop-review';
import ReceiptSourceViewer from './receipt-source-viewer';
import type {Detail,LedgerRow} from './receiving-workspace';
import SupplierNameInput from './supplier-name-input';
import {exactInboxSupplier} from '@/lib/receipt-supplier-inbox';
import './receipt-detail-list.css';

type Props={storeId:string;userId:string;row:LedgerRow;chain:boolean;onClose:()=>void;onSaved:()=>Promise<unknown>};
export default function ReceiptLineReview({storeId,userId,row,chain,onClose,onSaved}:Props){
 const dialog=useRef<HTMLDialogElement>(null),guard=useRef<(()=>boolean)|null>(null),sequence=useRef(0),flight=useRef<AbortController|null>(null),supplierLock=useRef(false);
 const [detail,setDetail]=useState<Detail|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[urls,setUrls]=useState<Record<string,string>>({}),[supplierBusy,setSupplierBusy]=useState(false),[supplierResolved,setSupplierResolved]=useState(false);
 const registerClose=useCallback((fn:(()=>boolean)|null)=>{guard.current=fn;},[]);
 const close=useCallback(()=>{if(!supplierLock.current&&(!guard.current||guard.current())){onClose();}},[onClose]);
 const setSupplierWorking=useCallback((busy:boolean)=>{supplierLock.current=busy;setSupplierBusy(busy);},[]);
 const refresh=useCallback(async()=>{
  flight.current?.abort();const controller=new AbortController();flight.current=controller;const request=++sequence.current;
  setLoading(true);setError('');
  try{
   const result=await receiptRead(signal=>supabase.rpc('get_pilot_receipt',{p_batch_id:row.batch_id}).abortSignal(signal),controller.signal);
   if(result.error)throw result.error;
   const next=result.data as unknown as Detail;
   if(!next?.batch||next.batch.id!==row.batch_id||(next.batch as {store_id?:string}).store_id!==storeId)throw Error('RECEIPT_ACCESS_DENIED');
   if(request!==sequence.current||controller.signal.aborted)return;
   setDetail(next);return {...next,lineStates:next.line_states||[],manualLines:next.manual_lines||[]};
  }catch(e){if(!controller.signal.aborted&&request===sequence.current){setError(receiptReadError(e));throw e;}}
  finally{if(request===sequence.current)setLoading(false);}
 },[storeId,row.batch_id]);
 useEffect(()=>{const ref=sequence;let live=true;dialog.current?.showModal();queueMicrotask(()=>{if(live)void refresh().catch(()=>{});});return()=>{live=false;ref.current++;flight.current?.abort();};},[refresh]);
 const paths=detail?.documents.map(d=>d.path).join('|')||'';
 useEffect(()=>{let active=true;if(!paths)return;void supabase.storage.from('receipt-documents').createSignedUrls(paths.split('|'),3600).then(({data,error})=>{if(!active)return;if(error)setError('原貨單暫時無法讀取，請關閉後重試。');else setUrls(Object.fromEntries((data||[]).map(d=>[d.path||'',d.signedUrl||''])));});return()=>{active=false;};},[paths]);
 const pictures=detail&&<ReceiptSourceViewer documents={detail.documents} imageUrls={urls}/>;
 const editable=!!detail?.review_allowed&&!!detail.run&&receiptDetailPage(detail)==='review';
 const savedReturn=async()=>{await onSaved();close();};
 const manual=detail?.manual_lines?.find(line=>'manual-'+line.id===row.row_key);
 const published=detail?.receipt||detail?.batch.status==='COMPLETED';
 return <dialog ref={dialog} className="receipt-line-dialog" aria-labelledby="receipt-line-title" onCancel={e=>{e.preventDefault();close();}}>
  <header><div><h2 id="receipt-line-title">{editable?'核對進貨品項':'查看進貨品項'}</h2><p>{row.receipt_date||'日期待核對'}・{row.supplier_name}・{detail?.batch.batch_number||''}</p></div><button type="button" className="text-button" aria-label="關閉核對視窗" onClick={close}><X/></button></header>
  {row.row_key==='document'?(row.document_issues||[]).filter(issue=>!supplierResolved||issue!=='供應商名稱未確認').length>0&&<p className="receipt-line-alert">⚠ {(row.document_issues||[]).filter(issue=>!supplierResolved||issue!=='供應商名稱未確認').join('・')}</p>:(row.issues||[]).length>0&&<p className="receipt-line-alert">⚠ {(row.issues||[]).join('・')}</p>}
  {error&&<p role="alert">{error}<button type="button" className="text-button" disabled={loading} onClick={()=>void refresh().catch(()=>{})}>重新讀取</button></p>}
  {detail&&editable&&row.row_key==='document'&&!supplierResolved&&(row.document_issues||[]).includes('供應商名稱未確認')&&<SupplierNameReview storeId={storeId} userId={userId} sourceName={String(receiptValue(detail.fields,'document','supplier_name')||'')} expected={row.supplier_id||null} onBusy={setSupplierWorking} onSaved={async()=>{await refresh();await onSaved();setSupplierResolved(true);}}/>}
  {loading&&!detail&&<p role="status">正在讀取原貨單與明細…</p>}
  {detail&&(manual?<ManualReview key={manual.id} line={manual} storeId={storeId} batchId={row.batch_id} runId={detail.run?.id||''} editable={editable} pictures={pictures} registerClose={registerClose} onSaved={savedReturn} onClose={close}/>:detail.fields.some(f=>f.row_key===row.row_key)&&detail.run?<ReceiptDesktopReview key={`${storeId}:${row.batch_id}:${detail.run.id}`} storeId={storeId} userId={userId} batchId={row.batch_id} runId={detail.run.id} fields={detail.fields} mappings={detail.mappings} lineStates={detail.line_states} manualLines={detail.manual_lines} chain={chain} canReview={editable} busy={loading||supplierBusy} pictures={pictures} focusedRow={row.row_key} onRefresh={refresh} onComplete={async()=>{}} registerClose={registerClose} onReturn={savedReturn}/>:<div className="receipt-focus-layout"><aside>{pictures}</aside><div><h3>{row.product_name}</h3><p>{row.quantity??'未提供'} {row.unit}</p><p>未稅單價：{row.unit_price??'未提供'}</p><p>小計：{row.subtotal??'未提供'}</p><p>{published?'已確認的原始紀錄。':'此品項資料已更新，請返回重新讀取。'}</p><button className="shell-secondary" onClick={close}>返回明細</button></div></div>)}
 </dialog>;
}
function ManualReview({line,storeId,batchId,runId,editable,pictures,registerClose,onSaved,onClose}:{line:NonNullable<Detail['manual_lines']>[number];storeId:string;batchId:string;runId:string;editable:boolean;pictures:React.ReactNode;registerClose:(fn:(()=>boolean)|null)=>void;onSaved:()=>Promise<void>;onClose:()=>void}){
 const [draft,setDraft]=useState({name:line.product_name,specification:line.specification,unit:line.unit,quantity:String(line.quantity),price:line.unit_price_ex_tax===null?'':String(line.unit_price_ex_tax),note:line.note});
 const [busy,setBusy]=useState(false),[error,setError]=useState('');const lock=useRef(false),dirty=useRef(false);
 useEffect(()=>{registerClose(()=>!lock.current&&(!dirty.current||window.confirm('尚未儲存，確定捨棄此列修改？')));return()=>registerClose(null);},[registerClose]);
 async function save(){if(!editable||lock.current)return;const q=Number(draft.quantity),p=draft.price.trim()===''?null:Number(draft.price);if(!draft.name.trim()||!draft.unit.trim()||!draft.quantity.trim()||!Number.isFinite(q)||q<=0||p!==null&&(!Number.isFinite(p)||p<0)){setError('請填寫品名、單位與有效數量。');return;}lock.current=true;setBusy(true);setError('');try{const r=await supabase.rpc('save_baihuayuan_manual_receipt_line',{p_store_id:storeId,p_batch_id:batchId,p_run_id:runId,p_line_id:line.id,p_supplier_name:line.supplier_name,p_product_name:draft.name,p_specification:draft.specification,p_unit:draft.unit,p_quantity:q,p_unit_price:p,p_note:draft.note});if(r.error)throw r.error;dirty.current=false;lock.current=false;await onSaved();}catch(e){setError(receiptError(e));}finally{lock.current=false;setBusy(false);}}
 return <><div className="receipt-focus-layout"><aside>{pictures}</aside><div className="receipt-focus-fields">{Object.entries({name:'品名',specification:'規格',unit:'單位',quantity:'數量',price:'未稅單價',note:'備註'}).map(([key,label])=><label key={key}>{label}<input value={draft[key as keyof typeof draft]} disabled={!editable||busy} onChange={e=>{setDraft({...draft,[key]:e.target.value});dirty.current=true;}}/></label>)}{error&&<p role="alert">{error}</p>}</div></div><footer className="receipt-focus-footer"><button className="shell-secondary" disabled={busy} onClick={onClose}>返回明細</button>{editable&&<button className="shell-primary" disabled={busy} onClick={()=>void save()}>儲存並返回</button>}</footer></>;
}

function SupplierNameReview({storeId,userId,sourceName,expected,onBusy,onSaved}:{storeId:string;userId:string;sourceName:string;expected:string|null;onBusy:(busy:boolean)=>void;onSaved:()=>Promise<void>}){
 const [options,setOptions]=useState<{id:string;name:string;aliases?:string[]}[]>([]),[name,setName]=useState(sourceName),[allowCreate,setAllowCreate]=useState(false),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 const operation=useOperation(storeId,userId);
 useEffect(()=>{let active=true;void supabase.rpc('app_workspace',{p_store_id:storeId,p_section:'suppliers',p_filter:{}}).then(({data,error})=>{if(!active)return;setLoading(false);if(error){setError('供應商清單未能讀取，請關閉後重試。');return;}const value=data as unknown as {suppliers:{id:string;name:string;is_active:boolean}[]};setOptions((value.suppliers||[]).filter(s=>s.is_active));});return()=>{active=false;};},[storeId]);
 const existing=exactInboxSupplier(name,options);
 async function save(){if(!name.trim()||!existing&&!allowCreate||loading||error||operation.busy)return;onBusy(true);try{const result=await operation.run('supplier.resolve-name',{source_name:sourceName,expected_supplier_id:expected,supplier_id:existing?.id||null,new_name:existing?'':name.trim()});if(result)await onSaved();}catch(e){setError(receiptError(e));}finally{onBusy(false);}}
 return <section className="receipt-line-alert"><strong>確認正式供應商</strong><p>原辨識名稱：{sourceName}</p><SupplierNameInput value={name} onChange={name=>{setName(name);operation.setError('');}} suppliers={options} disabled={loading||!!error||operation.busy} allowCreate={allowCreate} onAllowCreate={setAllowCreate}/><p>同一原單名稱的貨單會一併歸入選定供應商，原單文字保留。</p><button className="shell-secondary" disabled={loading||!!error||operation.busy||!name.trim()||!existing&&!allowCreate} onClick={()=>void save()}>確認供應商</button>{(error||operation.error)&&<p role="alert">{error||operation.error}</p>}</section>;
}
