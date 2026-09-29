'use client';
import {useState} from 'react';
import {Search,Plus,RefreshCw} from 'lucide-react';
import {groupSupplierInbox,inboxRecognitionLabel,inboxWaitingNotice,type ReceiptInboxRow} from '@/lib/receipt-supplier-inbox';
import {editableReceiptDate} from '@/lib/receipt-ledger-edit';
import {taipeiMonth} from '@/lib/inventory-monthly';
import './receipt-supplier-inbox.css';
type Props={storeId:string;userId:string;rows:ReceiptInboxRow[];loading:boolean;error:string;busy:boolean;onRefresh:()=>Promise<unknown>;onOpen:(row:ReceiptInboxRow)=>void;onDetails:(row:ReceiptInboxRow)=>void;onUpload:()=>void;onRetry:()=>void};
export function managementState(row:ReceiptInboxRow){return row.state==='FILE_MISSING'||row.state==='OCR_FAILED'?'需處理':row.line_count>0||row.has_goods_receipt?'已入檔':'辨識中';}
export default function ReceiptSupplierInbox({rows,loading,error,busy,onRefresh,onOpen,onDetails,onUpload,onRetry}:Props){
 const [month,setMonth]=useState(taipeiMonth),[date,setDate]=useState(''),[search,setSearch]=useState(''),[status,setStatus]=useState('ALL');
 const filtered=groupSupplierInbox(rows,month,search).flatMap(g=>g.rows).filter(row=>(!date||editableReceiptDate(row.receipt_date)===date)&&(status==='ALL'||managementState(row)===status)).sort((a,b)=>(editableReceiptDate(b.receipt_date)||b.work_date).localeCompare(editableReceiptDate(a.receipt_date)||a.work_date)||b.uploaded_at.localeCompare(a.uploaded_at));
 const waiting=inboxWaitingNotice(rows),failed=rows.filter(r=>r.state==='OCR_FAILED'&&r.page_count===r.stored_page_count);
 return <section className="supplier-inbox" aria-label="貨單管理">
 <header className="supplier-inbox-heading"><div><h1>貨單管理</h1><p>保存原單，辨識後建立進貨明細。</p></div><button type="button" className="shell-primary" disabled={busy} onClick={onUpload}><Plus size={18}/>上傳貨單</button></header>
 {waiting&&<p role="status" className="shell-note">{waiting}</p>}
 <div className="supplier-inbox-toolbar"><label>進貨月份<input type="month" value={month} onChange={e=>{setMonth(e.target.value);setDate('');}}/></label><label>進貨日期<input type="date" value={date} onChange={e=>{setDate(e.target.value);if(e.target.value)setMonth(e.target.value.slice(0,7));}}/></label><label className="supplier-inbox-search"><Search size={18}/><input aria-label="搜尋供應商或貨單編號" placeholder="搜尋供應商、貨單編號" value={search} onChange={e=>setSearch(e.target.value)}/></label><select aria-label="辨識狀態" value={status} onChange={e=>setStatus(e.target.value)}><option value="ALL">全部狀態</option>{['辨識中','已入檔','需處理'].map(s=><option key={s}>{s}</option>)}</select><button type="button" className="text-button" aria-label="重新整理貨單" disabled={loading} onClick={()=>void onRefresh()}><RefreshCw size={17}/></button></div>
 {error?<p role="alert" className="shell-note">{error}</p>:<><div className="supplier-inbox-table-wrap"><table className="supplier-inbox-table"><thead><tr><th>進貨日期</th><th>供應商</th><th>原始貨單</th><th>辨識狀態</th><th>操作</th></tr></thead><tbody>{filtered.map(row=><tr key={row.batch_id}><td>{editableReceiptDate(row.receipt_date)||'日期未辨識'}</td><td><strong>{row.supplier_name==='未提供'?'供應商未辨識':row.supplier_name||'供應商未辨識'}</strong></td><td>{row.page_count} 頁<details><summary>上傳資訊</summary><small>{new Date(row.uploaded_at).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false})}<br/>{row.batch_number}</small></details></td><td>{managementState(row)}{managementState(row)!=='已入檔'&&<small>{inboxRecognitionLabel(row)}</small>}</td><td><button type="button" className="text-button" disabled={busy} onClick={()=>onOpen(row)}>查看原單</button>{managementState(row)==='已入檔'&&<button type="button" className="text-button" disabled={busy} onClick={()=>onDetails(row)}>查看明細 →</button>}</td></tr>)}</tbody></table></div>
 {!filtered.length&&<p className="shell-note">{loading?'正在讀取貨單…':'目前沒有符合條件的貨單。'}</p>}
 <p className="supplier-inbox-footnote">共 {filtered.length} 張貨單。已入檔表示文字已保存，尚待行政依紙本核對；日期未辨識的貨單暫列上傳月份。</p></>}
 {!!failed.length&&<p className="supplier-inbox-footnote">{failed.length} 張需重新辨識，原單仍保留。<button type="button" className="text-button" disabled={busy} onClick={onRetry}>重新辨識</button></p>}
 </section>;
}
