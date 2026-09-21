"use client";

import { useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { importRemovalConfirmation, importRemovalError, removeInventoryImport } from "@/lib/inventory-import-removal";
import { displayTime } from "./inventory-catalog";
import { supabase } from "@/lib/supabase-browser";
import type { Database, Json } from "@/lib/database.types";
import {catalogStates,importRowLabel,importSummaryLabel,summarizeImportRows,type CatalogStatus} from "@/lib/inventory-import-status";

type ImportFile = Database["public"]["Tables"]["inventory_import_files"]["Row"] & { removed_at?: string | null; removed_by?: string | null };
type SourceRow = Database["public"]["Tables"]["inventory_import_rows"]["Row"];
type SummaryRow = Pick<SourceRow,"import_file_id"|"product_id"|"status">;
const objectOf = (value: Json): Record<string, Json | undefined> => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const textOf = (value: Json | undefined) => value === null || value === undefined || value === "" ? "未提供" : typeof value === "object" ? JSON.stringify(value) : String(value);

export default function ImportHistory({ storeId, refreshKey, removable = false, storeName, onRemoved }: { storeName?: string; onRemoved?: () => Promise<void>; storeId: string; refreshKey: number; removable?: boolean }) {
  const removingRef = useRef(false);
  const [removing, setRemoving] = useState(false);
  const [files, setFiles] = useState<ImportFile[]>([]);
  const [fileId, setFileId] = useState("");
  const [rows, setRows] = useState<SourceRow[]>([]);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [originalUrl, setOriginalUrl] = useState("");
  const [catalog, setCatalog] = useState<CatalogStatus[]>([]);
  const [summaryRows, setSummaryRows] = useState<SummaryRow[] | null>(null);

  useEffect(() => {
    let active = true;
    queueMicrotask(()=>{if(active){setSummaryRows(null);setCatalog([]);}});
    void (async()=>{
      try{
        const [fileResult,catalogResult]=await Promise.all([
          supabase.from("inventory_import_files").select("*").eq("store_id",storeId).order("created_at",{ascending:false}),
          supabase.rpc("get_pilot_inventory_catalog",{p_store_id:storeId}),
        ]);
        if(!active)return;
        if(fileResult.error)throw fileResult.error;
        const visible=((fileResult.data??[]) as ImportFile[]).filter(item=>!item.removed_at);
        setFiles(visible);
        if(catalogResult.error||!Array.isArray(catalogResult.data))throw catalogResult.error||Error("CATALOG_STATUS_UNAVAILABLE");
        const all:SummaryRow[]=[];
        if(visible.length){
          for(let offset=0;;offset+=1000){
            const result=await supabase.from("inventory_import_rows").select("import_file_id,product_id,status").eq("store_id",storeId)
              .in("import_file_id",visible.map(item=>item.id)).order("id").range(offset,offset+999);
            if(!active)return;
            if(result.error)throw result.error;
            all.push(...(result.data??[]));
            if(!result.data||result.data.length<1000)break;
          }
        }
        setCatalog(catalogResult.data as unknown as CatalogStatus[]);setSummaryRows(all);setNotice("");
      }catch{if(active)setNotice("建檔狀態尚未讀取完整，請重新開啟此頁確認可盤點數量。");}
    })();
    return () => { active = false; };
  }, [storeId, refreshKey]);

  useEffect(() => {
    let active = true;
    if (!fileId) return;
    void (async () => {
      setLoading(true);
      const allRows: SourceRow[] = [];
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await supabase.from("inventory_import_rows").select("*")
          .eq("store_id", storeId).eq("import_file_id", fileId).order("id").range(offset, offset + 999);
        if (!active) return;
        if (error) { setNotice("無法讀取完整建檔資料，請重新選擇。"); setLoading(false); return; }
        allRows.push(...(data ?? []));
        if (!data || data.length < 1000) break;
      }
      setRows(allRows);
      setNotice("");
      setLoading(false);
    })();
    return () => { active = false; };
  }, [storeId, fileId, refreshKey]);

  const file = files.find(item => item.id === fileId);
  const sheetNames = Array.isArray(file?.sheet_names) ? file.sheet_names.map(String) : [];
  const orderedRows = [...rows].sort((a, b) => sheetNames.indexOf(a.sheet_name) - sheetNames.indexOf(b.sheet_name) || a.source_row - b.source_row);
  const productStates=catalogStates(catalog);
  const summaryFor=(id:string)=>summaryRows===null?null:summarizeImportRows(summaryRows.filter(row=>row.import_file_id===id),productStates);
  const currentSummary=file?summaryFor(file.id):null;

  async function prepareDownload() {
    if (!file) return;
    const { data, error } = await supabase.storage.from("inventory-imports").createSignedUrl(file.storage_path, 60, { download: file.original_filename });
    setNotice(error ? "無法取得原始檔，請稍後重試。" : "");
    setOriginalUrl(data?.signedUrl ?? "");
  }
  async function removeImport(item:ImportFile) {
    if (!removable || removingRef.current) return;
    if (!window.confirm(importRemovalConfirmation(item.original_filename, storeName))) return;
    removingRef.current = true; setRemoving(true); setNotice('正在整批移除資料與品項…');
    try {
      const message = await removeInventoryImport((name, args) => supabase.rpc(name, args), storeId, item.file_sha256);
      setFiles(current => current.filter(row => row.id !== item.id));
      setFileId(''); setRows([]); setOriginalUrl('');
      setNotice(message);
      try { await onRemoved?.(); }
      catch { setNotice(`${message}盤點清單尚未更新，請重新開啟盤點頁。`); }
    } catch (error) { setNotice(importRemovalError(error)); }
    finally { removingRef.current = false; setRemoving(false); }
  }


  if (fileId && file) {
    return <section className="shell-section">
      <button className="shell-back" type="button" onClick={() => { setRows([]); setFileId(""); setOriginalUrl(""); }}>‹ 返回匯入盤點總覽</button>
      <div className="shell-section-head"><h2>{file.original_filename}</h2><span>{currentSummary?`${currentSummary.sourceRows} 列來源資料`:"來源資料"}</span></div>
      <section className="shell-card" style={{padding:12}}>
        <p>匯入時間：{displayTime(file.created_at)}</p>
        <p>{currentSummary?`已建檔 ${currentSummary.builtRows} 列` : "建檔狀態待確認"}</p>
        {currentSummary&&<p>{importSummaryLabel(currentSummary)}</p>}
        {removable && <button type="button" className="shell-secondary full" disabled={removing} onClick={() => void removeImport(file)}>{removing ? "移除中…" : "整批移除資料與品項"}</button>}
        <button className="text-button" onClick={prepareDownload}>取得原始檔</button>
        {originalUrl && <a href={originalUrl} download={file.original_filename}>下載 {file.original_filename}</a>}
      </section>
      {loading ? <p role="status">正在讀取建檔內容…</p> : <div className="shell-card count-detail-list">{orderedRows.slice(0,100).map(row => {
        const values = objectOf(row.normalized_values);
        return <details key={row.id}>
          <summary><span><strong>{textOf(values.name)}</strong><small>{importRowLabel(row,productStates)}・{textOf(values.zone)}・期初 {textOf(values.opening_quantity)}</small></span><b>›</b></summary>
          <div style={{padding:"0 14px 12px"}}><p>規格：{textOf(values.specification)}・單位：{textOf(values.unit)}</p><p>{row.reason}</p></div>
        </details>;
      })}</div>}
      {orderedRows.length > 100 && <p className="shell-note">另有 {orderedRows.length - 100} 筆來源資料未展開顯示。</p>}
      {notice && <p role="status">{notice}</p>}
    </section>;
  }

  return <section className="shell-section import-history-overview">
    <div className="shell-section-head"><h1>匯入盤點總覽</h1><span>{files.length} 次</span></div>
    {removable && <p className="shell-note">左滑可移除匯入資料。</p>}
    {!files.length && !notice && <p className="pilot-empty">尚無匯入盤點資料。</p>}
    {!!files.length && <div className="shell-card swipe-list">
      {files.map(item => {const summary=summaryFor(item.id);return <div className="swipe-row" key={item.id}>
        <button type="button" className="swipe-row-main" onClick={() => { setRows([]); setOriginalUrl(""); setFileId(item.id); }}>
          <span><strong>{item.original_filename}</strong><small>匯入時間 {displayTime(item.created_at)}</small><small>{storeName ? `門市 ${storeName}・` : ""}{summary?`已建檔 ${summary.builtRows} 列`:"建檔狀態待確認"}</small>{summary&&<small>{importSummaryLabel(summary)}</small>}</span><b>›</b>
        </button>
        {removable&&<button type="button" className="swipe-row-remove" aria-label={`移除 ${item.original_filename}`} disabled={removing} onClick={()=>void removeImport(item)}><Trash2 size={20} aria-hidden="true"/><span>移除</span></button>}
      </div>;})}
    </div>}
    {notice && <p role="status">{notice}</p>}
  </section>;
}
