"use client";
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase-browser';
import { displayTime } from './inventory-catalog';
import { countExportRows, paperOrder, type CountResult } from '@/lib/count-flow';
export default function CountDetails({sessionId,management=false,paper=false,zoneId,onPaperComplete}:{sessionId:string;management?:boolean;paper?:boolean;zoneId?:string;onPaperComplete?:()=>Promise<void>}) {
 const [entries,setEntries]=useState<CountResult[]>([]); const [message,setMessage]=useState('正在讀取明細…'); const [query,setQuery]=useState('');
 const [segment,setSegment]=useState(()=>{try{return Number(localStorage.getItem(`count-paper:${sessionId}`)||0);}catch{return 0;}});
 useEffect(()=>{let active=true;void (async()=>{const results=await supabase.rpc('get_pilot_count_results',{p_session_id:sessionId});
 const full=management?await supabase.rpc('get_pilot_count_details',{p_session_id:sessionId}):null;
 if(!active)return;const rows=Array.isArray(results.data)?results.data as unknown as CountResult[]:[];
 const baselines=Array.isArray(full?.data)?full.data as unknown as CountResult[]:[];
 setEntries(rows.map(r=>({...r,...(management?{opening_quantity:baselines.find(b=>b.id===r.id)?.opening_quantity??null}:{})})));setMessage(results.error||full?.error?'明細讀取失敗，請重新進入。':'');})();return()=>{active=false;};},[sessionId,management]);
 const filtered=entries.filter(r=>(!zoneId||r.zone_id===zoneId)&&`${r.name} ${r.supplier||''} ${r.zone}`.includes(query));
 const ordered=paper?paperOrder(filtered):filtered; const pages=Math.max(1,Math.ceil(ordered.length/25));const current=Math.min(segment,pages-1);const visible=paper?ordered.slice(current*25,current*25+25):ordered;
 function turn(n:number){setSegment(n);try{localStorage.setItem(`count-paper:${sessionId}`,String(n));}catch{}}
 async function exportRows(format:'xlsx'|'csv'){const XLSX=await import('xlsx');const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.json_to_sheet(countExportRows(ordered,management)),'盤點明細');XLSX.writeFile(book,`盤點-${sessionId.slice(0,8)}.${format}`,{bookType:format});}
 const renderEntry=(entry:CountResult)=><article className="catalog-item" key={entry.id}><b>{entry.name}｜{entry.zone}</b><p>實盤：<strong>{entry.quantity} {entry.unit}</strong>{management&&<>｜期初：{entry.opening_quantity??'未提供'}</>}</p>{paper&&<small>{entry.file_name||'未對應'}｜{entry.sheet_name||'新增品項'} {entry.source_row?`第 ${entry.source_row} 列`:''}</small>}<details><summary>廠商與規格</summary><p>{entry.supplier||'未提供'}｜{entry.specification||'未提供'}</p></details><small>盤點人：{entry.entered_by||'未提供'}｜送出時間：{displayTime(entry.entered_at)}</small></article>;
 return <div className="submitted-details"><h3>{paper?'紙本謄寫表':management?'完整盤點明細':'已盤清單'}（{filtered.length} 筆）</h3>
 {management&&<p className="helper">期初是開始盤點時的紀錄；未提供的品項不計算差異。</p>}
 <label className="zone-editor-field print-hidden">搜尋明細<input type="search" value={query} onChange={e=>setQuery(e.target.value)}/></label>
 {paper&&<><p>依原工作表與列次・未對應品項列於最後</p><div className="paper-step-actions"><button className="shell-secondary" disabled={!current} onClick={()=>turn(current-1)}>上一段</button><span>第 {current+1}／{pages} 段</span><button className="shell-secondary" disabled={current+1>=pages} onClick={()=>turn(current+1)}>下一段</button></div></>}
 <div className={paper?'paper-screen-rows':''}>{visible.map(renderEntry)}</div>{paper&&<div className="paper-print-rows">{ordered.map(renderEntry)}</div>}
 {!!entries.length&&<div className="shell-button-stack print-hidden"><button className="shell-secondary" onClick={()=>exportRows('xlsx')}>匯出 Excel</button><button className="shell-secondary" onClick={()=>exportRows('csv')}>匯出 CSV</button><button className="shell-secondary" onClick={()=>window.print()}>列印／另存 PDF</button>{paper&&onPaperComplete&&<button className="shell-primary" onClick={onPaperComplete}>完成紙本謄寫</button>}</div>}{message&&<p role="status">{message}</p>}</div>;
}
