'use client';
import {useState} from 'react';
import {Search,Download} from 'lucide-react';
import {groupSupplierInbox,type ReceiptInboxRow} from '@/lib/receipt-supplier-inbox';
import {editableReceiptDate} from '@/lib/receipt-ledger-edit';
import {taipeiMonth} from '@/lib/inventory-monthly';
import './receipt-supplier-inbox.css';
type Props={storeId:string;userId:string;rows:ReceiptInboxRow[];loading:boolean;error:string;busy:boolean;onRefresh:()=>Promise<unknown>;onOpen:(row:ReceiptInboxRow)=>void;onDetails:(row:ReceiptInboxRow)=>void;onDownload:(row:ReceiptInboxRow)=>void;onUpload:()=>void;onRetry:()=>void};
export default function ReceiptSupplierInbox({rows,loading,error,busy,onOpen,onDownload,onRetry}:Props){
 const [month,setMonth]=useState(taipeiMonth),[search,setSearch]=useState('');
 const filtered=groupSupplierInbox(rows,month).flatMap(g=>g.rows).filter(r=>!search.trim()||[r.supplier_name,r.raw_supplier_name,r.receipt_date,r.work_date,r.batch_number].some(v=>String(v||'').toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))).sort((a,b)=>(editableReceiptDate(b.receipt_date)||b.work_date).localeCompare(editableReceiptDate(a.receipt_date)||a.work_date)||b.uploaded_at.localeCompare(a.uploaded_at));
 const failed=rows.filter(r=>r.state==='OCR_FAILED');
 return <section className="supplier-inbox" aria-label="貨單管理">
 <header className="supplier-inbox-heading"><h1>貨單管理</h1></header>
 <div className="supplier-inbox-toolbar"><input aria-label="貨單月份" type="month" value={month} onChange={e=>setMonth(e.target.value)}/><label className="supplier-inbox-search"><Search size={18}/><input aria-label="搜尋供應商或貨單日期" placeholder="搜尋供應商、日期" value={search} onChange={e=>setSearch(e.target.value)}/></label></div>
 {error?<p role="alert" className="shell-note">{error}</p>:<><div className="supplier-inbox-table-wrap"><table className="supplier-inbox-table"><thead><tr><th>日期</th><th>供應商</th><th>貨單</th><th>操作</th></tr></thead><tbody>{filtered.map(row=><tr key={row.batch_id}><td>{editableReceiptDate(row.receipt_date)||row.work_date}<small>{!editableReceiptDate(row.receipt_date)&&'上傳日期'}</small></td><td>{row.supplier_name==='未提供'?'待辨識':row.supplier_name||'待辨識'}</td><td>{row.page_count} 張</td><td><button type="button" className="text-button" disabled={busy} onClick={()=>onOpen(row)}>查看</button><button type="button" className="text-button" aria-label={`下載 ${row.supplier_name} ${row.receipt_date} 貨單`} disabled={busy} onClick={()=>onDownload(row)}><Download size={18}/></button></td></tr>)}</tbody></table></div>
 {!filtered.length&&<p className="shell-note">{loading?'正在讀取貨單…':'目前沒有符合條件的貨單。'}</p>}
 <p className="supplier-inbox-footnote">共 {filtered.length} 張貨單</p></>}
 {!!failed.length&&<p className="supplier-inbox-footnote">{failed.length} 張貨單辨識未完成，原檔已保存。<button type="button" className="text-button" disabled={busy} onClick={onRetry}>重試</button></p>}
 </section>;
}
