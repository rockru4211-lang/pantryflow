'use client';
import {useState} from 'react';
import {Plus,Search,CheckCircle2} from 'lucide-react';
import {repairYear,type AdministrativeRow} from '@/lib/administrative-directory';
import {equipmentChoices} from '@/lib/equipment-selection';
import {repairReported} from '@/lib/mobile-repair';
type Props={rows:AdministrativeRow[];draft?:AdministrativeRow;loading:boolean;busy:boolean;canEdit:boolean;error:string;notice:string;onNew:()=>void;onEdit:(row:AdministrativeRow)=>void;onChange:(row:AdministrativeRow,key:keyof AdministrativeRow,value:string)=>void;onSave:(row:AdministrativeRow)=>void;onCancel:()=>void;onReload:()=>void};
export default function MobileEquipment({rows,draft,loading,busy,canEdit,error,notice,onNew,onEdit,onChange,onSave,onCancel,onReload}:Props){
 const[query,setQuery]=useState('');const[year,setYear]=useState(()=>new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Taipei'}).slice(0,4));
 const records=rows.filter(r=>r.category==='維修紀錄'&&!r.archived&&!r.is_removed);
 const years=[...new Set([new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Taipei'}).slice(0,4),...records.map(repairYear).filter(y=>y!=='undated')])].sort().reverse();
 const visible=records.filter(r=>(year==='all'||repairYear(r)===year)&&`${r.name} ${r.repair_reason||''} ${r.repair_result||''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).sort((a,b)=>(b.repair_date||'').localeCompare(a.repair_date||''));
 const choices=equipmentChoices(rows).names;
 return <section className="mobile-equipment"><h1>設備維修</h1>
 {error&&<p className="pilot-message" role="alert">{error}{!draft&&<button className="text-button" onClick={onReload} disabled={busy}>重新讀取</button>}</p>}{notice&&<p role="status">{notice}</p>}
 {draft?<form onSubmit={e=>{e.preventDefault();setYear(repairYear(draft));setQuery('');onSave(draft);}} className="shell-card mobile-repair-form">
  <h2>回報維修完成</h2>
  <label>設備名稱<input autoFocus value={draft.name} list="mobile-repair-names" placeholder="搜尋或輸入設備名稱" required maxLength={160} disabled={busy} onChange={e=>onChange(draft,'name',e.target.value)}/></label>
  <datalist id="mobile-repair-names">{choices.map(name=><option key={name} value={name}/>)}</datalist>
  <label>完成日期<input type="date" required value={draft.repair_date||''} disabled={busy} onChange={e=>onChange(draft,'repair_date',e.target.value)}/></label>
  <label>原因與處理簡述<textarea rows={4} required maxLength={8000} placeholder="例如：冷藏不冷，更換溫控器後恢復正常。原因不明可註記待確認。" value={draft.repair_reason||''} disabled={busy} onChange={e=>onChange(draft,'repair_reason',e.target.value)}/></label>
  <div className="mobile-repair-actions"><button type="submit" className="shell-primary" disabled={busy||!canEdit}>{busy?'回報中…':'回報完成'}</button><button type="button" className="shell-secondary" disabled={busy} onClick={onCancel}>取消</button></div>
 </form>:<>
  <p className="shell-note">維修完成後，簡述原因與處理方式，讓後勤掌握結果。</p>
  {canEdit&&<button className="shell-primary mobile-repair-new" disabled={loading||busy} onClick={onNew}><Plus size={18}/>回報維修完成</button>}
  <div className="mobile-repair-record-head"><h2>維修紀錄</h2><select aria-label="維修年份" value={year} onChange={e=>setYear(e.target.value)}>{years.map(y=><option key={y} value={y}>{y} 年</option>)}<option value="all">全部年份</option><option value="undated">日期未填</option></select></div>
  <label className="mobile-repair-search"><Search size={18} aria-hidden="true"/><input type="search" aria-label="搜尋維修紀錄" placeholder="搜尋設備或維修原因" value={query} onChange={e=>setQuery(e.target.value)}/></label>
  {loading?<p role="status">正在讀取維修紀錄…</p>:<div className="mobile-repair-records">{visible.map(r=><article className="shell-card mobile-repair-record" key={r.id}><header><strong>{r.name}</strong>{repairReported(r)&&<span className="mobile-repair-completed"><CheckCircle2 size={14}/>已完成</span>}</header><small>{r.repair_date||'日期未填'}</small><p>{r.repair_reason||'尚未填寫原因'}</p>{r.repair_result&&r.repair_result!=='已完成維修'&&<details><summary>處理紀錄</summary><p>{r.repair_result}</p></details>}{!repairReported(r)&&canEdit&&<button className="shell-secondary" onClick={()=>onEdit(r)}>回報完成</button>}</article>)}{!visible.length&&!error&&<p className="shell-note">目前沒有符合的維修紀錄。</p>}</div>}
 </>}
 </section>;
}
