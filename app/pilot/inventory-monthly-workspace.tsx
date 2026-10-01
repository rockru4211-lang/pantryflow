'use client';
import RemovedCountItems, {type RemovedCountItem} from './removed-count-items';
import CountChangeHistory from './count-change-history';
import type {ReactNode} from 'react';
import {CategoryFilter,CategorySelect} from './product-category-controls';
import {useCallback,useEffect,useRef,useState} from 'react';
import {Download,RefreshCw,Search,Warehouse,CheckCircle2,ChevronDown,X} from 'lucide-react';
import {supabase} from '@/lib/supabase-browser';
import {receiptRead,receiptReadRows} from '@/lib/receipt-read';
import {canExportData,type AppStore} from '@/lib/app-workspace';
import type {Json} from '@/lib/database.types';
import {inventoryActiveRows,monthlyDisplayRows,inventoryPurchases,type InventoryReceiptLine,inventoryCategorySummary,comparisonLabel,filterInventory,inventoryCategories,inventoryError,inventoryExportRows,inventoryMoney,inventoryNumber,reviewLabel,taipeiMonth,type InventoryMonth,type InventoryRow} from '@/lib/inventory-monthly';
import './inventory-monthly.css';
import {inventorySpots,readInventorySpots} from '@/lib/inventory-spot';
import CustodyWorkspace from './custody-workspace';

