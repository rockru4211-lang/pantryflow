"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { supabase } from "@/lib/supabase-browser";
import type { Json } from "@/lib/database.types";
import type { Zone } from "./count-workspace";

export default function ZoneEditor({ zone, zones, locked, onSaved }: {
  zone: Zone; zones: Zone[]; locked: boolean; onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(zone.name);
  const [productIds, setProductIds] = useState(zone.zone_products.map(item => item.product_id));
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<string[]>([]);
  const [candidateQuery, setCandidateQuery] = useState("");
  const [keepExisting,setKeepExisting]=useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [expected] = useState<Json>(() => Object.fromEntries(zones.map(item => [item.id, {
    name: item.name,
    product_ids: [...item.zone_products].sort((a,b) => a.sort_order-b.sort_order || a.product_id.localeCompare(b.product_id)).map(row => row.product_id),
  }])));
  const catalog = new Map(zones.flatMap(item => item.zone_products.map(row => {
    const product = Array.isArray(row.products) ? row.products[0] : row.products;
    const supplier = Array.isArray(product?.suppliers) ? product.suppliers[0]?.name : product?.suppliers?.name;
    return [row.product_id, { ...product, id: row.product_id, supplier: supplier || "未提供", unit: row.count_unit }] as const;
  })));
  const matches = (id: string, search: string) => {
    const item = catalog.get(id);
    return `${item?.name} ${item?.product_code} ${item?.supplier}`.toLowerCase().includes(search.trim().toLowerCase());
  };
  const available = [...catalog.keys()].filter(id => !productIds.includes(id) && matches(id,candidateQuery));

  function move(index: number, offset: number) {
    setProductIds(ids => {
      const next = [...ids];
      [next[index],next[index+offset]] = [next[index+offset],next[index]];
      return next;
    });
  }
  async function save() {
    if (!name.trim()) { setNotice("請填寫區域名稱。"); return; }
    setBusy(true); setNotice("");
    const { error } = await supabase.rpc("save_pilot_zone_configuration_v2", {
      p_zone_id: zone.id, p_name: name.trim(), p_product_ids: productIds, p_expected_config: expected,
      p_keep_existing: keepExisting,
    });
    if (error) {
      const message = error.message;
      setNotice(message.includes("COUNT_IN_PROGRESS") ? "本次盤點已開始，完成後再調整區域。"
        : message.includes("ZONE_NAME_EXISTS") || error.code === "23505" ? "此門市已有同名區域，請使用其他名稱。"
        : message.includes("ZONE_CONFIGURATION_CHANGED") ? "區域資料已有變動，請返回清單重新開啟後編輯。"
        : message.includes("CHOOSE_DESTINATION_ZONE") ? "請進入目的區域，將未分類品項移入。"
        : "儲存失敗，請確認網路後重試。");
      setBusy(false); return;
    }
    await onSaved();
  }

  return <div className="zone-editor">
    {locked && <p className="count-feedback">本次盤點進行中，完成後再調整區域。</p>}
    <label className="zone-editor-field">區域名稱<input value={name} maxLength={80} disabled={locked || busy} onChange={event => setName(event.target.value)} /></label>
    {!locked && <details className="zone-add-panel"><summary><Plus size={17} /> 加入／移入品項</summary>
      <label className="zone-editor-field">搜尋可移入品項<input type="search" value={candidateQuery} placeholder="品名、代碼或供應商" onChange={event => setCandidateQuery(event.target.value)} /></label>
      <label className="zone-keep-existing"><input type="checkbox" checked={keepExisting} onChange={e=>setKeepExisting(e.target.checked)}/> 同時保留原區域，分區盤點</label>
      <div className="zone-candidates">{available.map(id => <label key={id}>
        <input type="checkbox" checked={candidates.includes(id)} disabled={busy} onChange={event => setCandidates(items => event.target.checked ? [...items,id] : items.filter(value => value!==id))} />
        <span><strong>{catalog.get(id)?.name}</strong><small>{zones.filter(item => item.zone_products.some(row => row.product_id===id)).map(item=>item.name).join("、")}・{catalog.get(id)?.supplier}</small></span>
      </label>)}</div>
      {!available.length && <p className="shell-note">沒有符合的其他品項。</p>}
      {candidates.length > 0 && <button className="shell-secondary full" type="button" disabled={busy} onClick={() => { setProductIds(ids => [...ids,...candidates.filter(id => !ids.includes(id))]); setCandidates([]); }}>移入已選 {candidates.length} 項</button>}
    </details>}
    <div className="shell-section-head"><h2>區內品項（{productIds.length} 項）</h2><span>依盤點順序</span></div>
    {productIds.length > 0 && <label className="zone-editor-field">搜尋區內品項<input type="search" value={query} placeholder="品名、代碼或供應商" onChange={event => setQuery(event.target.value)} /></label>}
    <div className="shell-card zone-editor-items">{productIds.map((id,index) => matches(id,query) && <article key={id}>
      <div><strong>{index+1}. {catalog.get(id)?.name}</strong><small>{catalog.get(id)?.supplier}・{catalog.get(id)?.unit}</small></div>
      {!locked && <div className="zone-item-actions">
        <button type="button" aria-label={`上移 ${catalog.get(id)?.name}`} disabled={busy || index===0} onClick={() => move(index,-1)}><ArrowUp size={17} /></button>
        <button type="button" aria-label={`下移 ${catalog.get(id)?.name}`} disabled={busy || index===productIds.length-1} onClick={() => move(index,1)}><ArrowDown size={17} /></button>
        {name.replace(/\s/g,"") !== "未分類" && <button type="button" aria-label={`將 ${catalog.get(id)?.name} 移回未分類`} disabled={busy} onClick={() => setProductIds(ids => ids.filter(value=>value!==id))}><X size={16} /><span>移回未分類</span></button>}
      </div>}
    </article>)}</div>
    {!productIds.length && <p className="shell-note">此區尚無品項，從上方移入即可。</p>}
    {!locked && <div className="zone-editor-save"><p role="status">{notice || "完成調整後儲存，才會更新區域設定。"}</p><button className="shell-primary full" type="button" disabled={busy} onClick={save}>{busy ? "儲存中…" : "儲存此區域"}</button></div>}
  </div>;
}
