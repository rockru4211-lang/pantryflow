'use client';
import {useEffect,useRef,useState} from 'react';
import {emptyDelivery,type ReceiptDelivery,type DeliveryIssue} from '@/lib/receipt-delivery';
import {useOperation} from './operation-hooks';

export default function ReceiptDeliveryEditor({storeId,userId,batchId,delivery,names,onClose}:{storeId:string;userId:string;batchId:string;delivery?:ReceiptDelivery;names:string[];onClose:(saved:boolean)=>void}) {
  const dialog=useRef<HTMLDialogElement>(null);
  const [draft,setDraft]=useState(()=>structuredClone(delivery||emptyDelivery()));
  const operation=useOperation(storeId,userId);
  useEffect(()=>{const el=dialog.current!;el.showModal();return()=>el.close();},[]);
  const change=(id:string,patch:Partial<DeliveryIssue>)=>setDraft(d=>({...d,issues:d.issues.map(i=>i.id===id?{...i,...patch}:i)}));
  async function save(){const result=await operation.run('receipt.delivery',{batch_id:batchId,...draft});if(result)onClose(true);}
  return <dialog ref={dialog} className="context-expiry-dialog delivery-dialog" aria-label="到貨與異常" onCancel={e=>{e.preventDefault();if(!operation.busy)onClose(false);}}>
    <h2>到貨與異常</h2>
    <form onSubmit={e=>{e.preventDefault();void save();}}>
      <fieldset disabled={operation.busy}>
        <label className="field">到貨日期<input type="date" value={draft.arrived_on||''} onChange={e=>setDraft({...draft,arrived_on:e.target.value||null,arrived_time:e.target.value?draft.arrived_time:null})}/></label>
        <details><summary>到貨時間（選填）</summary><label className="field">時間<input type="time" disabled={!draft.arrived_on} value={draft.arrived_time?.slice(0,5)||''} onChange={e=>setDraft({...draft,arrived_time:e.target.value||null})}/></label></details>
        {draft.issues.map((issue,index)=><details className="delivery-issue" key={issue.id} open={!delivery?.issues.some(saved=>saved.id===issue.id)}>
          <summary>{issue.name||`異常 ${index+1}`}・{issue.reason}・{issue.status==='COMPLETE'?'已處理':'待處理'}</summary>
          <label className="field">品項<input required list="delivery-item-names" maxLength={160} value={issue.name} onChange={e=>change(issue.id,{name:e.target.value})}/></label>
          <label className="field">狀況<select value={issue.reason} onChange={e=>change(issue.id,{reason:e.target.value as DeliveryIssue['reason']})}>{['未收到','少收貨','多收貨','效期太短','其他'].map(reason=><option key={reason}>{reason}</option>)}</select></label>
          <div className="delivery-quantity"><label className="field">實收數量（選填）<input type="number" min="0" max="999999999" step="any" value={issue.quantity??''} onChange={e=>change(issue.id,{quantity:e.target.value===''?null:Number(e.target.value)})}/></label><label className="field">單位<input maxLength={30} required={issue.quantity!==null} value={issue.unit} onChange={e=>change(issue.id,{unit:e.target.value})}/></label></div>
          <label className="field">處理說明<textarea maxLength={1000} required={issue.status==='COMPLETE'||issue.reason==='其他'} placeholder="例如：已聯絡供應商補貨" value={issue.note} onChange={e=>change(issue.id,{note:e.target.value})}/></label>
          {!delivery?.issues.some(saved=>saved.id===issue.id)&&<button type="button" className="text-button" onClick={()=>setDraft({...draft,issues:draft.issues.filter(i=>i.id!==issue.id)})}>取消這筆異常</button>}
          <label className="delivery-check"><input type="checkbox" checked={issue.status==='COMPLETE'} onChange={e=>change(issue.id,{status:e.target.checked?'COMPLETE':'OPEN'})}/>已處理</label>
        </details>)}
        <datalist id="delivery-item-names">{names.map(name=><option key={name} value={name}/>)}</datalist>
        <button type="button" className="text-button" onClick={()=>setDraft({...draft,issues:[...draft.issues,{id:crypto.randomUUID(),name:'',reason:'未收到',quantity:null,unit:'',note:'',status:'OPEN'}]})}>＋ 登記異常</button>
        {!!draft.issues.length&&<p className="shell-note">此處記錄異常，不變更已確認的收貨數量。</p>}
      </fieldset>
      {operation.error&&<p role="alert">{operation.error}</p>}
      <div className="context-expiry-actions"><button type="button" className="shell-secondary" disabled={operation.busy} onClick={()=>onClose(false)}>取消</button><button className="shell-primary" disabled={operation.busy}>{operation.busy?'儲存中…':'儲存'}</button></div>
    </form>
  </dialog>;
}
