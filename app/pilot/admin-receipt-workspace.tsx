"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase-browser';
import ReceiptImage from './receipt-image';
import { adminRpc, type AdminRpcArgs } from '@/lib/admin-receipt-api';
import {
  adminError, calculatedSubtotal, cleanValues, documentLines, editableFields, exportMatrix,
  fieldLabels, filterLines, groupSuppliers, inArrivalRange, lineSubtotal, money, sortLines,
  supplierKey, text, totals,
  type AdminBatch, type AdminDocument, type AdminLine, type Values,
} from '@/lib/admin-receipt-register';
import './admin-receipt.css';

type Props = { storeId: string; userId: string; organizationId: string; onBack: () => void;
  returnLabel?: string; initialBatchId?: string; embedded?: boolean };
type Editor = { line: AdminLine; draft: Values; reviewed: boolean };
type HistoryEntry = { id: number; row_key: string | null; action: string; actor: string | null;
  created_at: string; old_value: Values; new_value: Values };
function checkedDocument(value: unknown, storeId: string, organizationId: string): AdminDocument {
  const d = value as AdminDocument;
  if (!d?.batch || d.batch.store_id !== storeId || d.batch.organization_id !== organizationId ||
    !Array.isArray(d.fields) || !Array.isArray(d.documents) || !Array.isArray(d.admin?.rows) || !d.admin?.tokens) {
    throw new Error('ADMIN_RECEIPT_ACCESS_DENIED');
  }
  return d;
}
function Modal({title,children,onClose,busy=false}: {title:string;children:ReactNode;onClose:()=>void;busy?:boolean}) {
  const ref = useRef<HTMLDialogElement>(null); const label=useId();
  useEffect(() => { const dialog=ref.current; if (dialog && !dialog.open) dialog.showModal(); return () => dialog?.close(); }, []);
  return <dialog ref={ref} className="admin-receipt-dialog" aria-labelledby={label}
    onCancel={e=>{e.preventDefault();if(!busy)onClose();}}>
    <header><h2 id={label}>{title}</h2><button type="button" onClick={onClose} disabled={busy} aria-label="關閉">×</button></header>
    {children}
  </dialog>;
}
function OriginalDocument({doc,onClose}: {doc:AdminDocument;onClose:()=>void}) {
  const [urls,setUrls]=useState<Record<string,string>>({}); const [error,setError]=useState('');
  useEffect(()=>{
    let active=true;
    const load=async()=>{
      const result=await supabase.storage.from('receipt-documents').createSignedUrls(doc.documents.map(d=>d.path),3600);
      if(!active)return;
      if(result.error){setError('原始照片暫時無法讀取，請關閉後重試。');return;}
      setUrls(Object.fromEntries((result.data??[]).filter(d=>!!d.signedUrl).map(d=>[d.path??'',d.signedUrl??''])));
      if((result.data??[]).some(d=>!d.signedUrl))setError('部分原單無法讀取，未以其他貨單照片替代。');
    };
    if(doc.documents.length)void load().catch(()=>{if(active)setError('原單讀取失敗，請稍後重試。');});
    return()=>{active=false;};
  },[doc]);
  return <Modal title={`原始貨單・${doc.batch.batch_number}`} onClose={onClose}>
    {error&&<p role="alert">{error}</p>}
    {!doc.documents.length&&<p>此貨單沒有原始附件。</p>}
    {doc.documents.map(d=><figure key={d.id}>
      {urls[d.path]?<a href={urls[d.path]} target="_blank" rel="noopener noreferrer">
        {d.mime_type==='application/pdf'?'開啟原始 PDF':<ReceiptImage src={urls[d.path]} mime={d.mime_type} alt={`原始貨單第 ${d.page_order} 頁`}/>}
      </a>:<p>原單讀取中…</p>}<figcaption>第 {d.page_order} 頁・{d.name}</figcaption>
    </figure>)}
    <details><summary>OCR 原值（不覆蓋）</summary><div className="admin-receipt-scroll"><table><thead><tr><th>原始列</th><th>欄位</th><th>OCR 原值</th></tr></thead>
      <tbody>{doc.fields.map(f=><tr key={f.id}><td>{f.row_key}</td><td>{fieldLabels[f.field_name]??f.field_name}</td><td>{text(f.raw_value)||'未提供'}</td></tr>)}</tbody></table></div></details>
  </Modal>;
}
async function readHistory(batchId: string, before: number | null): Promise<HistoryEntry[]> {
  const result = await adminRpc('get_admin_receipt_history', {p_batch_id: batchId, p_before: before});
  if (result.error) throw result.error;
  if (!Array.isArray(result.data)) throw Error('INVALID_HISTORY');
  return result.data as HistoryEntry[];
}
function History({batchId,onClose}: {batchId:string;onClose:()=>void}) {
  const [items,setItems]=useState<HistoryEntry[]>([]),[busy,setBusy]=useState(true),[error,setError]=useState(''),[more,setMore]=useState(true);
  const mounted=useRef(false),lock=useRef(false),requestSequence=useRef({version:0});
  // Initial loading is part of initial state. Effects only update state from
  // completed requests; clicking "load more" owns its loading-state update.
  useEffect(()=>{
    const sequence=requestSequence.current;
    const version=++sequence.version;
    let cancelled=false;
    mounted.current=true;lock.current=true;
    const current=()=>!cancelled&&mounted.current&&sequence.version===version;
    void readHistory(batchId,null).then(rows=>{
      if(!current())return;
      setItems(rows);setMore(rows.length===50);setError('');
    }).catch(e=>{if(current())setError(adminError(e));}).finally(()=>{
      if(current()){lock.current=false;setBusy(false);}
    });
    return()=>{cancelled=true;mounted.current=false;sequence.version++;lock.current=false;};
  },[batchId]);
  async function load(before:number|null){
    if(lock.current||!mounted.current)return;
    lock.current=true;setBusy(true);setError('');
    const sequence=requestSequence.current,version=++sequence.version;
    const current=()=>mounted.current&&sequence.version===version;
    try{
      const rows=await readHistory(batchId,before);
      if(!current())return;
      setItems(prev=>before===null?rows:[...prev,...rows]);setMore(rows.length===50);
    }catch(e){if(current())setError(adminError(e));}
    finally{if(current()){lock.current=false;setBusy(false);}}
  }
  return <Modal title="修改紀錄" onClose={onClose}>
    {error&&<p role="alert">{error}</p>}
    {!items.length&&!busy&&!error&&<p>尚無行政修改紀錄。</p>}
    {items.map(entry=>{
      const old=(entry.action==='ROW_SAVED'?entry.old_value.effective:entry.old_value) as Values;
      const next=(entry.action==='ROW_SAVED'?entry.new_value.effective:entry.new_value) as Values;
      const keys=[...new Set([...Object.keys(old??{}),...Object.keys(next??{})])].filter(k=>JSON.stringify(old?.[k])!==JSON.stringify(next?.[k]));
      return <article className="admin-change" key={entry.id}><strong>{entry.actor||'授權人員'}・{entry.action==='ROW_SAVED'?`明細 ${entry.row_key}`:'到貨日期'}</strong>
        <small>{new Date(entry.created_at).toLocaleString('zh-TW')}</small>
        {keys.filter(k=>k!=='revision'&&k!=='issues').map(k=><p key={k}>{fieldLabels[k]??k}：{text(old?.[k])||'未填'} → {text(next?.[k])||'未填'}</p>)}
        {entry.action==='ROW_SAVED'&&<p>{entry.new_value.reviewed?'本筆已核對完成':'本筆保存為待核對'}</p>}
      </article>;
    })}
    {more&&<button type="button" className="shell-secondary" disabled={busy} onClick={()=>void load(items.at(-1)?.id??null)}>{busy?'讀取中…':'載入較早紀錄'}</button>}
  </Modal>;
}

