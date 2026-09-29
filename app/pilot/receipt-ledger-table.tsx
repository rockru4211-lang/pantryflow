'use client';
import {useEffect,useId,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase-browser';
import {receiptRead,receiptReadError} from '@/lib/receipt-read';
import {editableReceiptDate,receiptCategories,type LedgerEditValues} from '@/lib/receipt-ledger-edit';
import {sheetValues,sheetDirty,sheetPayload,type SheetDraft} from '@/lib/receipt-sheet';
import {useOperation,useOperationDraft} from './operation-hooks';
import type {Detail,LedgerRow} from './receiving-workspace';
import './receipt-ledger-table.css';
type Props={editSignal?:number;storeId:string;userId:string;rows:LedgerRow[];allRows:LedgerRow[];busy:boolean;onSaved:()=>Promise<unknown>;onSource:(row:LedgerRow)=>void;onConfirm:(row:LedgerRow)=>void;onEditing:(key:string,active:boolean)=>void;onFlag:(id:string,state:'LIVE'|'TEST'|'REMOVED')=>void;recordView:string};
const keyOf=(row:LedgerRow)=>`${row.batch_id}:${row.row_key}`;
const money=(v:number|null)=>v===null?'—':v.toLocaleString('zh-TW',{maximumFractionDigits:4});
export default function ReceiptLedgerTable(props:Props){
 const supplierListId=useId();
 const [drafts,setDrafts]=useOperationDraft<Record<string,SheetDraft>>(props.userId,props.storeId,'receiving-sheet-v1',{});
 const [mode,setMode]=useState(false);
 const [loading,setLoading]=useState<string[]>([]),[error,setError]=useState(''),[notice,setNotice]=useState(''),[extra,setExtra]=useState(false),[selected,setSelected]=useState('');
 const cache=useRef(new Map<string,Promise<Detail>>()),lock=useRef(false),generation=useRef(0),preparing=useRef(false),lastEditSignal=useRef(props.editSignal||0);
 const operation=useOperation(props.storeId,props.userId),{onEditing}=props;
 const dirty=Object.values(drafts).filter(sheetDirty),active=mode||Object.keys(drafts).length>0||loading.length>0;
 useEffect(()=>{onEditing('sheet',active);return()=>onEditing('sheet',false);},[active,onEditing]);
 useEffect(()=>{if(!active)return;const warn=(e:BeforeUnloadEvent)=>e.preventDefault();window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[active]);
 useEffect(()=>()=>{generation.current++;},[]);
 useEffect(()=>{if(props.editSignal!==lastEditSignal.current){lastEditSignal.current=props.editSignal||0;if(props.editSignal)void begin();}
 // An explicit toolbar click snapshots the current filtered rows.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[props.editSignal]);
 async function begin(){if(operation.busy||lock.current||preparing.current)return;preparing.current=true;setMode(true);setError('');setNotice('');
  const version=generation.current;
  const queue=props.rows.filter(r=>r.review_allowed&&r.status!=='COMPLETE'&&!!r.run_id&&props.recordView==='LIVE'&&!drafts[keyOf(r)]);
  let index=0;
  try{await Promise.all(Array.from({length:Math.min(4,queue.length)},async()=>{while(index<queue.length&&version===generation.current){const row=queue[index++];await open(row);}}));}finally{if(version===generation.current)preparing.current=false;}
 }

 async function open(row:LedgerRow){const key=keyOf(row);if(drafts[key]||loading.includes(key)||operation.busy||lock.current||!row.review_allowed||row.status==='COMPLETE'||props.recordView!=='LIVE')return;
  const version=generation.current;setLoading(old=>[...old,key]);
  try{
   let request=cache.current.get(row.batch_id);if(!request){request=receiptRead(signal=>supabase.rpc('get_pilot_receipt',{p_batch_id:row.batch_id}).abortSignal(signal),new AbortController().signal).then(r=>{if(r.error)throw r.error;const detail=r.data as unknown as Detail;if(!detail?.batch||detail.batch.id!==row.batch_id||!detail.review_allowed||detail.run?.id!==row.run_id)throw Error('RECEIPT_REVIEWER_REQUIRED');return detail;});cache.current.set(row.batch_id,request);}
   const detail=await request;if(version!==generation.current)return;
   const initial=sheetValues(row,detail);setDrafts(old=>{const sibling=Object.values(old).find(d=>d.row.batch_id===row.batch_id),supplierSibling=Object.values(old).find(d=>!!initial.supplier.trim()&&d.initial.supplier===initial.supplier);return {...old,[key]:{row,detail,initial,values:{...initial,...(supplierSibling?{supplier:supplierSibling.values.supplier}:{}),...(sibling?{supplier:sibling.values.supplier,date:sibling.values.date}:{})}}};});
  }catch(e){if(version===generation.current){cache.current.delete(row.batch_id);setError(receiptReadError(e));}}finally{if(version===generation.current)setLoading(old=>old.filter(k=>k!==key));}
 }
 function change(key:string,field:keyof LedgerEditValues,value:string){setDrafts(old=>{
  const current=old[key];if(!current)return old;
  const shared=field==='supplier'||field==='date';return Object.fromEntries(Object.entries(old).map(([k,d])=>[k,k===key||shared&&(d.row.batch_id===current.row.batch_id||field==='supplier'&&!!current.initial.supplier.trim()&&d.initial.supplier===current.initial.supplier)?{...d,values:{...d.values,[field]:value}}:d]));
 });}
 function cancel(){if(lock.current||operation.busy)return;generation.current++;preparing.current=false;setMode(false);setDrafts({});setLoading([]);cache.current.clear();setError('');setNotice('');operation.setError('');}
 async function save(){if(lock.current||operation.busy||loading.length||!dirty.length)return;lock.current=true;setError('');setNotice('');try{
  const payload=sheetPayload(Object.values(drafts));const result=await operation.run<{saved:boolean;count:number}>('receipt.edit-sheet',payload);if(!result?.saved)return;
  setMode(false);setDrafts({});cache.current.clear();setNotice(`已儲存 ${result.count} 筆變更`);await props.onSaved();
 }catch(e){setError(e instanceof Error?e.message:'儲存失敗，修改內容已保留。');}finally{lock.current=false;}}
 function cell(row:LedgerRow,name:keyof LedgerEditValues,label:string,fallback:string,type='text'){
  const key=keyOf(row),d=drafts[key];const changed=d&&d.values[name]!==d.initial[name];
  return <td className={`${changed?'sheet-changed ':''}${type==='number'?'numeric':''}`}>{d?<input aria-label={`${row.product_name} ${label}`} type={type} list={name==='supplier'?supplierListId:undefined} maxLength={name==='supplier'?160:undefined} step={type==='number'?'any':undefined} value={d.values[name]} disabled={operation.busy} onChange={e=>change(key,name,e.target.value)}/>:<span title={fallback}>{fallback||'—'}</span>}</td>;
 }
 const target=props.allRows.find(r=>keyOf(r)===selected);
 const supplierChanged=dirty.some(d=>d.values.supplier.trim()!==d.initial.supplier.trim());
 const dateChanged=dirty.some(d=>d.values.date!==d.initial.date);
 return <section className="receipt-sheet">
 <datalist id={supplierListId}>{[...new Set(props.allRows.map(r=>r.supplier_name).filter(Boolean))].map(name=><option key={name} value={name}/>)}</datalist>
 <div className="sheet-options"><label><input type="checkbox" checked={extra} onChange={e=>setExtra(e.target.checked)}/>分類與備註</label><details><summary>其他操作</summary><div><select aria-label="選擇操作明細" value={selected} disabled={active||operation.busy} onChange={e=>setSelected(e.target.value)}><option value="">選擇明細</option>{props.rows.map(r=><option key={keyOf(r)} value={keyOf(r)}>{r.receipt_date}・{r.supplier_name}・{r.product_name}</option>)}</select>{target&&<><button disabled={active||operation.busy} onClick={()=>props.onSource(target)}>查看原單</button><button disabled={active||operation.busy||!target.review_allowed||target.status==='COMPLETE'} onClick={()=>props.onConfirm(target)}>確認貨單</button><button disabled={active||operation.busy} onClick={()=>props.onFlag(target.batch_id,props.recordView==='LIVE'?'TEST':'LIVE')}>{props.recordView==='LIVE'?'標記測試':'恢復正式資料'}</button><button disabled={active||operation.busy} onClick={()=>props.onFlag(target.batch_id,'REMOVED')}>移出正式資料</button></>}</div></details></div>
 <div className="receipt-flat-wrap"><table className={`receipt-flat-table${extra?' sheet-extra':''}`}><colgroup><col style={{width:110}}/>{extra&&<col style={{width:82}}/>}<col style={{width:150}}/><col style={{width:165}}/><col style={{width:110}}/><col style={{width:78}}/><col style={{width:65}}/><col style={{width:100}}/><col style={{width:110}}/>{extra&&<col style={{width:150}}/>}</colgroup><thead><tr>{['日期',...(extra?['分類']:[]),'供應商','品名','規格','數量','單位','未稅單價','未稅金額',...(extra?['備註']:[])].map(label=><th key={label}>{label}</th>)}</tr></thead><tbody>
 {props.rows.map(row=>{const key=keyOf(row),d=drafts[key],sibling=Object.values(drafts).find(v=>v.row.batch_id===row.batch_id);const v=d?.values;const amount=v&&(v.quantity!==d.initial.quantity||v.price!==d.initial.price)?v.quantity.trim()&&v.price.trim()?Number(v.quantity)*Number(v.price):null:row.subtotal;return <tr key={key} className={row.status==='COMPLETE'?'sheet-readonly':''} title={row.status==='COMPLETE'?'已確認，僅供檢視':undefined}>
 {cell(row,'date','日期',sibling?.values.date||editableReceiptDate(row.receipt_date),'date')}
 {extra&&<td className={d&&d.values.category!==d.initial.category?'sheet-changed':''}>{d?<select aria-label={`${row.product_name} 分類`} value={d.values.category} disabled={operation.busy} onChange={e=>change(key,'category',e.target.value)}>{receiptCategories.map(c=><option key={c}>{c}</option>)}</select>:row.category||'待分類'}</td>}
 {cell(row,'supplier','供應商',sibling?.values.supplier||row.supplier_name)}{cell(row,'name','品名',row.product_name)}{cell(row,'specification','規格',row.specification==='未提供'?'':row.specification)}{cell(row,'quantity','數量',String(row.quantity??''),'number')}{cell(row,'unit','單位',row.unit)}{cell(row,'price','未稅單價',money(row.unit_price),'number')}<td className="numeric"><span>{money(amount)}</span></td>{extra&&cell(row,'note','備註',row.note||'')}
 </tr>;})}
 </tbody></table></div>
 {supplierChanged&&<p className="sheet-notice" role="status">儲存後記住供應商名稱，同名貨單與明細同步更新，下次辨識自動套用。</p>}
 {dateChanged&&<p className="sheet-notice">日期會同步套用至同張貨單的明細。</p>}
 {(error||operation.error)&&<p role="alert" className="sheet-error">{error||operation.error} 修改內容已保留。{mode&&!operation.busy&&<button type="button" className="text-button" onClick={()=>void begin()}>重新讀取未載入明細</button>}</p>}
 {active&&<p className="sheet-notice" role="status">{loading.length?'正在準備編輯欄位…':'可直接點欄位輸入，Tab 切換下一格。'}{props.rows.some(r=>r.status==='COMPLETE')&&' 灰底為已確認資料，僅供檢視。'}</p>}
 <div className={`sheet-savebar${active?' is-editing':''}`}><span role="status">{dirty.length?`有 ${dirty.length} 筆變更`:notice||`${props.rows.length} 筆明細`}</span>{active&&<div><button className="sheet-cancel" disabled={operation.busy} onClick={cancel}>取消</button><button className="sheet-save" disabled={operation.busy||!!loading.length||!dirty.length} onClick={()=>void save()}>{operation.busy?'儲存中…':'儲存變更'}</button></div>}</div>
 </section>;
}
