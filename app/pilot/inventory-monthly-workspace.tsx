'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {Download,RefreshCw,Search,Warehouse,CheckCircle2,ChevronDown,X} from 'lucide-react';
import {supabase} from '@/lib/supabase-browser';
import {canExportData,type AppStore} from '@/lib/app-workspace';
import type {Json} from '@/lib/database.types';
import {comparisonLabel,filterInventory,inventoryCategories,inventoryError,inventoryExportRows,inventoryMoney,inventoryNumber,reviewLabel,taipeiMonth,type InventoryMonth,type InventoryRow} from '@/lib/inventory-monthly';
import './inventory-monthly.css';

type Tab='total'|'review'|'amount';
type Editor={key:string;price:string;note:string;acknowledged:boolean;dirty:boolean};
type Props={store:AppStore;stores:AppStore[];onStoreChange:(id:string)=>void;registerLeave?:(handler:(()=>Promise<boolean>)|null)=>void};
const dateLabel=(value:string|null|undefined)=>value?new Date(value).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false}):'—';
export default function InventoryMonthlyWorkspace({store,stores,onStoreChange,registerLeave}:Props) {
 const [month,setMonth]=useState(taipeiMonth),[source,setSource]=useState(''),[tab,setTab]=useState<Tab>('total');
 const [data,setData]=useState<InventoryMonth|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
 const [search,setSearch]=useState(''),[zone,setZone]=useState(''),[pending,setPending]=useState(false),[page,setPage]=useState(1);
 const [editor,setEditor]=useState<Editor|null>(null),[expanded,setExpanded]=useState<string|null>(null),[lastRead,setLastRead]=useState('');
 const request=useRef(0),working=useRef(false),editorRef=useRef(editor),leaveRef=useRef(registerLeave);
 useEffect(()=>{editorRef.current=editor;leaveRef.current=registerLeave;},[editor,registerLeave]);
 const askLeave=useCallback(async()=>!working.current&&(!editorRef.current?.dirty||window.confirm('核對內容尚未儲存，確定離開？')),[]);
 useEffect(()=>{leaveRef.current?.(askLeave);const unload=(event:BeforeUnloadEvent)=>{if(editorRef.current?.dirty||working.current){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',unload);return()=>{leaveRef.current?.(null);window.removeEventListener('beforeunload',unload);};},[askLeave]);
 const fetchMonth=useCallback(async(action='read',payload:Record<string,Json|undefined>={})=>{
  const {data:result,error:failure}=await supabase.rpc('baihuayuan_inventory_month',{p_store_id:store.id,p_month:`${month}-01`,p_action:action,p_data:{...(source?{session_id:source}:{}),...payload}});
  if(failure)throw failure;return result as unknown as InventoryMonth;
 },[store.id,month,source]);
 const read=useCallback(async(quiet=false)=>{
  if(working.current||quiet&&(document.visibilityState!=='visible'||editorRef.current))return;
  const sequence=++request.current;
  try{const next=await fetchMonth();if(sequence!==request.current)return;setData(next);setError('');setLastRead(dateLabel(new Date().toISOString()));}
  catch(e){if(sequence===request.current)setError(inventoryError(e));}
  finally{if(sequence===request.current)setLoading(false);}
 },[fetchMonth]);
 useEffect(()=>{const requests=request;const initial=setTimeout(()=>void read(),0);const timer=setInterval(()=>void read(true),5000);const refresh=()=>void read(true);window.addEventListener('focus',refresh);window.addEventListener('online',refresh);document.addEventListener('visibilitychange',refresh);return()=>{requests.current++;clearTimeout(initial);clearInterval(timer);window.removeEventListener('focus',refresh);window.removeEventListener('online',refresh);document.removeEventListener('visibilitychange',refresh);};},[read]);
 const visible=data?.store_id===store.id&&data.month===`${month}-01`?data:null;
 async function switchMonth(value:string){if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)||value<'2000-01'||value>'2100-12'||!await askLeave())return;editorRef.current=null;setEditor(null);setLoading(true);setData(null);setSource('');setMonth(value);setPage(1);setExpanded(null);}
 async function switchSource(value:string){if(!await askLeave())return;editorRef.current=null;setEditor(null);setLoading(true);setData(null);setSource(value);setPage(1);setExpanded(null);}
 function edit(row:InventoryRow){request.current++;setLoading(false);const next={key:row.row_key,price:row.unit_price==null?'':String(row.unit_price),note:row.review_note,acknowledged:row.acknowledged,dirty:false};editorRef.current=next;setEditor(next);setError('');}
 function updateEditor(patch:Partial<Editor>){setEditor(old=>{const next=old?{...old,...patch,dirty:true}:null;editorRef.current=next;return next;});}
 async function closeEditor(){if(await askLeave()){editorRef.current=null;setEditor(null);setError('');}}
 async function reloadEditor(){if(working.current||!visible)return;setLoading(true);const sequence=++request.current;try{const next=await fetchMonth('read',{session_id:visible.source_id});if(sequence!==request.current)return;setData(next);setError(next.closed?'此月份已由其他人確認，請查看封存結果。':'已讀取最新資料，保留您的輸入；請重新核對後再儲存。');updateEditor({acknowledged:false});}catch(e){if(sequence===request.current)setError(inventoryError(e));}finally{if(sequence===request.current)setLoading(false);}}
 async function saveReview(){if(!editor||!visible||working.current||loading||visible.closed)return;
  const price=editor.price.trim()===''?null:Number(editor.price);if(price!==null&&(!Number.isFinite(price)||price<0||price>=1e9)){setError(inventoryError({message:'INVALID_INVENTORY_PRICE'}));return;}
  working.current=true;request.current++;setBusy(true);setError('');
  try{const next=await fetchMonth('review',{session_id:visible.source_id,revision:visible.revision,row_key:editor.key,unit_price:price,acknowledged:editor.acknowledged,note:editor.note});setData(next);editorRef.current=null;setEditor(null);}
  catch(e){setError(inventoryError(e));}finally{working.current=false;setBusy(false);}
 }
 async function confirmMonth(){if(!visible||working.current||loading||editor)return;
  if(!window.confirm(`確認 ${store.name} ${month} 盤點？\n將保存這份盤點範圍的數量、單價與核對備註；確認後無法在此修改。`))return;
  working.current=true;request.current++;setBusy(true);setError('');try{setData(await fetchMonth('close',{session_id:visible.source_id,revision:visible.revision}));}catch(e){setError(inventoryError(e));}finally{working.current=false;setBusy(false);}
 }
 async function exportExcel(){if(working.current||!visible||editor)return;working.current=true;request.current++;setBusy(true);setError('');try{
  const snapshot=await fetchMonth('export',{session_id:visible.source_id});setData(snapshot);
  const XLSX=await import('xlsx');const workbook=XLSX.utils.book_new();
  const sheet=XLSX.utils.json_to_sheet(inventoryExportRows(snapshot.rows));sheet['!cols']=[{wch:36},{wch:18},{wch:12},{wch:24},...Array.from({length:6},()=>({wch:14})),{wch:18},{wch:40},{wch:14}];
  XLSX.utils.book_append_sheet(workbook,sheet,'庫存總表');
  XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([
   ['門市',store.name],['月份',month],['資料狀態',snapshot.closed?'已確認':'尚未確認'],['盤點來源',snapshot.source_id||'無'],['盤點完成時間',dateLabel(snapshot.completed_at)],
   ['比較月份',snapshot.previous_month],['上月盤點來源',snapshot.previous_source_id||'無'],['上月已確認',snapshot.previous_closed?'是':'否'],
   ['本月已計價金額',snapshot.summary.subtotal??'未提供'],['缺單價項目',snapshot.summary.missing_prices],['上月缺單價項目',snapshot.summary.previous_missing_prices],
   ['範圍說明','以所選已完成盤點的品項為準；未提供資料不視為 0。儲物區篩選不會拆分合計數量。'],['單價來源','盤點時保存單價；行政補價僅適用本月報表。'],
  ]),'資料說明');
  XLSX.utils.book_append_sheet(workbook,XLSX.utils.json_to_sheet(snapshot.rows.flatMap(r=>r.zones.map(z=>({'品項':r.name,'單位':r.unit,'資料月份':r.current_quantity===null?snapshot.previous_month:snapshot.month,'儲物區':z.zone,'原始數量':z.quantity,'盤點人員':z.entered_by,'盤點時間':dateLabel(z.entered_at),'現場備註':z.note||'','合計已更正':r.corrected?'是，請以總表為準':'否'})))),'儲物區原始明細');
  XLSX.writeFile(workbook,`${store.name}-庫存總表-${month}.xlsx`);
 }catch(e){setError(inventoryError(e));}finally{working.current=false;setBusy(false);}}
 const rows=visible?.rows||[];const filtered=filterInventory(rows,{search,zone,pending:pending||tab==='review'}),pages=Math.max(1,Math.ceil(filtered.length/20)),currentPage=Math.min(page,pages),pageRows=filtered.slice((currentPage-1)*20,currentPage*20);
 const zones=[...new Map(rows.flatMap(r=>r.zones.map(z=>[z.zone_id,z.zone] as const))).entries()].sort((a,b)=>a[1].localeCompare(b[1],'zh-TW'));
 const editRow=editor?rows.find(r=>r.row_key===editor.key):undefined;
 const summary=visible?.summary,partial=!!summary&&(summary.missing_prices>0||summary.previous_missing_prices>0);
 const canClose=!!visible?.source_id&&visible.source_complete&&!!summary?.items&&!summary.pending&&!visible.closed&&!busy&&!loading&&!editor;
 return <section className="inventory-monthly" aria-label="庫存管理">
  <header className="im-heading"><div><span className="im-eyebrow">行政／後勤</span><h1><Warehouse size={27}/>庫存管理</h1><p>查看盤點後明細、上月差異與庫存金額</p></div><div className="im-heading-actions"><button disabled={busy||loading||!!editor} onClick={()=>{setLoading(true);void read();}}><RefreshCw size={16}/>重新整理</button>{canExportData(store)&&<button disabled={!visible?.source_id||busy||loading||!!editor} onClick={()=>void exportExcel()}><Download size={16}/>匯出總表</button>}</div></header>
  <div className="im-selectors"><label>門市<select value={store.id} disabled={busy} onChange={e=>onStoreChange(e.target.value)}>{stores.filter(s=>['LOGISTICS','OWNER'].includes(s.role)&&s.is_active!==false).map(s=><option value={s.id} key={s.id}>{s.name}</option>)}</select></label><label>盤點月份<input type="month" min="2000-01" max="2100-12" value={month} disabled={busy} onChange={e=>void switchMonth(e.target.value)}/></label><span className={`im-badge ${visible?.closed?'done':''}`}>{visible?.closed?'本月已確認':'本月待確認'}</span><small>{editor?'核對中，保留您的輸入':lastRead?`每 5 秒同步・${lastRead}`:'讀取資料中'}</small></div>
  <div className="im-cards"><article><span>本月庫存金額</span><strong>{inventoryMoney(summary?.subtotal)}</strong><small>{summary?.missing_prices?`已計價小計・${summary.missing_prices} 項缺單價未計入`:`${summary?.items??0} 個品項／單位・依所選盤點範圍`}</small></article><article><span>較上月金額增減</span><strong>{inventoryMoney(summary?.amount_difference,true)}</strong><small>{!visible?.has_previous?'無上月資料，暫不比較':partial?'部分品項未計價，僅比較已計價金額':`對照 ${visible.previous_month.slice(0,7)}${visible.previous_closed?' 已確認資料':' 未確認盤點'}`}</small></article><article className="im-review-card"><span>待核對項目</span><strong>{summary?.pending??'—'} <small>項</small></strong><button onClick={()=>{setTab('review');setPage(1);}}>查看需要核對的項目 →</button></article></div>
  <div className="im-tabs" role="tablist" aria-label="庫存管理分頁">{([['total','總表'],['review','差異核對'],['amount','庫存金額']] as const).map(([id,label])=><button key={id} role="tab" aria-selected={tab===id} aria-controls={`im-panel-${tab}`} onClick={()=>{setTab(id);setPage(1);}}>{label}{id==='review'&&!!summary?.pending&&<span>{summary.pending}</span>}</button>)}</div>
  {error&&<p role="alert" className="im-error">{error}{!editor&&<button disabled={busy} onClick={()=>{setLoading(true);void read();}}>重新載入</button>}</p>}
  {loading&&!visible?<p className="im-empty" role="status">正在讀取盤點明細…</p>:!visible?.source_id?<div className="im-empty"><Warehouse/><h2>這個月份尚無已完成盤點</h2><p>請選擇其他月份，或待門市完成盤點後再查看。</p></div>:<>
   <div className="im-source"><label>盤點來源<select aria-label="盤點來源" value={visible.source_id} disabled={busy||visible.closed} onChange={e=>void switchSource(e.target.value)}>{visible.sessions.map(s=><option key={s.id} value={s.id}>{dateLabel(s.completed_at)} 完成</option>)}</select></label><span>{visible.closed?`已於 ${dateLabel(visible.confirmed_at)} 確認封存`:'同月有多份時預設採最近完成的一份'}</span></div>
   {!visible.source_complete&&<p className="im-warning">此份盤點範圍尚未完整完成，目前僅供查看，無法確認月份。</p>}
   {visible.has_active_count&&<p className="im-note">門市另有進行中的盤點；本表僅顯示上方所選的已完成資料。</p>}
   <div role="tabpanel" id={`im-panel-${tab}`} aria-label={tab==='total'?'總表':tab==='review'?'差異核對':'庫存金額'}>
   {tab==='amount'?<><p className="im-note">各分類依品項合計，跨儲物區不重複計價。缺少單價的品項未計入金額。</p><div className="im-table-wrap"><table><thead><tr><th>分類</th><th>品項／單位數</th><th>庫存金額</th><th>計價狀態</th></tr></thead><tbody>{inventoryCategories(rows).map(g=><tr key={g.name}><td>{g.name}</td><td>{g.items}</td><td>{inventoryMoney(g.amount)}</td><td>{g.missing?`${g.missing} 項待補單價`:'已完整計價'}</td></tr>)}</tbody></table></div></>:<>
    <div className="im-filters"><label className="im-search"><Search size={18}/><input aria-label="搜尋品項或供應商" placeholder="搜尋品項、供應商" value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}}/></label><select aria-label="儲物區篩選" value={zone} onChange={e=>{setZone(e.target.value);setPage(1);}}><option value="">全部儲物區</option>{zones.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select>{tab==='total'&&<label className="im-check"><input type="checkbox" checked={pending} onChange={e=>{setPending(e.target.checked);setPage(1);}}/>只看待核對</label>}<small>共 {filtered.length} 項</small></div>
    {zone&&<p className="im-note">顯示包含此儲物區的品項；數量與金額仍為該品項所有儲物區的合計。</p>}
    <div className="im-table-wrap"><table><thead><tr><th>品項</th><th>儲物區</th><th>單位</th><th>上月數量</th><th>本月數量</th><th>增減</th><th>單價</th><th>本月金額</th><th>核對狀態</th></tr></thead><tbody>{pageRows.map(row=><InventoryTableRows key={row.row_key} row={row} expanded={expanded===row.row_key} onExpand={()=>setExpanded(expanded===row.row_key?null:row.row_key)} onEdit={()=>edit(row)} disabled={busy||loading} closed={visible.closed}/>)}{!pageRows.length&&<tr><td colSpan={9} className="im-empty">{tab==='review'?'目前沒有符合條件的待核對項目':'沒有符合條件的品項'}</td></tr>}</tbody></table></div>
    <div className="im-pagination"><span>本頁已計價小計 <strong>{inventoryMoney(Math.round(pageRows.reduce((n,r)=>n+(r.amount??0),0)*100)/100)}</strong></span><div><button disabled={currentPage<=1} onClick={()=>setPage(currentPage-1)}>上一頁</button><span>{currentPage} / {pages}</span><button disabled={currentPage>=pages} onClick={()=>setPage(currentPage+1)}>下一頁</button></div></div>
   </>}
   </div>
   <footer className="im-footer"><p>依盤點時保存的單價計算；行政補價僅適用本月報表。<br/>{visible.closed?'確認後保留本月數量、單價與核對紀錄。':summary?.pending?`還有 ${summary.pending} 項需要處理，完成後即可確認月份。`:'確認後將保存此份盤點範圍的數量、單價與核對紀錄。'}</p><button className="im-primary" disabled={!canClose} onClick={()=>void confirmMonth()}><CheckCircle2 size={18}/>{busy?'處理中…':visible.closed?'本月盤點已確認':'確認本月盤點'}</button></footer>
  </>}
  {editor&&<div className="im-modal-backdrop"><section className="im-modal" role="dialog" aria-modal="true" aria-labelledby="im-review-title" onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();void closeEditor();}if(event.key==='Tab'){const fields=event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled)');const first=fields[0],last=fields[fields.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}}}><header><h2 id="im-review-title">{visible?.closed?'查看核對紀錄':'品項核對'}</h2><button aria-label="關閉核對" disabled={busy} onClick={()=>void closeEditor()}><X/></button></header>{editRow?<><h3>{editRow.name}</h3><p>{editRow.unit}・上月 {inventoryNumber(editRow.previous_quantity)} ／ 本月 {inventoryNumber(editRow.current_quantity)} ／ {comparisonLabel(editRow)}</p><ZoneDetails row={editRow}/><label>本月單價<input autoFocus type="number" min="0" max="999999999.9999" step="any" value={editor.price} disabled={busy||visible?.closed||editRow.current_quantity===null} placeholder="尚未提供" onChange={e=>updateEditor({price:e.target.value})}/></label><label>核對備註<textarea value={editor.note} maxLength={2000} disabled={busy||visible?.closed} placeholder="差異原因、單位變更或本月未盤的說明" onChange={e=>updateEditor({note:e.target.value})}/></label><label className="im-check"><input type="checkbox" checked={editor.acknowledged} disabled={busy||visible?.closed||editRow.correction_conflict} onChange={e=>updateEditor({acknowledged:e.target.checked})}/>已核對數量差異及資料狀況</label>{editRow.correction_conflict&&<p className="im-warning">原盤點有多筆合計更正或不同單位，請先由主管釐清來源資料。</p>}</>:<p>此品項已不在最新盤點中，請關閉後重新選擇。</p>}{error&&<p className="im-error" role="alert">{error}</p>}<footer><button disabled={busy||loading} onClick={()=>void reloadEditor()}>重新讀取最新資料</button><button className="im-primary" disabled={busy||loading||!editRow||visible?.closed} onClick={()=>void saveReview()}>{busy?'儲存中…':'儲存核對'}</button></footer></section></div>}
 </section>;
}
function ZoneDetails({row}:{row:InventoryRow}) {return <div className="im-zone-details"><strong>{row.current_quantity===null?'上月儲物區明細':'儲物區原始明細'}</strong>{row.corrected&&<p>原始合計 {inventoryNumber(row.original_quantity)}；主管確認合計 {inventoryNumber(row.current_quantity)}。更正以總表合計為準。</p>}<ul>{row.zones.map(z=><li key={z.id}><span>{z.zone} <b>{inventoryNumber(z.quantity)} {row.unit}</b></span><small>{z.entered_by}・{dateLabel(z.entered_at)}{z.note&&`・${z.note}`}</small></li>)}</ul></div>;}
export function InventoryTableRows({row,expanded,onExpand,onEdit,disabled,closed}:{row:InventoryRow;expanded:boolean;onExpand:()=>void;onEdit:()=>void;disabled:boolean;closed:boolean}) {return <><tr><td><strong>{row.name}</strong><small>{row.supplier||'未提供供應商'}</small></td><td><button className="im-zone-toggle" aria-expanded={expanded} onClick={onExpand}>{row.zones.length>1?`${new Set(row.zones.map(z=>z.zone_id)).size} 個儲物區`:row.zones[0]?.zone||'未提供'}<ChevronDown size={14}/></button></td><td>{row.unit}</td><td>{inventoryNumber(row.previous_quantity)}</td><td><strong>{row.current_quantity===null?'未盤':inventoryNumber(row.current_quantity)}</strong>{row.corrected&&<small>含合計更正</small>}</td><td className={row.difference?'im-difference':''}>{comparisonLabel(row)}</td><td>{inventoryNumber(row.unit_price)}</td><td>{row.amount===null?'未計入':inventoryMoney(row.amount)}</td><td><button disabled={disabled} onClick={onEdit} className={`im-status ${row.needs_review?'pending':'done'}`}>{closed?'查看紀錄':reviewLabel(row)}</button></td></tr>{expanded&&<tr><td colSpan={9}><ZoneDetails row={row}/></td></tr>}</>;}
