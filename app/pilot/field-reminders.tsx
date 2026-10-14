'use client';
import {useEffect,useState} from 'react';
import {Package,Wrench,Plus,ChevronRight,Clock3} from 'lucide-react';
import type {AppStore} from '@/lib/app-workspace';
import type {WorkEntry} from '@/lib/workflow-rules';
import {useWorkspace,useOperation,useOperationDraft} from './operation-hooks';
import type {OperationalRecord} from './records-workspace';
import {displayTime} from './inventory-catalog';

export default function FieldReminders({store,userId,rows,feedError,onOpen,refreshFeed}:{store:AppStore;userId:string;rows?:WorkEntry[];feedError:string;onOpen:(row:WorkEntry)=>void;refreshFeed:()=>void}){
 const workspace=useWorkspace<{records:OperationalRecord[]}>(store.id,'activity');
 const operation=useOperation(store.id,userId);
 const [page,setPage]=useState<'home'|'all'|'new'>('home');
 const [completed,setCompleted]=useState(false);
 const [selected,setSelected]=useState<OperationalRecord>();
 const [note,setNote]=useState('');
 const [draft,setDraft,clearDraft]=useOperationDraft(userId,store.id,'field-reminder',{title:'',body:'',due:'',category:'一般提醒'});
 const refreshReminders=workspace.refresh;
 useEffect(()=>{const refresh=()=>void refreshReminders();const timer=setInterval(refresh,30000);window.addEventListener('focus',refresh);return()=>{clearInterval(timer);window.removeEventListener('focus',refresh);};},[refreshReminders]);
 const records=(workspace.data?.records||[]).filter(r=>r.kind==='handover');
 const active=records.filter(r=>r.status!=='COMPLETE').sort((a,b)=>(a.due_at?Date.parse(a.due_at):Infinity)-(b.due_at?Date.parse(b.due_at):Infinity)||Date.parse(b.created_at)-Date.parse(a.created_at));
 const history=records.filter(r=>r.status==='COMPLETE').sort((a,b)=>Date.parse(b.completed_at||b.created_at)-Date.parse(a.completed_at||a.created_at));
 const repairs=(rows||[]).filter(r=>r.category==='equipment'&&r.pending);
 const others=(rows||[]).filter(r=>r.pending&&['spot','expiry','stock','incident','bulletin','company_task'].includes(r.category));
 const waiting=repairs.filter(r=>r.copy.startsWith('等待報價'));
 const actionable=[...repairs.filter(r=>!r.copy.startsWith('等待報價')),...others];
 const total=active.length+actionable.length;
 const submit=async()=>{if(!draft.title.trim())return;const result=await operation.run('record.create',{kind:'handover',title:draft.title.trim(),body:draft.body,category:draft.category,due_at:draft.due?new Date(`${draft.due}:00+08:00`).toISOString():null});if(result){clearDraft();setPage('home');await workspace.refresh();refreshFeed();}};
 const finish=async()=>{if(!selected)return;const result=await operation.run('record.complete',{id:selected.id,revision:selected.revision,note});if(result){setSelected(undefined);setNote('');await workspace.refresh();refreshFeed();}};
 const open=(record:OperationalRecord)=>{setSelected(record);setNote('');operation.setError('');};
 const recordRow=(r:OperationalRecord)=><article className="bm-row bm-reminder" key={r.id}><span className="bm-icon">{r.category==='宅配到貨'?<Package/>:<Clock3/>}</span><button type="button" className="bm-copy bm-reminder-detail" onClick={()=>open(r)}><strong>{r.title}</strong><small>{r.due_at?`${displayTime(r.due_at)} 前`:'未設定期限'}{r.body?`・${r.body}`:''}</small></button><button type="button" className="bm-reminder-action" onClick={()=>open(r)}>{r.status==='COMPLETE'?'查看紀錄':r.category==='宅配到貨'?'確認收到':'回報完成'}</button></article>;
 const workRow=(r:WorkEntry)=><article className="bm-row bm-reminder" key={r.key}><span className="bm-icon"><Wrench/></span><span className="bm-copy"><strong>{r.title}</strong><small>{r.copy.startsWith('等待報價')?'後勤追蹤・現場暫無需操作':r.copy}</small></span><button type="button" className={r.copy.startsWith('等待報價')?'bm-status':'bm-reminder-action'} onClick={()=>onOpen(r)}>{r.copy.startsWith('等待報價')?'等待報價':r.category==='equipment'?'回報完成':'查看處理'}</button></article>;
 const preview=[...active.map(recordRow),...actionable.map(workRow),...waiting.map(workRow)];
 return <section className="bm-tasks" aria-label="現場提醒"><div className="bm-section-head"><h2>現場提醒{workspace.data&&rows&&<span>{total}</span>}</h2><div className="bm-reminder-tools"><button type="button" onClick={()=>{setPage('new');setSelected(undefined);}}><Plus size={16}/>新增</button><button type="button" onClick={()=>{setPage('all');setCompleted(false);setSelected(undefined);}}>查看全部<ChevronRight size={16}/></button></div></div>
 {(workspace.error||operation.error||feedError)&&<p role="alert">{operation.error||workspace.error||feedError}<button type="button" onClick={()=>{void workspace.refresh();refreshFeed();}}>重新讀取</button></p>}
 {selected?<div className="shell-card transfer-form"><button type="button" className="text-button" onClick={()=>setSelected(undefined)}>〈 返回提醒</button><h3>{selected.title}</h3><p className="preserve-lines">{selected.body}</p><small>{selected.actor_name}・{displayTime(selected.created_at)}</small>{selected.due_at&&<p>期限：{displayTime(selected.due_at)}</p>}{selected.status!=='COMPLETE'?<><label>完成說明（選填）<textarea value={note} onChange={e=>setNote(e.target.value)} maxLength={5000}/></label><button type="button" className="shell-primary" disabled={operation.busy} onClick={()=>void finish()}>{operation.busy?'儲存中…':selected.category==='宅配到貨'?'確認已收到':'確認完成'}</button></>:<><p>已完成・{displayTime(selected.completed_at||selected.created_at)}</p>{selected.events.map(e=><p key={e.id}>{e.actor_name}・{displayTime(e.created_at)}{e.note?`・${e.note}`:''}</p>)}</>}</div>:page==='new'?<form className="shell-card transfer-form" onSubmit={e=>{e.preventDefault();void submit();}}><h3>新增提醒</h3><small>提醒門市：{store.name}・全體現場人員</small><label>事項<input required maxLength={160} value={draft.title} onChange={e=>setDraft({...draft,title:e.target.value})} placeholder="例如：冷凍包裹到貨確認"/></label><label>類型<select value={draft.category} onChange={e=>setDraft({...draft,category:e.target.value})}><option>一般提醒</option><option>宅配到貨</option></select></label><label>提醒期限（選填）<input type="datetime-local" value={draft.due} onChange={e=>setDraft({...draft,due:e.target.value})}/></label><label>說明（選填）<textarea maxLength={5000} value={draft.body} onChange={e=>setDraft({...draft,body:e.target.value})}/></label><div className="shell-button-stack"><button type="submit" className="shell-primary" disabled={operation.busy}>{operation.busy?'儲存中…':'建立提醒'}</button><button type="button" className="text-button" onClick={()=>setPage('home')}>取消</button></div></form>:<>{page==='all'&&<div className="bm-reminder-tools"><button type="button" onClick={()=>setPage('home')}>〈 收起</button><button type="button" aria-pressed={!completed} onClick={()=>setCompleted(false)}>待處理與追蹤</button><button type="button" aria-pressed={completed} onClick={()=>setCompleted(true)}>已完成</button></div>}{!workspace.data&&!workspace.error?<p role="status">正在讀取提醒…</p>:<div className="bm-rows">{page==='all'&&completed?history.map(recordRow):page==='all'?preview:preview.slice(0,3)}</div>}{page==='all'&&completed&&<button type="button" className="text-button" onClick={()=>onOpen({key:'equipment-history',id:'',category:'equipment',title:'維修紀錄',copy:'',at:'',pending:false,target:'equipment'})}>查看維修完成紀錄</button>}{workspace.data&&!(completed&&page==='all'?history.length:preview.length)&&<p>目前沒有{completed&&page==='all'?'已完成紀錄':'待處理提醒'}</p>}<p className="shell-note">完成後自動收起，可至全部提醒查看。</p></>}
 </section>;
}
