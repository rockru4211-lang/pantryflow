"use client";

import { FormEvent, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase-browser";

type Store = { id: string; name: string; store_code: string };
type Product = { id: string; name: string; product_code: string; count_unit: string };
type ZoneProduct = { product_id: string; count_unit: string; sort_order: number; products: Product | Product[] };
type Zone = { id: string; name: string; sort_order: number; zone_products: ZoneProduct[] };
type CountSession = { id: string; status: string };
type Progress = { zone_id: string; status: string };

const productOf = (row: ZoneProduct) => Array.isArray(row.products) ? row.products[0] : row.products;

export default function CountWorkspace({ stores, organizationId, session }: {
  stores: Store[];
  organizationId: string;
  session: Session;
}) {
  const [storeId, setStoreId] = useState(stores[0]?.id || "");
  const [zones, setZones] = useState<Zone[]>([]);
  const [countSession, setCountSession] = useState<CountSession | null>(null);
  const [progress, setProgress] = useState<Progress[]>([]);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const selectedStore = stores.find(store => store.id === storeId);
  const productCount = zones.reduce((total, zone) => total + zone.zone_products.length, 0);

  async function loadCountData(nextStoreId = storeId) {
    if (!nextStoreId) return;
    setBusy(true);
    const { data: zoneData, error: zoneError } = await supabase
      .from("count_zones")
      .select("id,name,sort_order,zone_products(product_id,count_unit,sort_order,products(id,name,product_code,count_unit))")
      .eq("store_id", nextStoreId)
      .eq("is_active", true)
      .order("sort_order");
    if (zoneError) {
      setNotice("目前無法讀取盤點設定。");
      setBusy(false);
      return;
    }
    setZones((zoneData as unknown as Zone[]) ?? []);
    const { data: sessionData } = await supabase
      .from("inventory_count_sessions")
      .select("id,status")
      .eq("store_id", nextStoreId)
      .in("status", ["DRAFT", "IN_PROGRESS", "REVIEWING"])
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setCountSession(sessionData ?? null);
    if (sessionData) {
      const [{ data: progressData }, { data: draftData }] = await Promise.all([
        supabase.from("count_zone_progress").select("zone_id,status").eq("session_id", sessionData.id),
        supabase.from("count_drafts").select("product_id,quantity").eq("session_id", sessionData.id),
      ]);
      setProgress(progressData ?? []);
      setQuantities(Object.fromEntries((draftData ?? []).map(row => [row.product_id, String(row.quantity ?? "")])));
    } else {
      setProgress([]);
      setQuantities({});
    }
    setBusy(false);
  }

  // Initial remote data load; subsequent store changes load in the select handler.
  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(() => { void loadCountData(storeId); }, []);

  async function addZone(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    const { error } = await supabase.rpc("create_pilot_zone", { p_store_id: storeId, p_name: String(data.get("zone_name") || "") });
    setNotice(error ? "無法建立區域，請確認名稱與權限。" : "盤點區域已建立。");
    if (!error) { form.reset(); await loadCountData(); }
    setBusy(false);
  }

  async function addProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    const { data: productId, error } = await supabase.rpc("create_pilot_product", {
      p_store_id: storeId,
      p_product_code: String(data.get("product_code") || ""),
      p_name: String(data.get("product_name") || ""),
      p_count_unit: String(data.get("unit") || ""),
      p_purchase_unit: String(data.get("unit") || ""),
      p_opening_quantity: Number(data.get("opening_quantity") || 0),
    });
    const assignment = !error && productId
      ? await supabase.rpc("assign_pilot_product_to_zone", { p_zone_id: String(data.get("zone_id") || ""), p_product_id: productId })
      : { error };
    setNotice(assignment.error ? "無法建立品項，請檢查代碼是否重複。" : "盤點品項已建立並放入區域。");
    if (!assignment.error) { form.reset(); await loadCountData(); }
    setBusy(false);
  }

  async function startCount() {
    setBusy(true);
    const { error } = await supabase.rpc("create_pilot_count_session", { p_store_id: storeId });
    setNotice(error ? "請先確認每個區域都有品項與期初數量。" : "盤點已開始。");
    await loadCountData();
  }

  async function saveQuantity(zoneId: string, row: ZoneProduct, value: string) {
    if (!countSession || value === "" || Number(value) < 0) return;
    const { error } = await supabase.from("count_drafts").upsert({
      organization_id: organizationId,
      session_id: countSession.id,
      zone_id: zoneId,
      product_id: row.product_id,
      quantity: Number(value),
      unit: row.count_unit,
      entered_by: session.user.id,
      updated_at: new Date().toISOString(),
    }, { onConflict: "session_id,zone_id,product_id" });
    setNotice(error ? "暫存失敗，請再輸入一次。" : "已自動暫存");
  }

  async function completeZone(zone: Zone) {
    if (!countSession) return;
    const complete = zone.zone_products.every(row => quantities[row.product_id] !== undefined && quantities[row.product_id] !== "");
    if (!complete) { setNotice("請先填完這個區域的所有品項。"); return; }
    setBusy(true);
    const { error } = await supabase.rpc("complete_pilot_count_zone", { p_session_id: countSession.id, p_zone_id: zone.id });
    setNotice(error ? "送出失敗，請確認每個品項都有數量。" : "此區域已送出並留下盤點紀錄。");
    await loadCountData();
  }

  if (!stores.length) return <p className="pilot-empty">目前沒有可存取的門市。</p>;

  return <section className="count-workspace">
    <label className="store-select">目前門市<select value={storeId} onChange={event => { setStoreId(event.target.value); void loadCountData(event.target.value); }}>{stores.map(store => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label>
    <div className="count-heading"><div><small>{selectedStore?.store_code}</small><h2>盤點</h2></div>{countSession && <span>進行中</span>}</div>
    {!countSession && <details className="setup-panel" open={!zones.length}>
      <summary>盤點設定</summary>
      <form onSubmit={addZone} className="compact-form"><label>新增區域<input name="zone_name" placeholder="例如冷藏庫" required /></label><button disabled={busy}>建立區域</button></form>
      {!!zones.length && <form onSubmit={addProduct} className="compact-form product-form">
        <label>區域<select name="zone_id">{zones.map(zone => <option key={zone.id} value={zone.id}>{zone.name}</option>)}</select></label>
        <label>品項<input name="product_name" placeholder="例如鮮奶油" required /></label>
        <label>品項代碼<input name="product_code" placeholder="例如 MILK001" required /></label>
        <label>單位<input name="unit" placeholder="瓶、包、公斤" required /></label>
        <label>目前數量<input name="opening_quantity" type="number" min="0" step="0.01" required /></label>
        <button disabled={busy}>建立品項</button>
      </form>}
      {!!productCount && <div className="setup-summary">已設定 {zones.length} 個區域、{productCount} 個品項</div>}
    </details>}
    {!countSession && !!productCount && <button className="pilot-primary start-count" onClick={startCount} disabled={busy}>開始盤點</button>}
    {countSession && <div className="zone-stack">{zones.map(zone => {
      const done = progress.find(item => item.zone_id === zone.id)?.status === "COMPLETED";
      return <article className="count-zone" key={zone.id}>
        <header><b>{zone.name}</b><span>{done ? "已送出" : `${zone.zone_products.length} 項`}</span></header>
        {!done && zone.zone_products.map(row => { const product = productOf(row); return <label className="count-row" key={row.product_id}><span><b>{product?.name}</b><small>{product?.product_code}</small></span><input aria-label={`${product?.name}數量`} type="number" min="0" step="0.01" value={quantities[row.product_id] ?? ""} onChange={event => setQuantities(current => ({ ...current, [row.product_id]: event.target.value }))} onBlur={event => saveQuantity(zone.id, row, event.target.value)} /><em>{row.count_unit}</em></label>; })}
        {!done && <button onClick={() => completeZone(zone)} disabled={busy}>送出此區域</button>}
      </article>;
    })}</div>}
    {notice && <p className="count-notice" role="status">{notice}</p>}
  </section>;
}