type Tab='total'|'review'|'amount'|'supplier'|'reserved'|'count';
type Editor={key:string;price:string;note:string;acknowledged:boolean;dirty:boolean;fieldNotes:Record<string,string>};
type Props={userId:string;store:AppStore;stores:AppStore[];onStoreChange:(id:string)=>void;registerLeave?:(handler:(()=>Promise<boolean>)|null)=>void;initialTab?:'total'|'count';renderSpotCount?:(registerGuard:(handler:(()=>Promise<boolean>)|null)=>void,onBack:()=>void)=>ReactNode};
const dateLabel=(value:string|null|undefined)=>value?new Date(value).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false}):'—';
export default function InventoryMonthlyWorkspace({userId,store,stores,onStoreChange,registerLeave,initialTab='total',renderSpotCount}:Props) {
 const [month,setMonth]=useState(taipeiMonth),[source,setSource]=useState(''),[tab,setTab]=useState<Tab>(initialTab);
 const [data,setData]=useState<InventoryMonth|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
 const [category,setCategory]=useState(''),[showAmounts,setShowAmounts]=useState(false);
 const [search,setSearch]=useState(''),[zone,setZone]=useState(''),[pending,setPending]=useState(false),[page,setPage]=useState(1);
 const [editor,setEditor]=useState<Editor|null>(null),[expanded,setExpanded]=useState<string|null>(null),[lastRead,setLastRead]=useState(''),[showSource,setShowSource]=useState(false);
 const custody=tab==='supplier'||tab==='reserved'||tab==='count';
 const custodyGuard=useRef<(()=>Promise<boolean>)|null>(null);
 const registerCustodyGuard=useCallback((guard:(()=>Promise<boolean>)|null)=>{custodyGuard.current=guard;},[]);
 const request=useRef(0),working=useRef(false),editorRef=useRef(editor),leaveRef=useRef(registerLeave);
 const readFlight=useRef<AbortController|null>(null);
 useEffect(()=>{editorRef.current=editor;leaveRef.current=registerLeave;},[editor,registerLeave]);
 const askLeave=useCallback(async()=>!working.current&&(!custodyGuard.current||await custodyGuard.current())&&(!editorRef.current?.dirty||window.confirm('核對內容尚未儲存，確定離開？')),[]);
 const switchTab=async(next:Tab)=>{if(next!==tab&&await askLeave()){request.current++;editorRef.current=null;setEditor(null);setTab(next);setPage(1);}};
 useEffect(()=>{leaveRef.current?.(askLeave);const unload=(event:BeforeUnloadEvent)=>{if(editorRef.current?.dirty||working.current){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',unload);return()=>{leaveRef.current?.(null);window.removeEventListener('beforeunload',unload);};},[askLeave]);
 const fetchMonth=useCallback(async(action='read',payload:Record<string,Json|undefined>={},signal?:AbortSignal)=>{
  const query=()=>supabase.rpc('baihuayuan_inventory_month',{p_store_id:store.id,p_month:`${month}-01`,p_action:action,p_data:{...(source?{session_id:source}:{}),...payload}});
  // Only reads are bounded. A timed-out mutation must never be retried automatically.
  const {data:result,error:failure}=await (action==='read'||action==='export'?receiptRead(s=>query().abortSignal(s),signal??new AbortController().signal):query());
  if(failure)throw failure;
  const removed=await receiptRead(s=>supabase.rpc('get_count_field_removed',{p_store_id:store.id}).abortSignal(s),signal??new AbortController().signal);
  if(removed.error)throw removed.error;
  let next={...result as unknown as InventoryMonth,field_removed:removed.data as unknown as RemovedCountItem[]};
  if(next.source_id&&!next.historical){
   try{
    const rpc=async<T,>(spotAction:string,spotData:Record<string,string>):Promise<T>=>{
     const response=await receiptRead(s=>supabase.rpc('baihuayuan_spot_check',{p_store_id:store.id,p_action:spotAction,p_data:spotData}).abortSignal(s),signal??new AbortController().signal);
     if(response.error)throw response.error;
     return response.data as unknown as T;
    };
    const checks=await readInventorySpots(rpc,store.id,next.source_id,next.month);
    next={...next,rows:inventorySpots(next.rows,checks,store.id,next.source_id)};
   }catch{next={...next,spot_error:true,rows:next.rows.map(row=>({...row,spots:undefined}))};}
  }
  if(next.source_id)try{
   const readSignal=signal??new AbortController().signal;
   const [ledger,flags]=await Promise.all([
    receiptRead(s=>supabase.rpc('get_baihuayuan_receipt_detail_ledger',{p_store_id:store.id}).abortSignal(s),readSignal),
    receiptRead(s=>supabase.rpc('get_baihuayuan_record_flags',{p_store_id:store.id,p_entity_type:'RECEIPT_BATCH'}).abortSignal(s),readSignal),
   ]);
   next={...next,rows:inventoryPurchases(next.rows,receiptReadRows<InventoryReceiptLine>(ledger),receiptReadRows<{entity_id:string;state:string}>(flags),next.month)};
  }catch{next={...next,rows:next.rows.map(r=>({...r,purchase_quantity:null,purchase_status:'讀取失敗'}))};}
  return next;
 },[store.id,month,source]);
 const read=useCallback(async(quiet=false)=>{
  if(custody||working.current||quiet&&(readFlight.current||document.visibilityState!=='visible'||editorRef.current))return;
  readFlight.current?.abort();
  const controller=new AbortController();readFlight.current=controller;
  const sequence=++request.current;
  try{const next=await fetchMonth('read',{},controller.signal);if(controller.signal.aborted||sequence!==request.current||quiet&&editorRef.current)return;setData(next);setError('');setLastRead(dateLabel(new Date().toISOString()));}
  catch(e){if(!controller.signal.aborted&&sequence===request.current)setError(inventoryError(e));}
  finally{if(readFlight.current===controller)readFlight.current=null;if(sequence===request.current)setLoading(false);}
 },[fetchMonth,custody]);
 useEffect(()=>{const requests=request,flight=readFlight;const initial=setTimeout(()=>void read(),0);const timer=setInterval(()=>void read(true),5000);const refresh=()=>void read(true);window.addEventListener('focus',refresh);window.addEventListener('online',refresh);document.addEventListener('visibilitychange',refresh);return()=>{requests.current++;flight.current?.abort();flight.current=null;clearTimeout(initial);clearInterval(timer);window.removeEventListener('focus',refresh);window.removeEventListener('online',refresh);document.removeEventListener('visibilitychange',refresh);};},[read]);
 const visible=data?.store_id===store.id&&data.month===`${month}-01`?data:null;
 async function switchMonth(value:string){if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)||value<'2000-01'||value>'2100-12'||!await askLeave())return;editorRef.current=null;setEditor(null);setLoading(true);setData(null);setSource('');setMonth(value);setPage(1);setExpanded(null);}
 async function switchSource(value:string){if(!await askLeave())return;editorRef.current=null;setEditor(null);setLoading(true);setData(null);setSource(value);setPage(1);setExpanded(null);}
 function edit(row:InventoryRow){request.current++;setLoading(false);const next={key:row.row_key,price:row.unit_price==null?'':String(row.unit_price),note:row.review_note,acknowledged:row.acknowledged,dirty:false,fieldNotes:Object.fromEntries(row.zones.filter(z=>z.editable_note).map(z=>[z.id,z.note||'']))};editorRef.current=next;setEditor(next);setError('');}
 function updateEditor(patch:Partial<Editor>){setEditor(old=>{const next=old?{...old,...patch,dirty:true}:null;editorRef.current=next;return next;});}
 async function closeEditor(){if(await askLeave()){editorRef.current=null;setEditor(null);setError('');}}
 async function reloadEditor(){if(working.current||!visible)return;setLoading(true);const sequence=++request.current;try{const next=await fetchMonth('read',{session_id:visible.source_id});if(sequence!==request.current)return;setData(next);setError(next.closed?'此月份已由其他人確認，請查看封存結果。':'已讀取最新資料，保留您的輸入；請重新核對後再儲存。');updateEditor({acknowledged:false});}catch(e){if(sequence===request.current)setError(inventoryError(e));}finally{if(sequence===request.current)setLoading(false);}}
 async function saveReview(){if(!editor||!visible||working.current||loading||visible.closed)return;
  const price=editor.price.trim()===''?null:Number(editor.price);if(price!==null&&(!Number.isFinite(price)||price<0||price>=1e9)){setError(inventoryError({message:'INVALID_INVENTORY_PRICE'}));return;}
  working.current=true;request.current++;setBusy(true);setError('');
  try{const next=await fetchMonth('review',{session_id:visible.source_id,revision:visible.revision,row_key:editor.key,unit_price:price,acknowledged:editor.acknowledged,note:editor.note,field_notes:editor.fieldNotes});setData(next);editorRef.current=null;setEditor(null);}
  catch(e){setError(inventoryError(e));}finally{working.current=false;setBusy(false);}
 }
 async function confirmMonth(){if(!visible||working.current||loading||editor)return;
  if(!window.confirm(`確認 ${store.name} ${month} 盤點？\n將保存這份盤點範圍的數量、單價與核對備註；確認後無法在此修改。`))return;
  working.current=true;request.current++;setBusy(true);setError('');try{setData(await fetchMonth('close',{session_id:visible.source_id,revision:visible.revision}));}catch(e){setError(inventoryError(e));}finally{working.current=false;setBusy(false);}
 }
 async function exportExcel(){if(working.current||!visible||editor)return;working.current=true;request.current++;setBusy(true);setError('');try{
  const snapshot=await fetchMonth('export',{session_id:visible.source_id});setData(snapshot);if(snapshot.spot_error)throw Error('INVENTORY_SPOT_READ_FAILED');
  const XLSX=await import('xlsx');const workbook=XLSX.utils.book_new();
  const sheet=XLSX.utils.json_to_sheet(inventoryExportRows(inventoryActiveRows(monthlyDisplayRows(snapshot.rows),snapshot.field_removed,snapshot.month)));sheet['!cols']=[{wch:36},{wch:18},{wch:12},{wch:24},...Array.from({length:6},()=>({wch:14})),{wch:18},{wch:40},{wch:14}];
  sheet['!cols']=[36,18,12,24,12,14,14,26,14,40,22,22,22,30,14,18,20,32,14].map(wch=>({wch}));
  XLSX.utils.book_append_sheet(workbook,sheet,'庫存總表');
  XLSX.utils.book_append_sheet(workbook,XLSX.utils.json_to_sheet((snapshot.field_removed||[]).map(r=>({'品項':r.name,'移除時間':dateLabel(r.removed_at),'經手人':r.removed_by}))), '已移除');
  XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([
   ['門市',store.name],['月份',month],['資料狀態',snapshot.closed?'已確認':'尚未確認'],['盤點來源',snapshot.source_id||'無'],['盤點完成時間',dateLabel(snapshot.completed_at)],
   ['比較月份',snapshot.previous_month],['上月盤點來源',snapshot.previous_source_id||'無'],['上月已確認',snapshot.previous_closed?'是':'否'],
   ['本月已計價金額',snapshot.summary.subtotal??'未提供'],['缺單價項目',snapshot.summary.missing_prices],['上月缺單價項目',snapshot.summary.previous_missing_prices],
   ['範圍說明','同品項編號及相容單位整併；已移除但本期有數量或抽盤紀錄者保留。未提供資料不視為 0。'],['進貨說明','依貨單日期彙總已核對且品項及單位可對應的進貨小計；排除測試與已移除貨單。同一貨單明細不重複計入。未完成貨單或尚未上傳者不在小計內，仍需核對完整性。'],['抽盤說明','同份盤點表各品項／單位／儲物區的最新抽盤清單；含暫存數字，差異對照建立抽盤時的數量，未覆寫庫存。'],['單價來源','盤點時保存單價；行政補價僅適用本月報表。'],
  ]),'資料說明');
  XLSX.utils.book_append_sheet(workbook,XLSX.utils.json_to_sheet(snapshot.rows.flatMap(r=>r.zones.map(z=>({'品項':r.name,'單位':r.unit,'資料月份':r.current_quantity===null?snapshot.previous_month:snapshot.month,'儲物區':z.zone,'原始數量':z.quantity,'盤點人員':z.entered_by,'盤點時間':dateLabel(z.entered_at),'現場備註':z.note||'','合計已更正':r.corrected?'是，請以總表為準':'否'})))),'儲物區原始明細');
  XLSX.writeFile(workbook,`${store.name}-庫存總表-${month}.xlsx`);
 }catch(e){setError(inventoryError(e));}finally{working.current=false;setBusy(false);}}
 const rows=monthlyDisplayRows(visible?.rows||[]);const removedView=category==='已移除';const activeRows=inventoryActiveRows(rows,visible?.field_removed,visible?.month);const categoryRows=category?activeRows.filter(r=>r.category===category):activeRows;const filtered=filterInventory(activeRows,{search,zone,category,pending:tab==='review'}).filter(r=>!pending||r.spots?.some(s=>s.difference!=null&&s.difference!==0)),pages=Math.max(1,Math.ceil(filtered.length/20)),currentPage=Math.min(page,pages),pageRows=filtered.slice((currentPage-1)*20,currentPage*20);
 const zones=[...new Map(rows.flatMap(r=>r.zones.map(z=>[z.zone_id,z.zone] as const))).entries()].sort((a,b)=>a[1].localeCompare(b[1],'zh-TW'));
 const editRow=editor?visible?.rows.find(r=>r.row_key===editor.key):undefined;
 const summary=visible?.summary,displaySummary=!removedView&&visible?inventoryCategorySummary(categoryRows,visible.has_previous):summary,partial=!!displaySummary&&(displaySummary.missing_prices>0||displaySummary.previous_missing_prices>0);
 const canClose=!!visible?.source_id&&visible.source_complete&&!!summary?.items&&!summary.pending&&!visible.closed&&!busy&&!loading&&!editor;
 return <section className="inventory-monthly" aria-label="庫存管理">
  <header className="im-heading"><div><span className="im-eyebrow">行政／後勤</span><h1><Warehouse size={27}/>{custody?'庫存管理':'每月庫存總表'}</h1><p>{tab==='supplier'?'供應商寄庫、領貨與效期追蹤':tab==='reserved'?'保留對象與分批取貨紀錄':tab==='count'?'建立抽盤表、進行抽盤與查看結果':'期初、進貨、期末與抽盤紀錄，一次核對'}</p></div>{!custody&&<div className="im-heading-actions"><button aria-pressed={showAmounts} onClick={()=>setShowAmounts(v=>!v)}>{showAmounts?'收起金額':'查看金額'}</button><button disabled={busy||loading||!!editor} onClick={()=>{setLoading(true);void read();}}><RefreshCw size={16}/>重新整理</button>{canExportData(store)&&<button disabled={!visible?.source_id||busy||loading||!!editor} onClick={()=>void exportExcel()}><Download size={16}/>匯出 Excel</button>}</div>}</header>
  <div className="im-selectors"><label>門市<select value={store.id} disabled={busy} onChange={e=>onStoreChange(e.target.value)}>{stores.filter(s=>['LOGISTICS','OWNER'].includes(s.role)&&s.is_active!==false).map(s=><option value={s.id} key={s.id}>{s.name}</option>)}</select></label>{!custody&&<><label>盤點月份<input type="month" min="2000-01" max="2100-12" value={month} disabled={busy} onChange={e=>void switchMonth(e.target.value)}/></label><span className={`im-badge ${visible?.closed?'done':''}`}>{visible?.historical?'歷史盤點':visible?.closed?'本月已確認':['DRAFT','IN_PROGRESS'].includes(visible?.source_status||'')?'盤點進行中':'本月待確認'}</span><small>{editor?'核對中，保留您的輸入':error?'同步未完成，請重新載入':lastRead?`每 5 秒同步・${lastRead}`:'讀取資料中'}</small></>}</div>
  {!custody&&(showAmounts||tab==='amount')&&<div className="im-cards"><article><span>{category&&!removedView?`${category}庫存金額`:'本月庫存金額'}</span><strong>{inventoryMoney(displaySummary?.subtotal)}</strong><small>{displaySummary?.subtotal==null&&displaySummary?.missing_prices?'缺少有效單價，暫無法計價':displaySummary?.missing_prices?`已計價小計・${displaySummary.missing_prices} 項缺單價未計入`:`${displaySummary?.items??0} 個品項／單位・依所選盤點範圍`}</small></article><article><span>較上月金額增減</span><strong>{inventoryMoney(displaySummary?.amount_difference,true)}</strong><small>{!visible?.has_previous?'無上月資料，暫不比較':partial?'部分品項未計價，暫不比較總金額':`對照 ${visible.previous_month.slice(0,7)}${visible.baseline_file?' 歷史盤點':visible.previous_closed?' 已確認資料':' 未確認盤點'}`}</small></article><article className="im-review-card"><span>待核對項目</span><strong>{displaySummary?.pending??'—'} <small>項</small></strong><button onClick={()=>{setTab('review');setPage(1);}}>查看需要核對的項目 →</button></article></div>}
  <div className="im-tabs" role="tablist" aria-label="庫存管理分頁">{([['total','總表'],['review','差異核對'],['amount','庫存金額'],['supplier','寄庫'],['reserved','保留貨']] as const).map(([id,label])=><button key={id} role="tab" aria-selected={tab===id} aria-controls={`im-panel-${id}`} onClick={()=>void switchTab(id)}>{label}{id==='review'&&!!displaySummary?.pending&&<span>{displaySummary.pending}</span>}</button>)}{renderSpotCount&&<button role="tab" aria-selected={tab==='count'} aria-controls="im-panel-count" onClick={()=>void switchTab('count')}>每月抽盤</button>}</div>
  {tab==='count'?<section role="tabpanel" id="im-panel-count" aria-label="每月抽盤">{renderSpotCount&&<SpotCountPanel render={renderSpotCount} registerGuard={registerCustodyGuard} onBack={()=>void switchTab('total')}/>}</section>:custody?<CustodyWorkspace key={`${store.id}:${tab}`} storeId={store.id} kind={tab} registerGuard={registerCustodyGuard}/>:<>
  {error&&<p role="alert" className="im-error">{error}{!editor&&<button disabled={busy} onClick={()=>{setLoading(true);void read();}}>重新載入</button>}</p>}
  {loading&&!visible?<p className="im-empty" role="status">正在讀取盤點明細…</p>:error&&!visible?null:!visible?.source_id?<div className="im-empty"><Warehouse/><h2>這個月份尚無已完成盤點</h2><p>請選擇其他月份，或待門市完成盤點後再查看。</p></div>:<>
   <CountChangeHistory key={store.id} storeId={store.id} disabled={busy||!!editor}/><div className="im-source"><label>盤點來源<select aria-label="盤點來源" value={visible.source_id} disabled={busy||visible.closed} onChange={e=>void switchSource(e.target.value)}>{visible.sessions.map(s=><option key={s.id} value={s.id}>{s.label||`${dateLabel(s.completed_at)} 完成`}</option>)}</select></label><span>{visible.historical?'歷史原值；有疑點的欄位保留待確認':visible.closed?`已於 ${dateLabel(visible.confirmed_at)} 確認封存`:'預設顯示本月最新現場盤點，可切換查看先前紀錄'}</span></div>
   <div className="im-note">期初依據：{visible.has_previous?`${visible.previous_month.slice(0,7)} ${visible.baseline_file?'月底歷史盤點':'已確認盤點'}`:visible.baseline_pending?'上月盤點尚未確認':'缺少上月盤點'} {(visible.has_previous||visible.historical)&&<button className="text-button" onClick={()=>setShowSource(v=>!v)}>{showSource?'收合來源':'查看來源'}</button>}{showSource&&<p>本月：{visible.source_file||dateLabel(visible.completed_at)}<br/>期初：{visible.baseline_file||dateLabel(visible.previous_completed_at)}<br/>逐筆來源可在品項的「查看紀錄」中查閱；缺漏不當成 0。</p>}</div>
   {!visible.historical&&!visible.source_complete&&<p className="im-warning">此份盤點範圍尚未完整完成，目前僅供查看，無法確認月份。</p>}
   {visible.has_active_count&&<p className="im-note">現場盤點進行中，已儲存的數量與備註每 5 秒同步；未填項目顯示「未盤」。</p>}
   {visible.spot_error&&<p role="alert" className="im-warning">抽盤資料暫時無法讀取，請按「重新整理」；空白不代表未抽盤。</p>}
   <p className="im-warning">進貨顯示已核對小計；未識別、未核對或尚未上傳的貨單仍待補齊，缺資料不當成 0。</p>
   {!visible.historical&&<p className="im-note">抽盤數量自動帶入各儲物區最新清單，含已儲存的暫存數字；差異對照建立抽盤時的原數量，原庫存保留。</p>}
   <CategoryFilter extraOptions={["已移除"]} value={category} disabled={busy||!!editor} onChange={value=>{setCategory(value);setPage(1);setExpanded(null);}}/><div role="tabpanel" id={`im-panel-${tab}`} aria-label={tab==='total'?'總表':tab==='review'?'差異核對':'庫存金額'}>
   {removedView?<RemovedCountItems key={store.id} inline suppliedItems={visible.field_removed} storeId={store.id} userId={userId} disabled={busy||!!editor} onChanged={()=>read()} renderDetails={item=><>{rows.filter(r=>r.product_id===item.product_id).map(r=><div key={r.row_key}><small>本次：{inventoryNumber(r.current_quantity)} {r.unit}{r.zones.filter(z=>z.note).map(z=>`・${z.note}`).join('')}</small><button type="button" className="text-button" disabled={busy||loading} onClick={()=>edit(r)}>查看本次紀錄</button></div>)}</>}/>:tab==='amount'?<><p className="im-note">各分類依品項合計，跨儲物區不重複計價。缺少單價的品項未計入金額。</p><div className="im-table-wrap"><table><thead><tr><th>分類</th><th>品項／單位數</th><th>庫存金額</th><th>計價狀態</th></tr></thead><tbody>{inventoryCategories(categoryRows).map(g=><tr key={g.name}><td>{g.name}</td><td>{g.items}</td><td>{inventoryMoney(g.amount)}</td><td>{g.missing?`${g.missing} 項待補單價`:'已完整計價'}</td></tr>)}</tbody></table></div></>:<>
    <div className="im-filters"><label className="im-search"><Search size={18}/><input aria-label="搜尋品項或供應商" placeholder="搜尋品項、供應商" value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}}/></label><select aria-label="儲物區篩選" value={zone} onChange={e=>{setZone(e.target.value);setPage(1);}}><option value="">全部儲物區</option>{zones.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select>{tab==='total'&&<label className="im-check"><input type="checkbox" checked={pending} onChange={e=>{setPending(e.target.checked);setPage(1);}}/>只看抽盤差異</label>}<small>共 {filtered.length} 項</small></div>
    {zone&&<p className="im-note">顯示包含此儲物區的品項；數量與金額仍為該品項所有儲物區的合計。</p>}
    <div className="im-table-wrap"><table><thead><tr><th>品項／供應商</th><th>單位</th><th>期初</th><th>本月進貨</th><th>期末</th><th>現場備註</th><th>抽盤</th><th>差異</th><th>差異原因</th>{showAmounts&&<><th>成本單價</th><th>期末金額</th></>}<th>核對</th></tr></thead><tbody>{pageRows.map(row=><InventoryTableRows key={row.row_key} row={row} showAmounts={showAmounts} spotError={visible.spot_error} removed={visible.field_removed?.find(r=>r.product_id===row.product_id)} categoryControl={row.product_id?<CategorySelect storeId={store.id} userId={userId} id={row.product_id} name={row.name} value={row.category} revision={row.category_revision||0} disabled={busy||loading||!!editor} onBusy={value=>{working.current=value;request.current++;setBusy(value);}} onSaved={(category,revision)=>setData(old=>old?{...old,rows:old.rows.map(r=>r.product_id===row.product_id?{...r,category,category_revision:revision}:r)}:old)}/>:undefined} expanded={expanded===row.row_key} onExpand={()=>setExpanded(expanded===row.row_key?null:row.row_key)} onEdit={()=>edit(row)} disabled={busy||loading} closed={visible.closed||!!visible.historical}/>)}{!pageRows.length&&<tr><td colSpan={showAmounts?12:10} className="im-empty">{tab==='review'?'目前沒有符合條件的待核對項目':'沒有符合條件的品項'}</td></tr>}</tbody></table></div>
    <div className="im-pagination"><span hidden={!showAmounts}>本頁已計價小計 <strong>{inventoryMoney(pageRows.some(r=>r.amount!==null)?Math.round(pageRows.reduce((n,r)=>n+(r.amount??0),0)*100)/100:null)}</strong></span><div><button disabled={currentPage<=1} onClick={()=>setPage(currentPage-1)}>上一頁</button><span>{currentPage} / {pages}</span><button disabled={currentPage>=pages} onClick={()=>setPage(currentPage+1)}>下一頁</button></div></div>
   </>}
   </div>
   <footer className="im-footer"><p>分類依目前品項設定，修改後供應商與庫存同步使用。<br/>依盤點時保存的單價計算；行政補價僅適用本月報表。<br/>{visible.closed?'確認後保留本月數量、單價與核對紀錄。':summary?.pending?`整月還有 ${summary.pending} 項需要處理，完成後即可確認月份。`:'確認後將保存此份盤點範圍的數量、單價與核對紀錄。'}</p><button className="im-primary" disabled={!canClose} onClick={()=>void confirmMonth()}><CheckCircle2 size={18}/>{busy?'處理中…':visible.historical?'歷史資料原值留存':visible.closed?'本月盤點已確認':'確認本月盤點'}</button></footer>
  </>}
  </>}
  {editor&&<div className="im-modal-backdrop"><section className="im-modal" role="dialog" aria-modal="true" aria-labelledby="im-review-title" onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();void closeEditor();}if(event.key==='Tab'){const fields=event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled)');const first=fields[0],last=fields[fields.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}}}><header><h2 id="im-review-title">{visible?.closed||visible?.historical?'查看核對紀錄':'修改與核對'}</h2><button aria-label="關閉核對" disabled={busy} onClick={()=>void closeEditor()}><X/></button></header>{editRow?<><h3>{editRow.name}</h3><p>{editRow.unit}・期初 {inventoryNumber(editRow.previous_quantity)} ／ 本月 {inventoryNumber(editRow.current_quantity)} ／ {comparisonLabel(editRow)}</p><ZoneDetails row={editRow}/>{editRow.zones.filter(z=>z.editable_note).map(z=><label key={z.id}>現場備註（{z.zone}）<textarea aria-label={`現場備註 ${z.zone}`} value={editor.fieldNotes[z.id]??z.note??''} maxLength={2000} disabled={busy||visible?.closed} onChange={e=>updateEditor({fieldNotes:{...editor.fieldNotes,[z.id]:e.target.value}})}/></label>)}{(editRow.history_source||editRow.baseline_source)&&<div className="im-note">{([['本月來源',editRow.history_source],['期初來源',editRow.baseline_source]] as const).map(([label,record])=>record&&<div key={label}><strong>{label}</strong><p>{record.file}<br/>{record.location}<br/>原數量：{record.raw_quantity??'未提供'} {record.unit}<br/>{record.note}{record.identity_pending&&'・品項對應待確認'}</p>{record.issues.filter(i=>i.deferred).map((i,n)=><p key={n}>{i.field}：{i.reason}</p>)}</div>)}</div>}<label>本月單價<input autoFocus type="number" min="0" max="999999999.9999" step="any" value={editor.price} disabled={busy||visible?.closed||visible?.historical||editRow.current_quantity===null} placeholder="尚未提供" onChange={e=>updateEditor({price:e.target.value})}/></label><label>核對備註<textarea value={editor.note} maxLength={2000} disabled={busy||visible?.closed||visible?.historical} placeholder="差異原因、單位變更或本月未盤的說明" onChange={e=>updateEditor({note:e.target.value})}/></label><label className="im-check"><input type="checkbox" checked={editor.acknowledged} disabled={busy||visible?.closed||visible?.historical||editRow.correction_conflict} onChange={e=>updateEditor({acknowledged:e.target.checked})}/>已核對數量差異及資料狀況</label>{editRow.correction_conflict&&<p className="im-warning">原盤點有多筆合計更正或不同單位，請先由主管釐清來源資料。</p>}</>:<p>此品項已不在最新盤點中，請關閉後重新選擇。</p>}{error&&<p className="im-error" role="alert">{error}</p>}<footer><button disabled={busy||loading} onClick={()=>void reloadEditor()}>重新讀取最新資料</button><button className="im-primary" disabled={busy||loading||!editRow||visible?.closed} onClick={()=>void saveReview()}>{busy?'儲存中…':'儲存變更'}</button></footer></section></div>}
 </section>;
}
function SpotCountPanel({render,registerGuard,onBack}:{render:NonNullable<Props['renderSpotCount']>;registerGuard:(handler:(()=>Promise<boolean>)|null)=>void;onBack:()=>void}) {return render(registerGuard,onBack);}
function ZoneDetails({row}:{row:InventoryRow}) {return <div className="im-zone-details"><strong>{row.current_quantity===null?'上月儲物區明細':'儲物區原始明細'}</strong>{row.corrected&&<p>原始合計 {inventoryNumber(row.original_quantity)}；主管確認合計 {inventoryNumber(row.current_quantity)}。更正以總表合計為準。</p>}<ul>{row.zones.map(z=><li key={z.id}><span>{z.zone} <b>{inventoryNumber(z.quantity)} {row.unit}</b></span><small>{z.entered_by}・{dateLabel(z.entered_at)}{z.note&&`・${z.note}`}</small></li>)}</ul></div>;}
export function InventoryTableRows({row,showAmounts=false,spotError,removed,categoryControl,expanded,onExpand,onEdit,disabled,closed}:{showAmounts?:boolean;spotError?:boolean;removed?:RemovedCountItem;categoryControl?:ReactNode;row:InventoryRow;expanded:boolean;onExpand:()=>void;onEdit:()=>void;disabled:boolean;closed:boolean}) {return <><tr>
 <td><button className="im-item-toggle" aria-expanded={expanded} onClick={onExpand}><ChevronDown size={14}/><strong>{row.name}</strong></button><small>{row.supplier||'未提供供應商'}</small>{removed&&<small className="im-removed-status" title={`${removed.removed_by}・${dateLabel(removed.removed_at)}`}>目前已移出・本期紀錄保留</small>}</td>
 <td>{row.unit}</td><td>{inventoryNumber(row.previous_quantity)}</td><td>{row.purchase_quantity==null?(row.purchase_status||'待補齊'):inventoryNumber(row.purchase_quantity)}{row.purchase_quantity!=null&&<small>{row.purchase_status}</small>}</td>
 <td><strong>{row.current_quantity===null?(row.history_source?'待確認':'未盤'):inventoryNumber(row.current_quantity)}</strong>{row.corrected&&<small>含合計更正</small>}</td>
 <td className="im-field-notes">{row.zones.some(z=>z.note)?row.zones.filter(z=>z.note).map(z=><div key={z.id}><small>{z.zone}：</small>{z.note}</div>):'—'}</td>
 <td>{spotError?'讀取失敗':row.spots?.length?row.spots.map(s=><div key={s.zone_id}><strong>{s.quantity===null?'未填':inventoryNumber(s.quantity)}</strong><small>{s.zone}・{s.status==='CLOSED'?'已完成':'抽盤中'}</small></div>):'未抽盤'}</td>
 <td>{spotError?'—':row.spots?.length?row.spots.map(s=><div key={s.zone_id} className={s.difference?'im-difference':''}><strong>{inventoryNumber(s.difference,true)}</strong><small>{s.zone}・原數量 {inventoryNumber(s.baseline)}</small></div>):'—'}</td>
 <td className="im-field-notes">{!spotError&&row.spots?.length?row.spots.map(s=><div key={s.zone_id}><small>{s.zone}</small>{s.note||'—'}</div>):'—'}</td>
 {showAmounts&&<><td>{inventoryNumber(row.unit_price)}</td><td>{row.amount===null?'未計入':inventoryMoney(row.amount)}</td></>}
 <td><button disabled={disabled} onClick={onEdit} className="im-status done">{closed?'查看':'修改'}</button></td>
 </tr>{expanded&&<tr><td colSpan={showAmounts?12:10}><div className="im-detail-meta">{categoryControl||row.category}<span>{new Set(row.zones.map(z=>z.zone_id)).size} 個儲物區</span><span>{reviewLabel(row)}</span><span>庫存增減：{comparisonLabel(row)}（非耗損）</span></div><ZoneDetails row={row}/>{row.spots?.map(s=><p className="im-note" key={s.zone_id}>{s.zone} 抽盤建立時間：{dateLabel(s.created_at)}；跨日抽盤需核對期間異動。</p>)}</td></tr>}</>;}
