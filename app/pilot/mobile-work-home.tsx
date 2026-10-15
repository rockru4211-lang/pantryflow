'use client';
import {canData,viewAccess} from '@/lib/data-access';
import {useState,type ReactNode} from 'react';
import {Truck,ArrowLeftRight,Trash2,ClipboardList,Search,ChevronRight,Clock3,ClipboardCheck,Wrench} from 'lucide-react';
import {hasCrossStore,type AppStore} from '@/lib/app-workspace';
import {visibleWork,type WorkEntry} from '@/lib/workflow-rules';
import type {ShellView} from './app-shell';
import './mobile-work-home.css';

type Props={reminders?:ReactNode;store:AppStore;rows?:WorkEntry[];error:string;refresh:()=>void;onNavigate:(view:ShellView)=>void;onOpenWork?:(row:WorkEntry)=>void;onRecipeSearch?:(query:string)=>void};
export default function MobileWorkHome({reminders,store,rows,error,refresh,onNavigate,onOpenWork,onRecipeSearch}:Props){
 const [query,setQuery]=useState('');
 const pending=visibleWork((rows||[]).filter(row=>row.category!=='receipt'&&row.category!=='loan'&&viewAccess(store,row.target)),'tasks','','all','');
 return <div className="beape-mobile-home">
  <header className="bm-heading"><h1>今日工作</h1><p>選擇作業，直接開始</p></header>
  <nav className="bm-shortcuts" aria-label="常用作業">
   <button type="button" className="bm-upload" onClick={()=>onNavigate('receiving')}><Truck aria-hidden="true"/><strong>貨單上傳</strong></button>
   {hasCrossStore(store)&&<button type="button" onClick={()=>onNavigate('transfers')}><ArrowLeftRight aria-hidden="true"/><strong>調撥</strong></button>}
   <button type="button" onClick={()=>onNavigate('waste')}><Trash2 aria-hidden="true"/><strong>廢棄</strong></button>
  </nav>
  <section className="bm-group"><h2>其他作業</h2><div className="bm-rows">
   {store.business_type!=='CHAIN_RESTAURANT'&&canData(store,'SUPPLIERS')&&<button type="button" className="bm-row" onClick={()=>onNavigate('suppliers')}><span className="bm-icon"><Truck/></span><span className="bm-copy"><strong>供應商訂貨</strong><small>查看廠商與訂貨方式</small></span><ChevronRight/></button>}
   <button type="button" className="bm-row" onClick={()=>onNavigate('count')}><span className="bm-icon"><ClipboardList/></span><span className="bm-copy"><strong>盤點</strong><small>選擇儲物區，開始盤點</small></span><ChevronRight/></button>
   {canData(store,'SPOT')&&<button type="button" className="bm-row" onClick={()=>onNavigate('spot-check')}><span className="bm-icon"><ClipboardCheck/></span><span className="bm-copy"><strong>抽盤</strong><small>查看與執行抽盤</small></span><ChevronRight/></button>}
   {canData(store,'EQUIPMENT')&&<button type="button" className="bm-row" onClick={()=>onNavigate('equipment')}><span className="bm-icon"><Wrench/></span><span className="bm-copy"><strong>設備維修</strong><small>新增報修、查廠商與處理進度</small></span><ChevronRight/></button>}
   {viewAccess(store,'purchase-notes')&&<button type="button" className="bm-row" onClick={()=>onNavigate('purchase-notes')}><span className="bm-icon"><ClipboardList/></span><span className="bm-copy"><strong>待購事項</strong><small>記下要買的物品、追蹤到貨</small></span><ChevronRight/></button>}
  </div></section>
  {canData(store,'RECIPE')&&<section className="bm-group"><h2>食譜</h2><form className="bm-search" onSubmit={event=>{event.preventDefault();if(onRecipeSearch)onRecipeSearch(query.trim());else onNavigate('recipes');}}><Search aria-hidden="true"/><input type="search" aria-label="搜尋主食譜" placeholder="搜尋菜名" value={query} onChange={event=>setQuery(event.target.value)}/><button type="submit" aria-label="查找食譜"><ChevronRight/></button></form></section>}
  {reminders??<section className="bm-tasks" aria-label="今日待辦"><div className="bm-section-head"><h2>今日待辦{rows&&!error&&<span>{pending.length}</span>}</h2><button type="button" onClick={()=>onNavigate('tasks')}>查看全部<ChevronRight size={16}/></button></div>
   {error?<p role="alert">待辦暫時無法載入。<button type="button" onClick={refresh}>重試</button></p>:!rows?<p role="status">正在讀取待辦…</p>:pending.length?<div className="bm-rows">{pending.slice(0,3).map(row=><button type="button" className="bm-row bm-task" key={row.key} onClick={()=>onOpenWork?onOpenWork(row):onNavigate('tasks')}><span className="bm-icon"><Clock3/></span><span className="bm-copy"><strong>{row.title}</strong><small>{row.copy}</small></span><span className="bm-status">待處理</span><ChevronRight/></button>)}</div>:<p className="bm-clear">目前沒有待處理事項</p>}
  </section>}
 </div>;
}
