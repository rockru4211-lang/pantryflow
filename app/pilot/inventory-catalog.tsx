"use client";

import { FormEvent, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase-browser";

type CatalogItem = { product_id: string; name: string; unit: string; zone: string; quantity: number | null; imported_at: string | null; supplier: string | null; sheet: string | null; source_row: number | null };
export const displayTime = (value: string | null) => value ? new Date(value).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false }) : "未提供";

export default function InventoryCatalog({ storeId, refreshKey, expanded = false }: { storeId: string; refreshKey: number; expanded?: boolean }) {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    void supabase.rpc("get_pilot_inventory_catalog", { p_store_id: storeId }).then(({ data, error }) => {
      if (!active) return;
      setItems(Array.isArray(data) ? data as unknown as CatalogItem[] : []);
      setNotice(error ? "無法讀取品項與期初，請重新進入盤點頁。" : "");
    });
    return () => { active = false; };
  }, [storeId, refreshKey, revision]);

  async function fillOpening(event: FormEvent<HTMLFormElement>, productId: string) {
    event.preventDefault();
    const form = event.currentTarget;
    const raw = String(new FormData(form).get("opening") ?? "").trim();
    if (raw === "" || !Number.isFinite(Number(raw)) || Number(raw) < 0) {
      setNotice("請輸入有效期初；留白會保留未提供。"); return;
    }
    setBusy(true);
    const { error } = await supabase.rpc("fill_pilot_opening", { p_store_id: storeId, p_product_id: productId, p_quantity: Number(raw) });
    setNotice(error ? "無法補填：請確認權限，或此品項已提供期初。" : "期初已補填；已開始或送出的盤點仍保留原本的期初。");
    if (!error) { form.reset(); setRevision(value => value + 1); }
    setBusy(false);
  }

  return <details className="setup-panel inventory-catalog" open={expanded || (items.length > 0 && items.length <= 10)}>
    <summary>品項與期初（{items.length} 項）</summary>
    {!items.length && <p className="pilot-empty">尚無品項，請先匯入檔案。</p>}
    {!!items.length && <p className="helper">期初未提供仍可開始盤點。補填不會修改已開始或已送出盤點的紀錄。</p>}
    {items.map((item, index) => <article className="catalog-item" key={item.zone + ":" + item.product_id}>
      <b>{index + 1}. {item.name}</b><p>單位：{item.unit}｜區域：{item.zone || "未分類"}</p>
      <p>期初數量：<strong>{item.quantity ?? "未提供"}</strong>｜匯入時間：{displayTime(item.imported_at)}</p>
      <small>廠商：{item.supplier || "未提供"}｜工作表：{item.sheet || "未提供"}{item.source_row ? "，第 " + item.source_row + " 列" : ""}</small>
      {item.quantity === null && <form className="compact-form" onSubmit={event => fillOpening(event, item.product_id)}>
        <label>補填 {item.name} 期初<input name="opening" aria-label={item.name + "期初"} type="number" min="0" step="any" placeholder="未提供" required /></label>
        <button disabled={busy}>儲存期初</button>
      </form>}
    </article>)}
    {notice && <p role="status">{notice}</p>}
  </details>;
}
