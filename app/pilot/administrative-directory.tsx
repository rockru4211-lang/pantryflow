'use client';
import {DirectoryAttachments,useAttachmentCounts} from './directory-attachments';
import MobileEquipment from './mobile-equipment';
import {completedRepair,finishRepair,repairReported,repairCompletedDate} from '@/lib/mobile-repair';
import {canData,officeAccess} from '@/lib/data-access';
import {useCallback,useEffect,useRef,useState} from 'react';
import {Download,Plus,Search,Upload} from 'lucide-react';
import {supabase} from '@/lib/supabase-browser';
import {appError,canExportData,type AppStore} from '@/lib/app-workspace';
import {operationDeadline} from '@/lib/operation-deadline';
import {ADMIN_CATEGORIES,repairYear,equipmentContact,updateEquipmentContact,type EquipmentContact,administrativeSection,contractDue,contractReminderDate,prepareAdministrativeImport,safeAdministrativeLink,validateAdministrativeRows,type AdministrativeRow} from '@/lib/administrative-directory';
import type {Json} from '@/lib/database.types';
import './administrative-directory.css';
import './directory-lifecycle.css';
import {directoryState,lifecycleConfirmation,lifecycleLabels,type LifecycleOperation} from '@/lib/directory-lifecycle';
import {equipmentChoices,repairVendor,withRepairVendor,selectRepairEquipment} from '@/lib/equipment-selection';
import {DirectoryLifecycleMenu} from './directory-lifecycle-menu';

