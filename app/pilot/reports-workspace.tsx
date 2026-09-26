'use client';
import {useEffect,useState} from 'react';
import SupplierPriceOverview from './supplier-price-overview';
import {receiptPriceSummary} from '@/lib/receipt-price-summary';
import {supabase} from '@/lib/supabase-browser';
import {canExportData,canManageBusiness,localMonth,monthRange,type AppStore} from '@/lib/app-workspace';
import {confirmedReceiptTotal,reportAuditEvents,reportEventLabel,reportMenu,reportPriceRows,type ReportAuditEvent,type ReportInitialPage,type ReportSection} from '@/lib/report-workspace-model';
import {useOperationDraft,useWorkspace} from './operation-hooks';
import {displayTime} from './inventory-catalog';
import type {ShellView} from './app-shell';
type Report={counts:{id:string;started_at:string;completed_at:string;status:string}[];receipts:{id:string;receipt_date:string|null;source_batch_id:string;document_number:string;supplier_name:string;total_inc_tax:number|null}[];lines:{id:string;receipt_id:string;product_id:string|null;name:string;quantity:number|null;unit:string|null;unit_price:number|null;amount:number|null;receipt_date:string|null;supplier_name:string;inventory_status:string;source_batch_id:string}[]};
type Audit={events:ReportAuditEvent[]};
const formatAmount=(value:number|null|undefined)=>value===null||value===undefined||!Number.isFinite(Number(value))?'未提供':`NT$ ${Number(value).toLocaleString()}`;
export async function exportRows(rows:Record<string,unknown>[],format:'xlsx'|'csv',fileName:string){
 const XLSX=await import('xlsx');const records=rows.map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,value===null||value===undefined?'未提供':typeof value==='object'?JSON.stringify(value):value])));
 const sheet=XLSX.utils.json_to_sheet(records.length?records:[{紀錄:'此期間沒有資料'}]);
 if(format==='xlsx'){const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,sheet,'紀錄');XLSX.writeFile(book,`${fileName}.xlsx`);}
 else {const safe=records.map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,typeof value==='string'&&/^[=+\-@\t\r]/.test(value)?`'${value}`:value])));const csv=XLSX.utils.sheet_to_csv(XLSX.utils.json_to_sheet(safe.length?safe:[{紀錄:'此期間沒有資料'}]));const url=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`${fileName}.csv`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);}
}
export default function ReportsWorkspace({returnLabel="返回上一頁",store,userId,section,initialPage,onBack,onCount,onReceipt,onNavigate,onWasteHistory}:{store:AppStore;userId:string;section:ReportSection;initialPage?:ReportInitialPage;returnLabel?:string;onBack:()=>void;onCount:(id:string)=>void;onReceipt:(id:string)=>void;onNavigate:(view:ShellView)=>void;onWasteHistory?:(month:string)=>void}){
 const[state,setState]=useOperationDraft<{month:string;page:string;search:string}>(userId,store.id,`report:${section}`,{month:localMonth(),page:initialPage||'home',search:''});const{month,page,search}=state;const setMonth=(month:string)=>setState(v=>({...v,month}));const setPage=(page:string)=>setState(v=>({...v,page}));const[formatOpen,setFormatOpen]=useState(false);const[exporting,setExporting]=useState(false);const[exportError,setExportError]=useState('');
 useEffect(()=>{if(initialPage!==undefined)setState(v=>({...v,page:initialPage}));},[initialPage,setState]);
 const workspace=useWorkspace<Report&Partial<Audit>>(store.id,section==='audit'?'audit':'reports',monthRange(month));
 const data=workspace.data;const lines=(data?.lines||[]).filter(l=>`${l.name} ${l.supplier_name||''}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));const receipts=(data?.receipts||[]).filter(r=>!search||lines.some(l=>l.receipt_id===r.id));const total=confirmedReceiptTotal(data?.receipts?receipts:undefined);const title=section==='reports'?'報表中心':section==='exports'?'資料匯出':section==='costs'?'進貨與廢棄紀錄':'操作稽核';
 const pages=reportMenu(section,canManageBusiness(store),!!onWasteHistory);
 const auditPage=section==='audit'&&page!=='home';const events=reportAuditEvents(data?.events,page);
 const prices=receiptPriceSummary(lines);
 const supplierComparison=store.business_type!=='CHAIN_RESTAURANT'&&page==='prices'&&['OWNER','LOGISTICS'].includes(store.role);
 const rows:Record<string,unknown>[]=auditPage?events.map(e=>({時間:e.created_at,操作者:e.actor_name,事件:reportEventLabel(e.action),事件識別:e.action,資料:e.entity_type,識別:e.entity_id,修改前:e.old_value,修改後:e.new_value})):page==='summary'?[{門市:store.name,月份:month,已確認盤點:data?.counts?.length??null,已確認收貨:data?.receipts?receipts.length:null,進貨總額:total}]:page==='prices'?reportPriceRows(prices,store.name):page==='counts'?(data?.counts||[]).map(c=>({門市:store.name,盤點識別:c.id,開始:c.started_at,完成:c.completed_at,狀態:'已完成'})):lines.map(l=>({門市:store.name,日期:l.receipt_date,供應商:l.supplier_name,品名:l.name,數量:l.quantity,單位:l.unit,單價:l.unit_price,金額:l.amount,狀態:inventoryState(l.inventory_status),貨單:l.receipt_id}));
 const download=async(format:'xlsx'|'csv')=>{setExporting(true);setExportError('');try{const permission=await supabase.rpc('authorize_app_feature',{p_store_id:store.id,p_feature:'DATA_EXPORT'});if(permission.error)throw permission.error;await exportRows(rows,format,`序-${store.name}-${month}-${page}`);setFormatOpen(false);}catch{setExportError('匯出未完成，請重試。');}finally{setExporting(false);}};
 const go=(next:string)=>{if(next==='waste'){onWasteHistory?.(month);return;}if(next==='audit'){if(canManageBusiness(store))onNavigate('audit');return;}setPage(next);setExportError('');setFormatOpen(false);};
 return <><button className="shell-back" onClick={()=>page==='home'?onBack():setPage('home')}>‹ {page==='home'?returnLabel:`返回${title}`}</button><h1>{title}</h1>
 {workspace.error&&<p className="pilot-message" role="alert">{workspace.error}<button onClick={()=>void workspace.refresh()}>重新讀取</button></p>}
 {(page!=='home'||section==='costs')&&<label className="field">月份<input type="month" value={month} onChange={e=>{if(e.target.value)setMonth(e.target.value);}}/></label>}
 {page==='home'?<div className="shell-card shell-list">{pages.map(([next,label,copy])=><button className="shell-list-row" key={next} onClick={()=>go(next)}><span><strong>{label}</strong><small>{copy}</small></span><b>›</b></button>)}</div>:<>
 <h2>{pages.find(([key])=>key===page)?.[1]||title}</h2>
 {!auditPage&&page!=='counts'&&<label className="field">搜尋品項／供應商<input type="search" value={search} onChange={e=>setState(v=>({...v,search:e.target.value}))}/></label>}
 {workspace.loading?<p role="status">正在讀取報表…</p>:workspace.error?null:<>
 {page==='summary'&&<section className="shell-card result-list"><div><span>門市</span><strong>{store.name}</strong></div><div><span>已確認盤點</span><strong>{data?.counts?`${data.counts.length} 次`:'未提供'}</strong></div><div><span>已確認收貨</span><strong>{data?.receipts?`${receipts.length} 張`:'未提供'}</strong></div><div><span>進貨總額</span><strong>{formatAmount(total)}</strong></div></section>}
 {!auditPage&&page==='counts'&&<section className="shell-card shell-list">{data?.counts?.map(c=><button className="shell-list-row" key={c.id} onClick={()=>onCount(c.id)}><span><strong>{displayTime(c.completed_at)}</strong><small>已確認盤點・查看完整明細與回填檔案</small></span><b>›</b></button>)}</section>}
 {!auditPage&&(page==='receipts'||page==='summary')&&<section className="shell-section"><h2>進貨明細</h2>{section==='costs'&&<p className="shell-note">此處呈現已確認貨單的進貨金額，不代表本期實際耗用成本。</p>}<div className="shell-card shell-list">{receipts.map(r=><button className="shell-list-row" key={r.id} onClick={()=>onReceipt(r.source_batch_id)}><span><strong>{r.supplier_name||'未提供供應商'}</strong><small>{r.receipt_date||'未提供日期'}・{r.document_number||'未提供單號'}・{formatAmount(r.total_inc_tax)}</small></span><b>›</b></button>)}</div></section>}
 {supplierComparison?<SupplierPriceOverview storeId={store.id} month={month} search={search} onReceipt={onReceipt}/>:page==='prices'&&<section className="shell-card shell-list">{prices.map((l,i)=><button className="shell-list-row" key={i} onClick={()=>onReceipt(l.source)}><span><strong>{l.name}／{l.unit||'未提供單位'}</strong><small>最近 {l.latestDate||'未提供日期'}・{formatAmount(l.latest)}</small><small>本期加權均價 {l.weightedAverage===null?'未提供':formatAmount(Math.round(l.weightedAverage*100)/100)}・{l.supplier}</small></span><b>›</b></button>)}</section>}
 {auditPage&&<div className="shell-card timeline-list">{events.map(e=><article key={e.id}><i/><div><strong>{reportEventLabel(e.action)}・{e.actor_name||'未提供操作者'}</strong><small>{displayTime(e.created_at)}</small><details><summary>查看明細</summary><pre className="audit-json">{JSON.stringify({事件:e.action,資料:e.entity_type,識別:e.entity_id,修改前:e.old_value,修改後:e.new_value},null,2)}</pre></details></div></article>)}</div>}
 {!supplierComparison&&!rows.length&&<p className="shell-note">{auditPage?'此期間沒有符合的操作紀錄。':'此期間沒有符合的已確認資料。'}</p>}
 {supplierComparison?<p className="shell-note">與供應商頁面採用相同比對依據；稅別不明的歷史單價僅供參考。</p>:!auditPage&&page==='counts'?<p className="shell-note">選擇一筆盤點，查看明細並匯出原表回填檔案。</p>:<div className="report-actions"><div className="export-menu"><button className="shell-primary" disabled={exporting||!!workspace.error||!data||!canExportData(store)} aria-expanded={formatOpen} onClick={()=>setFormatOpen(v=>!v)}>匯出檔案</button>{formatOpen&&<div className="shell-button-stack"><button className="shell-secondary" disabled={exporting} onClick={()=>void download('xlsx')}>Excel</button><button className="shell-secondary" disabled={exporting} onClick={()=>void download('csv')}>CSV</button></div>}</div><button className="shell-secondary" onClick={()=>window.print()}>列印／另存 PDF</button></div>}{exportError&&<p className="pilot-message" role="alert">{exportError}</p>}
 </>}</>}
 </>;
}

function inventoryState(value:string){return ({POSTED:"已計入庫存",MAPPING_PENDING:"商品待對應",UNIT_PENDING:"單位待確認",QUANTITY_PENDING:"數量待確認",REVIEW_PENDING:"辨識資料未確認"} as Record<string,string>)[value]||"未確認";}
