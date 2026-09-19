"use client";

import { FormEvent, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase-browser";
import type { Json } from "@/lib/database.types";

type CatalogItem = { product_id: string; name: string; unit: string; zone: string; quantity: number | null; imported_at: string | null; supplier: string | null; sheet: string | null; source_row: number | null; is_active?: boolean };
export const displayTime = (value: string | null) => value ? new Date(value).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false }) : "未提供";

export default function InventoryCatalog({ storeId, refreshKey, expanded = false, canEdit = true }: { storeId: string; refreshKey: number; expanded?: boolean; canEdit?: boolean }) {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [selectedIds,setSelectedIds]=useState<string[]>([]);
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
  async function lifecycle(mode:"DISABLE"|"RESTORE",ids:string[]) {
    if(!ids.length)return;
    setBusy(true);
    const {error}=await supabase.rpc("app_operation",{
      p_store_id:storeId,
      p_action:"product.lifecycle",
      p_data:{ids,mode} as unknown as Json,
      p_request_id:crypto.randomUUID(),
    });
    setNotice(error
      ? "目前無法調整品項，請確認權限後重試。"
      : mode==="DISABLE"
        ? `已移出 ${ids.length} 個品項；歷史、進貨與成本資料都會保留。`
        : `已恢復 ${ids.length} 個品項。`);
    if(!error){setSelectedIds([]);setRevision(value=>value+1);}
    setBusy(false);
  }

  const activeItems=items.filter(item=>item.is_active!==false);
  const removedItems=items.filter(item=>item.is_active===false);
  const uniqueActive=[...new Map(activeItems.map(item=>[item.product_id,item])).values()];
  const uniqueRemoved=[...new Map(removedItems.map(item=>[item.product_id,item])).values()];

  return <details className="setup-panel inventory-catalog" open={expanded || (activeItems.length > 0 && activeItems.length <= 10)}>
    <summary>品項與期初（{activeItems.length} 項）</summary>
    {!activeItems.length && <p className="pilot-empty">目前沒有使用中的品項；可從「已移出品項」恢復。</p>}
    {!!activeItems.length && <p className="helper">季節性或暫停使用的食材可直接「移出品項」，歷史資料不會刪除，需要時再恢復。</p>}
    {canEdit&&uniqueActive.length>1&&<details className="setup-panel"><summary>批次移出品項</summary>{uniqueActive.map(item=><label className="checkbox-row" key={item.product_id}><input type="checkbox" checked={selectedIds.includes(item.product_id)} onChange={e=>setSelectedIds(e.target.checked?[...selectedIds,item.product_id]:selectedIds.filter(id=>id!==item.product_id))}/>{item.name}</label>)}<button type="button" className="shell-secondary full" disabled={!selectedIds.length||busy} onClick={()=>void lifecycle("DISABLE",selectedIds)}>移出所選（{selectedIds.length}）</button></details>}
    {activeItems.map((item, index) => <article className="catalog-item" key={item.zone + ":" + item.product_id}>
      <b>{index + 1}. {item.name}</b><p>單位：{item.unit}｜區域：{item.zone || "未分類"}</p>
      <p>期初數量：<strong>{item.quantity ?? "未提供"}</strong>｜匯入時間：{displayTime(item.imported_at)}</p>
      <small>廠商：{item.supplier || "未提供"}｜工作表：{item.sheet || "未提供"}{item.source_row ? "，第 " + item.source_row + " 列" : ""}</small>
      {canEdit && item.quantity === null && <form className="compact-form" onSubmit={event => fillOpening(event, item.product_id)}>
        <label>補填 {item.name} 期初<input name="opening" aria-label={item.name + "期初"} type="number" min="0" step="any" placeholder="未提供" required /></label>
        <button disabled={busy}>儲存期初</button>
      </form>}
      {canEdit&&<button type="button" className="text-button" disabled={busy} onClick={()=>void lifecycle("DISABLE",[item.product_id])}>移出品項</button>}
    </article>)}
    {!!uniqueRemoved.length&&<details className="setup-panel"><summary>已移出品項（{uniqueRemoved.length}）</summary><p className="helper">季節重新上線時直接恢復，不需要重新建檔。</p>{uniqueRemoved.map(item=><div className="shell-list-row" key={item.product_id}><span><strong>{item.name}</strong><small>{item.unit}・原資料保留</small></span>{canEdit&&<button type="button" className="text-button" disabled={busy} onClick={()=>void lifecycle("RESTORE",[item.product_id])}>恢復</button>}</div>)}</details>}
    {notice && <p role="status">{notice}</p>}
  </details>;
}
