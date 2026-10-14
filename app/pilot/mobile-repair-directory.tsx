'use client';
import {useState} from 'react';
import {Phone,Search} from 'lucide-react';
import type {AdministrativeRow} from '@/lib/administrative-directory';
import {repairDirectory,repairLineLink} from '@/lib/mobile-repair-directory';
import {supplierPhones} from '@/lib/supplier-directory';
import './mobile-recipe-trials.css';
export default function MobileRepairDirectory({rows,loading,error,onReload}:{rows:AdministrativeRow[];loading:boolean;error:string;onReload:()=>void}){
 const [query,setQuery]=useState('');const matches=repairDirectory(rows,query);
 return <div className="mobile-repair-directory"><label className="repair-search"><Search size={17}/><input type="search" aria-label="搜尋維修廠商" placeholder="搜尋設備或服務，例如：冰箱" value={query} onChange={e=>setQuery(e.target.value)}/></label><p className="shell-note">依設備或服務事項找廠商，直接聯絡。</p>{error&&<p role="alert">{error}<button onClick={onReload}>重新讀取</button></p>}{matches.map(c=>{const line=repairLineLink(`${c.method} ${c.row.link}`),phones=supplierPhones(c.phone);return <article className="mobile-vendor-row" key={c.row.id}><h2>{c.row.name}</h2><p>{c.service||'服務事項尚未填寫'}</p>{c.contact&&<p className="shell-note">聯絡人：{c.contact}</p>}<div className="mobile-vendor-actions">{phones.map((p,i)=>p.href?<a key={i} href={p.href}><Phone size={15}/>{p.label}</a>:<span key={i}>{p.label}</span>)}{line&&<a href={line} target="_blank" rel="noopener noreferrer">開啟 LINE</a>}</div>{c.method&&<p className="mobile-contact-method">{c.method}</p>}{!c.phone&&!c.method&&!line&&<p className="shell-note">尚未填寫聯絡方式，請洽行政。</p>}</article>;})}{!error&&!matches.length&&<p className="shell-note">{loading?'讀取中…':query?'找不到對應廠商，請換個關鍵字或洽行政。':'尚未建檔維修廠商。'}</p>}</div>;
}
