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
        setNotice(error ? "無法讀取匯入來源，請稍後重試。" : "");
        setFiles(data ?? []);
        setLoading(Boolean(data?.length));
        setFileId(data?.[0]?.id ?? "");
      });
    return () => { active = false; };
  }, [storeId, refreshKey]);

  useEffect(() => {
    let active = true;
    if (!fileId) return;
    void (async () => {
      const allRows: SourceRow[] = [];
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await supabase.from("inventory_import_rows").select("*")
          .eq("store_id", storeId).eq("import_file_id", fileId).order("id").range(offset, offset + 999);
        if (!active) return;
        if (error) { setNotice("無法讀取完整來源列，請重新選擇檔案。"); setLoading(false); return; }
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

  return <details className="setup-panel import-source-history" open={expanded}>
    <summary>匯入來源與完整資料</summary>
    {!files.length && !notice && <p className="pilot-empty">尚無匯入來源。</p>}
    {!!files.length && <>
      <label className="store-select">來源檔案<select value={fileId} onChange={event => { setRows([]); setOriginalUrl(""); setLoading(true); setFileId(event.target.value); }}>{files.map(item => <option key={item.id} value={item.id}>{item.original_filename}</option>)}</select></label>
      {file && <>
        <p>{sheetNames.length} 個工作表・{rows.length} 筆來源列，依原始工作表與列順序顯示。</p>
        <p>匯入時間：{displayTime(file.created_at)}</p>
        <p>工作表順序：{sheetNames.join(" → ")}</p>
        <button onClick={prepareDownload}>取得原始檔</button>
        {originalUrl && <a href={originalUrl} download={file.original_filename}>下載 {file.original_filename}</a>}
      </>}
      {loading ? <p role="status">正在讀取完整來源…</p> : orderedRows.map(row => {
        const values = objectOf(row.normalized_values);
        return <details className="count-row-details" key={row.id}>
          <summary>{row.sheet_name} 第 {row.source_row} 列｜{textOf(values.name)}</summary>
          <p>品項代碼：{textOf(values.product_code)}・規格：{textOf(values.specification)}・單位：{textOf(values.unit)}</p>
          <p>來源廠商：{textOf(values.supplier)}・區域：{textOf(values.zone)}・期初數量：{textOf(values.opening_quantity)}</p>
          <p>{row.reason}</p>
          {Array.isArray(row.merged_ranges) && !!row.merged_ranges.length && <p>合併儲存格：{row.merged_ranges.map(String).join("、")}</p>}
          <dl>{Object.entries(objectOf(row.raw_values)).map(([column, value]) => <div key={column}><dt>{column}</dt><dd>{textOf(value)}</dd></div>)}</dl>
        </details>;
      })}
    </>}
    {notice && <p role="status">{notice}</p>}
  </details>;
}
