"use client";
import { useEffect, useId, useState } from 'react';
import { supabase } from '@/lib/supabase-browser';
import { displayTime } from './inventory-catalog';
import {downloadCountFile} from '@/lib/count-file';
import { paperOrder, clampPaperSegment, countReasonLabel, type CountResult } from '@/lib/count-flow';

export default function CountDetails({sessionId,management=false,paper=false,zoneId,onPaperComplete,outputOnly=false}:{
 sessionId:string;management?:boolean;paper?:boolean;zoneId?:string;onPaperComplete?:()=>Promise<void>;outputOnly?:boolean;
}) {
 const [entries,setEntries]=useState<CountResult[]>([]);
 const [message,setMessage]=useState('正在讀取明細…');
 const [query,setQuery]=useState('');
 const [exportOpen,setExportOpen]=useState(false);
 const [exporting,setExporting]=useState(false);
 const [completing,setCompleting]=useState(false);
 const menuId=useId();
 const fullDetails=management&&!paper;
 const [segment,setSegment]=useState(()=>{try{return Number(localStorage.getItem(`count-paper:${sessionId}`)||0);}catch{return 0;}});
 useEffect(()=>{
  let active=true;
  void (async()=>{
   const [results,full]=await Promise.all([
    supabase.rpc('get_pilot_count_results',{p_session_id:sessionId}),
    fullDetails?supabase.rpc('get_pilot_count_details',{p_session_id:sessionId}):Promise.resolve(null),
   ]);
   if(!active)return;
   if(results.error||full?.error){setEntries([]);setMessage('明細讀取失敗，請重新進入。');return;}
   const rows=Array.isArray(results.data)?results.data as unknown as CountResult[]:[];
   const baselines=Array.isArray(full?.data)?full.data as unknown as CountResult[]:[];
   setEntries(rows.map(r=>({...r,...(fullDetails?{...baselines.find(b=>b.id===r.id),opening_quantity:baselines.find(b=>b.id===r.id)?.opening_quantity??null}:{})})));
   setMessage('');
  })().catch(()=>{if(active)setMessage('明細讀取失敗，請重新進入。');});
  return()=>{active=false;};
 },[sessionId,fullDetails]);
 const filtered=entries.filter(r=>(!zoneId||r.zone_id===zoneId)&&`${r.name} ${r.supplier||''} ${r.zone}`.includes(query));
 const ordered=paper?paperOrder(filtered):filtered;
 const pages=Math.max(1,Math.ceil(ordered.length/25));const current=clampPaperSegment(segment,pages);
 const visible=paper?ordered.slice(current*25,current*25+25):ordered;
 const first=current*25+1;const last=Math.min((current+1)*25,ordered.length);
 function turn(n:number){
  const next=clampPaperSegment(n,pages);setSegment(next);
  try{localStorage.setItem(`count-paper:${sessionId}`,String(next));}catch{}
 }
 async function exportRows(format:'xlsx'|'csv'){
  setExporting(true);
  try{await downloadCountFile(sessionId,ordered,fullDetails,format);
   setExportOpen(false);setMessage('');
  }catch{setMessage('匯出未完成，請重試。');}finally{setExporting(false);}
 }
 async function finishPaper(){
  if(completing||!onPaperComplete)return;setCompleting(true);
  try{await onPaperComplete();}finally{setCompleting(false);}
 }
 const renderDetails=(entry:CountResult)=><article className="catalog-item" key={entry.id}>
  <b>{entry.name}｜{entry.zone}</b><p>實盤：<strong>{entry.quantity} {entry.unit}</strong>{fullDetails&&<>｜期初：{entry.opening_quantity??'未提供'}</>}</p>
  {fullDetails&&entry.confirmed_at&&<p>確認數量：{entry.confirmed_quantity??entry.quantity} {entry.unit}｜差異：{entry.difference??'未提供'}<br/>原因：{countReasonLabel(entry.correction_reason)}｜{entry.confirmed_by||'未提供'}・{displayTime(entry.confirmed_at)}</p>}
  <details><summary>廠商與規格</summary><p>{entry.supplier||'未提供'}｜{entry.specification||'未提供'}</p></details>
  <small>盤點人：{entry.entered_by||'未提供'}｜送出時間：{displayTime(entry.entered_at)}</small>
 </article>;
 const renderPaper=(rows:CountResult[],offset:number)=>rows.map((entry,index)=><div key={entry.id}>
  <span className="paper-position">{String(offset+index+1).padStart(3,'0')}</span>
  <span><strong>{entry.name}</strong><details className="paper-supplier"><summary>廠商與規格</summary><small>{entry.supplier||'未提供'}｜{entry.specification||'未提供'}</small></details></span>
  <b>{entry.quantity} {entry.unit}</b>
 </div>);
 const printButton=<button className="shell-secondary" disabled={!entries.length} onClick={()=>window.print()}>列印／另存 PDF</button>;
 const outputs=<div className="shell-button-stack count-outputs print-hidden">
  {outputOnly&&printButton}
  <div className="count-export-picker"><button className="shell-secondary" aria-expanded={exportOpen} aria-controls={menuId} onClick={()=>setExportOpen(open=>!open)} disabled={exporting||!entries.length}>{exporting?'匯出中…':'匯出檔案'}</button>
   {exportOpen&&<div id={menuId} className="count-export-options" role="group" aria-label="匯出格式">
    <button className="shell-secondary" onClick={()=>void exportRows('xlsx')} disabled={exporting}>Excel（.xlsx）</button>
    <button className="shell-secondary" onClick={()=>void exportRows('csv')} disabled={exporting}>CSV（.csv）</button>
   </div>}
  </div>
  {!outputOnly&&printButton}
 </div>;
 if(outputOnly)return <div className="submitted-details">{outputs}<div className="count-print-only"><h3>{fullDetails?'完整盤點明細':'已盤清單'}（{entries.length} 筆）</h3>{entries.map(renderDetails)}</div>{message&&<p role="status">{message}</p>}</div>;
 return <div className="submitted-details">
  {!paper&&<><h3>{fullDetails?'完整盤點明細':'已盤清單'}（{filtered.length} 筆）</h3>
   {fullDetails&&<p className="helper">期初是開始盤點時的紀錄；未提供的品項不計算差異。</p>}
   <label className="zone-editor-field print-hidden">搜尋明細<input type="search" value={query} onChange={e=>setQuery(e.target.value)}/></label>
   <div>{visible.map(renderDetails)}</div>
  </>}
  {paper&&<>
   <section className="paper-reference-toolbar print-hidden">
    <span>門市匯入表｜{[...new Set(visible.map(r=>r.sheet_name||'新增品項'))].join('、')}</span>
    <select aria-label="選擇原表段落" value={current} onChange={e=>turn(Number(e.target.value))}>{Array.from({length:pages},(_,n)=><option key={n} value={n}>原表第 {n+1} 段｜第 {n*25+1}–{Math.min((n+1)*25,ordered.length)} 列</option>)}</select>
    <div><strong>第 {ordered.length?first:0}–{last} 項</strong><small>共 {ordered.length} 項</small></div>
   </section>
   <section className="shell-card paper-reference-list paper-screen-rows">{renderPaper(visible,current*25)}</section>
   <section className="shell-card paper-reference-list paper-print-rows">{renderPaper(ordered,0)}</section>
   <div className="paper-step-actions print-hidden"><button className="text-button" disabled={!current} onClick={()=>turn(current-1)}>上一段</button><button className="shell-secondary" disabled={current+1>=pages} onClick={()=>turn(current+1)}>下一段{current+1<pages?` ${last+1}–${Math.min(last+25,ordered.length)}`:''}</button></div>
  </>}
  {outputs}
  {paper&&<><p className="shell-note">盤點時依現場區域執行；謄寫時系統自動恢復成門市原表順序。完成整份後只送出一次紀錄。</p>
   {onPaperComplete&&<button className="shell-primary full print-hidden" onClick={()=>void finishPaper()} disabled={completing||!entries.length}>{completing?'正在記錄…':'完成紙本謄寫'}</button>}
  </>}
  {message&&<p role="status">{message}</p>}
 </div>;
}
