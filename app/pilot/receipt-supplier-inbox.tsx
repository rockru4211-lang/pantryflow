'use client';
import {useEffect,useRef,useState} from 'react';
import {Search,Plus,RefreshCw} from 'lucide-react';
import {supabase} from '@/lib/supabase-browser';
import {receiptRead,receiptReadError} from '@/lib/receipt-read';
import {groupSupplierInbox,inboxNameKey,inboxRecognitionLabel,suggestInboxSuppliers,unresolvedSupplierNames,type ReceiptInboxRow} from '@/lib/receipt-supplier-inbox';
import {taipeiMonth} from '@/lib/inventory-monthly';
import type {SupplierProfile} from '@/lib/supplier-prices';
import {useOperation} from './operation-hooks';
import './receipt-supplier-inbox.css';

type Props={storeId:string;userId:string;rows:ReceiptInboxRow[];loading:boolean;error:string;busy:boolean;onRefresh:()=>Promise<unknown>;onOpen:(row:ReceiptInboxRow)=>void;onUpload:()=>void;onRetry:()=>void;};
export default function ReceiptSupplierInbox({storeId,userId,rows,loading,error,busy,onRefresh,onOpen,onUpload,onRetry}:Props){
 const [month,setMonth]=useState(taipeiMonth),[search,setSearch]=useState(''),[selected,setSelected]=useState('');
 const [source,setSource]=useState<string|null>(null),[expected,setExpected]=useState<string|null>(null),[target,setTarget]=useState(''),[newName,setNewName]=useState('');
 const [suppliers,setSuppliers]=useState<SupplierProfile[]>([]),[editable,setEditable]=useState(false),[metadataLoading,setMetadataLoading]=useState(false),[metadataError,setMetadataError]=useState(''),[notice,setNotice]=useState('');
 const operation=useOperation(storeId,userId),readFlight=useRef<AbortController|null>(null);
 useEffect(()=>()=>readFlight.current?.abort(),[]);
 const groups=groupSupplierInbox(rows,month,search),allGroups=groupSupplierInbox(rows,month),group=allGroups.find(g=>g.key===selected);
 const exceptions=unresolvedSupplierNames(rows),count=groups.reduce((total,g)=>total+g.rows.length,0),failed=rows.filter(r=>r.state==='OCR_FAILED'&&r.page_count===r.stored_page_count);
 const names=[...new Set(rows.map(r=>r.raw_supplier_name??r.supplier_name).filter(n=>n&&n!=='未提供'))].sort((a,b)=>a.localeCompare(b,'zh-Hant'));
 const affected=source?rows.filter(r=>inboxNameKey(r.raw_supplier_name??r.supplier_name)===inboxNameKey(source)):[];
 async function loadSuppliers(){
  readFlight.current?.abort();const controller=new AbortController();readFlight.current=controller;setMetadataLoading(true);setMetadataError('');
  try{const result=await receiptRead(signal=>supabase.rpc('app_workspace',{p_store_id:storeId,p_section:'suppliers',p_filter:{}}).abortSignal(signal),controller.signal);if(result.error)throw result.error;
   const value=result.data as unknown as {suppliers:SupplierProfile[];editable:boolean};if(!Array.isArray(value?.suppliers))throw Error('INVALID_RESPONSE');
   if(!controller.signal.aborted){setSuppliers(value.suppliers.filter(s=>s.is_active));setEditable(value.editable);}
  }catch(e){if(!controller.signal.aborted){setMetadataError(receiptReadError(e));setEditable(false);}}
  finally{if(!controller.signal.aborted)setMetadataLoading(false);}
 }
 function chooseSource(name:string){setSource(name);setExpected(rows.find(r=>inboxNameKey(r.raw_supplier_name??r.supplier_name)===inboxNameKey(name))?.supplier_id??null);setTarget('');setNewName(name);operation.setError('');}
 function openNames(name:string){chooseSource(name);void loadSuppliers();}
 async function saveName(){if(!source||!editable||operation.busy)return;
  const result=await operation.run<{id:string;name:string}>('supplier.resolve-name',{source_name:source,expected_supplier_id:expected,supplier_id:target==='__NEW__'?null:target,new_name:target==='__NEW__'?newName:''});
  if(result){setSource(null);setSelected(result.id);setNotice(`已統一為「${result.name}」，相同名稱的貨單與後續辨識會沿用。`);try{await onRefresh();}catch{setNotice('名稱對應已儲存，請重新整理以取得最新貨單。');}}
 }
 const suggestions=source?suggestInboxSuppliers(source,suppliers):[];
 return <section className="supplier-inbox" aria-label="依供應商整理貨單">
  <header className="supplier-inbox-heading"><div><h1>貨單收件箱</h1><p>依供應商整理，點開查看貨單。</p></div><button className="shell-primary" disabled={busy} onClick={onUpload}><Plus size={18}/>上傳貨單</button></header>
  {notice&&<p role="status" className="shell-note">{notice}</p>}
  {error?<p role="alert" className="shell-note">{error}<button className="text-button" disabled={loading} onClick={()=>void onRefresh()}>重新讀取</button></p>:<>
   {!!exceptions.length&&<div className="supplier-inbox-exception"><span>有 {exceptions.length} 個供應商名稱需要釐清</span><button className="shell-secondary" onClick={()=>openNames(exceptions[0].name)}>處理名稱</button></div>}
   <div className="supplier-inbox-toolbar"><label className="supplier-inbox-search"><Search size={18}/><input aria-label="搜尋供應商或貨單編號" placeholder="搜尋供應商…" value={search} onChange={e=>{setSearch(e.target.value);setSelected('');}}/></label><label>貨單月份<input type="month" aria-label="貨單月份" value={month} onChange={e=>{if(/^\d{4}-(0[1-9]|1[0-2])$/.test(e.target.value)){setMonth(e.target.value);setSelected('');}}}/></label><span>{groups.length} 家供應商・共 {count} 張貨單</span><button className="text-button" aria-label="重新整理收件箱" disabled={loading} onClick={()=>void onRefresh()}><RefreshCw size={17}/></button></div>
   {selected?<>
    <button className="shell-back" onClick={()=>setSelected('')}>‹ 返回供應商清單</button>
    <div className="supplier-inbox-detail-heading"><h2>{group?.name||'此月份沒有此供應商貨單'}</h2>{!!group?.names.length&&<button className="text-button" onClick={()=>openNames(group.names[0])}>更改名稱歸屬</button>}</div>
    <div className="supplier-inbox-table-wrap"><table className="supplier-inbox-table"><thead><tr><th>貨單</th><th>進貨日期</th><th>辨識狀態</th><th>操作</th></tr></thead><tbody>{group?.rows.map(row=><tr key={row.batch_id}><td><strong>{row.batch_number}</strong><small>{row.page_count} 頁・上傳 {new Date(row.uploaded_at).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false})}</small></td><td>{row.receipt_date||'未提供'}</td><td>{inboxRecognitionLabel(row)}</td><td><button className="text-button" disabled={busy} onClick={()=>onOpen(row)}>查看貨單 →</button></td></tr>)}</tbody></table></div>
   </>:<><div className="supplier-inbox-table-wrap"><table className="supplier-inbox-table"><thead><tr><th>供應商</th><th>貨單張數</th><th>操作</th></tr></thead><tbody>{groups.map(g=><tr key={g.key}><td><strong>{g.name}</strong></td><td>{g.rows.length} 張</td><td><button className="text-button" onClick={()=>setSelected(g.key)}>查看貨單 →</button></td></tr>)}</tbody></table></div>
    {!groups.length&&<p className="shell-note" role="status">{loading?'正在讀取貨單…':search?'沒有符合條件的供應商。':'這個月份尚無貨單，可切換月份查看。'}</p>}
    <p className="supplier-inbox-footnote">同一供應商的貨單集中顯示，點開後再查看各張內容。</p>
   </>}
   {!!failed.length&&<p className="supplier-inbox-footnote">有 {failed.length} 張貨單辨識失敗，原圖仍保留。<button className="text-button" disabled={busy} onClick={onRetry}>重新辨識失敗貨單</button></p>}
  </>}
  {source!==null&&<div className="supplier-inbox-backdrop"><section className="supplier-inbox-dialog" role="dialog" aria-modal="true" aria-label="整理供應商名稱" onKeyDown={e=>{if(e.key==='Escape'&&!operation.busy)setSource(null);if(e.key==='Tab'){const fields=e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),select:not(:disabled),input:not(:disabled)');const first=fields[0],last=fields[fields.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}}}>
   <header><h2>整理供應商名稱</h2><button className="text-button" disabled={operation.busy} onClick={()=>setSource(null)}>關閉</button></header>
   <p>同一名稱只需處理一次，不必逐張核對貨單。</p>
   <label>貨單上的名稱<select autoFocus value={source} disabled={operation.busy} onChange={e=>chooseSource(e.target.value)}>{names.map(name=><option key={name}>{name}</option>)}</select></label>
   <small>目前門市有 {new Set(affected.map(r=>r.batch_id)).size} 張相關貨單。儲存後，同企業使用此名稱的貨單與進價比對一併歸類。</small>
   {metadataLoading?<p role="status">正在讀取供應商…</p>:metadataError?<p role="alert">{metadataError}<button className="text-button" onClick={()=>void loadSuppliers()}>重新讀取</button></p>:<>
    {suggestions.length>0&&<div className="supplier-inbox-suggestions"><small>可能是以下供應商，請依貨單確認：</small>{suggestions.map(s=><button key={s.id} className="shell-secondary" disabled={operation.busy} onClick={()=>setTarget(s.id)}>{s.name}</button>)}</div>}
    <label>使用的正式供應商<select aria-label="使用的正式供應商" disabled={operation.busy||!editable} value={target} onChange={e=>setTarget(e.target.value)}><option value="">選擇供應商</option>{suppliers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}<option value="__NEW__">＋ 確實是新供應商</option></select></label>
    {target==='__NEW__'&&<label>新供應商名稱<input maxLength={160} value={newName} disabled={operation.busy} onChange={e=>setNewName(e.target.value)}/></label>}
    {!editable&&<p>請由行政／後勤或老闆整理供應商名稱。</p>}
   </>}
   <p className="supplier-inbox-footnote">原始貨單與辨識文字保留；下次辨識到相同名稱會自動歸類。</p>
   {operation.error&&<p role="alert" className="shell-note">{operation.error}</p>}
   <footer><button className="shell-primary" disabled={!editable||metadataLoading||operation.busy||!target||target==='__NEW__'&&!newName.trim()} onClick={()=>void saveName()}>{operation.busy?'儲存中…':'儲存名稱對應'}</button></footer>
  </section></div>}
 </section>;
}
