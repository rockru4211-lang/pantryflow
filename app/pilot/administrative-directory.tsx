'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {Download,Plus,Search,Upload} from 'lucide-react';
import {supabase} from '@/lib/supabase-browser';
import {appError,canExportData,type AppStore} from '@/lib/app-workspace';
import {operationDeadline} from '@/lib/operation-deadline';
import {ADMIN_CATEGORIES,administrativeSection,prepareAdministrativeImport,safeAdministrativeLink,validateAdministrativeRows,type AdministrativeRow} from '@/lib/administrative-directory';
import type {Json} from '@/lib/database.types';
import './administrative-directory.css';

type Props={section?:'equipment'|'contracts';onRepairs?:()=>void;store:AppStore;onSuppliers:()=>void;registerLeave?:(handler:(()=>Promise<boolean>)|null)=>void};
export default function AdministrativeDirectory({store,onSuppliers,registerLeave,section,onRepairs}:Props){
 const title=section==='equipment'?'設備維修':section==='contracts'?'合約管理':'行政資料';const defaultCategory=section==='equipment'?'設備資料':section==='contracts'?'合約文件':'其他';
 const [rows,setRows]=useState<AdministrativeRow[]>([]),[drafts,setDrafts]=useState<Record<string,AdministrativeRow>>({});
 const [query,setQuery]=useState(''),[category,setCategory]=useState('全部'),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const lock=useRef(false),pending=useRef<{signature:string;id:string}|undefined>(undefined),file=useRef<HTMLInputElement>(null),dirty=useRef(false),alive=useRef(true);
 const leave=useRef(registerLeave);const hasDrafts=Object.keys(drafts).length>0;
 useEffect(()=>{leave.current=registerLeave;},[registerLeave]);
 useEffect(()=>{dirty.current=hasDrafts;},[hasDrafts]);
 const load=useCallback(async()=>{setLoading(true);setError('');try{
  const result=await operationDeadline(signal=>supabase.rpc('app_workspace',{p_store_id:store.id,p_section:'administrative',p_filter:{}}).abortSignal(signal));
  if(result.error)throw result.error;
  const data=result.data as unknown as {rows:AdministrativeRow[]};if(!Array.isArray(data?.rows))throw Error('INVALID_RESPONSE');
  if(alive.current&&!dirty.current&&!lock.current)setRows(data.rows);
 }catch(e){if(alive.current)setError(appError(e));}finally{if(alive.current)setLoading(false);}},[store.id]);
 useEffect(()=>{alive.current=true;queueMicrotask(()=>void load());const check=async()=>!dirty.current||window.confirm('仍有尚未儲存的行政資料，確定離開並放棄修改？');leave.current?.(check);
  const before=(e:BeforeUnloadEvent)=>{if(dirty.current){e.preventDefault();e.returnValue='';}};
  const focus=()=>{if(!dirty.current&&!lock.current)void load();};window.addEventListener('beforeunload',before);window.addEventListener('focus',focus);
  return()=>{alive.current=false;leave.current?.(null);window.removeEventListener('beforeunload',before);window.removeEventListener('focus',focus);};},[load]);
 const all=[...rows.map(r=>drafts[r.id]||r),...Object.values(drafts).filter(r=>!rows.some(x=>x.id===r.id))];
 const categories=[...new Set([...ADMIN_CATEGORIES,...all.map(r=>r.category).filter(Boolean)])];
 const matchesSection=(r:AdministrativeRow)=>{
  if(!section)return category==='已封存'?r.archived:!r.archived&&(category==='全部'||r.category===category);
  if(drafts[r.id])return true;
  if(category==='其他既有資料')return !administrativeSection(r.category);
  return administrativeSection(r.category)===section&&(category==='已封存'?r.archived:!r.archived);
 };
 const visible=all.filter(r=>matchesSection(r)&&`${r.name} ${r.category} ${r.summary} ${r.note} ${r.link}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
 const edit=(row:AdministrativeRow,key:keyof AdministrativeRow,value:string)=>setDrafts(old=>({...old,[row.id]:{...row,[key]:value}}));
 const cancel=(id?:string)=>{if(!window.confirm('放棄尚未儲存的修改？'))return;setDrafts(old=>{if(!id)return {};const next={...old};delete next[id];return next;});setError('');};
 async function save(target=Object.values(drafts)){
  if(lock.current||!target.length)return;const problem=validateAdministrativeRows(target);if(problem){setError(problem);return;}
  lock.current=true;setBusy(true);setError('');setNotice('');const payload={rows:target};const signature=JSON.stringify(payload);
  if(pending.current?.signature!==signature)pending.current={signature,id:crypto.randomUUID()};
  try{const result=await operationDeadline(signal=>supabase.rpc('app_operation',{p_store_id:store.id,p_action:'administrative.save',p_data:payload as unknown as Json,p_request_id:pending.current!.id}).abortSignal(signal));if(result.error)throw result.error;
   const saved=(result.data as unknown as {rows:AdministrativeRow[]}).rows;if(!Array.isArray(saved))throw Error('INVALID_RESPONSE');
   setRows(old=>[...old.filter(r=>!saved.some(s=>s.id===r.id)),...saved]);setDrafts(old=>{const next={...old};target.forEach(r=>delete next[r.id]);return next;});pending.current=undefined;setNotice(`已儲存 ${saved.length} 筆。`);
  }catch(e){setError(appError(e));}finally{lock.current=false;setBusy(false);}
 }
 const newRow=()=>{const row:AdministrativeRow={id:crypto.randomUUID(),name:'',category:section?defaultCategory:category==='全部'||category==='已封存'?'其他':category,summary:'',link:'',note:'',archived:false,revision:0};setDrafts(old=>({...old,[row.id]:row}));setCategory('全部');setQuery('');};
 async function exportRows(){try{const XLSX=await import('xlsx');const data=visible.map(r=>({'資料名稱':r.name,'分類':r.category,'內容摘要':r.summary,'附件／連結':r.link,'備註':r.note,'狀態':r.archived?'已封存':'使用中'}));const book=XLSX.utils.book_new();const sheet=XLSX.utils.json_to_sheet(data.length?data:[{'資料名稱':'','分類':'','內容摘要':'','附件／連結':'','備註':'','狀態':''}]);sheet['!cols']=[{wch:24},{wch:16},{wch:45},{wch:45},{wch:35},{wch:12}];XLSX.utils.book_append_sheet(book,sheet,title);XLSX.writeFile(book,`${store.name}-${title}.xlsx`);}catch(e){setError(appError(e));}}
 async function importFile(selected:File){if(lock.current)return;lock.current=true;setBusy(true);setError('');try{
  if(selected.size>10*1024*1024)throw Error('請使用 10 MB 以下的 Excel 檔案。');
  const XLSX=await import('xlsx');const book=XLSX.read(await selected.arrayBuffer(),{type:'array'});const values=book.SheetNames.flatMap(name=>XLSX.utils.sheet_to_json<Record<string,unknown>>(book.Sheets[name],{defval:''}));
  if(!values.some(v=>Object.hasOwn(v,'資料名稱')))throw Error('請使用含「資料名稱」欄位的表格，可先匯出取得格式。');
  const result=prepareAdministrativeImport(values,all,()=>crypto.randomUUID());if(section){for(const row of result.rows){if(!row.category.trim())row.category=defaultCategory;}}const problem=validateAdministrativeRows([...Object.values(drafts),...result.rows]);if(problem)throw Error(problem);
  setDrafts(old=>({...old,...Object.fromEntries(result.rows.map(r=>[r.id,r]))}));setCategory('全部');setQuery('');setNotice(`已帶入 ${result.rows.length} 筆供確認，略過 ${result.skipped} 筆空白或重複名稱（含已封存）。按「儲存全部」後才會建檔。`);
 }catch(e){setError(e instanceof Error?e.message:appError(e));}finally{lock.current=false;setBusy(false);if(file.current)file.current.value='';}}
 const field=(r:AdministrativeRow,key:'name'|'category'|'summary'|'link'|'note',label:string)=>drafts[r.id]?<input aria-label={`${r.name||'新增資料'} ${label}`} list={key==='category'?'administrative-categories':undefined} value={r[key]} onChange={e=>edit(r,key,e.target.value)} disabled={busy} maxLength={key==='name'?160:key==='category'?80:key==='link'?2000:8000}/>:key==='link'?(safeAdministrativeLink(r.link)?<a href={safeAdministrativeLink(r.link)!} target="_blank" rel="noopener noreferrer">開啟附件／連結</a>:r.link||'—'):r[key]||'—';
 return <section className="administrative-directory"><header className="administrative-heading"><h1>{title}</h1><div>{onRepairs&&<button className="shell-secondary" onClick={onRepairs}>報修紀錄</button>}<button className="shell-secondary" onClick={onSuppliers}>供應商聯絡資料</button></div></header>
  <nav className="administrative-tabs" aria-label="行政資料分類">{(section?['全部','已封存',...(all.some(r=>!administrativeSection(r.category))?['其他既有資料']:[])]:['全部',...categories,'已封存']).map(c=><button key={c} aria-pressed={category===c} onClick={()=>setCategory(c)}>{section&&c==='全部'?'使用中':c}</button>)}</nav>
  <div className="administrative-toolbar"><label><Search size={18}/><input type="search" aria-label="搜尋行政資料" placeholder="搜尋資料名稱、內容或備註" value={query} onChange={e=>setQuery(e.target.value)}/></label>
   <button className="shell-primary" disabled={loading||busy} onClick={newRow}><Plus size={16}/>新增資料</button><button className="shell-secondary" disabled={loading||busy||!visible.length} onClick={()=>setDrafts(old=>({...old,...Object.fromEntries(visible.map(r=>[r.id,{...r}]))}))}>編輯全部</button>
   <button className="shell-secondary" disabled={loading||busy} onClick={()=>file.current?.click()}><Upload size={16}/>匯入</button>{canExportData(store)&&<button className="shell-secondary" disabled={loading||busy||hasDrafts} onClick={()=>void exportRows()}><Download size={16}/>匯出</button>}
   <button className="shell-secondary" disabled={loading||busy} onClick={()=>{if(!dirty.current||window.confirm('重新讀取會放棄未儲存修改，確定繼續？')){setDrafts({});void load();}}}>重新讀取</button>
  </div><input ref={file} hidden type="file" accept=".xlsx,.xls,.csv" onChange={e=>{const f=e.target.files?.[0];if(f)void importFile(f);}}/><datalist id="administrative-categories">{categories.map(c=><option key={c} value={c}/>)}</datalist>
  {error&&<p role="alert" className="shell-note">{error}</p>}{notice&&<p role="status" className="shell-note">{notice}</p>}
  {hasDrafts&&<div className="administrative-save"><span>{Object.keys(drafts).length} 筆尚未儲存</span><button className="shell-primary" disabled={busy} onClick={()=>void save()}>{busy?'儲存中…':'儲存全部'}</button><button className="shell-secondary" disabled={busy} onClick={()=>cancel()}>取消全部</button></div>}
  <div className="administrative-table-wrap"><table><thead><tr><th>資料名稱</th><th>分類</th><th>內容摘要</th><th>附件／連結</th><th>備註</th><th>操作</th></tr></thead><tbody>{visible.map(r=><tr key={r.id} className={drafts[r.id]?'is-editing':''}><td>{field(r,'name','資料名稱')}</td><td>{field(r,'category','分類')}</td><td>{field(r,'summary','內容摘要')}</td><td>{field(r,'link','附件／連結')}</td><td>{field(r,'note','備註')}</td><td><div className="administrative-actions">{drafts[r.id]?<><button disabled={busy} onClick={()=>void save([r])}>儲存</button><button disabled={busy} onClick={()=>cancel(r.id)}>取消</button></>:<><button disabled={busy} onClick={()=>setDrafts(old=>({...old,[r.id]:{...r}}))}>編輯</button><button disabled={busy} onClick={()=>{if(window.confirm(r.archived?'恢復這筆行政資料？':'封存後可在「已封存」中查找與恢復，確定封存？'))void save([{...r,archived:!r.archived}]);}}>{r.archived?'恢復':'封存'}</button></>}</div></td></tr>)}</tbody></table></div>
  {!visible.length&&<p className="administrative-empty">{loading?'正在讀取行政資料…':error?'資料尚未讀取成功，請按重新讀取。':rows.length?'沒有符合條件的資料。':'尚無行政資料，可新增或匯入 Excel。'}</p>}
  <footer>共 {visible.length} 筆・資料可後補・附件可貼上原始文件連結</footer>
 </section>;
}
