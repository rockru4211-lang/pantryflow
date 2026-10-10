'use client';
import {Fragment,useCallback,useEffect,useId,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {acceptReceiptSave,receiptDraftDirty,rebaseReceiptDraft} from '@/lib/receipt-autosave';
import {readIngredientMatching,readScopedReceiptAccounts,saveReceiptReview} from '@/lib/receipt-accounting-api';
import {receiptHandling,changeReviewLine,reviewDraft,reviewError,reviewPayload,type ReviewAccount,type ReviewDraft} from '@/lib/receipt-review';
import {workspaceStorage} from '@/lib/workspace-storage';
import {useOperationDraft} from './operation-hooks';
import ReceiptIngredientCell from './receipt-ingredient-cell';
import {autoMatchReceiptDraft,clearReceiptIngredient,emptyIngredientMatching,type IngredientMatching} from '@/lib/receipt-ingredient-matching';
import './receipt-ledger-table.css';
import './receipt-bulk-layout.css';

type Draft={row:ReviewAccount;value:ReviewDraft;conflicts?:string[];structural?:boolean;latest?:ReviewAccount};
type Props={desktopMode?:boolean;onFinance?:()=>void;toolsTarget?:HTMLElement|null;registerLeave?:(handler:(()=>Promise<boolean>)|null)=>void;storeId:string;userId:string;rows:ReviewAccount[];disabled:boolean;onSource:(id:string)=>void;onEditing:(key:string,active:boolean)=>void;onSaved:(row:ReviewAccount)=>void;onSubmitted:()=>void;onFlag?:(id:string,state:'LIVE'|'TEST'|'REMOVED')=>Promise<boolean>|boolean|void;onConfirm?:(id:string)=>void};

export default function ReceiptBulkReview(props:Props){
 const {onEditing,registerLeave,rows:sourceRows}=props;
 const [drafts,setDrafts]=useOperationDraft<Record<string,Draft>>(props.userId,props.storeId,'receipt-bulk-review-v1',{});
 const supplierListId=useId(),unitListId=useId();
 const [matchingData,setMatchingData]=useState<{storeId:string;catalog:IngredientMatching}|null>(null),[matchError,setMatchError]=useState('');
 const matching=matchingData?.storeId===props.storeId?matchingData.catalog:emptyIngredientMatching;
 const refreshMatching=useCallback((signal:AbortSignal)=>readIngredientMatching(props.storeId,signal).then(value=>{if(!signal.aborted){setMatchingData({storeId:props.storeId,catalog:value});setMatchError('');}}).catch(()=>{if(!signal.aborted)setMatchError('食材對應暫時無法載入，仍可編輯及儲存貨單。');}),[props.storeId]);
 useEffect(()=>{const c=new AbortController();void refreshMatching(c.signal);return()=>c.abort();},[refreshMatching]);
 const [saving,setSaving]=useState(false),[error,setError]=useState(''),[editing,setEditing]=useState(false),[composing,setComposing]=useState(false);
 const [selected,setSelected]=useState<string[]>([]);
 const lock=useRef(false),alive=useRef(true);
 const [requests,setRequests]=useOperationDraft<Record<string,{signature:string;id:string}>>(props.userId,props.storeId,'receipt-bulk-review-requests',{});

 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{onEditing('bulk-saving',saving);return()=>onEditing('bulk-saving',false);},[saving,onEditing]);

 const rows=sourceRows
  .map(row=>drafts[row.batch_id]?.row||row)
  .sort((a,b)=>(a.receipt_date||'9999').localeCompare(b.receipt_date||'9999')||a.batch_id.localeCompare(b.batch_id));


 useEffect(()=>{
  setDrafts(old=>{
   let changed=false;
   const next={...old};
   for(const row of sourceRows){
    if(lock.current||!row.can_edit||row.record_state!=='LIVE'||!row.lines.length)continue;
    const prior=next[row.batch_id];
    if(prior&&(receiptDraftDirty(prior.row,prior.value)||JSON.stringify(prior.row)===JSON.stringify(row)))continue;
    next[row.batch_id]={row,value:reviewDraft(row)};
    changed=true;
   }
   return changed?next:old;
  });
 },[sourceRows,setDrafts]);

 const dirty=Object.values(drafts).filter(d=>sourceRows.some(row=>row.batch_id===d.row.batch_id&&row.can_edit&&row.record_state==='LIVE')&&receiptDraftDirty(d.row,d.value));
 const state=useRef({drafts,requests,props,composing,matching});
 useEffect(()=>{state.current={drafts,requests,props,composing,matching};});
 useEffect(()=>{onEditing('bulk-review',editing);return()=>onEditing('bulk-review',false);},[editing,onEditing]);
 useEffect(()=>{onEditing('bulk-pending',dirty.length>0);return()=>onEditing('bulk-pending',false);},[dirty.length,onEditing]);
 useEffect(()=>{
  if(!dirty.length)return;
  const warn=(e:BeforeUnloadEvent)=>e.preventDefault();
  window.addEventListener('beforeunload',warn);
  return()=>window.removeEventListener('beforeunload',warn);
 },[dirty.length]);

 function update(id:string,change:(v:ReviewDraft)=>ReviewDraft){
  setError('');
  setDrafts(old=>({
   ...old,
   [id]:{
    ...old[id],
    row:old[id]?.row||sourceRows.find(row=>row.batch_id===id)!,
    value:change(old[id]?.value||reviewDraft(sourceRows.find(row=>row.batch_id===id)!))
   }
  }));
 }

 const save=useCallback(async()=>{
  const {drafts,requests,props,composing,matching}=state.current;
  const dirty=Object.values(drafts).filter(d=>props.rows.some(row=>row.batch_id===d.row.batch_id&&row.can_edit&&row.record_state==='LIVE')&&receiptDraftDirty(d.row,d.value));
  if(!dirty.length)return true;
  if(lock.current||props.disabled||composing)return false;
  const issues:string[]=[];
  const jobs=dirty.flatMap(d=>{
   if(d.conflicts?.length){issues.push(`${d.value.date}・${d.value.supplier}：請先選擇衝突資料`);return [];}
   try{
    const data={...reviewPayload(d.row,autoMatchReceiptDraft(d.value,matching),false),checked:false,reviewed:false};
    const signature=JSON.stringify(data),old=requests[d.row.batch_id];
    return [{...d,data,signature,id:old?.signature===signature?old.id:crypto.randomUUID()}];
   }catch(e){
    issues.push(`${d.value.date||'日期未填'}・${d.value.supplier||'供應商未填'}：${e&&typeof e==='object'&&'message' in e?String(e.message):'請檢查輸入'}`);
    return [];
   }
  });
  if(!jobs.length){setError(issues.join('\n'));return false;}

  setRequests(old=>({...old,...Object.fromEntries(jobs.map(j=>[j.row.batch_id,{signature:j.signature,id:j.id}]))}));
  lock.current=true;setSaving(true);setError('');let done=0;const acknowledged=new Map<string,ReviewAccount>();
  try{
   for(const job of jobs){
    try{
    let saved:ReviewAccount;
    try{saved=await saveReceiptReview(props.storeId,job.row.batch_id,job.data,job.id);}
    catch(e){
     if(!/REVISION_CONFLICT|RECEIPT_LINES_CHANGED/.test(e&&typeof e==='object'&&'message' in e?String(e.message):''))throw e;
     const latest=(await readScopedReceiptAccounts(props.storeId,new AbortController().signal,'','','ALL',job.row.batch_id))[0];
     if(!latest||!latest.can_edit||latest.record_state!=='LIVE')throw Error('RECEIPT_ACCOUNT_NOT_LIVE');
     if(!alive.current)return false;
     const current=state.current.drafts[job.row.batch_id]?.value||job.value;
     const merged=rebaseReceiptDraft(job.row,current,latest);
     setDrafts(old=>({...old,[job.row.batch_id]:{row:merged.structural?job.row:latest,value:merged.value,conflicts:merged.conflicts,structural:merged.structural,latest}}));
     if(merged.conflicts.length){issues.push(`${current.date}・${current.supplier}：有欄位需要選擇，輸入已保留`);continue;}
     job.row=latest;job.value=merged.value;
     if(!receiptDraftDirty(latest,merged.value)){saved=latest;}
     else{
      job.data={...reviewPayload(latest,autoMatchReceiptDraft(merged.value,matching),false),checked:false,reviewed:false};
      job.id=crypto.randomUUID();job.signature=JSON.stringify(job.data);
      setRequests(old=>({...old,[job.row.batch_id]:{signature:job.signature,id:job.id}}));
      // Exactly one retry after a fresh read; a second conflict is shown, never looped.
      saved=await saveReceiptReview(props.storeId,job.row.batch_id,job.data,job.id);
     }
    }
    if(!alive.current)return false;
    done++;acknowledged.set(job.row.batch_id,saved);
    props.onSaved(saved);
    setDrafts(old=>({...old,[job.row.batch_id]:{row:saved,value:acceptReceiptSave(saved,job.value,old[job.row.batch_id]?.value||job.value)}}));
    setRequests(old=>{const next={...old};delete next[job.row.batch_id];return next;});
    }catch(e){issues.push(`${job.value.date||'日期未填'}・${job.value.supplier||'供應商未填'}・${job.value.number||job.row.batch_id.slice(0,8)}：${reviewError(e)}`);}

   }
   if(done)void refreshMatching(new AbortController().signal);
   const newer=Object.values(state.current.drafts).some(d=>{const job=jobs.find(j=>j.row.batch_id===d.row.batch_id);const accepted=acknowledged.get(d.row.batch_id);return accepted&&d.row.revision===accepted.revision?receiptDraftDirty(d.row,d.value):job?JSON.stringify(d.value)!==JSON.stringify(job.value):receiptDraftDirty(d.row,d.value);});
   if(issues.length)setError(`${issues.length} 張未儲存：${issues.join('；')}`);
   return !issues.length&&!newer;
  }catch(e){
   if(alive.current)setError(`已儲存 ${done} 張，其餘修改保留。 ${reviewError(e)}${issues.length?'\n'+issues.join('\n'):''}`);
   return false;
  }finally{
   lock.current=false;
   if(alive.current)setSaving(false);
  }
 },[setDrafts,setRequests,refreshMatching]);

 const leave=useCallback(async()=>{
  const {drafts,requests,props}=state.current;
  if(!Object.values(drafts).some(d=>receiptDraftDirty(d.row,d.value)))return true;
  // Loading/unavailable data cannot veto all navigation. Preserve recovery drafts explicitly.
  {
   try{
    const storage=workspaceStorage(props.userId),prefix=`app-draft:${props.userId}:${props.storeId}:`;
    storage.setItem(prefix+'receipt-bulk-review-v1',JSON.stringify(drafts));
    storage.setItem(prefix+'receipt-bulk-review-requests',JSON.stringify(requests));
    // Navigation persists drafts without starting another failed request.
    return true;
   }catch{setError('草稿暫存失敗，請保留此頁並重試。');return false;}
  }
 },[]);
 useEffect(()=>{registerLeave?.(leave);return()=>registerLeave?.(null);},[registerLeave,leave]);
 function toggleEditing(){if(editing){void save();setEditing(false);}else setEditing(true);}
 const editButton=<><button type="button" className="shell-secondary" disabled={props.disabled||composing} onClick={()=>void toggleEditing()}>{editing?'完成編輯':'編輯明細'}</button><button type="button" className="shell-primary" disabled={props.disabled||saving||composing||!dirty.length} onClick={()=>void save()}>{saving?'儲存中…':'儲存'}</button></>;

 const eligible=rows.filter(row=>row.can_edit&&['LIVE','REMOVED'].includes(row.record_state));
 const removedView=eligible.length>0&&eligible.every(row=>row.record_state==='REMOVED');
 const chosen=eligible.filter(row=>selected.includes(row.batch_id));
 function cancelDesktop(){
  if(dirty.length&&!window.confirm('取消本次尚未儲存的修改？'))return;
  setDrafts(old=>{const next={...old};for(const row of sourceRows)next[row.batch_id]={row,value:reviewDraft(row)};return next;});
  setEditing(false);setError('');
 }
 async function removeSelected(){
  if(!props.onFlag||lock.current||!chosen.length)return;
  if(!window.confirm(removedView?`還原選取的 ${chosen.length} 張貨單？`:`將選取的 ${chosen.length} 張貨單移至「已移除」？同張貨單的全部明細會一起移除，歷史資料會保留。`))return;
  lock.current=true;setSaving(true);
  try{for(const row of chosen){const ok=await props.onFlag(row.batch_id,removedView?'LIVE':'REMOVED');if(ok===false)break;setSelected(old=>old.filter(id=>id!==row.batch_id));}}
  catch(e){setError(`操作未完成；已成功處理的貨單保留，其餘可重試。${reviewError(e)}`);}
  finally{lock.current=false;setSaving(false);}
 }
 async function submitFinance(){
  if(lock.current||dirty.length||!chosen.length)return;
  lock.current=true;setSaving(true);setError('');
  try{
   for(const row of chosen){
    const saved=await saveReceiptReview(props.storeId,row.batch_id,{...reviewPayload(row,reviewDraft(row),false),checked:row.status==='CHECKED',reviewed:true},crypto.randomUUID());
    props.onSaved(saved);setDrafts(old=>({...old,[row.batch_id]:{row:saved,value:reviewDraft(saved)}}));setSelected(old=>old.filter(id=>id!==row.batch_id));
   }
   props.onFinance?.();
  }catch(e){setError(`加入對帳單未完成；已加入的貨單保留，其餘可重試。${reviewError(e)}`);}
  finally{lock.current=false;setSaving(false);}
 }
 const desktopButtons=editing?<><button data-receipt-action="edit" className="shell-secondary" disabled={saving||composing} onClick={cancelDesktop}>取消編輯</button><button className="shell-primary" disabled={props.disabled||saving||composing} onClick={async()=>{if(await save())setEditing(false);}}>{saving?'儲存中…':'儲存變更'}</button></>:<><button className="shell-secondary" disabled={props.disabled||saving} data-receipt-action="edit" onClick={()=>setEditing(true)} hidden={removedView}>編輯全部</button><button className="shell-secondary" disabled={props.disabled||saving||!chosen.length||dirty.length>0} data-receipt-action="delete" onClick={()=>void removeSelected()}>{removedView?'還原':'刪除'}（{chosen.length}張）</button><button className="shell-primary" disabled={props.disabled||saving||!chosen.length||dirty.length>0} hidden={removedView} data-receipt-action="finance" onClick={()=>void submitFinance()}>加入對帳單（{chosen.length}張）</button></>;

 const supplierOptions=[...new Set(rows.map(r=>r.supplier_name).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'zh-Hant'));
 const unitOptions=[...new Set(rows.flatMap(r=>r.lines.map(l=>l.unit)).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'zh-Hant'));
 const categories=[...new Set(['食材','耗材','調料','酒水','運費','其他','待分類',...rows.flatMap(r=>r.lines.map(l=>l.category)).filter(Boolean)])];

 return <section className="receipt-sheet receipt-bulk-review receipt-detail-source" onCompositionStart={()=>setComposing(true)} onCompositionEnd={()=>setComposing(false)}>
  {props.toolsTarget?createPortal(props.desktopMode?desktopButtons:editButton,props.toolsTarget):props.desktopMode?desktopButtons:editButton}
  <datalist id={supplierListId}>{supplierOptions.map(v=><option key={v} value={v}/>)}</datalist>
  <datalist id={unitListId}>{unitOptions.map(v=><option key={v} value={v}/>)}</datalist>

  <div className="receipt-flat-wrap">
   <table className="receipt-flat-table receipt-source-table">
    <colgroup>
     {props.desktopMode&&<col style={{width:44}}/>}
     <col style={{width:116}}/><col style={{width:170}}/><col style={{width:240}}/><col style={{width:100}}/>
     <col style={{width:82}}/><col style={{width:82}}/><col style={{width:108}}/><col style={{width:108}}/>
     <col style={{width:130}}/><col style={{width:180}}/><col style={{width:90}}/>
    </colgroup>
    <thead><tr>{props.desktopMode&&<th><input type="checkbox" aria-label="選取全部可編輯貨單" disabled={saving||editing||props.disabled} checked={!!eligible.length&&eligible.every(r=>selected.includes(r.batch_id))} onChange={e=>setSelected(e.target.checked?eligible.map(r=>r.batch_id):[])}/></th>}{['日期','供應商','品名','類別','數量','單位','未稅單價','未稅金額','原貨單','備註','操作'].map(s=><th key={s}>{s}</th>)}</tr></thead>
    <tbody>
     {rows.map(row=>{
      const id=row.batch_id,d=drafts[id],value=d?.value||reviewDraft(row),canEdit=editing&&!!d&&row.can_edit&&row.record_state==='LIVE'&&!props.disabled;
      return <Fragment key={id}>{value.lines.map((line,index)=><tr key={`${id}:${line.row_key}`}>
       {props.desktopMode&&<td><input type="checkbox" aria-label={`選取整張貨單 ${value.supplier} ${value.date} ${id}`} checked={selected.includes(id)} disabled={saving||editing||props.disabled||!row.can_edit||!['LIVE','REMOVED'].includes(row.record_state)} onChange={e=>setSelected(old=>e.target.checked?[...new Set([...old,id])]:old.filter(key=>key!==id))}/></td>}
       <td>{canEdit?<input type="date" aria-label={`第 ${index+1} 筆 日期`} value={value.date} disabled={value.lines.some(l=>l.custody_posted)} onChange={e=>update(id,v=>({...v,date:e.target.value}))}/>:<span>{value.date||'待確認'}</span>}</td>
       <td>{canEdit?<input type="text" list={supplierListId} aria-label={`第 ${index+1} 筆 供應商`} value={value.supplier} onChange={e=>update(id,v=>({...v,supplier:e.target.value,lines:v.lines.map(clearReceiptIngredient)}))}/>:<span>{value.supplier||'待確認'}</span>}</td>
       <td><ReceiptIngredientCell line={line} supplier={value.supplier} catalog={matching} editable={canEdit} disabled={saving||props.disabled} onChange={next=>update(id,v=>({...v,lines:v.lines.map((l,i)=>i===index?next:l)}))}/></td>
       <td>{canEdit?<select aria-label={`${line.product_name} 類別`} value={line.category} onChange={e=>update(id,v=>changeReviewLine(v,index,'category',e.target.value))}>{categories.map(c=><option key={c}>{c}</option>)}</select>:<span>{line.category||'待分類'}</span>}</td>
       <td className="numeric">{canEdit?<input aria-label={`${line.product_name} 數量`} inputMode="decimal" value={line.quantity} disabled={!!line.custody_posted} onChange={e=>update(id,v=>changeReviewLine(v,index,'quantity',e.target.value))}/>:<span>{line.quantity||''}</span>}</td>
       <td>{canEdit?<input type="text" list={unitListId} aria-label={`${line.product_name} 單位`} value={line.unit} disabled={!!line.custody_posted} onChange={e=>update(id,v=>changeReviewLine(v,index,'unit',e.target.value))}/>:<span>{line.unit||''}</span>}</td>
       <td className="numeric">{receiptHandling(line)==='CUSTODY_RELEASE'?<span/>:canEdit?<input placeholder="待補" aria-label={`${line.product_name} 未稅單價`} inputMode="decimal" value={line.unit_price} onChange={e=>update(id,v=>changeReviewLine(v,index,'unit_price',e.target.value))}/>:<span>{line.unit_price||''}</span>}</td>
       <td className="numeric">{receiptHandling(line)==='CUSTODY_RELEASE'?<span/>:canEdit?<input aria-label={`${line.product_name} 未稅金額`} inputMode="decimal" value={line.subtotal} onChange={e=>update(id,v=>changeReviewLine(v,index,'subtotal',e.target.value))}/>:<span>{line.subtotal||''}</span>}</td>
       <td><button type="button" className="text-button" onClick={()=>props.onSource(id)}>查看原貨單</button></td>
       <td>{canEdit?<input aria-label={`${line.product_name} 備註`} value={line.note} onChange={e=>update(id,v=>changeReviewLine(v,index,'note',e.target.value))}/>:<span title={line.note}>{line.note||''}</span>}</td>
      <td><ReceiptIngredientCell details line={line} supplier={value.supplier} catalog={matching} editable={canEdit} disabled={saving||props.disabled} onChange={next=>update(id,v=>({...v,lines:v.lines.map((l,i)=>i===index?next:l)}))}/></td>
      </tr>)}</Fragment>;
     })}
    </tbody>
   </table>
  </div>

  {matchError&&<p className="shell-note">{matchError}<button type="button" onClick={()=>void refreshMatching(new AbortController().signal)}>重試對應</button></p>}
  {!rows.length&&<p className="shell-note">目前沒有符合條件的進貨明細。</p>}
  {Object.entries(drafts).filter(([id,d])=>sourceRows.some(r=>r.batch_id===id)&&d.conflicts?.length).map(([id,d])=><div key={id} role="alert" className="sheet-error">
   <strong>{d.value.date}・{d.value.supplier}・{d.value.number||id.slice(0,8)}</strong>
   {d.conflicts!.map((message,i)=><p key={i}>{message}</p>)}
   {!d.structural&&<button type="button" className="text-button" disabled={saving} onClick={()=>{const next={...state.current.drafts,[id]:{...state.current.drafts[id],conflicts:undefined}};state.current={...state.current,drafts:next};setDrafts(next);setError('');void save();}}>保留我的修改並儲存</button>}
   <button type="button" className="text-button" disabled={saving} onClick={()=>{const latest=d.latest!;setDrafts(old=>({...old,[id]:{row:latest,value:reviewDraft(latest)}}));setError('');props.onSaved(latest);}}>改用這張貨單的已存資料</button>
  </div>)}
  {error&&<details className="shell-note"><summary role="alert">部分修改未儲存，點此查看貨單</summary><p>{error}</p></details>}

  <div className="receipt-source-footer">
   <span>{rows.reduce((n,row)=>n+row.lines.length,0)} 筆明細・{rows.length} 張貨單</span>
   <span role="status" aria-live="polite">{saving?'儲存中…':error?'儲存失敗，輸入已保留':dirty.length?'有修改尚未儲存':'已儲存'}</span>
   {error&&<button type="button" className="text-button" disabled={saving||props.disabled} onClick={()=>void save()}>重試</button>}
  </div>
 </section>;
}
