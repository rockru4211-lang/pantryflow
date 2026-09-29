'use client';
import {Fragment,useEffect,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase-browser';
import {receiptRead,receiptReadError} from '@/lib/receipt-read';
import {receiptError,receiptValue} from '@/lib/receipt-workflow';
import {editableReceiptDate,ledgerEditCard,ledgerEditError,receiptCategories,type LedgerEditValues} from '@/lib/receipt-ledger-edit';
import {useOperation} from './operation-hooks';
import type {Detail,LedgerRow} from './receiving-workspace';
import './receipt-ledger-table.css';
type Props={storeId:string;userId:string;rows:LedgerRow[];allRows:LedgerRow[];busy:boolean;onSaved:()=>Promise<unknown>;onSource:(row:LedgerRow)=>void;onConfirm:(row:LedgerRow)=>void;onEditing:(key:string,active:boolean)=>void;onFlag:(id:string,state:'LIVE'|'TEST'|'REMOVED')=>void;recordView:string};
const money=(value:number|null)=>value===null?'—':Number(value).toLocaleString('zh-TW',{maximumFractionDigits:4});
export default function ReceiptLedgerTable(props:Props){
 const [adding,setAdding]=useState<LedgerRow|null>(null);
 return <div className="receipt-flat-wrap"><table className="receipt-flat-table"><thead><tr>{['進貨日期','分類','供應商','品名／規格','數量','單位','未稅單價','未稅金額','備註','操作'].map(label=><th key={label}>{label}</th>)}</tr></thead><tbody>
 {props.rows.map(row=><Fragment key={`${row.batch_id}:${row.row_key}`}><EditableRow {...props} row={row} onAdd={()=>setAdding(row)}/>{adding?.batch_id===row.batch_id&&adding.row_key===row.row_key&&<EditableRow {...props} row={{...row,row_key:'new',product_name:'',specification:'',quantity:null,unit:'',unit_price:null,subtotal:null,note:'',annotation_revision:0}} isNew onAdd={()=>{}} onCancelAdd={()=>setAdding(null)}/>}</Fragment>)}
 </tbody></table></div>;
}
function EditableRow({row,isNew=false,onCancelAdd,onAdd,...props}:Props&{row:LedgerRow;isNew?:boolean;onAdd:()=>void;onCancelAdd?:()=>void}){
 const [editing,setEditing]=useState(isNew),[detail,setDetail]=useState<Detail|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [documentDraft,setDocumentDraft]=useState<Record<string,string>>({}),[documentReviewed,setDocumentReviewed]=useState(false);
 const [draft,setDraft]=useState<LedgerEditValues|null>(null);const operation=useOperation(props.storeId,props.userId),sequence=useRef(0),lock=useRef(false),baseline=useRef({review_revision:row.review_revision,annotation_revision:row.annotation_revision||0});
 const key=`${row.batch_id}:${row.row_key}`;const {onEditing}=props;
 useEffect(()=>{onEditing(key,editing);return()=>onEditing(key,false);},[editing,key,onEditing]);
 useEffect(()=>{if(!editing)return;const request=++sequence.current;const controller=new AbortController();
  async function load(){baseline.current={review_revision:row.review_revision,annotation_revision:row.annotation_revision||0};setLoading(true);setError('');try{
   const r=await receiptRead(signal=>supabase.rpc('get_pilot_receipt',{p_batch_id:row.batch_id}).abortSignal(signal),controller.signal);if(r.error)throw r.error;
   const next=r.data as unknown as Detail;
   if(!next?.batch||next.batch.id!==row.batch_id||!next.review_allowed||next.run?.id!==row.run_id)throw Error('RECEIPT_REVIEWER_REQUIRED');
   if(request!==sequence.current||controller.signal.aborted)return;
   const manual=next.manual_lines?.find(m=>'manual-'+m.id===row.row_key);
   const v=(name:string,fallback:unknown)=>String(receiptValue(next.fields,row.row_key,name)??fallback??'');
   setDetail(next);setDocumentReviewed(false);setDocumentDraft(Object.fromEntries(['document_number','subtotal_ex_tax','tax','total_inc_tax'].map(name=>[name,String(receiptValue(next.fields,'document',name)??'')])));setDraft({date:editableReceiptDate(String(receiptValue(next.fields,'document','receipt_date')||row.receipt_date||'')),supplier:String(receiptValue(next.fields,'document','supplier_name')||row.supplier_name||''),name:isNew?'':manual?.product_name||v('product',row.product_name),specification:isNew?'':manual?.specification||v('specification',row.specification==='未提供'?'':row.specification),quantity:isNew?'':String(manual?.quantity??v('quantity',row.quantity)),unit:isNew?'':manual?.unit||v('unit',row.unit),price:isNew?'':manual?String(manual.unit_price_ex_tax??''):v('unit_price_ex_tax',row.unit_price),category:row.category||'待分類',note:isNew?'':row.note||manual?.note||''});
  }catch(e){if(!controller.signal.aborted)setError(receiptReadError(e));}finally{if(!controller.signal.aborted)setLoading(false);}}
  void load();return()=>controller.abort();
 // Load only on opening: background refresh must never replace typed values.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[editing,row.batch_id,row.row_key,props.storeId,isNew]);
 useEffect(()=>{if(!editing)return;const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[editing]);
 const editable=row.review_allowed&&row.status!=='COMPLETE'&&!!row.run_id&&props.recordView==='LIVE';
 const sharedChanged=!!draft&&!!detail&&(draft.supplier!==String(receiptValue(detail.fields,'document','supplier_name')||'')||draft.date!==editableReceiptDate(String(receiptValue(detail.fields,'document','receipt_date')||'')));
 const count=props.allRows.filter(r=>r.batch_id===row.batch_id).length;
 function cancel(){if(operation.busy||lock.current)return;setEditing(false);setDraft(null);setError('');operation.setError('');onCancelAdd?.();}
 async function save(){if(!draft||!detail?.run||lock.current)return;const validation=ledgerEditError(draft);if(validation){setError(validation);return;}
  lock.current=true;setError('');setNotice('');
  try{
   const docChanged=Object.entries(documentDraft).some(([name,value])=>value!==String(receiptValue(detail.fields,'document',name)??''));
   const document=sharedChanged||docChanged||documentReviewed?{...ledgerEditCard(row.batch_id,detail.run.id,'document',detail.fields,{...documentDraft,supplier_name:draft.supplier.trim(),receipt_date:draft.date}),acknowledge:documentReviewed}:null;
   const values:Record<string,string>={product:draft.name.trim(),specification:draft.specification,quantity:draft.quantity,unit:draft.unit.trim(),unit_price_ex_tax:draft.price};
   const oldQ=receiptValue(detail.fields,row.row_key,'quantity'),oldP=receiptValue(detail.fields,row.row_key,'unit_price_ex_tax');
   if(draft.quantity!==String(oldQ??'')||draft.price!==String(oldP??''))values.subtotal_ex_tax=draft.price.trim()?String(Number(draft.quantity)*Number(draft.price)):'';
   const manual=isNew||row.row_key.startsWith('manual-');
   const payload={batch_id:row.batch_id,run_id:detail.run.id,row_key:row.row_key,review_revision:baseline.current.review_revision,annotation_revision:baseline.current.annotation_revision,document,category:draft.category,note:draft.note,
    ...(manual?{manual:{product_name:draft.name.trim(),specification:draft.specification,unit:draft.unit.trim(),quantity:Number(draft.quantity),unit_price:draft.price.trim()?Number(draft.price):null}}:{line:ledgerEditCard(row.batch_id,detail.run.id,row.row_key,detail.fields,values,detail.mappings.find(m=>m.row_key===row.row_key))})};
   const result=await operation.run('receipt.edit-ledger',payload);if(!result)return;
   setNotice('已儲存');setEditing(false);setDraft(null);onCancelAdd?.();await props.onSaved();
  }catch(e){setError(receiptError(e));}finally{lock.current=false;}
 }
 const change=(field:keyof LedgerEditValues,value:string)=>setDraft(old=>old?{...old,[field]:value}:old);
 const field=(name:keyof LedgerEditValues,label:string,type='text')=><input aria-label={label} type={type} step={type==='number'?'any':undefined} value={draft?.[name]||''} onChange={e=>change(name,e.target.value)} disabled={operation.busy}/>;
 const numericChanged=!!draft&&(isNew||draft.quantity!==String(row.quantity??'')||draft.price!==String(row.unit_price??''));
 const amount=numericChanged?draft&&draft.quantity.trim()&&draft.price.trim()?Number(draft.quantity)*Number(draft.price):null:row.subtotal;
 return <><tr className={editing?'receipt-flat-editing':''}>
 {editing&&draft?<><td>{field('date','進貨日期','date')}</td><td><select aria-label="分類" value={draft.category} onChange={e=>change('category',e.target.value)} disabled={operation.busy}>{receiptCategories.map(c=><option key={c}>{c}</option>)}</select></td><td>{field('supplier','供應商')}</td><td>{field('name','品名')}{field('specification','規格')}</td><td>{field('quantity','數量','number')}</td><td>{field('unit','單位')}</td><td>{field('price','未稅單價','number')}</td><td className="numeric">{money(amount)}</td><td>{field('note','備註')}</td></>:<><td>{editableReceiptDate(row.receipt_date)||'未提供'}</td><td>{row.category||'待分類'}</td><td>{row.supplier_name||'未提供'}</td><td><strong>{row.product_name||'新增品項'}</strong>{row.specification&&row.specification!=='未提供'&&<small>{row.specification}</small>}</td><td className="numeric">{row.quantity??'—'}</td><td>{row.unit||'—'}</td><td className="numeric">{money(row.unit_price)}</td><td className="numeric">{money(row.subtotal)}</td><td>{row.note||'—'}</td></>}
 <td><div className="receipt-flat-actions">{editing?<><button type="button" className="shell-primary" disabled={loading||operation.busy||!draft} onClick={()=>void save()}>{operation.busy?'儲存中…':'儲存'}</button><button type="button" className="text-button" disabled={operation.busy} onClick={cancel}>取消</button></>:<><button type="button" className="shell-secondary" disabled={!editable||props.busy} onClick={()=>{setNotice('');setEditing(true);}}>{row.status==='COMPLETE'?'已確認':'修改'}</button><details className="record-more"><summary aria-label={`${row.product_name}更多操作`}>⋯</summary><div><button type="button" onClick={()=>props.onSource(row)}>查看原單</button>{editable&&<><button type="button" onClick={onAdd}>＋補上漏項</button><button type="button" onClick={()=>props.onConfirm(row)}>確認此張貨單</button></>}{props.recordView==='LIVE'?<><button type="button" onClick={()=>props.onFlag(row.batch_id,'TEST')}>標記測試</button><button type="button" onClick={()=>props.onFlag(row.batch_id,'REMOVED')}>移出正式資料</button></>:<button type="button" onClick={()=>props.onFlag(row.batch_id,'LIVE')}>恢復正式資料</button>}</div></details></>}{notice&&<small role="status">{notice}</small>}</div></td>
 </tr>{(editing||error)&&<tr className="receipt-flat-message"><td colSpan={10}>{loading&&<span role="status">正在讀取可修改欄位…</span>}{sharedChanged&&<span>供應商／日期將同步更新此張貨單共 {count} 筆明細。 </span>}{isNew&&<span>補入此張貨單：{row.supplier_name}・{row.receipt_date}。 </span>}{editing&&draft&&<details className="receipt-document-fields"><summary>貨單編號與稅額</summary><div>{[['document_number','貨單編號'],['subtotal_ex_tax','原單未稅合計'],['tax','原單稅額'],['total_inc_tax','原單含稅總額']].map(([name,label])=><label key={name}>{label}<input aria-label={label} type={name==='document_number'?'text':'number'} step="any" value={documentDraft[name]||''} disabled={operation.busy} onChange={e=>{setDocumentReviewed(false);setDocumentDraft(old=>({...old,[name]:e.target.value}));}}/></label>)}<label><input type="checkbox" checked={documentReviewed} disabled={operation.busy} onChange={e=>setDocumentReviewed(e.target.checked)}/>已依紙本核對貨單資料</label></div></details>}{(error||operation.error)&&<span role="alert">{error||operation.error}</span>}</td></tr>}</>;
}
