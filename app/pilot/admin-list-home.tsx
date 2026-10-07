'use client';
import {useState} from 'react';
import type {WorkEntry} from '@/lib/workflow-rules';
import type {ShellView} from './app-shell';
import {workCategories} from './work-feed';
import {displayTime} from './inventory-catalog';
import {exportRows} from './reports-workspace';

type Props={storeName:string;rows?:WorkEntry[];error:string;refresh:()=>void;onOpen:(row:WorkEntry)=>void;onNavigate:(view:ShellView)=>void};
export default function AdminListHome({storeName,rows,error,refresh,onOpen,onNavigate}:Props){
 const [query,setQuery]=useState(''),[category,setCategory]=useState('all'),[tab,setTab]=useState<'pending'|'recent'>('pending'),[exportError,setExportError]=useState('');
 const filtered=(rows||[]).filter(r=>(tab==='recent'||r.pending)&&(category==='all'||r.category===category)&&`${r.title} ${r.copy}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).sort((a,b)=>b.at.localeCompare(a.at));
 async function download(){try{await exportRows(filtered.map(r=>({'日期':displayTime(r.at),'類型':workCategories[r.category]||r.category,'事項':r.title,'說明':r.copy,'狀態':r.pending?'待處理':'已完成'})),'xlsx',`${storeName}_行政待辦`);setExportError('');}catch{setExportError('匯出未完成，請重試。');}}
 return <section className="admin-list-home"><header className="admin-list-heading"><div><h1>行政總覽</h1><p>{storeName}・{new Date().toLocaleDateString('zh-TW')}</p></div><button className="shell-secondary" onClick={refresh}>重新讀取</button></header>
 <div className="admin-list-summary"><span>待處理 <strong>{rows?rows.filter(r=>r.pending).length:'—'}</strong> 筆</span><span>進貨待整理 <strong>{rows?rows.filter(r=>r.category==='receipt'&&r.pending).length:'—'}</strong> 筆</span><span>抽盤待確認 <strong>{rows?rows.filter(r=>r.category==='spot'&&r.pending).length:'—'}</strong> 項</span></div>
 <div className="admin-module-tabs"><button aria-pressed={tab==='pending'} onClick={()=>setTab('pending')}>待辦清單</button><button aria-pressed={tab==='recent'} onClick={()=>setTab('recent')}>最近異動</button></div>
 <div className="admin-list-toolbar"><input type="search" aria-label="搜尋行政事項" placeholder="搜尋事項、供應商" value={query} onChange={e=>setQuery(e.target.value)}/><select aria-label="待辦類型" value={category} onChange={e=>setCategory(e.target.value)}><option value="all">全部類型</option>{Object.entries(workCategories).filter(([key])=>key!=='all').map(([key,label])=><option key={key} value={key}>{label}</option>)}</select><button className="shell-secondary" disabled={!filtered.length} onClick={()=>void download()}>匯出 Excel</button><button className="shell-secondary" onClick={()=>onNavigate('finance-accounts')}>財務對帳</button></div>
 {(error||exportError)&&<p role="alert">{error||exportError}</p>}
 <div className="admin-list-table-wrap"><table className="admin-list-table"><thead><tr><th>日期</th><th>類型</th><th>事項</th><th>說明</th><th>狀態</th><th>操作</th></tr></thead><tbody>{filtered.map(r=><tr key={r.key}><td>{displayTime(r.at)}</td><td>{workCategories[r.category]||r.category}</td><td>{r.title}</td><td>{r.copy}</td><td>{r.pending?'待處理':'已完成'}</td><td><button className="text-button" onClick={()=>onOpen(r)}>開啟</button></td></tr>)}{!filtered.length&&<tr><td colSpan={6}>{!rows&&!error?'正在讀取待辦…':error?'待辦尚未讀取，請重試。':'目前沒有符合條件的事項。'}</td></tr>}</tbody></table></div><small>共 {filtered.length} 筆</small></section>;
}
