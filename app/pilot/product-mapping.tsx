'use client';
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import type {AppStore} from '@/lib/app-workspace';
import {useOperation,useOperationDraft,useWorkspace} from './operation-hooks';
type Line={id:string;batch_id:string;name:string;supplier_name:string|null;quantity:number|null;unit:string|null;product_id:string|null;inventory_status:string;modified_at:string;date:string|null};
type Data={editable:boolean;lines:Line[];products:{id:string;name:string;unit:string}[];rules:{id:string;product_name:string;supplier_name:string|null;source_unit:string;base_unit:string;factor:number}[]};
const states:Record<string,string>={MAPPING_PENDING:'商品待對應',UNIT_PENDING:'單位待確認',QUANTITY_PENDING:'數量待確認',REVIEW_PENDING:'辨識資料未確認',POSTED:'已計入庫存'};
export default function ProductMapping({store,userId,onReceipt}:{store:AppStore;userId:string;onReceipt:(id:string)=>void}){
 const workspace=useWorkspace<Data>(store.id,'mappings');const operation=useOperation(store.id,userId);const[selected,setSelected]=useState<Line>();const[notice,setNotice]=useState('');
 const[draft,setDraft,clearDraft]=useOperationDraft(userId,store.id,`mapping:${selected?.id||'none'}`,{product_id:'',factor:''});
 const[reloading,setReloading]=useState(false);const recoverySequence=useRef(0);const recoveryIdentity=useRef('');
 const editIdentity=`${store.id}:${selected?.id||''}`;
 useLayoutEffect(()=>{recoveryIdentity.current=editIdentity;},[editIdentity]);
 useEffect(()=>()=>{recoverySequence.current++;},[]);
 const product=workspace.data?.products.find(p=>p.id===draft.product_id);const needsFactor=!!selected?.unit&&!!product&&selected.unit!==product.unit;
 const reloadSelected=async()=>{
  if(!selected)return;
  const request=++recoverySequence.current;const identity=recoveryIdentity.current;const id=selected.id;
  setReloading(true);
  try{
   const latest=await workspace.refresh();
   if(request!==recoverySequence.current||identity!==recoveryIdentity.current||!latest)return;
   const line=latest.lines.find(item=>item.id===id);operation.setError('');clearDraft();
   if(!line){setSelected(undefined);setNotice('此品項已完成對應或不在目前清單，已返回待對應清單。');return;}
   setSelected(line);setDraft({product_id:line.product_id||'',factor:''});
   setNotice('已重新載入最新品項，未儲存的對應選擇已捨棄。');
  }finally{if(request===recoverySequence.current)setReloading(false);}
 };
 const save=async()=>{if(!selected)return;const result=await operation.run<{value:Line}>('mapping.resolve',{id:selected.id,modified_at:selected.modified_at,product_id:draft.product_id,factor:needsFactor?Number(draft.factor):null});if(result){clearDraft();setSelected(undefined);setNotice(result.value.inventory_status==='POSTED'?'商品與單位對應已保存。':'商品對應已保存；尚未確認的資料保持原狀，不計入庫存。');await workspace.refresh();}};
 return <>{notice&&<p role="status">{notice}</p>}{(workspace.error||operation.error)&&<p className="pilot-message" role="alert">{workspace.error||operation.error}<button type="button" disabled={reloading||operation.busy} onClick={()=>void (selected?reloadSelected():workspace.refresh())}>{reloading?'正在重新載入…':selected?'重新載入此筆（捨棄未存變更）':'重新讀取'}</button></p>}{workspace.loading&&!workspace.data?<p>正在讀取品項對應…</p>:selected?<><button className="text-button" disabled={reloading} onClick={()=>setSelected(undefined)}>‹ 返回品項對應</button><form onSubmit={e=>{e.preventDefault();void save();}}><section className="shell-card transfer-form"><h2>{selected.name}</h2><p>{selected.quantity??'未提供'} {selected.unit||'未提供單位'}・{states[selected.inventory_status]}</p><label>正式商品<select value={draft.product_id} disabled={!workspace.data?.editable||reloading} onChange={e=>setDraft({...draft,product_id:e.target.value,factor:''})} required><option value="">選擇商品</option>{workspace.data?.products.map(p=><option value={p.id} key={p.id}>{p.name}（{p.unit}）</option>)}</select></label>{needsFactor&&<label>1 {selected.unit} 等於多少 {product.unit}<input type="number" min="0.000001" max="999999999" step="any" value={draft.factor} onChange={e=>setDraft({...draft,factor:e.target.value})} disabled={!workspace.data?.editable||reloading} required/></label>}<button type="button" className="text-button" onClick={()=>onReceipt(selected.batch_id)}>查看原貨單與核對紀錄 ›</button></section>{workspace.data?.editable&&<button className="shell-primary full" disabled={operation.busy||reloading}>{operation.busy?'儲存中…':'儲存對應'}</button>}</form></>:<><section className="shell-section"><h2>待對應品項</h2><div className="shell-card shell-list">{workspace.data?.lines.map(l=><button className="shell-list-row" key={l.id} onClick={()=>{setSelected(l);setNotice('');}}><span><strong>{l.name}</strong><small>{l.supplier_name||'未提供供應商'}・{l.quantity??'未提供'} {l.unit||'未提供單位'}</small><small>{states[l.inventory_status]}</small></span><b>›</b></button>)}</div>{!workspace.data?.lines.length&&<p>目前沒有待對應品項。</p>}</section><section className="shell-section"><h2>單位換算紀錄</h2><div className="shell-card shell-list">{workspace.data?.rules.map(r=><div className="shell-list-row" key={r.id}><span><strong>{r.product_name}</strong><small>{r.supplier_name||'未提供供應商'}・1 {r.source_unit} ＝ {r.factor} {r.base_unit}</small></span></div>)}</div>{!workspace.data?.rules.length&&<p>目前沒有已確認換算。</p>}</section></>}{workspace.data&&!workspace.data.editable&&<p className="shell-note">依商家授權查看；商品維護由指定的資料維護人員處理。</p>}</>;
}
