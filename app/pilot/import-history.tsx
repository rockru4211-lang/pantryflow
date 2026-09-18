"use client";

import { useEffect, useState } from "react";
import { displayTime } from "./inventory-catalog";
import { supabase } from "@/lib/supabase-browser";
import type { Database, Json } from "@/lib/database.types";

type ImportFile = Database["public"]["Tables"]["inventory_import_files"]["Row"];
type SourceRow = Database["public"]["Tables"]["inventory_import_rows"]["Row"];
const objectOf = (value: Json): Record<string, Json | undefined> => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const textOf = (value: Json | undefined) => value === null || value === undefined || value === "" ? "未提供" : typeof value === "object" ? JSON.stringify(value) : String(value);

export default function ImportHistory({ storeId, refreshKey, expanded = false }: { storeId: string; refreshKey: number; expanded?: boolean }) {
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
        setFiles(data ?? []);
        if (expanded && data?.[0]) setFileId(data[0].id);
      });
    return () => { active = false; };
  }, [storeId, refreshKey, expanded]);

  useEffect(() => {
    let active = true;
    if (!fileId) { setRows([]); return; }
    setLoading(true);
    void (async () => {
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

  if (fileId && file) {
    return <section className="shell-section">
      <button className="shell-back" type="button" onClick={() => { setFileId(""); setOriginalUrl(""); }}>‹ 返回歷史建檔</button>
      <div className="shell-section-head"><h2>{file.original_filename}</h2><span>{file.row_count} 筆</span></div>
      <section className="shell-card" style={{padding:12}}>
        <p>匯入時間：{displayTime(file.created_at)}</p>
        <p>已建立 {file.added_count + file.existing_count} 筆・失敗 {file.failed_count} 筆</p>
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

  return <section className="shell-section">
    <div className="shell-section-head"><h2>歷史建檔</h2><span>{files.length} 次</span></div>
    {!files.length && !notice && <p className="pilot-empty">尚無歷史建檔紀錄。</p>}
    {!!files.length && <div className="shell-card shell-list">
      {files.map(item => <button type="button" className="shell-list-row" key={item.id} onClick={() => { setOriginalUrl(""); setFileId(item.id); }}>
        <span><strong>{item.original_filename}</strong><small>{displayTime(item.created_at)}・{item.added_count + item.existing_count} 項</small></span><b>›</b>
      </button>)}
    </div>}
    {notice && <p role="status">{notice}</p>}
  </section>;
}
