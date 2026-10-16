'use client';
import {useState} from 'react';
import {Search,Download} from 'lucide-react';
import {groupSupplierInbox,inboxHasDetails,type ReceiptInboxRow,type ReceiptEntryProgress} from '@/lib/receipt-supplier-inbox';
import {editableReceiptDate} from '@/lib/receipt-ledger-edit';
import {taipeiMonth} from '@/lib/inventory-monthly';
import './receipt-supplier-inbox.css';
import './report-table.css';
type Props={progress?:Record<string,ReceiptEntryProgress>;progressError?:string;storeId:string;userId:string;rows:ReceiptInboxRow[];loading:boolean;error:string;busy:boolean;onRefresh:()=>Promise<unknown>;onOpen:(row:ReceiptInboxRow,queue?:ReceiptInboxRow[])=>void;onDetails:(row:ReceiptInboxRow,queue?:ReceiptInboxRow[])=>void;onDownload:(row:ReceiptInboxRow)=>void;onUpload:()=>void;onRetry:()=>void};
export default function ReceiptSupplierInbox({progress={},progressError,rows,loading,error,busy,onOpen,onDownload,onRetry,onRefresh,onDetails,onUpload}:Props){
 const [month,setMonth]=useState(taipeiMonth),[search,setSearch]=useState('');
 const [supplier,setSupplier]=useState(''),[status,setStatus]=useState('');
 const matches=groupSupplierInbox(rows,month).flatMap(g=>g.rows).filter(r=>(!supplier||r.supplier_name===supplier)&&(!search.trim()||[r.supplier_name,r.raw_supplier_name,r.receipt_date,r.work_date,r.batch_number].some(v=>String(v||'').toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))));
 const hasDetails=(r:ReceiptInboxRow)=>inboxHasDetails(r,progress[r.batch_id]);
 const filtered=matches.filter(r=>!status||!hasDetails(r));
 const grouped=groupSupplierInbox(filtered,month);
 const pending=(name:string)=>!name.trim()||['未提供','尚未識別供應商','待辨識'].includes(name);
 const unknown=grouped.filter(g=>pending(g.name)).flatMap(g=>g.rows);
 const dateOrder=(a:ReceiptInboxRow,b:ReceiptInboxRow)=>Number(hasDetails(a))-Number(hasDetails(b))||(editableReceiptDate(b.receipt_date)||b.work_date).localeCompare(editableReceiptDate(a.receipt_date)||a.work_date)||b.uploaded_at.localeCompare(a.uploaded_at);
 const groups=[...grouped.filter(g=>!pending(g.name)),...(unknown.length?[{key:'pending',name:'供應商待補',rows:unknown}]:[])].map(g=>({...g,rows:[...g.rows].sort(dateOrder)})).sort((a,b)=>Number(!a.rows.some(r=>!hasDetails(r)))-Number(!b.rows.some(r=>!hasDetails(r))));
 const failed=rows.filter(r=>r.state==='OCR_FAILED'&&r.last_error!=='MANUAL_REVIEW'&&!progress[r.batch_id]?.saved);
 return <section className="supplier-inbox" aria-label="貨單管理">
 <header className="supplier-inbox-heading"><h1>貨單管理</h1></header>
 <div className="supplier-inbox-toolbar"><input aria-label="貨單月份" type="month" value={month} onChange={e=>setMonth(e.target.value)}/><select aria-label="篩選供應商" value={supplier} onChange={e=>setSupplier(e.target.value)}><option value="">全部供應商</option>{[...new Set(rows.map(r=>r.supplier_name).filter(Boolean))].sort().map(name=><option key={name}>{name}</option>)}</select><label className="supplier-inbox-search"><Search size={18}/><input aria-label="搜尋供應商或貨單日期" placeholder="搜尋供應商、日期" value={search} onChange={e=>setSearch(e.target.value)}/></label><button className="shell-primary" disabled={busy} onClick={onUpload}>上傳貨單</button></div>
 <div className="supplier-inbox-filters" aria-label="貨單建檔篩選"><button type="button" aria-pressed={!status} onClick={()=>setStatus('')}>全部貨單 <small>{matches.length}</small></button><button type="button" aria-pressed={status==='ENTRY'} onClick={()=>setStatus('ENTRY')}>待建檔 <small>{matches.filter(r=>!hasDetails(r)).length}</small></button></div>
 {progressError&&<p role="status" className="supplier-inbox-footnote">{progressError}</p>}
 {error?<p role="alert" className="shell-note">{error}<button type="button" className="text-button" disabled={busy||loading} onClick={()=>void onRefresh().catch(()=>{})}>{loading?'重新讀取中…':'重新讀取貨單'}</button></p>:<><div className="supplier-inbox-table-wrap"><table className="supplier-inbox-table"><thead><tr><th>日期</th><th>貨單</th><th>建檔狀態</th><th>操作</th></tr></thead>{groups.map(group=><tbody key={group.key} aria-label={group.name}><tr className="archive-supplier-heading"><th colSpan={4} scope="rowgroup"><span>{group.name}</span><small>{group.rows.length} 張貨單</small></th></tr>{group.rows.map(row=><tr key={row.batch_id}><td>{editableReceiptDate(row.receipt_date)||row.work_date}<small>{!editableReceiptDate(row.receipt_date)&&'日期未辨識'}</small></td><td>{row.page_count} 張</td><td><span className={`receipt-progress-chip ${hasDetails(row)?'details':'entry'}`}>{hasDetails(row)?'已有明細':'待建檔'}</span></td><td><button type="button" className="receipt-entry-action" disabled={busy} onClick={()=>onDetails(row,groups.flatMap(g=>g.rows))}>{hasDetails(row)?'查看／修改':'開始建檔'}</button><button type="button" className="text-button" disabled={busy||row.state==='FILE_MISSING'} onClick={()=>onOpen(row)}>查看原單</button><button type="button" className="text-button" aria-label={`下載 ${row.supplier_name} ${row.receipt_date} 貨單`} disabled={busy||row.state==='FILE_MISSING'} onClick={()=>onDownload(row)}><Download size={18}/></button></td></tr>)}</tbody>)}</table></div>
 {!filtered.length&&<p className="shell-note">{loading?'正在讀取貨單…':'目前沒有符合條件的貨單。'}</p>}
 <p className="supplier-inbox-footnote">共 {filtered.length} 張貨單</p></>}
 {!!failed.length&&<p className="supplier-inbox-footnote">{failed.length} 張貨單辨識未完成，原檔已保存，可直接建檔。<button type="button" className="text-button" disabled={busy} onClick={onRetry}>重試</button></p>}
 </section>;
}