type Props={mobileMode?:boolean;section?:'equipment'|'contracts';onRepairs?:()=>void;store:AppStore;onSuppliers:()=>void;registerLeave?:(handler:(()=>Promise<boolean>)|null)=>void};
export default function AdministrativeDirectory({store,onSuppliers,registerLeave,section,onRepairs,mobileMode=false}:Props){
 const attachmentCounts=useAttachmentCounts(store.id,'document');
 const attachments=(r:AdministrativeRow,expanded=false)=><DirectoryAttachments key={`${store.id}:${r.id}:${expanded}`} storeId={store.id} kind="document" targetId={r.id} count={attachmentCounts[r.id]||0} editable={canEdit&&!r.is_removed} saved={rows.some(x=>x.id===r.id)} expanded={expanded} disabled={busy}/>;
 const canEdit=section==='equipment'?canData(store,'EQUIPMENT',true):officeAccess(store)&&store.access_mode!=='VIEW';
 const title=section==='equipment'?'設備維修':section==='contracts'?'合約管理':'行政資料';const defaultCategory=section==='equipment'?'設備資料':section==='contracts'?'合約文件':'其他';
 const [rows,setRows]=useState<AdministrativeRow[]>([]),[drafts,setDrafts]=useState<Record<string,AdministrativeRow>>({});
 const [query,setQuery]=useState(''),[category,setCategory]=useState('全部'),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [repairYearFilter,setRepairYearFilter]=useState(()=>new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Taipei'}).slice(0,4)),[focusId,setFocusId]=useState('');
 const directory=useRef<HTMLElement>(null);
 useEffect(()=>{if(!focusId)return;const row=directory.current?.querySelector<HTMLElement>(`[data-administrative-id="${focusId}"]`);row?.querySelector<HTMLInputElement|HTMLTextAreaElement>('textarea,input')?.focus({preventScroll:true});row?.scrollIntoView({block:'start',behavior:'auto'});},[focusId]);
 const lock=useRef(false),pending=useRef<{signature:string;id:string}|undefined>(undefined),file=useRef<HTMLInputElement>(null),dirty=useRef(false),alive=useRef(true);
 const leave=useRef(registerLeave);const hasDrafts=Object.keys(drafts).length>0;
 useEffect(()=>{leave.current=registerLeave;},[registerLeave]);
 useEffect(()=>{dirty.current=hasDrafts;},[hasDrafts]);
 const load=useCallback(async()=>{setLoading(true);setError('');try{
  const result=await operationDeadline(signal=>supabase.rpc('app_workspace',{p_store_id:store.id,p_section:section==='equipment'?'equipment':'administrative',p_filter:{}}).abortSignal(signal));
  if(result.error)throw result.error;
  const data=result.data as unknown as {rows:AdministrativeRow[]};if(!Array.isArray(data?.rows))throw Error('INVALID_RESPONSE');
  if(alive.current&&!dirty.current&&!lock.current)setRows(data.rows);
 }catch(e){if(alive.current)setError(appError(e));}finally{if(alive.current)setLoading(false);}},[store.id,section]);
 useEffect(()=>{alive.current=true;queueMicrotask(()=>void load());const check=async()=>mobileMode&&lock.current?false:!dirty.current||window.confirm(mobileMode?'維修回報尚未送出，確定離開並放棄？':'仍有尚未儲存的行政資料，確定離開並放棄修改？');leave.current?.(check);
  const before=(e:BeforeUnloadEvent)=>{if(dirty.current){e.preventDefault();e.returnValue='';}};
  const focus=()=>{if(!dirty.current&&!lock.current)void load();};window.addEventListener('beforeunload',before);window.addEventListener('focus',focus);
  return()=>{alive.current=false;leave.current?.(null);window.removeEventListener('beforeunload',before);window.removeEventListener('focus',focus);};},[load,mobileMode]);
 const all=[...Object.values(drafts).filter(r=>!rows.some(x=>x.id===r.id)).reverse(),...rows.map(r=>drafts[r.id]||r)];
 const choices=equipmentChoices(rows);
 const categories=[...new Set([...ADMIN_CATEGORIES,...all.map(r=>r.category).filter(Boolean)])];
 const repairs=section==='equipment'&&category==='維修紀錄';
 const repairYears=[...new Set([new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Taipei'}).slice(0,4),...all.filter(r=>r.category==='維修紀錄'&&directoryState(r)==='使用中').map(repairYear).filter(y=>y!=='undated')])].sort().reverse();
 const equipmentList=section==='equipment'&&!repairs&&category!=='其他既有資料';
 const dueCount=rows.filter(r=>contractDue(r)).length;
 const matchesSection=(r:AdministrativeRow)=>{
  if(drafts[r.id])return true;
  const state=directoryState(r);
  if(category==='已停用'||category==='已移除')return state===category&&(!section||administrativeSection(r.category)===section);
  if(state!=='使用中')return false;
  if(!section)return category==='全部'||r.category===category;
  if(category==='即將到期')return contractDue(r);
  if(category==='維修紀錄')return r.category==='維修紀錄';
  if(category==='其他既有資料')return !administrativeSection(r.category);
  return administrativeSection(r.category)===section&&(section!=='equipment'||r.category!=='維修紀錄');
 };
 const visible=all.filter(r=>matchesSection(r)&&(!repairs||!!drafts[r.id]||repairYearFilter==='all'||repairYear(r)===repairYearFilter)&&`${r.name} ${r.category} ${r.summary} ${r.repair_reason||''} ${r.repair_result||''} ${r.contract_end||''} ${r.note} ${r.link}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
 if(repairs)visible.sort((a,b)=>{const newA=!!drafts[a.id]&&!rows.some(r=>r.id===a.id),newB=!!drafts[b.id]&&!rows.some(r=>r.id===b.id);return Number(newB)-Number(newA)||(newA&&newB?0:(b.repair_date||'').localeCompare(a.repair_date||''));});
 const edit=(row:AdministrativeRow,key:keyof AdministrativeRow,value:string)=>setDrafts(old=>({...old,[row.id]:{...row,[key]:value}}));
 const lifecyclePending=useRef<{signature:string;id:string}|undefined>(undefined);
 async function changeLifecycle(row:AdministrativeRow,operation:LifecycleOperation){
  if(lock.current||hasDrafts||!canEdit||!window.confirm(lifecycleConfirmation(row.name,operation)))return;
  const payload={kind:administrativeSection(row.category)==='equipment'?'equipment':'contract',id:row.id,operation,revision:row.revision};const signature=JSON.stringify(payload);
  if(lifecyclePending.current?.signature!==signature)lifecyclePending.current={signature,id:crypto.randomUUID()};
  lock.current=true;setBusy(true);setError('');setNotice('');
  try{const result=await operationDeadline(signal=>supabase.rpc('app_operation',{p_store_id:store.id,p_action:'directory.lifecycle',p_data:payload,p_request_id:lifecyclePending.current!.id}).abortSignal(signal));if(result.error)throw result.error;
   lifecyclePending.current=undefined;setRows(old=>operation==='delete'?old.filter(r=>r.id!==row.id):old.map(r=>r.id===row.id?{...r,is_removed:operation==='remove',archived:operation!=='activate',revision:r.revision+1}:r));setNotice(`已${lifecycleLabels[operation]}「${row.name}」。`);lock.current=false;await load();
  }catch(e){setError(appError(e));}finally{lock.current=false;setBusy(false);}
 }
 const cancel=(id?:string)=>{if(!window.confirm('放棄尚未儲存的修改？'))return;setDrafts(old=>{if(!id)return {};const next={...old};delete next[id];return next;});setError('');};
 async function save(target=Object.values(drafts)){
  if(lock.current||!target.length||!canEdit)return;const problem=validateAdministrativeRows(target);if(problem){setError(problem);return;}
  lock.current=true;setBusy(true);setError('');setNotice('');const payload={rows:target.map(row=>{if(officeAccess(store))return row;const safe={...row};delete safe.contract_start;delete safe.contract_end;return safe;})};const signature=JSON.stringify(payload);
  if(pending.current?.signature!==signature)pending.current={signature,id:crypto.randomUUID()};
  try{const result=await operationDeadline(signal=>supabase.rpc('app_operation',{p_store_id:store.id,p_action:'administrative.save',p_data:payload as unknown as Json,p_request_id:pending.current!.id}).abortSignal(signal));if(result.error)throw result.error;
   const saved=(result.data as unknown as {rows:AdministrativeRow[]}).rows;if(!Array.isArray(saved))throw Error('INVALID_RESPONSE');
   setRows(old=>[...old.filter(r=>!saved.some(s=>s.id===r.id)),...saved]);setDrafts(old=>{const next={...old};target.forEach(r=>delete next[r.id]);return next;});pending.current=undefined;if(repairs&&saved.length===1&&saved[0].category==='維修紀錄')setRepairYearFilter(repairYear(saved[0]));setNotice(mobileMode?'已回報維修完成，後勤可查看紀錄。':`已儲存 ${saved.length} 筆。`);
  }catch(e){setError(appError(e));}finally{lock.current=false;setBusy(false);}
 }
 async function completeRepair(row:AdministrativeRow){
  if(busy||!canEdit||row.is_removed||repairReported(row))return;
  if(!row.repair_result?.trim()){setDrafts(old=>({...old,[row.id]:{...row}}));setFocusId(row.id);setNotice('請填寫處理結果，再按「完成維修」。');return;}
  if(window.confirm(`確認「${row.name}」已完成維修？將儲存處理結果與完成日期。`))await save([finishRepair(row)]);
 }
 const newRow=()=>{const row:AdministrativeRow={id:crypto.randomUUID(),name:'',category:repairs?'維修紀錄':section?defaultCategory:category==='全部'||category==='已停用'||category==='已移除'?'其他':category,summary:'',link:'',note:'',contract_start:null,contract_end:null,repair_date:repairs?new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Taipei'}):null,repair_reason:'',repair_result:'',archived:false,revision:0};dirty.current=true;setDrafts(old=>({...old,[row.id]:row}));setFocusId(row.id);setError('');setNotice('');if(!repairs)setCategory('全部');setQuery('');};
 async function exportRows(){try{const XLSX=await import('xlsx');const data=visible.map(r=>({'資料名稱':r.name,'分類':r.category,'合約起日':r.contract_start||'','合約到期日':r.contract_end||'','維修日期':r.repair_date||'','維修廠商':repairVendor(r.summary),'維修原因':r.repair_reason||'','處理結果':r.repair_result||'','內容摘要':r.summary,...(section==='equipment'&&r.category!=='維修紀錄'?{'服務事項':equipmentContact(r.summary).service,'聯絡人':equipmentContact(r.summary).contact,'電話':equipmentContact(r.summary).phone,'聯絡方式':equipmentContact(r.summary).method,'補充說明':equipmentContact(r.summary).details}:{}),'附件／連結':r.link,'備註':r.note,'狀態':directoryState(r)}));const book=XLSX.utils.book_new();const sheet=XLSX.utils.json_to_sheet(data.length?data:[{'資料名稱':'','分類':'','合約起日':'','合約到期日':'','維修日期':'','維修原因':'','處理結果':'','內容摘要':'','附件／連結':'','備註':'','狀態':''}]);sheet['!cols']=[24,16,14,14,14,30,30,35,45,30,12].map(wch=>({wch}));XLSX.utils.book_append_sheet(book,sheet,title);XLSX.writeFile(book,`${store.name}-${title}${repairs?`-${repairYearFilter==='all'?'全部年份':repairYearFilter==='undated'?'日期未填':repairYearFilter+'年'}`:''}.xlsx`);}catch(e){setError(appError(e));}}
 async function importFile(selected:File){if(lock.current)return;lock.current=true;setBusy(true);setError('');try{
  if(selected.size>10*1024*1024)throw Error('請使用 10 MB 以下的 Excel 檔案。');
  const XLSX=await import('xlsx');const book=XLSX.read(await selected.arrayBuffer(),{type:'array',dateNF:'yyyy-mm-dd'});const values=book.SheetNames.flatMap(name=>XLSX.utils.sheet_to_json<Record<string,unknown>>(book.Sheets[name],{defval:'',raw:false}));
  if(!values.some(v=>Object.hasOwn(v,'資料名稱')))throw Error('請使用含「資料名稱」欄位的表格，可先匯出取得格式。');
  const result=prepareAdministrativeImport(values,all,()=>crypto.randomUUID());if(section){for(const row of result.rows){if(!row.category.trim())row.category=repairs?'維修紀錄':defaultCategory;}}const problem=validateAdministrativeRows([...Object.values(drafts),...result.rows]);if(problem)throw Error(problem);
  setDrafts(old=>({...old,...Object.fromEntries(result.rows.map(r=>[r.id,r]))}));if(!repairs)setCategory('全部');setQuery('');setNotice(`已帶入 ${result.rows.length} 筆供確認，略過 ${result.skipped} 筆空白或重複名稱（含已封存）。按「儲存全部」後才會建檔。`);
 }catch(e){setError(e instanceof Error?e.message:appError(e));}finally{lock.current=false;setBusy(false);if(file.current)file.current.value='';}}
 const equipmentName=(r:AdministrativeRow)=><input aria-label={r.category==='維修紀錄'?'設備名稱':'廠商／設備名稱'} list={r.category==='維修紀錄'?'equipment-name-options':'equipment-directory-options'} placeholder="輸入關鍵字快選，也可直接填寫" value={r.name} maxLength={160} disabled={busy||!canEdit} onChange={e=>setDrafts(old=>{const current=old[r.id]||r;return {...old,[r.id]:r.category==='維修紀錄'?selectRepairEquipment(current,e.target.value,rows):{...current,name:e.target.value}};})} onBlur={()=>{if(r.category==='維修紀錄')setDrafts(old=>{const current=old[r.id]||r;return {...old,[r.id]:selectRepairEquipment(current,current.name,rows)};});}}/>;
 const vendorField=(r:AdministrativeRow)=><input aria-label="維修廠商" list="equipment-vendor-options" placeholder="搜尋既有廠商或直接填寫，可後補" value={repairVendor(r.summary)} maxLength={160} disabled={busy||!canEdit} onChange={e=>setDrafts(old=>{const current=old[r.id]||r;return {...old,[r.id]:{...current,summary:withRepairVendor(current.summary,e.target.value)}};})}/>;
 const field=(r:AdministrativeRow,key:'name'|'category'|'summary'|'link'|'note'|'contract_start'|'contract_end'|'repair_date'|'repair_reason'|'repair_result',label:string)=>drafts[r.id]?(!!section&&['name','summary','note','link','repair_reason','repair_result'].includes(key)?<textarea aria-label={`${r.name||'新增資料'} ${label}`} rows={['summary','note','repair_reason','repair_result'].includes(key)?section==='contracts'?8:6:2} value={r[key]||''} onChange={e=>edit(r,key,e.target.value)} disabled={busy||!canEdit} maxLength={key==='name'?160:key==='link'?2000:8000}/>:<input aria-label={`${r.name||'新增資料'} ${label}`} list={key==='category'?'administrative-categories':undefined} type={['contract_start','contract_end','repair_date'].includes(key)?'date':'text'} value={r[key]||''} onChange={e=>edit(r,key,e.target.value)} disabled={busy||!canEdit} maxLength={key==='name'?160:key==='category'?80:key==='link'?2000:8000}/>):key==='link'?(safeAdministrativeLink(r.link)?<a href={safeAdministrativeLink(r.link)!} target="_blank" rel="noopener noreferrer">{section==='equipment'?'開啟原始表格':'開啟附件／連結'}</a>:r.link||'—'):r[key]||'—';
 const contactField=(r:AdministrativeRow,key:keyof EquipmentContact,label:string)=><textarea aria-label={`${r.name||'新增資料'} ${label}`} rows={key==='service'||key==='details'?4:2} value={equipmentContact(r.summary)[key]} onChange={e=>setDrafts(old=>{const current=old[r.id]||r;return {...old,[r.id]:{...current,summary:updateEquipmentContact(current.summary,key,e.target.value)}};})} disabled={busy||!canEdit} maxLength={8000}/>;
 if(mobileMode&&section==='equipment')return <MobileEquipment attachments={attachments} rows={rows} draft={Object.values(drafts)[0]} loading={loading} busy={busy} canEdit={canEdit} error={error} notice={notice}
  onNew={()=>{const row:AdministrativeRow={id:crypto.randomUUID(),name:'',category:'維修紀錄',summary:'',link:'',note:'',repair_date:new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Taipei'}),repair_reason:'',repair_result:'',archived:false,revision:0};dirty.current=true;setDrafts({[row.id]:row});setError('');setNotice('');}}
  onEdit={row=>{dirty.current=true;setDrafts({[row.id]:{...row,repair_date:new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Taipei'})}});setError('');setNotice('');}}
  onChange={edit} onSave={row=>{if(!row.repair_reason?.trim()){setError('請簡述原因與處理方式；原因不明可填寫待確認。');return;}void save([completedRepair(row)]);}}
  onCancel={()=>cancel()} onReload={()=>void load()}/>;
 return <section ref={directory} className="administrative-directory"><header className="administrative-heading"><h1>{title}</h1>{section==='contracts'&&<small className="contract-reminder-caption">到期前 3 個月自動通知</small>}<div>{onRepairs&&<button className="shell-secondary" onClick={onRepairs}>報修紀錄</button>}{!section&&canData(store,'SUPPLIERS')&&<button className="shell-secondary" onClick={onSuppliers}>供應商聯絡資料</button>}</div></header>
  <nav className="administrative-tabs" aria-label="行政資料分類">{(section?['全部',...(section==='equipment'?['維修紀錄']:['即將到期']),'已停用','已移除',...(all.some(r=>!administrativeSection(r.category))?['其他既有資料']:[])]:['全部',...categories,'已停用','已移除']).map(c=><button key={c} aria-pressed={category===c} onClick={()=>setCategory(c)}>{section&&c==='全部'?'使用中':c==='即將到期'?`即將到期 ${dueCount}`:c}</button>)}</nav>
  <div className="administrative-toolbar">{repairs&&<select className="repair-year-filter" aria-label="維修年份" value={repairYearFilter} onChange={e=>setRepairYearFilter(e.target.value)}>{repairYears.map(year=><option key={year} value={year}>{year} 年</option>)}<option value="all">全部年份</option><option value="undated">日期未填</option></select>}<label><Search size={18}/><input type="search" aria-label="搜尋行政資料" placeholder={repairs?'搜尋設備名稱、維修原因或處理結果':section==='equipment'?'搜尋服務事項、廠商、聯絡人或電話':'搜尋資料名稱、內容或備註'} value={query} onChange={e=>setQuery(e.target.value)}/></label>
   <button className="shell-primary" disabled={loading||busy||!canEdit} onClick={newRow}><Plus size={16}/>{repairs?'新增紀錄':'新增'}</button><button className="shell-secondary" disabled={loading||busy||!visible.some(r=>!r.is_removed)||!canEdit} onClick={()=>setDrafts(old=>({...old,...Object.fromEntries(visible.filter(r=>!r.is_removed).map(r=>[r.id,{...r}]))}))}>編輯全部</button>
   <button className="shell-secondary" disabled={loading||busy||!canEdit} onClick={()=>file.current?.click()}><Upload size={16}/>匯入</button>{officeAccess(store)&&canExportData(store)&&<button className="shell-secondary" disabled={loading||busy||hasDrafts} onClick={()=>void exportRows()}><Download size={16}/>匯出</button>}
   <details className="administrative-more"><summary>更多</summary><div><button className="shell-secondary" disabled={loading||busy||!canEdit} onClick={()=>{if(!dirty.current||window.confirm('重新讀取會放棄未儲存修改，確定繼續？')){setDrafts({});void load();}}}>重新讀取</button></div></details>
  </div><input ref={file} hidden type="file" accept=".xlsx,.xls,.csv" onChange={e=>{const f=e.target.files?.[0];if(f)void importFile(f);}}/><datalist id="administrative-categories">{categories.map(c=><option key={c} value={c}/>)}</datalist>
  <datalist id="equipment-name-options">{choices.names.map(v=><option key={v} value={v}/>)}</datalist><datalist id="equipment-vendor-options">{choices.vendors.map(v=><option key={v} value={v}/>)}</datalist><datalist id="equipment-directory-options">{choices.directoryNames.map(v=><option key={v} value={v}/>)}</datalist>
  {error&&<p role="alert" className="shell-note">{error}</p>}{notice&&<p role="status" className="shell-note">{notice}</p>}
  {hasDrafts&&<div className="administrative-save"><span>{Object.keys(drafts).length} 筆尚未儲存</span><button className="shell-primary" disabled={busy||!canEdit} onClick={()=>void save()}>{busy?'儲存中…':'儲存全部'}</button><button className="shell-secondary" disabled={busy||!canEdit} onClick={()=>cancel()}>取消全部</button></div>}
  <div className={`administrative-table-wrap${equipmentList?' equipment-contact-table':''}`}><table><thead><tr>{(repairs?['維修日期','設備名稱','維修原因','處理結果','附件／連結','操作']:equipmentList?['服務事項','廠商／設備名稱','聯絡人','聯絡方式','原始表格／備註','操作']:section==='contracts'?['合約名稱','分類','合約期間','附件／連結','備註','操作']:['設備名稱','分類','內容摘要','附件／連結','備註','操作']).map(label=><th key={label}>{label}</th>)}</tr></thead><tbody>{visible.map(r=><tr key={r.id} data-administrative-id={r.id} className={drafts[r.id]?'is-editing':''}>
   {section==='equipment'&&drafts[r.id]?<td colSpan={6}><div className="equipment-expanded-editor">
    <div className="contract-editor-heading"><strong>{r.category==='維修紀錄'?'編輯維修紀錄':'編輯廠商／設備'} · {r.name||'新增資料'}</strong><div>{r.category==='維修紀錄'&&!repairReported(r)&&<button className="shell-primary" disabled={busy||!canEdit} onClick={()=>void completeRepair(r)}>完成維修</button>}<button className="shell-primary" disabled={busy||!canEdit} onClick={()=>void save([r])}>{busy?'儲存中…':'儲存'}</button><button className="shell-secondary" disabled={busy||!canEdit} onClick={()=>cancel(r.id)}>取消</button></div></div>
    <div className="equipment-editor-grid">
     <label>{r.category==='維修紀錄'?'設備名稱':'廠商／設備名稱'}{equipmentName(r)}</label><label>分類{field(r,'category','分類')}</label>
     {r.category==='維修紀錄'?<><label>維修廠商{vendorField(r)}</label><label>維修日期{field(r,'repair_date','維修日期')}</label><label className="equipment-editor-wide">維修原因{field(r,'repair_reason','維修原因')}</label><label className="equipment-editor-wide">處理結果{field(r,'repair_result','處理結果')}</label></>:<><label className="equipment-editor-wide">服務事項{contactField(r,'service','服務事項')}</label><label>聯絡人{contactField(r,'contact','聯絡人')}</label><label>電話{contactField(r,'phone','電話')}</label><label className="equipment-editor-wide">其他聯絡方式（LINE／群組等）{contactField(r,'method','其他聯絡方式')}</label></>}
     <label className="equipment-editor-wide">原始表格／附件連結{field(r,'link','原始表格／附件連結')}</label>
     <label className="equipment-editor-wide">備註{field(r,'note','備註')}</label><div className="equipment-editor-wide">附件{attachments(r,true)}</div>
     {r.category!=='維修紀錄'&&equipmentContact(r.summary).details&&<label className="equipment-editor-wide">補充說明{contactField(r,'details','補充說明')}</label>}
    </div>
   </div></td>:section==='contracts'&&drafts[r.id]?<td colSpan={6}><div className="contract-expanded-editor">
    <div className="contract-editor-heading"><strong>編輯合約</strong><div><button className="shell-primary" disabled={busy||!canEdit} onClick={()=>void save([r])}>{busy?'儲存中…':'儲存'}</button><button className="shell-secondary" disabled={busy||!canEdit} onClick={()=>cancel(r.id)}>取消</button></div></div>
    <div className="contract-editor-grid">
     <label className="contract-editor-name">合約名稱{field(r,'name','合約名稱')}</label>
     <label>分類{field(r,'category','分類')}</label>
     <label>合約起日{field(r,'contract_start','合約起日')}</label>
     <label>合約到期日{field(r,'contract_end','合約到期日')}</label>
     <label className="contract-editor-summary">內容摘要{field(r,'summary','內容摘要')}</label>
     <label className="contract-editor-note">備註{field(r,'note','備註')}</label>
     <label className="contract-editor-link">附件／連結{field(r,'link','附件／連結')}</label><div className="contract-editor-link">上傳附件{attachments(r,true)}</div>
    </div>
   </div></td>:<>{equipmentList?<><td>{equipmentContact(r.summary).service||(r.category==='維修紀錄'?r.repair_reason:'')||'—'}</td><td>{r.name}{r.category==='維修紀錄'&&<small className="equipment-detail">{r.repair_date||'日期未填'} · 維修紀錄</small>}</td><td>{equipmentContact(r.summary).contact||'—'}</td><td><div className="equipment-contact-method">{equipmentContact(r.summary).phone&&<div>{equipmentContact(r.summary).phone}</div>}{equipmentContact(r.summary).method&&<div>{equipmentContact(r.summary).method}</div>}{!equipmentContact(r.summary).phone&&!equipmentContact(r.summary).method&&'—'}</div></td><td>{attachments(r)}{r.link&&<div>{field(r,'link','原始表格／附件連結')}</div>}{r.note&&<div className="equipment-detail">{r.note}</div>}{equipmentContact(r.summary).details&&<div className="equipment-detail">{equipmentContact(r.summary).details}</div>}{r.category==='維修紀錄'&&<div className="equipment-detail">{r.repair_result}</div>}{!r.link&&!r.note&&!r.summary&&'—'}</td></>:repairs?<><td>{field(r,'repair_date','維修日期')}</td><td>{field(r,'name','設備名稱')}{repairReported(r)&&<small className="equipment-detail">已完成維修{repairCompletedDate(r)?` · ${repairCompletedDate(r)}`:''}</small>}{repairVendor(r.summary)&&<small className="equipment-detail">維修廠商：{repairVendor(r.summary)}</small>}</td><td>{field(r,'repair_reason','維修原因')}</td><td>{field(r,'repair_result','處理結果')}</td><td>{field(r,'link','附件／連結')}{attachments(r)}</td></>:<><td>{field(r,'name','資料名稱')}{contractDue(r)&&<small className="contract-due-badge">{r.contract_end!<new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Taipei'})?'已到期':'即將到期'}</small>}</td><td>{field(r,'category','分類')}</td><td>{section==='contracts'?<><div className="contract-period">{field(r,'contract_start','合約起日')}<span>～</span>{field(r,'contract_end','合約到期日')}</div>{r.contract_end&&<small className="contract-reminder-date">{r.notified_at?`${new Date(r.notified_at).toLocaleDateString('zh-TW',{timeZone:'Asia/Taipei'})} 已通知`:`${contractReminderDate(r.contract_end)} 提醒`}</small>}{(r.summary||drafts[r.id])&&<div>{field(r,'summary','內容摘要')}</div>}</>:r.category==='維修紀錄'?<>{field(r,'repair_date','維修日期')}<br/>{field(r,'repair_reason','維修原因')}<br/>{field(r,'repair_result','處理結果')}</>:field(r,'summary','內容摘要')}</td><td>{field(r,'link','附件／連結')}{attachments(r)}</td><td>{field(r,'note','備註')}</td></>}
   <td><div className="administrative-actions">{drafts[r.id]?<><button disabled={busy||!canEdit} onClick={()=>void save([r])}>儲存</button><button disabled={busy||!canEdit} onClick={()=>cancel(r.id)}>取消</button></>:<>{r.category==='維修紀錄'&&!r.is_removed&&!repairReported(r)&&<button disabled={busy||hasDrafts||!canEdit} onClick={()=>void completeRepair(r)}>完成維修</button>}{!r.is_removed&&<button disabled={busy||!canEdit} onClick={()=>setDrafts(old=>({...old,[r.id]:{...r}}))}>編輯</button>}{administrativeSection(r.category)?<DirectoryLifecycleMenu row={r} disabled={busy||hasDrafts||!canEdit} canDelete={officeAccess(store)} onAction={action=>void changeLifecycle(r,action)}/>:<button disabled={busy||!canEdit} onClick={()=>void save([{...r,archived:!r.archived}])}>{r.archived?'恢復使用':'停用'}</button>}</>}</div></td></>}</tr>)}</tbody></table></div>
  {!visible.length&&<p className="administrative-empty">{loading?'正在讀取行政資料…':error?'資料尚未讀取成功，請按重新讀取。':rows.length?'沒有符合條件的資料。':'尚無行政資料，可新增或匯入 Excel。'}</p>}
  <footer>共 {visible.length} 筆・資料可後補・附件可貼上原始文件連結</footer>
 </section>;
}
