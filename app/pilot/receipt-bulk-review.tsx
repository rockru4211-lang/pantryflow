'use client';
import {Fragment,useEffect,useId,useRef,useState} from 'react';
import {saveReceiptReview} from '@/lib/receipt-accounting-api';
import {receiptHandling,changeReviewLine,reviewDraft,reviewError,reviewPayload,type ReviewAccount,type ReviewDraft} from '@/lib/receipt-review';
import {useOperationDraft} from './operation-hooks';
import './receipt-ledger-table.css';
import './receipt-bulk-layout.css';

type Draft={row:ReviewAccount;value:ReviewDraft};
type Props={storeId:string;userId:string;rows:ReviewAccount[];disabled:boolean;onSource:(id:string)=>void;onEditing:(key:string,active:boolean)=>void;onSaved:(row:ReviewAccount)=>void;onSubmitted:()=>void;onFlag?:(id:string,state:'LIVE'|'TEST'|'REMOVED')=>void;onConfirm?:(id:string)=>void};

export default function ReceiptBulkReview(props:Props){
 const [drafts,setDrafts]=useOperationDraft<Record<string,Draft>>(props.userId,props.storeId,'receipt-bulk-review-v1',{});
 const supplierListId=useId(),productListId=useId(),unitListId=useId();
 const [saving,setSaving]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const lock=useRef(false),alive=useRef(true);
 const [requests,setRequests]=useOperationDraft<Record<string,{signature:string;id:string}>>(props.userId,props.storeId,'receipt-bulk-review-requests',{});

 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{props.onEditing('bulk-saving',saving);return()=>props.onEditing('bulk-saving',false);},[saving,props.onEditing]);

 const rows=props.rows
  .map(row=>drafts[row.batch_id]?.row||row)
  .sort((a,b)=>(a.receipt_date||'9999').localeCompare(b.receipt_date||'9999')||a.batch_id.localeCompare(b.batch_id));
 const editable=rows.filter(row=>row.can_edit&&row.record_state==='LIVE'&&row.lines.length>0);

 useEffect(()=>{
  setDrafts(old=>{
   let changed=false;
   const next={...old};
   for(const row of props.rows){
    if(!row.can_edit||row.record_state!=='LIVE'||!row.lines.length||next[row.batch_id])continue;
    next[row.batch_id]={row,value:reviewDraft(row)};
    changed=true;
   }
   return changed?next:old;
  });
 },[props.rows,setDrafts]);

 const dirty=Object.values(drafts).filter(d=>JSON.stringify(d.value)!==JSON.stringify(reviewDraft(d.row)));
 useEffect(()=>{
  if(!dirty.length)return;
  const warn=(e:BeforeUnloadEvent)=>e.preventDefault();
  window.addEventListener('beforeunload',warn);
  return()=>window.removeEventListener('beforeunload',warn);
 },[dirty.length]);

 function update(id:string,change:(v:ReviewDraft)=>ReviewDraft){
  setDrafts(old=>({
   ...old,
   [id]:{
    row:old[id]?.row||props.rows.find(row=>row.batch_id===id)!,
    value:change(old[id]?.value||reviewDraft(props.rows.find(row=>row.batch_id===id)!))
   }
  }));
 }

 async function save(){
  if(lock.current||props.disabled||!dirty.length)return;
  const issues:string[]=[];
  const jobs=dirty.flatMap(d=>{
   try{
    const data={...reviewPayload(d.row,d.value,false),checked:false,reviewed:false};
    const signature=JSON.stringify(data),old=requests[d.row.batch_id];
    return [{...d,data,signature,id:old?.signature===signature?old.id:crypto.randomUUID()}];
   }catch(e){
    issues.push(`${d.value.date||'日期未填'}・${d.value.supplier||'供應商未填'}：${e&&typeof e==='object'&&'message' in e?String(e.message):'請檢查輸入'}`);
    return [];
   }
  });
  if(!jobs.length){setError(issues.join('\n'));return;}

  setRequests(old=>({...old,...Object.fromEntries(jobs.map(j=>[j.row.batch_id,{signature:j.signature,id:j.id}]))}));
  lock.current=true;setSaving(true);setError('');setNotice('');let done=0;
  try{
   for(const job of jobs){
    const saved=await saveReceiptReview(props.storeId,job.row.batch_id,job.data,job.id);
    if(!alive.current)return;
    done++;
    props.onSaved(saved);
    setDrafts(old=>({...old,[job.row.batch_id]:{row:saved,value:reviewDraft(saved)}}));
    setRequests(old=>{const next={...old};delete next[job.row.batch_id];return next;});
   }
   setNotice(`已儲存 ${done} 張貨單的修改，缺漏資料可後補。`);
   if(issues.length)setError(`另有 ${issues.length} 張尚未儲存，原輸入保留：\n${issues.join('\n')}`);
  }catch(e){
   if(alive.current)setError(`已儲存 ${done} 張，其餘修改保留。 ${reviewError(e)}${issues.length?'\n'+issues.join('\n'):''}`);
  }finally{
   lock.current=false;
   if(alive.current)setSaving(false);
  }
 }

 const supplierOptions=[...new Set(rows.map(r=>r.supplier_name).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'zh-Hant'));
 const productOptions=[...new Set(rows.flatMap(r=>r.lines.map(l=>l.product_name)).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'zh-Hant'));
 const unitOptions=[...new Set(rows.flatMap(r=>r.lines.map(l=>l.unit)).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'zh-Hant'));
 const categories=['食材','耗材','酒水','運費','其他'];

 return <section className="receipt-sheet receipt-bulk-review receipt-detail-source">
  <datalist id={supplierListId}>{supplierOptions.map(v=><option key={v} value={v}/>)}</datalist>
  <datalist id={productListId}>{productOptions.map(v=><option key={v} value={v}/>)}</datalist>
  <datalist id={unitListId}>{unitOptions.map(v=><option key={v} value={v}/>)}</datalist>

  <div className="receipt-flat-wrap">
   <table className="receipt-flat-table receipt-source-table">
    <colgroup>
     <col style={{width:116}}/><col style={{width:170}}/><col style={{width:240}}/><col style={{width:100}}/>
     <col style={{width:82}}/><col style={{width:82}}/><col style={{width:108}}/><col style={{width:108}}/>
     <col style={{width:130}}/><col style={{width:180}}/>
    </colgroup>
    <thead><tr>{['日期','供應商','品名','類別','數量','單位','未稅單價','未稅金額','原貨單','備註'].map(s=><th key={s}>{s}</th>)}</tr></thead>
    <tbody>
     {rows.map(row=>{
      const id=row.batch_id,d=drafts[id],value=d?.value||reviewDraft(row),canEdit=!!d&&!saving&&!props.disabled;
      return <Fragment key={id}>{value.lines.map((line,index)=><tr key={`${id}:${line.row_key}`}>
       <td>{canEdit?<input type="date" aria-label={`第 ${index+1} 筆 日期`} value={value.date} disabled={value.lines.some(l=>l.custody_posted)} onChange={e=>update(id,v=>({...v,date:e.target.value}))}/>:<span>{value.date||'待確認'}</span>}</td>
       <td>{canEdit?<input type="text" list={supplierListId} aria-label={`第 ${index+1} 筆 供應商`} value={value.supplier} onChange={e=>update(id,v=>({...v,supplier:e.target.value}))}/>:<span>{value.supplier||'待確認'}</span>}</td>
       <td>{canEdit?<input type="text" list={productListId} aria-label={`${line.product_name} 品名`} value={line.product_name} onChange={e=>update(id,v=>changeReviewLine(v,index,'product_name',e.target.value))}/>:<span title={line.product_name}>{line.product_name||'—'}</span>}</td>
       <td>{canEdit?<select aria-label={`${line.product_name} 類別`} value={line.category} onChange={e=>update(id,v=>changeReviewLine(v,index,'category',e.target.value))}>{categories.map(c=><option key={c}>{c}</option>)}</select>:<span>{line.category||'待分類'}</span>}</td>
       <td className="numeric">{canEdit?<input aria-label={`${line.product_name} 數量`} inputMode="decimal" value={line.quantity} disabled={!!line.custody_posted} onChange={e=>update(id,v=>changeReviewLine(v,index,'quantity',e.target.value))}/>:<span>{line.quantity||'—'}</span>}</td>
       <td>{canEdit?<input type="text" list={unitListId} aria-label={`${line.product_name} 單位`} value={line.unit} disabled={!!line.custody_posted} onChange={e=>update(id,v=>changeReviewLine(v,index,'unit',e.target.value))}/>:<span>{line.unit||'—'}</span>}</td>
       <td className="numeric">{receiptHandling(line)==='CUSTODY_RELEASE'?<span>—</span>:canEdit?<input aria-label={`${line.product_name} 未稅單價`} inputMode="decimal" value={line.unit_price} onChange={e=>update(id,v=>changeReviewLine(v,index,'unit_price',e.target.value))}/>:<span>{line.unit_price||'—'}</span>}</td>
       <td className="numeric">{receiptHandling(line)==='CUSTODY_RELEASE'?<span>—</span>:canEdit?<input aria-label={`${line.product_name} 未稅金額`} inputMode="decimal" value={line.subtotal} onChange={e=>update(id,v=>changeReviewLine(v,index,'subtotal',e.target.value))}/>:<span>{line.subtotal||'—'}</span>}</td>
       <td><button type="button" className="text-button" disabled={saving} onClick={()=>props.onSource(id)}>查看原貨單 ↗</button></td>
       <td>{canEdit?<input aria-label={`${line.product_name} 備註`} value={line.note} onChange={e=>update(id,v=>changeReviewLine(v,index,'note',e.target.value))}/>:<span title={line.note}>{line.note||'—'}</span>}</td>
      </tr>)}</Fragment>;
     })}
    </tbody>
   </table>
  </div>

  {!rows.length&&<p className="shell-note">目前沒有符合條件的進貨明細。</p>}
  {error&&<p role="alert" className="sheet-error" style={{whiteSpace:'pre-line'}}>{error}</p>}
  {notice&&<p role="status" className="sheet-notice">{notice}</p>}
  <div className="receipt-source-footer">
   <span>資料可後補 · {rows.reduce((n,row)=>n+row.lines.length,0)} 筆進貨明細{dirty.length? ` · ${dirty.length} 張貨單有修改`:''}</span>
   <button className="sheet-save" disabled={saving||props.disabled||!dirty.length} onClick={()=>void save()}>{saving?'儲存中…':'儲存修改'}</button>
  </div>
 </section>;
}
