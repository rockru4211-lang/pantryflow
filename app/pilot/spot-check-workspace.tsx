'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {Download,RefreshCw,ClipboardCheck} from 'lucide-react';
import {supabase} from '@/lib/supabase-browser';
import {localMonth,type AppStore} from '@/lib/app-workspace';
import type {Json} from '@/lib/database.types';
import {downloadSpotWorkbook,spotActionLabel,spotDifference,spotError,spotItemStatus,spotReasons,spotStatus,validSpotQuantity,type SpotCatalog,type SpotCheck,type SpotItem,type SpotList} from '@/lib/spot-checks';
import {displayTime} from './inventory-catalog';
import './spot-check.css';

type Props={store:AppStore;userId:string;initialId?:string;registerLeave?:(guard:(()=>Promise<boolean>)|null)=>void;onBack?:()=>void};
type Review={entryId:string;quantity:string;reason:string;note:string};
type Pending={action:string;data:Record<string,Json|undefined>};
const number=(value:number|null|undefined)=>value==null?'—':Number(value).toLocaleString('zh-TW',{maximumFractionDigits:3});

export default function SpotCheckWorkspace({store,userId,initialId,registerLeave,onBack}:Props){
 const [month,setMonth]=useState(localMonth),[tab,setTab]=useState<'new'|'pending'|'history'>('pending');
 const [list,setList]=useState<SpotList|null>(null),[catalog,setCatalog]=useState<SpotCatalog|null>(null),[detail,setDetail]=useState<SpotCheck|null>(null);
 const [sourceId,setSourceId]=useState(''),[assignee,setAssignee]=useState(''),[selected,setSelected]=useState<string[]>([]),[draftId,setDraftId]=useState('');
 const [search,setSearch]=useState(''),[zone,setZone]=useState(''),[values,setValues]=useState<Record<string,string>>({});
 const [review,setReview]=useState<Review|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[uncertain,setUncertain]=useState(false);
 const [dirty,setDirty]=useState(false);
 const alive=useRef(true),working=useRef(false),pending=useRef<Pending|null>(null),detailRef=useRef(detail),valuesRef=useRef(values),dirtyRef=useRef(false),planDirty=useRef(false),reviewRef=useRef(review),sequence=useRef(0),detailSequence=useRef(0),opening=useRef(false);
 const registerRef=useRef(registerLeave);useEffect(()=>{registerRef.current=registerLeave;reviewRef.current=review;},[registerLeave,review]);
 const caps=list?.caps||catalog?.caps;
 const rpc=useCallback(async<T,>(action:string,data:Record<string,Json|undefined>={})=>{
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
  try{const result=await supabase.rpc('baihuayuan_spot_check',{p_store_id:store.id,p_action:action,p_data:data}).abortSignal(controller.signal);if(result.error)throw result.error;if(result.data==null)throw Error('EMPTY_SPOT_RESPONSE');return result.data as unknown as T;}
  finally{clearTimeout(timer);}
 },[store.id]);
 const accept=useCallback((next:SpotCheck)=>{
  if(next.store_id!==store.id||!Array.isArray(next.items))throw Error('INVALID_SPOT_RESPONSE');
  detailRef.current=next;setDetail(next);const quantities=Object.fromEntries(next.items.map(i=>[i.entry_id,i.quantity==null?'':String(i.quantity)]));
  valuesRef.current=quantities;setValues(quantities);dirtyRef.current=false;setDirty(false);
 },[store.id]);
 const read=useCallback(async(quiet=false)=>{
  if(working.current||pending.current||opening.current||quiet&&(dirtyRef.current||planDirty.current||reviewRef.current||document.visibilityState!=='visible'))return;
  const request=++sequence.current;
  try{const [nextList,nextCatalog]=await Promise.all([rpc<SpotList>('list',{month,pending:true}),rpc<SpotCatalog>('catalog',{month,...(sourceId?{source_id:sourceId}:{})})]);
   if(!alive.current||request!==sequence.current)return;setList(nextList);setCatalog(nextCatalog);setError('');
   if(quiet&&detailRef.current&&!dirtyRef.current&&!reviewRef.current){const detailRequest=detailSequence.current,id=detailRef.current.id;const next=await rpc<SpotCheck>('detail',{id});if(alive.current&&request===sequence.current&&detailRequest===detailSequence.current&&detailRef.current?.id===id&&!dirtyRef.current&&!reviewRef.current)accept(next);}
  }catch(e){if(alive.current&&request===sequence.current)setError(spotError(e));}finally{if(alive.current&&request===sequence.current)setLoading(false);}
 },[rpc,month,sourceId,accept]);
 useEffect(()=>{const requests=sequence;alive.current=true;const timer=setTimeout(()=>void read(),0),poll=setInterval(()=>void read(true),5000);const focus=()=>void read(true);window.addEventListener('focus',focus);return()=>{alive.current=false;requests.current++;clearTimeout(timer);clearInterval(poll);window.removeEventListener('focus',focus);};},[read]);
 useEffect(()=>{if(!initialId)return;let live=true;const request=++detailSequence.current;void rpc<SpotCheck>('detail',{id:initialId}).then(next=>{if(live&&request===detailSequence.current)accept(next);}).catch(e=>{if(live&&request===detailSequence.current)setError(spotError(e));});return()=>{live=false;};},[initialId,rpc,accept]);
 async function mutate(action:string,data:Record<string,Json|undefined>,retry=false):Promise<SpotCheck|null>{
  if(working.current||pending.current&&!retry)return null;
  const operation=retry?pending.current!:{action,data:{...data,request_id:crypto.randomUUID()}};
  working.current=true;sequence.current++;setBusy(true);setError('');pending.current=operation;
  try{const next=await rpc<SpotCheck>(operation.action,operation.data);
   if(!alive.current)return null;if(next.id!==operation.data.id)throw Error('INVALID_SPOT_RESPONSE');accept(next);
   pending.current=null;setUncertain(false);setReview(null);reviewRef.current=null;planDirty.current=false;
   if(operation.action==='create'||operation.action==='plan'){setTab('pending');setDraftId('');setSourceId('');setSelected([]);setAssignee('');}
   setNotice(operation.action==='save_entries'?'數量已暫存':operation.action==='submit'?'抽查已送出，差異已列入主管與行政待辦。':operation.action==='close'?'已確認結案，原盤點紀錄保留。':'已儲存。');return next;
  }catch(e){if(!alive.current)return null;
   const code=e&&typeof e==='object'&&'code' in e?String(e.code):'';
   if(/^(22|23|40|42|P0)/.test(code)){pending.current=null;setUncertain(false);}else setUncertain(true);
   setError(spotError(e));return null;
  }finally{working.current=false;if(alive.current)setBusy(false);}
 }
 async function saveQuantities(){
  const current=detailRef.current;if(!current||!dirtyRef.current)return true;
  if(Object.values(valuesRef.current).some(v=>v.trim()!==''&&!validSpotQuantity(v))){setError('數量最多三位小數；沒有庫存請填 0。');return false;}
  const next=await mutate('save_entries',{id:current.id,revision:current.revision,entries:current.items.map(i=>({entry_id:i.entry_id,quantity:valuesRef.current[i.entry_id]?.trim()?Number(valuesRef.current[i.entry_id]):null}))});return !!next;
 }
 const saveRef=useRef(saveQuantities);useEffect(()=>{saveRef.current=saveQuantities;});
 useEffect(()=>{if(!dirty||busy||uncertain||error)return;const timer=setTimeout(()=>void saveRef.current(),700);return()=>clearTimeout(timer);},[values,dirty,busy,uncertain,error]);
 const canLeave=useCallback(async()=>{
  if(working.current||pending.current)return false;
  if(dirtyRef.current&&!await saveRef.current())return false;
  if((planDirty.current||reviewRef.current)&&!window.confirm('清單或複核內容尚未儲存，確定離開？'))return false;
  planDirty.current=false;setReview(null);reviewRef.current=null;return true;
 },[]);
 useEffect(()=>{registerRef.current?.(canLeave);const unload=(event:BeforeUnloadEvent)=>{if(dirtyRef.current||planDirty.current||reviewRef.current||working.current||pending.current){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',unload);return()=>{registerRef.current?.(null);window.removeEventListener('beforeunload',unload);};},[canLeave]);
 async function open(id:string){if(!await canLeave())return;const request=++detailSequence.current;sequence.current++;opening.current=true;setLoading(true);setError('');try{const next=await rpc<SpotCheck>('detail',{id});if(alive.current&&request===detailSequence.current){if(next.id!==id)throw Error('INVALID_SPOT_RESPONSE');accept(next);setNotice('');}}catch(e){if(alive.current&&request===detailSequence.current)setError(spotError(e));}finally{if(alive.current&&request===detailSequence.current){opening.current=false;setLoading(false);}}}
 async function changeTab(next:typeof tab){if(!await canLeave())return;detailSequence.current++;opening.current=false;detailRef.current=null;setDetail(null);setTab(next);setError('');setNotice('');setDraftId('');setSourceId('');setSelected([]);setAssignee('');void read();}
 async function savePlan(publish:boolean){
  if(!sourceId||!selected.length||!assignee){setError('請選擇已完成盤點、抽查品項及抽查人員。');return;}
  const next=await mutate(draftId?'plan':'create',{id:draftId||crypto.randomUUID(),...(draftId?{revision:detailRef.current?.revision}:{}),source_id:sourceId,entries:selected,assignee_id:assignee,publish});
  if(next){setTab('pending');setDraftId('');setSourceId('');setSelected([]);setAssignee('');void read();}
 }
 async function editPlan(){if(!detail||!await canLeave())return;setDraftId(detail.id);setSourceId(detail.source_id);setMonth(detail.source_month.slice(0,7));setSelected(detail.items.map(i=>i.entry_id));setAssignee(detail.assignee_id);setTab('new');}
 async function submit(){if(!await saveQuantities())return;const current=detailRef.current;if(!current)return;await mutate('submit',{id:current.id,revision:current.revision});void read();}
 async function refreshDetail(){
  if(working.current||pending.current||opening.current)return;
  if(dirtyRef.current||reviewRef.current){if(!window.confirm('重新讀取會捨棄此畫面尚未儲存的輸入，確定重新讀取？'))return;}
  if(detailRef.current){const request=++detailSequence.current,id=detailRef.current.id;opening.current=true;setLoading(true);try{const next=await rpc<SpotCheck>('detail',{id});if(alive.current&&request===detailSequence.current){accept(next);setReview(null);reviewRef.current=null;setError('');}}catch(e){if(alive.current&&request===detailSequence.current)setError(spotError(e));}finally{if(alive.current&&request===detailSequence.current){opening.current=false;setLoading(false);}}}else void read();
 }
 async function exportExcel(){if(working.current||pending.current||!await canLeave())return;working.current=true;setBusy(true);setError('');try{const result=await rpc<{checks:SpotCheck[]}>('export',{month});if(!result.checks.length){setNotice('這個盤點月份尚無已送出的抽查紀錄。');return;}await downloadSpotWorkbook(result.checks,store.name,month);setNotice('Excel 已匯出，含抽盤明細與差異處理紀錄。');}catch(e){setError(spotError(e));}finally{working.current=false;setBusy(false);}}
 const showPlan=tab==='new'&&!!caps?.plan;
 const planItems=(catalog?.items||[]).filter(i=>(!zone||i.zone===zone)&&`${i.name} ${i.specification} ${i.zone}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
 const checks=(list?.checks||[]).filter(c=>tab==='history'?c.source_month.startsWith(month):c.status!=='CLOSED');
 const owns=detail?.assignee_id===userId&&detail.caps.operate;
 const blocked=busy||uncertain||loading;
 const updateQuantity=(id:string,value:string)=>{const next={...valuesRef.current,[id]:value};valuesRef.current=next;setValues(next);dirtyRef.current=true;setDirty(true);setError('');setNotice('尚未儲存');};
 const startReview=(item:SpotItem)=>setReview({entryId:item.entry_id,quantity:String(item.recheck_quantity??item.quantity??''),reason:item.reason||'UNKNOWN',note:item.note||''});
 async function sendReview(final:boolean){if(!review||!detail)return;if(review.quantity.trim()!==''&&!validSpotQuantity(review.quantity)){setError('請填寫有效複核數量。');return;}await mutate('review',{id:detail.id,revision:detail.revision,entry_id:review.entryId,quantity:review.quantity.trim()?Number(review.quantity):null,reason:review.reason,note:review.note,final});}
 async function returnItem(item:SpotItem){if(!detail)return;const note=window.prompt('請填寫退回補充的原因');if(!note?.trim())return;await mutate('return',{id:detail.id,revision:detail.revision,entry_id:item.entry_id,note:note.trim()});}
 return <section className="spot-workspace" aria-label="每月抽盤">
  {onBack&&<button className="shell-back" onClick={async()=>{if(await canLeave())onBack();}}>‹ 返回上一頁</button>}
  <header className="spot-heading"><div><h1><ClipboardCheck size={24}/>每月抽盤</h1><p>{store.name}・從已完成盤點挑選品項，到店複查</p></div><div className="spot-actions"><button className="shell-secondary" disabled={blocked} onClick={()=>void refreshDetail()}><RefreshCw size={16}/>重新讀取</button>{caps?.export&&<button className="shell-secondary" disabled={blocked} onClick={()=>void exportExcel()}><Download size={16}/>匯出 Excel</button>}</div></header>
  <div className="spot-toolbar"><label>盤點月份<input type="month" value={month} disabled={blocked} onChange={async e=>{const next=e.target.value;if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(next)||!await canLeave())return;detailSequence.current++;opening.current=false;detailRef.current=null;setDetail(null);setSourceId('');setSelected([]);setDraftId('');setMonth(next);setLoading(true);}}/></label><small>匯出依原盤點月份，包含已送出且尚待確認的紀錄。</small></div>
  <nav className="spot-tabs" aria-label="抽盤分頁">{caps?.plan&&<button disabled={blocked} aria-current={tab==='new'?'page':undefined} onClick={()=>void changeTab('new')}>建立抽查清單</button>}<button disabled={blocked} aria-current={tab==='pending'?'page':undefined} onClick={()=>void changeTab('pending')}>待抽查／待確認</button><button disabled={blocked} aria-current={tab==='history'?'page':undefined} onClick={()=>void changeTab('history')}>抽查紀錄</button></nav>
  {error&&<p role="alert" className="spot-alert">{error}</p>}{notice&&<p role="status" className="spot-notice">{notice}</p>}
  {uncertain&&<div className="spot-alert"><p>尚未確認是否儲存成功，請保持此頁。重試會核對同一次操作，不會重複建立紀錄。</p><button className="shell-primary" disabled={busy} onClick={()=>void mutate('',{},true)}>確認儲存結果／重試</button></div>}
  {loading&&!list&&<p role="status">正在讀取抽盤資料…</p>}
  {showPlan?<>
   <div className="spot-plan-fields"><label>盤點紀錄<select value={sourceId} disabled={blocked||!!draftId} onChange={e=>{setSourceId(e.target.value);setSelected([]);setSearch('');setZone('');planDirty.current=true;}}><option value="">請選擇已完成盤點</option>{catalog?.sources.map(s=><option key={s.id} value={s.id}>{displayTime(s.completed_at)}・已完成</option>)}</select></label><label>抽查人員<select value={assignee} disabled={blocked} onChange={e=>{setAssignee(e.target.value);planDirty.current=true;}}><option value="">請選擇人員</option>{catalog?.assignees.map(a=><option value={a.id} key={a.id}>{a.name}</option>)}</select></label></div>
   {!catalog?.sources.length&&<p>這個月份尚無已完成主管確認的盤點。請先完成原盤點確認。</p>}
   <div className="spot-plan-fields"><label>儲物區<select value={zone} onChange={e=>setZone(e.target.value)}><option value="">全部儲物區</option>{[...new Set(catalog?.items.map(i=>i.zone)||[])].map(z=><option key={z}>{z}</option>)}</select></label><label>搜尋品項<input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="品名、規格、儲物區"/></label></div>
   <div className="spot-selection"><div className="spot-select-head"><strong>品項</strong><span>儲物區／單位</span></div>{planItems.map(item=><label key={item.entry_id} className={selected.includes(item.entry_id)?'selected':''}><input type="checkbox" checked={selected.includes(item.entry_id)} disabled={blocked} onChange={e=>{setSelected(current=>e.target.checked?[...current,item.entry_id]:current.filter(id=>id!==item.entry_id));planDirty.current=true;}}/><span><strong>{item.name}</strong><small>{item.specification}</small>{item.baseline_note&&<small>{item.baseline_note}</small>}</span><span>{item.zone}<small>{item.unit}</small></span></label>)}</div>
   <footer className="spot-footer"><strong>已選 {selected.length} 項</strong><button className="shell-secondary" disabled={blocked||!selected.length} onClick={()=>void savePlan(false)}>儲存草稿</button><button className="shell-primary" disabled={blocked||!selected.length} onClick={()=>void savePlan(true)}>建立抽查清單</button></footer>
  </>:detail?<>
   <button className="shell-back" disabled={blocked} onClick={async()=>{if(await canLeave()){detailSequence.current++;opening.current=false;detailRef.current=null;setDetail(null);void read();}}}>‹ 返回抽查清單</button>
   <div className="spot-heading"><div><h2>{detail.source_month.slice(0,7)} 盤點複查</h2><p>原盤點：{displayTime(detail.source_completed_at)}<br/>抽查人員：{detail.assignee_name}</p></div><span className={`spot-badge ${detail.status==='CLOSED'?'done':''}`}>{spotStatus[detail.status]}</span></div>
   {detail.status==='DRAFT'&&detail.caps.plan&&<button className="shell-primary" disabled={blocked} onClick={()=>void editPlan()}>編輯及發布清單</button>}
   {detail.status==='OPEN'&&<p className="spot-notice">共 {detail.items.length} 項・已填 {detail.items.filter(i=>values[i.entry_id]?.trim()&&validSpotQuantity(values[i.entry_id])).length} 項。{owns?'依現場實際數量填寫；停止輸入後自動暫存。':'等待指定人員填寫及送出。'}</p>}
   {detail.submitted_at&&<p>抽查送出：{displayTime(detail.submitted_at)}・{detail.submitted_name}<br/><small>數量不同先確認期間使用、進貨或調撥；抽盤不直接調整庫存。</small></p>}
   <div className="spot-item-grid">{detail.items.map((item,index)=><article key={item.entry_id} className="spot-item">
    {(index===0||detail.items[index-1].zone!==item.zone)&&<h3 className="spot-zone">{item.zone}</h3>}
    <div className="spot-item-heading"><div><h3>{item.name}</h3><small>{item.zone}・{item.specification}・{item.unit}</small></div>{detail.submitted_at&&<span className={`spot-badge ${['SAME','CLOSED'].includes(item.review_status)?'done':''}`}>{spotItemStatus[item.review_status]}</span>}</div>
    {item.baseline_note&&<p className="spot-notice">{item.baseline_note}</p>}
    {detail.status==='OPEN'&&owns?<label className="spot-quantity">實際數量<input aria-label={`${item.zone} ${item.name} 實際數量`} type="text" inputMode="decimal" value={values[item.entry_id]??''} disabled={blocked} onChange={e=>updateQuantity(item.entry_id,e.target.value)} placeholder="請輸入"/><span>{item.unit}</span></label>:!detail.submitted_at?<p>{detail.status==='DRAFT'?'已列入抽查清單':'等待抽查送出'}</p>:<>
     <div className="spot-quantities"><div><small>原盤點</small><strong>{number(item.original_quantity)} {item.unit}</strong></div><div><small>抽查</small><strong>{number(item.quantity)} {item.unit}</strong></div><div><small>差異</small><strong>{number(spotDifference(item))} {item.unit}</strong></div></div>
     {item.reviewed_at&&<div className="spot-reply"><strong>主管回覆</strong><p>複核數量：{number(item.recheck_quantity)} {item.unit}・{spotReasons[item.reason||'']}</p><p>{item.note}</p><small>{item.reviewed_name}・{displayTime(item.reviewed_at)}</small></div>}
     {item.return_note&&<p className="spot-alert">退回原因：{item.return_note}</p>}
     {item.confirmed_at&&<p>最後確認：{number(item.final_quantity)} {item.unit}<br/><small>{item.confirmed_name}・{displayTime(item.confirmed_at)}</small></p>}
     {review?.entryId===item.entry_id?<div className="spot-review-form"><label>現場複核數量<input type="text" inputMode="decimal" value={review.quantity} disabled={blocked} onChange={e=>setReview({...review,quantity:e.target.value})}/></label><label>差異原因<select value={review.reason} disabled={blocked} onChange={e=>setReview({...review,reason:e.target.value})}>{Object.entries(spotReasons).map(([key,label])=><option value={key} key={key}>{label}</option>)}</select></label><label>補充說明<textarea value={review.note} maxLength={1000} disabled={blocked} onChange={e=>setReview({...review,note:e.target.value})}/></label><div className="spot-actions"><button className="shell-secondary" disabled={blocked} onClick={()=>void sendReview(false)}>暫存</button><button className="shell-primary" disabled={blocked||review.reason==='UNKNOWN'||!validSpotQuantity(review.quantity)} onClick={()=>void sendReview(true)}>送行政確認</button><button className="text-button" disabled={blocked} onClick={()=>setReview(null)}>取消</button></div></div>:item.review_status==='PENDING'&&detail.caps.review&&<button className="shell-primary" disabled={blocked||!!review} onClick={()=>startReview(item)}>填寫複核數量與原因</button>}
     {item.review_status==='REVIEWED'&&detail.caps.close&&<div className="spot-actions"><button className="shell-secondary" disabled={blocked||!!review} onClick={()=>void returnItem(item)}>退回補充</button><button className="shell-primary" disabled={blocked||!!review} onClick={()=>void mutate('close',{id:detail.id,revision:detail.revision,entry_id:item.entry_id})}>確認結案</button></div>}
    </>}
   </article>)}</div>
   {detail.status==='OPEN'&&owns&&<footer className="spot-footer"><span role="status">{dirty?'尚未儲存':'已暫存'}</span><button className="shell-secondary" disabled={blocked||!dirty} onClick={()=>void saveQuantities()}>重試儲存</button><button className="shell-primary" disabled={blocked||detail.items.some(i=>!validSpotQuantity(values[i.entry_id]||''))} onClick={()=>void submit()}>送出抽查</button></footer>}
   <details className="spot-history"><summary>處理紀錄</summary>{detail.events.map(e=><p key={e.id}><strong>{spotActionLabel(e)}</strong>・{e.actor_name}<br/><small>{displayTime(e.at)}</small></p>)}</details>
  </>:<div className="spot-list">{tab==='pending'&&<p className="shell-note">包含其他月份尚未完成的抽查及差異。</p>}{checks.map(c=><button key={c.id} className="spot-list-row" disabled={blocked||loading} onClick={()=>void open(c.id)}><span><strong>{c.source_month.slice(0,7)} 盤點複查</strong><small>{c.total} 項・{c.assignee_name}・{displayTime(c.created_at)}</small>{c.status==='REVIEWING'&&<small>{c.pending_review} 項待主管複核・{c.pending_close} 項待行政確認</small>}</span><span className={`spot-badge ${c.status==='CLOSED'?'done':''}`}>{spotStatus[c.status]} ›</span></button>)}{list&&!checks.length&&<p>目前沒有{tab==='pending'?'待處理抽查':'這個月份的抽查紀錄'}。</p>}</div>}
 </section>;
}