export default function AdminReceiptWorkspace({storeId,userId,organizationId,onBack,returnLabel='返回首頁',initialBatchId,embedded=false}:Props) {
  const [batches,setBatches]=useState<AdminBatch[]>([]),[selected,setSelected]=useState<string|null>(null),[docs,setDocs]=useState<AdminDocument[]>([]);
  const [loading,setLoading]=useState(true),[detailRefreshing,setDetailRefreshing]=useState(false),[busy,setBusy]=useState(false);
  const [detailResult,setDetailResult]=useState<{scope:string;ready:boolean}|null>(null);
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[showCodes,setShowCodes]=useState(false);
  const [supplierSearch,setSupplierSearch]=useState(''),[search,setSearch]=useState(''),[status,setStatus]=useState('all');
  const [from,setFrom]=useState(''),[to,setTo]=useState(''),[undated,setUndated]=useState(true),[descending,setDescending]=useState(false),[page,setPage]=useState(1);
  const [editor,setEditor]=useState<Editor|null>(null),[arrival,setArrival]=useState<{doc:AdminDocument;date:string}|null>(null);
  const [original,setOriginal]=useState<AdminDocument|null>(null),[history,setHistory]=useState<string|null>(null);
  const alive=useRef(true),writeLock=useRef(false),registerSequence=useRef({version:0}),detailSequence=useRef({version:0}),openedInitial=useRef(false);
  const retryRequests=useRef(new Map<string,string>());
  useEffect(()=>{
    const registers=registerSequence.current,details=detailSequence.current;
    alive.current=true;
    return()=>{alive.current=false;registers.version++;details.version++;};
  },[]);
  const readRegister=useCallback(async()=>{
    const result=await adminRpc('get_admin_receipt_register',{p_store_id:storeId});
    if(result.error)throw result.error;
    const data=result.data as {batches:AdminBatch[];show_codes:boolean};
    if(!Array.isArray(data?.batches)||data.batches.some(b=>b.store_id!==storeId||b.organization_id!==organizationId))throw Error('ADMIN_RECEIPT_ACCESS_DENIED');
    return data;
  },[storeId,organizationId]);
  const acceptRegister=useCallback((data:{batches:AdminBatch[];show_codes:boolean})=>{
    setBatches(data.batches);setShowCodes(data.show_codes===true);setLoading(false);
    if(initialBatchId&&!openedInitial.current){openedInitial.current=true;const b=data.batches.find(b=>b.id===initialBatchId);if(b)setSelected(supplierKey(b));}
  },[initialBatchId]);
  const refresh=useCallback(async()=>{
    const sequence=registerSequence.current,version=++sequence.version;
    const data=await readRegister();
    if(alive.current&&version===sequence.version)acceptRegister(data);
  },[readRegister,acceptRegister]);
  useEffect(()=>{
    const sequence=registerSequence.current,version=++sequence.version;
    let cancelled=false;
    const current=()=>!cancelled&&alive.current&&version===sequence.version;
    void readRegister().then(data=>{
      if(current())acceptRegister(data);
    }).catch(e=>{if(current()){setError(adminError(e));setLoading(false);}});
    return()=>{cancelled=true;sequence.version++;};
  },[readRegister,acceptRegister]);
  const rangeInvalid=!!from&&!!to&&from>to;
  const ranged=useMemo(()=>rangeInvalid?[]:batches.filter(b=>inArrivalRange(b,from,to,undated)),[batches,from,to,undated,rangeInvalid]);
  const groups=useMemo(()=>groupSuppliers(ranged),[ranged]);
  const selectedGroup=useMemo(()=>groupSuppliers(batches).find(g=>g.key===selected),[batches,selected]);
  const targetIds=(selectedGroup?.batches??[]).filter(b=>inArrivalRange(b,from,to,undated)&&!rangeInvalid).map(b=>b.id).sort().join(',');
  // Scope-derived loading hides old rows immediately when supplier/date changes,
  // before the next effect runs. Failed reads never become exportable data.
  const detailScope=JSON.stringify([storeId,organizationId,selected,targetIds]);
  const detailLoading=!!selected&&(detailRefreshing||detailResult?.scope!==detailScope);
  const detailReady=!!selected&&detailResult?.scope===detailScope&&detailResult.ready;
  const readDocuments=useCallback(async(current:()=>boolean)=>{
    const ids=targetIds?targetIds.split(','):[];const next:AdminDocument[]=[];
    // Bounded parallel reads; never silently omit a failed document from export.
    for(let index=0;index<ids.length;index+=3){
      if(!current())return null;
      const part=await Promise.all(ids.slice(index,index+3).map(async id=>{
        const r=await adminRpc('get_admin_receipt_document',{p_batch_id:id});if(r.error)throw r.error;
        const doc=checkedDocument(r.data,storeId,organizationId);
        if(doc.batch.id!==id)throw Error('ADMIN_RECEIPT_ACCESS_DENIED');
        return doc;
      }));
      if(!current())return null;
      next.push(...part);
    }
    return next;
  },[targetIds,storeId,organizationId]);
  const loadDocuments=useCallback(async()=>{
    const sequence=detailSequence.current,version=++sequence.version;
    const current=()=>alive.current&&version===sequence.version;
    setDetailRefreshing(true);setError('');
    try{
      const next=await readDocuments(current);
      if(current()&&next!==null){setDocs(next);setDetailResult({scope:detailScope,ready:true});setPage(1);}
    }catch(e){if(current()){setDocs([]);setDetailResult({scope:detailScope,ready:false});setError(adminError(e));}}
    finally{if(current())setDetailRefreshing(false);}
  },[readDocuments,detailScope]);
  useEffect(()=>{
    if(!selected)return;
    const sequence=detailSequence.current,version=++sequence.version;
    let cancelled=false;
    const current=()=>!cancelled&&alive.current&&version===sequence.version;
    void readDocuments(current).then(next=>{
      if(current()&&next!==null){setDocs(next);setDetailResult({scope:detailScope,ready:true});setPage(1);setError('');}
    }).catch(e=>{
      if(current()){setDocs([]);setDetailResult({scope:detailScope,ready:false});setError(adminError(e));}
    }).finally(()=>{if(current())setDetailRefreshing(false);});
    return()=>{cancelled=true;sequence.version++;};
  },[selected,readDocuments,detailScope]);
  const allLines=useMemo(()=>sortLines(docs.flatMap(d=>documentLines(d,selectedGroup?.name??'')),descending),[docs,selectedGroup?.name,descending]);
  const filtered=useMemo(()=>filterLines(allLines,search,status),[allLines,search,status]);
  const total=totals(filtered); const pageCount=Math.max(1,Math.ceil(filtered.length/20)),shownPage=Math.min(page,pageCount);
  const visible=filtered.slice((shownPage-1)*20,shownPage*20);
  const documentMap=new Map(docs.map(d=>[d.batch.id,d]));
  const working=busy||loading||detailLoading;
  async function act(action:()=>Promise<void>){
    if(writeLock.current)return;writeLock.current=true;setBusy(true);setError('');setNotice('');
    try{await action();}catch(e){if(alive.current)setError(adminError(e));}finally{writeLock.current=false;if(alive.current)setBusy(false);}
  }
  async function mutation<N extends 'save_admin_receipt_row'|'save_admin_receipt_arrival'>(name:N,args:Omit<AdminRpcArgs[N],'p_request_id'>):Promise<AdminDocument>{
    const signature=JSON.stringify([name,args]);const request=retryRequests.current.get(signature)??crypto.randomUUID();
    retryRequests.current.set(signature,request);
    const r=await adminRpc(name,{...args,p_request_id:request} as AdminRpcArgs[N]);if(r.error)throw r.error;
    const doc=checkedDocument(r.data,storeId,organizationId);retryRequests.current.delete(signature);return doc;
  }
  async function afterSave(doc:AdminDocument){
    if(!alive.current)return;
    setDocs(prev=>prev.map(d=>d.batch.id===doc.batch.id?doc:d));setNotice('已儲存至資料庫。');
    try{await refresh();}catch{if(alive.current)setNotice('已儲存，但列表統計尚未更新，請重新讀取。');}
  }
  function saveLine(line:AdminLine,values:Values,reviewed:boolean){
    void act(async()=>{
      const doc=await mutation('save_admin_receipt_row',{p_batch_id:line.batchId,p_run_id:line.runId,p_row_key:line.rowKey,
        p_revision:line.revision,p_source_token:line.sourceToken,p_values:values,p_reviewed:reviewed});
      if(alive.current)setEditor(null);await afterSave(doc);
    });
  }
  async function exportExcel(){
    if(!detailReady||detailLoading)return;
    const XLSX=await import('xlsx');const rows=exportMatrix(filtered,showCodes);const sheet=XLSX.utils.aoa_to_sheet(rows);
    rows.forEach((row,r)=>row.forEach((value,c)=>{if(typeof value==='string'){
      const cell=sheet[XLSX.utils.encode_cell({r,c})];if(cell){cell.t='s';cell.v=value;delete cell.f;}
    }}));
    sheet['!cols']=rows[0].map((_,index)=>({wch:index===1||index===2?28:18}));
    sheet['!autofilter']={ref:sheet['!ref']??'A1'};
    const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,sheet,'進貨核對明細');
    const name=(selectedGroup?.name??'供應商').replace(/[\\/:*?"<>|]/g,'_').slice(0,60);
    XLSX.writeFile(book,`進貨核對_${name}.xlsx`);
    setNotice(`已匯出目前篩選範圍 ${filtered.length} 筆明細（不限於本頁）。`);
  }
  function closeEditor(){if(!busy){setEditor(null);setError('');}}
  function back(){if(working)return;if(selected){setSelected(null);setDocs([]);setDetailResult(null);setSearch('');setStatus('all');setError('');setNotice('');}else onBack();}
  const filters=<div className="admin-receipt-filters">
    <label>到貨日期<input aria-label="開始到貨日期" type="date" value={from} disabled={working} onChange={e=>setFrom(e.target.value)}/></label>
    <label>至<input aria-label="結束到貨日期" type="date" value={to} disabled={working} onChange={e=>setTo(e.target.value)}/></label>
    <label className="admin-inline"><input type="checkbox" checked={undated} disabled={working} onChange={e=>setUndated(e.target.checked)}/>含日期未填</label>
  </div>;
  return <section className="admin-receipt-workspace" data-user-scope={userId? 'authenticated':'missing'}>
    {(!embedded||selected)&&<button type="button" className="shell-back" disabled={working} onClick={back}>‹ {selected?'返回供應商':returnLabel}</button>}
    <div className="shell-page-intro"><h1>{selected?'進貨明細核對':'進貨資料核對'}</h1><p>{selected?selectedGroup?.name:'核對進貨資料；原始照片與 OCR 原值完整保留。'}</p></div>
    {error&&<p className="admin-error" role="alert">{error}</p>}
    {notice&&<p className="shell-note" role="status">{notice}</p>}
    {rangeInvalid&&<p className="admin-error" role="alert">開始日期不可晚於結束日期。</p>}
    {!selected?<>
      <div className="admin-receipt-metrics">
        <div><span>識別中（張）</span><strong>{ranged.filter(b=>['QUEUED','RUNNING'].includes(b.job_status??'')).length}</strong></div>
        <div><span>待核對（筆）</span><strong>{ranged.filter(b=>b.ocr_status==='SUCCEEDED').reduce((sum,b)=>sum+Math.max(0,b.row_count-b.reviewed_count),0)}</strong></div>
        <div><span>已核對完成（筆）</span><strong>{ranged.reduce((sum,b)=>sum+b.reviewed_count,0)}</strong></div>
      </div>
      {filters}
      <div className="admin-receipt-toolbar"><input aria-label="搜尋供應商" placeholder="搜尋供應商" value={supplierSearch} onChange={e=>setSupplierSearch(e.target.value)}/>
        <button type="button" className="shell-secondary" disabled={working} onClick={()=>void act(refresh)}>重新讀取</button></div>
      <h2>供應商（{groups.length}）</h2>
      <div className="admin-supplier-list">{groups.filter(g=>g.name.includes(supplierSearch.trim())).map(g=><button type="button" className="admin-supplier-card" key={g.key} disabled={working}
        onClick={()=>{setSelected(g.key);setDetailResult(null);setError('');setNotice('');setPage(1);}}>
        <span><strong>{g.name}</strong><small>{g.batches.length} 張貨單・{g.rowCount} 筆明細</small><small>{g.latestArrival?`最近到貨 ${g.latestArrival}`:'到貨日期未填'}</small></span><span aria-hidden="true">›</span>
      </button>)}</div>
      {loading&&<p role="status">正在讀取供應商…</p>}
      {!loading&&!groups.length&&!error&&<p>目前範圍沒有貨單。</p>}
    </>:<>
      <div className="admin-receipt-toolbar">
        <label className="admin-inline">使用品項編碼（選用）<input type="checkbox" role="switch" checked={showCodes} disabled={working}
          onChange={e=>{const next=e.target.checked;void act(async()=>{const r=await adminRpc('set_admin_receipt_codes',{p_store_id:storeId,p_enabled:next});if(r.error)throw r.error;setShowCodes(r.data===true);});}}/>{showCodes?'開啟':'關閉'}</label>
        <button type="button" className="shell-secondary" disabled={working||!detailReady||!filtered.length} onClick={()=>void act(exportExcel)}>下載 Excel</button>
      </div>
      {filters}
      <div className="admin-receipt-toolbar"><input aria-label="搜尋明細" placeholder="搜尋品項、規格或備註" value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}}/>
        <select aria-label="核對狀態" value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}}><option value="all">全部狀態</option><option value="pending">待核對</option><option value="reviewed">已核對完成</option></select>
        <select aria-label="日期排序" value={descending?'desc':'asc'} onChange={e=>{setDescending(e.target.value==='desc');setPage(1);}}><option value="asc">到貨日期：舊 → 新</option><option value="desc">到貨日期：新 → 舊</option></select>
        <button type="button" className="shell-secondary" disabled={working} onClick={()=>void act(async()=>{await refresh();await loadDocuments();})}>重新讀取</button>
      </div>
      {detailLoading&&<p role="status">正在讀取該供應商貨單明細…</p>}
      {detailReady&&!detailLoading&&<>
        <details className="admin-document-list"><summary>貨單資料・到貨日期・異常（{docs.length} 張）</summary>
          {docs.map(d=>{
            const issueCount=d.batch.delivery.issues.filter(i=>i.status==='OPEN').length;
            return <article key={d.batch.id}><strong>{d.batch.batch_number}</strong><span>{d.batch.delivery.arrived_on??'到貨日期未填'}・{d.run?.status==='SUCCEEDED'?'辨識完成':'尚未完成辨識'}・異常 {issueCount}</span>
              <div><button type="button" disabled={busy} onClick={()=>setArrival({doc:d,date:d.batch.delivery.arrived_on??''})}>修改到貨日期</button>
                <button type="button" onClick={()=>setOriginal(d)}>查看原單</button><button type="button" onClick={()=>setHistory(d.batch.id)}>修改紀錄</button></div>
              {d.batch.delivery.issues.map(i=><p className={i.status==='OPEN'?'admin-issue':''} key={i.id}>{i.name}・{i.reason}・{i.status==='OPEN'?'待處理':'已處理'}{i.note?`・${i.note}`:''}</p>)}
            </article>;
          })}
        </details>
        <div className="admin-receipt-metrics"><div><span>篩選明細</span><strong>{filtered.length} 筆</strong></div>
          <div><span>{total.missing?'已填小計（未稅）':'小計合計（未稅）'}</span><strong>NT$ {money(total.sum)}</strong></div>
          <div><span>金額未填</span><strong>{total.missing} 筆</strong></div></div>
        <div className="admin-receipt-scroll" role="region" aria-label="進貨核對明細表，可左右捲動" tabIndex={0}>
          <table><thead><tr><th>到貨日期</th>{showCodes&&<th>品項編碼</th>}<th>分類</th><th>品項名稱</th><th>規格</th><th>單位</th><th>數量</th><th>單價（未稅）</th><th>小計（未稅）</th><th>狀態</th><th>操作</th></tr></thead>
          <tbody>{visible.map(l=><tr key={l.id}><td>{l.arrivedOn??'到貨日期未填'}</td>{showCodes&&<td>{text(l.values.product_code)||'未填'}</td>}<td>{text(l.values.category)||'—'}</td>
            <td><strong>{text(l.values.product)||'品名未填'}</strong><small>{l.batchNumber}</small>{l.values.note?<small>{text(l.values.note)}</small>:null}</td>
            <td>{text(l.values.specification)||'—'}</td><td>{text(l.values.unit)||'未填'}</td><td>{text(l.values.quantity)||'未填'}</td><td>{money(l.values.unit_price_ex_tax)}</td><td>{money(lineSubtotal(l.values))}</td>
            <td><span className={`admin-badge ${l.reviewed?'is-reviewed':''}`}>{l.reviewed?'已核對完成':'待核對'}</span>{l.stale&&<small>來源已更新，請重新核對</small>}</td>
            <td><div className="admin-row-actions"><button type="button" disabled={busy} onClick={()=>{setError('');setEditor({line:l,draft:{...l.values},reviewed:false});}}>編輯</button>
              {!l.reviewed&&<button type="button" disabled={busy} onClick={()=>saveLine(l,{},true)}>核對完成</button>}
              <button type="button" onClick={()=>{const d=documentMap.get(l.batchId);if(d)setOriginal(d);}}>原單</button></div></td>
          </tr>)}</tbody></table>
        </div>
        {!filtered.length&&<p>目前沒有符合篩選的明細；尚在辨識的貨單可由「貨單資料」查看。</p>}
        <p className="shell-note">此表為行政核對紀錄；核對不會再次收貨或直接改動庫存。金額為未稅小計，未填欄位不當作零元。</p>
        <div className="admin-receipt-pagination"><span>每頁 20 筆・第 {shownPage} / {pageCount} 頁</span>
          <button type="button" disabled={shownPage===1} onClick={()=>setPage(shownPage-1)}>上一頁</button><button type="button" disabled={shownPage>=pageCount} onClick={()=>setPage(shownPage+1)}>下一頁</button></div>
      </>}
    </>}
    {editor&&<Modal title="編輯進貨明細" onClose={closeEditor} busy={busy}>
      <form onSubmit={e=>{e.preventDefault();try{const values=cleanValues(editor.draft,showCodes);saveLine(editor.line,values,editor.reviewed);}catch(err){setError(err instanceof Error?err.message:'欄位格式錯誤。');}}}>
        <p>{editor.line.batchNumber}・{editor.line.arrivedOn??'到貨日期未填'}</p>
        <div className="admin-edit-grid">{editableFields.filter(k=>k!=='product_code'||showCodes).map(key=><label key={key}>{fieldLabels[key]}
          <input type={['quantity','unit_price_ex_tax','subtotal_ex_tax'].includes(key)?'number':'text'}
            step="any" min="0" value={text(editor.draft[key])} disabled={busy}
            onChange={e=>{const value=e.target.value;setEditor(prev=>{if(!prev)return prev;const draft={...prev.draft,[key]:value};if(key==='quantity'||key==='unit_price_ex_tax')draft.subtotal_ex_tax=calculatedSubtotal(draft.quantity,draft.unit_price_ex_tax);return {...prev,draft};});}}/>
        </label>)}</div>
        <button type="button" className="text-button" disabled={busy} onClick={()=>setEditor(prev=>prev?{...prev,draft:{...prev.draft,subtotal_ex_tax:calculatedSubtotal(prev.draft.quantity,prev.draft.unit_price_ex_tax)}}:prev)}>依數量 × 單價帶入小計</button>
        <label className="admin-inline"><input type="checkbox" checked={editor.reviewed} disabled={busy} onChange={e=>{const v=e.target.checked;setEditor(prev=>prev?{...prev,reviewed:v}:prev);}}/>本筆核對完成</label>
        <p className="shell-note">不勾選也可先儲存。調整數量或單價會重算小計；折扣可直接更改小計。原始照片與 OCR 原值保留，此處不會重新收貨或異動庫存。</p>
        {error&&<p role="alert" className="admin-error">{error}</p>}
        <footer><button type="button" className="shell-secondary" disabled={busy} onClick={closeEditor}>取消</button><button type="submit" className="shell-primary" disabled={busy}>{busy?'儲存中…':'儲存修改'}</button></footer>
      </form>
    </Modal>}
    {arrival&&<Modal title="修改到貨日期" busy={busy} onClose={()=>{setArrival(null);setError('');}}>
      <form onSubmit={e=>{e.preventDefault();void act(async()=>{
        const d=await mutation('save_admin_receipt_arrival',{p_batch_id:arrival.doc.batch.id,p_revision:arrival.doc.batch.delivery.revision,p_arrived_on:arrival.date||null});
        if(alive.current)setArrival(null);await afterSave(d);
      });}}><p>{arrival.doc.batch.batch_number}</p><label>實際到貨日期<input type="date" min="1900-01-01" max="2200-12-31" value={arrival.date} disabled={busy} onChange={e=>{const date=e.target.value;setArrival(prev=>prev?{...prev,date}:prev);}}/></label>
        <p className="shell-note">此日期不是上傳時間。修改後，此貨單的行政核對狀態會重新判定為待核對；原有異常紀錄保留。</p>
        {error&&<p role="alert" className="admin-error">{error}</p>}
        <footer><button type="button" className="shell-secondary" disabled={busy} onClick={()=>setArrival(null)}>取消</button><button type="submit" className="shell-primary" disabled={busy}>{busy?'儲存中…':'儲存日期'}</button></footer>
      </form>
    </Modal>}
    {original&&<OriginalDocument key={original.batch.id} doc={original} onClose={()=>setOriginal(null)}/>}
    {history&&<History key={history} batchId={history} onClose={()=>setHistory(null)}/>}
  </section>;
}
