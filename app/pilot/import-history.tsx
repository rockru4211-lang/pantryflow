"use client";

import { useEffect, useRef, useState } from "react";
import { importRemovalConfirmation, importRemovalError, removeInventoryImport } from "@/lib/inventory-import-removal";
import { displayTime } from "./inventory-catalog";
import { supabase } from "@/lib/supabase-browser";
import type { Database, Json } from "@/lib/database.types";

type ImportFile = Database["public"]["Tables"]["inventory_import_files"]["Row"] & { removed_at?: string | null; removed_by?: string | null };
type SourceRow = Database["public"]["Tables"]["inventory_import_rows"]["Row"];
const objectOf = (value: Json): Record<string, Json | undefined> => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const textOf = (value: Json | undefined) => value === null || value === undefined || value === "" ? "未提供" : typeof value === "object" ? JSON.stringify(value) : String(value);

export default function ImportHistory({ storeId, refreshKey, expanded = false, compact = false, removable = false, storeName, onRemoved }: { storeName?: string; onRemoved?: () => Promise<void>; storeId: string; refreshKey: number; expanded?: boolean; compact?: boolean; removable?: boolean }) {
  const removingRef = useRef(false);
  const [removing, setRemoving] = useState(false);
  const [files, setFiles] = useState<ImportFile[]>([]);
  const [fileId, setFileId] = useState("");
  const [rows, setRows] = useState<SourceRow[]>([]);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [originalUrl, setOriginalUrl] = useState("");

  useEffect(() => {
    let active = true;
    void supabase.from("inventory_import_files").select("*").eq("store_id", storeId)
      .order("created_at", { ascending: false }).then(({ data, error }) => {
        if (!active) return;
        setNotice(error ? "無法讀取建檔紀錄，請稍後重試。" : "");
        const visible=((data ?? []) as ImportFile[]).filter(item=>!item.removed_at);
        setFiles(visible);
        if (expanded && !compact && visible[0]) setFileId(visible[0].id);
      });
    return () => { active = false; };
  }, [storeId, refreshKey, expanded]);

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
      <button className="shell-back" type="button" onClick={() => { setRows([]); setFileId(""); setOriginalUrl(""); }}>‹ 返回歷史建檔</button>
      <div className="shell-section-head"><h2>{file.original_filename}</h2><span>{file.row_count} 筆</span></div>
      <section className="shell-card" style={{padding:12}}>
        <p>匯入時間：{displayTime(file.created_at)}</p>
        <p>已建立 {file.added_count + file.existing_count} 筆・失敗 {file.failed_count} 筆</p>
        {removable && <button type="button" className="shell-secondary full" disabled={removing} onClick={() => void removeImport(file)}>{removing ? "移除中…" : "整批移除資料與品項"}</button>}
        <button className="text-button" onClick={prepareDownload}>取得原始檔</button>
        {originalUrl && <a href={originalUrl} download={file.original_filename}>下載 {file.original_filename}</a>}
      </section>
      {loading ? <p role="status">正在讀取建檔內容…</p> : <div className="shell-card count-detail-list">{orderedRows.slice(0,100).map(row => {
        const values = objectOf(row.normalized_values);
        return <details key={row.id}>
          <summary><span><strong>{textOf(values.name)}</strong><small>{textOf(values.zone)}・期初 {textOf(values.opening_quantity)}</small></span><b>›</b></summary>
          <div style={{padding:"0 14px 12px"}}><p>規格：{textOf(values.specification)}・單位：{textOf(values.unit)}</p><p>{row.reason}</p></div>
        </details>;
      })}</div>}
      {orderedRows.length > 100 && <p className="shell-note">另有 {orderedRows.length - 100} 筆來源資料未展開顯示。</p>}
      {notice && <p role="status">{notice}</p>}
    </section>;
  }

  return <section className="shell-section import-history-overview">
    <div className="shell-section-head"><h2>{compact?"匯入盤點資料":"歷史建檔"}</h2><span>{files.length} 次</span></div>
    {!files.length && !notice && <p className="pilot-empty">尚無匯入盤點資料。</p>}
    {!!files.length && <div className="shell-card swipe-list">
      {files.map(item => <div className="swipe-row" style={{overflowX:"hidden"}} key={item.id}>
        <button type="button" className="swipe-row-main" style={removable?{flex:"1 1 0",minWidth:0}:undefined} onClick={() => { setRows([]); setOriginalUrl(""); setFileId(item.id); }}>
          <span><strong>{item.original_filename}</strong><small>{displayTime(item.created_at)}・{item.added_count + item.existing_count} 項</small></span><b>›</b>
        </button>
        {removable&&<button type="button" className="text-button" style={{flex:"0 0 84px"}} disabled={removing} onClick={()=>void removeImport(item)}>整批移除</button>}
      </div>)}
    </div>}
    {compact&&removable&&files.length>0&&<p className="shell-note">整批移除會一併清除該份資料的品項與未完成盤點內容。</p>}
    {notice && <p role="status">{notice}</p>}
  </section>;
}
