'use client';
import {useState} from 'react';
import type {AppRole,AppStore} from '@/lib/app-workspace';
import {useWorkspace} from './operation-hooks';
import TransfersWorkspace from './transfers-workspace';
import {displayTime} from './inventory-catalog';
type Line={name:string;quantity:number|null;unit:string;zone?:string};
type Archive={role:AppRole;store:{id:string;name:string;store_code:string};can_settle:boolean;counts:{id:string;status:string;started_at:string;completed_at:string|null;lines:Line[]}[];receipts:{id:string;name:string;status:string;created_at:string;lines:Line[];fields:{row_key:string;field_name:string;value:unknown}[]}[];expiry:{id:string;name:string;expires_on:string;zone:string;resolved:boolean}[];waste:(Line&{id:string;reason:string;created_at:string;actor_name:string})[]};
const fields:Record<string,string>={product:'品名',raw_product_name:'品名',supplier_name:'供應商',receipt_date:'日期',document_number:'單號',quantity:'數量',unit:'單位',specification:'規格'};
const status:Record<string,string>={DRAFT:'草稿',IN_PROGRESS:'盤點中',CLOSED:'已完成',REVIEWING:'待主管查看',READY_FOR_REVIEW:'待核對',OCR_DONE:'已辨識',COMPLETED:'已完成',UPLOADED:'已上傳',FAILED:'辨識失敗'};
export default function StoreArchive({storeId,baseStore,userId,onBack}:{storeId:string;baseStore:AppStore;userId:string;onBack:()=>void}){
 const workspace=useWorkspace<Archive>(storeId,'store-archive');const[loans,setLoans]=useState(false);const data=workspace.data;
 if(loans&&data)return <TransfersWorkspace archive store={{...baseStore,...data.store,role:data.role}} userId={userId} onBack={()=>setLoans(false)} returnLabel="返回停用門市紀錄"/>;
 const lines=(rows:Line[])=><div className="shell-list">{rows.map((l,i)=><p key={i}><strong>{l.name}</strong>　{l.quantity??'未提供'} {l.unit}{l.zone?`・${l.zone}`:''}</p>)}</div>;
 return <><button className="shell-back" onClick={onBack}>‹ 返回</button><h1>停用門市紀錄</h1>{workspace.error&&<p role="alert">{workspace.error}</p>}{!data?<p role="status">正在讀取紀錄…</p>:<><h2>{data.store.name}（{data.store.store_code}）</h2><p className="shell-note">此頁僅查閱這家門市的歷史資料；未結借貸仍可依原權限處理。</p><button className="shell-secondary full" onClick={()=>setLoans(true)}>查看借貸與未結紀錄</button>
 <h2>進貨（{data.receipts.length}）</h2>{data.receipts.map(r=><details className="shell-card store-archive-record" key={r.id}><summary>{r.name}・{status[r.status]||'處理中'}<small>{displayTime(r.created_at)}</small></summary>{lines(r.lines)}{!r.lines.length&&r.fields.filter(f=>fields[f.field_name]).map((f,i)=><p key={i}>{f.row_key==='document'?'貨單':f.row_key}・{fields[f.field_name]}：{typeof f.value==='string'||typeof f.value==='number'?String(f.value):'未提供'}</p>)}</details>)}
 <h2>盤點（{data.counts.length}）</h2>{data.counts.map(c=><details className="shell-card store-archive-record" key={c.id}><summary>{displayTime(c.completed_at||c.started_at)}・{status[c.status]||'處理中'}</summary>{lines(c.lines)}{!c.lines.length&&<p>尚無已送出的盤點明細。</p>}</details>)}
 <h2>效期（{data.expiry.length}）</h2>{data.expiry.map(e=><article className="shell-card store-archive-record" key={e.id}><strong>{e.name}</strong><p>{e.expires_on}・{e.zone}・{e.resolved?'已處理':'尚未處理'}</p></article>)}
 <h2>廢棄（{data.waste.length}）</h2>{data.waste.map(w=><article className="shell-card store-archive-record" key={w.id}>{lines([w])}<p>{w.reason}・{w.actor_name}・{displayTime(w.created_at)}</p></article>)}</>}</>;
}
export function ArchivedStoreLinks({store,onOpen}:{store:AppStore;onOpen:(id:string)=>void}){
 const workspace=useWorkspace<{stores:{id:string;name:string;store_code:string}[]}>(store.id,'archived-stores');
 return workspace.data?.stores.length?<details className="setup-panel"><summary>停用門市紀錄</summary>{workspace.data.stores.map(s=><button key={s.id} className="shell-list-row" onClick={()=>onOpen(s.id)}>{s.name}（{s.store_code}）›</button>)}</details>:null;
}
