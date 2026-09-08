"use client";

import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase-browser";
import { parseInventoryWorkbook, readInventoryWorkbook } from "@/lib/inventory-import";
import ImportHistory from "./import-history";
import InventoryCatalog from "./inventory-catalog";
import CountDetails from "./count-details";
import ZoneEditor from "./zone-editor";
import { Check, ChevronRight, ClipboardList, FileText, Package } from "lucide-react";

type Store = { id: string; name: string; store_code: string };
type Supplier = { name: string };
type Product = {
  id: string;
  name: string;
  product_code: string;
  count_unit: string;
  specification: string | null;
  suppliers: Supplier | Supplier[] | null;
};
type ZoneProduct = { product_id: string; count_unit: string; sort_order: number; products: Product | Product[] };
export type Zone = { id: string; name: string; sort_order: number; zone_products: ZoneProduct[] };
type CountSession = { id: string; status: string };
type Progress = { zone_id: string; status: string };
type Discrepancy = { id: string; product_id: string; difference: number | null; status: string };
type ImportResult = {
  sheetName: string;
  sourceRow: number;
  name: string;
  supplierName: string;
  status: "ADDED" | "EXISTING" | "FAILED" | "SKIPPED";
  reason: string;
};
type ImportReport = {
  sheetCount: number;
  parsedRows: number;
  added: number;
  existing: number;
  failed: number;
  skipped: number;
  results: ImportResult[];
};

async function sha256Hex(data: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
}

function safeStorageName(fileName: string) {
  const normalized = fileName.normalize("NFKC").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || "inventory-file";
}

const productOf = (row: ZoneProduct) => Array.isArray(row.products) ? row.products[0] : row.products;

type CountPage = "overview" | "import" | "setup" | "zone-edit" | "catalog" | "source" | "entry" | "complete" | "details" | "review";

export default function CountWorkspace({ stores, organizationId, session, initialPage = "overview", onBack, canViewFullDetails = false }: {
  stores: Store[];
  organizationId: string;
  session: Session;
  initialPage?: "overview" | "import" | "setup";
  onBack: () => void;
  canViewFullDetails?: boolean;
}) {
  const storeId = stores[0]?.id || "";
  const [page, setPage] = useState<CountPage>(initialPage);
  const [selectedZoneId, setSelectedZoneId] = useState("");
  const [zones, setZones] = useState<Zone[]>([]);
  const [countSession, setCountSession] = useState<CountSession | null>(null);
  const [progress, setProgress] = useState<Progress[]>([]);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(true);
  const [notice, setNotice] = useState("");
  const [discrepancies, setDiscrepancies] = useState<Discrepancy[]>([]);
  const [importComplete, setImportComplete] = useState(false);
  const [importReport, setImportReport] = useState<ImportReport | null>(null);
  const [importRevision, setImportRevision] = useState(0);
  const [submittedTotals, setSubmittedTotals] = useState({ zones: 0, products: 0 });
  const loadRequestId = useRef(0);
  const pendingSaves = useRef(Promise.resolve());
  const entryInputs = useRef<Record<string, HTMLInputElement | null>>({});
  const workspaceElement = useRef<HTMLElement | null>(null);

  const selectedStore = stores.find(store => store.id === storeId);
  const productCount = zones.reduce((total, zone) => total + zone.zone_products.length, 0);
  const selectedZone = zones.find(zone => zone.id === selectedZoneId);
  const validQuantity = (zone: Zone, row: ZoneProduct) => {
    const value = quantities[`${zone.id}:${row.product_id}`];
    return value !== undefined && value !== "" && Number.isFinite(Number(value)) && Number(value) >= 0;
  };
  const filledCount = (zone: Zone) => zone.zone_products.filter(row => validQuantity(zone, row)).length;
  const completedZoneCount = progress.filter(item => item.status === "COMPLETED").length;
  function goTo(next: CountPage) { setNotice(""); setPage(next); }

  async function loadCountData(nextStoreId = storeId) {
    if (!nextStoreId) return;
    const requestId = ++loadRequestId.current;
    setBusy(true);
    const { data: zoneData, error: zoneError } = await supabase
      .from("count_zones")
      .select("id,name,sort_order,zone_products(product_id,count_unit,sort_order,products(id,name,product_code,count_unit,specification,suppliers(name)))")
      .eq("store_id", nextStoreId)
      .eq("is_active", true)
      .order("sort_order");
    if (requestId !== loadRequestId.current) return;
    if (zoneError) {
      setNotice("目前無法讀取盤點設定。");
      setBusy(false);
      return;
    }
    setZones(((zoneData as unknown as Zone[]) ?? []).map(zone => ({ ...zone, zone_products: [...zone.zone_products].sort((a, b) => a.sort_order - b.sort_order) })));
    const { data: activeSession } = await supabase
      .from("inventory_count_sessions")
      .select("id,status")
      .eq("store_id", nextStoreId)
      .in("status", ["DRAFT", "IN_PROGRESS", "REVIEWING"])
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (requestId !== loadRequestId.current) return;
    let sessionData = activeSession;
    if (!sessionData) {
      const { data: latestCompleted } = await supabase
        .from("inventory_count_sessions")
        .select("id,status")
        .eq("store_id", nextStoreId)
        .in("status", ["CLOSED"])
        .order("completed_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (requestId !== loadRequestId.current) return;
      sessionData = latestCompleted;
    }
    setCountSession(sessionData ?? null);
    if (sessionData && ["REVIEWING", "CLOSED"].includes(sessionData.status)) {
      const { data: entries } = await supabase.from("count_entries").select("zone_id,product_id").eq("session_id", sessionData.id);
      if (requestId !== loadRequestId.current) return;
      setSubmittedTotals({ zones: new Set(entries?.map(row => row.zone_id)).size, products: new Set(entries?.map(row => `${row.zone_id}:${row.product_id}`)).size });
    }
    if (sessionData) {
      const [{ data: progressData }, { data: draftData }, discrepancyResult] = await Promise.all([
        supabase.from("count_zone_progress").select("zone_id,status").eq("session_id", sessionData.id),
        supabase.from("count_drafts").select("zone_id,product_id,quantity").eq("session_id", sessionData.id).eq("entered_by", session.user.id),
        canViewFullDetails
          ? supabase.from("inventory_count_discrepancies").select("id,product_id,difference,status").eq("session_id", sessionData.id)
          : Promise.resolve({ data: [] as Discrepancy[] }),
      ]);
      if (requestId !== loadRequestId.current) return;
      setProgress(progressData ?? []);
      setQuantities(Object.fromEntries((draftData ?? []).map(row => [`${row.zone_id}:${row.product_id}`, String(row.quantity ?? "")])));
      setDiscrepancies(discrepancyResult.data ?? []);
    } else {
      setProgress([]);
      setQuantities({});
      setDiscrepancies([]);
    }
    setBusy(false);
  }

  // The parent keys this workspace by store so navigation cannot retain another store's data.
  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(() => { void loadCountData(storeId); }, []);

  useEffect(() => { workspaceElement.current?.closest(".shell-content")?.scrollTo({ top: 0 }); }, [page]);

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
      p_opening_quantity: String(data.get("opening_quantity") ?? "").trim() === "" ? null : Number(data.get("opening_quantity")),
    });
    const assignment = !error && productId
      ? await supabase.rpc("assign_pilot_product_to_zone", { p_zone_id: String(data.get("zone_id") || ""), p_product_id: productId })
      : { error };
    setNotice(assignment.error ? "無法建立品項，請檢查代碼是否重複。" : "盤點品項已建立並放入區域。");
    if (!assignment.error) { form.reset(); await loadCountData(); }
    setBusy(false);
  }

  async function importInventory(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setNotice("正在匯入盤點品項…");
    try {
      const fileData = await file.arrayBuffer();
      const workbook = readInventoryWorkbook(fileData, file.name);
      const parsed = parseInventoryWorkbook(workbook);
      if (!parsed.rows.length) throw new Error(parsed.failures[0]?.reason || "檔案中沒有可匯入的品項");
      const fileSha256 = await sha256Hex(fileData);
      const storagePath = `${organizationId}/${storeId}/${fileSha256}/${safeStorageName(file.name)}`;
      const upload = await supabase.storage.from("inventory-imports").upload(storagePath, fileData, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });
      if (upload.error && !/duplicate|already exists|resource exists/i.test(upload.error.message)) throw upload.error;
      const { data, error } = await supabase.rpc("import_pilot_inventory", {
        p_store_id: storeId,
        p_rows: {
          file: {
            original_filename: file.name,
            file_sha256: fileSha256,
            storage_path: storagePath,
            sheet_names: parsed.sheets.map(sheet => sheet.sheetName),
          },
          rows: parsed.rows.map(row => ({
            source_id: row.sourceId,
            sheet_name: row.sheetName,
            source_row: row.sourceRow,
            product_code: row.productCode,
            generated_code: row.generatedCode,
            name: row.name,
            specification: row.specification,
            count_unit: row.unit,
            supplier_name: row.supplierName,
            zone_name: row.zoneName,
            opening_quantity: row.openingQuantity,
            missing_fields: row.missingFields,
            raw_values: row.rawValues,
            merged_ranges: row.mergedRanges,
          })),
        },
      });
      if (error) throw error;
      const databaseResults = Array.isArray(data) ? data as Array<{
        sheet_name?: string;
        source_row?: number;
        name?: string;
        supplier_name?: string;
        status?: string;
        reason?: string;
      }> : [];
      const results: ImportResult[] = [
        ...databaseResults.map(row => ({
          sheetName: row.sheet_name || "Sheet",
          sourceRow: row.source_row || 0,
          name: row.name || "",
          supplierName: row.supplier_name || "",
          status: (["ADDED", "EXISTING", "FAILED"].includes(row.status || "") ? row.status : "FAILED") as ImportResult["status"],
          reason: row.reason || "資料庫未回傳原因",
        })),
        ...parsed.failures.map(row => ({ ...row, name: "", supplierName: "", status: "FAILED" as const })),
        ...parsed.skipped.map(row => ({ ...row, name: "", supplierName: "", status: "SKIPPED" as const })),
      ].sort((left, right) => workbook.SheetNames.indexOf(left.sheetName) - workbook.SheetNames.indexOf(right.sheetName) || left.sourceRow - right.sourceRow);
      const added = results.filter(row => row.status === "ADDED").length;
      const existing = results.filter(row => row.status === "EXISTING").length;
      const failed = results.filter(row => row.status === "FAILED").length;
      const skipped = results.filter(row => row.status === "SKIPPED").length;
      setImportReport({ sheetCount: parsed.sheets.length, parsedRows: parsed.rows.length, added, existing, failed, skipped, results });
      setImportRevision(value => value + 1);
      setNotice(`偵測 ${parsed.sheets.length} 個工作表、${parsed.rows.length} 筆；新增 ${added} 項、已存在 ${existing} 項、失敗 ${failed} 項、略過 ${skipped} 項。`);
      setImportComplete(added > 0 || existing > 0);
      await loadCountData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知錯誤";
      setImportReport(null);
      setNotice(`匯入失敗：${message}`);
    }
    event.target.value = "";
    setBusy(false);
  }

  async function startCount() {
    setBusy(true);
    const { error } = await supabase.rpc("create_pilot_count_session", { p_store_id: storeId });
    setNotice(error ? (error.message.includes("ACTIVE_COUNT_SESSION_EXISTS") ? "已有進行中或待審的盤點，請先完成該次盤點。" : "無法開始盤點，請確認每個區域都有品項且你有主管權限。") : "盤點已開始；期初未提供的品項仍可填寫實盤。");
    await loadCountData();
    if (!error) goTo("overview");
  }

  async function saveQuantity(zoneId: string, row: ZoneProduct, value: string) {
    if (!countSession || (value !== "" && (!Number.isFinite(Number(value)) || Number(value) < 0))) return;
    const sessionId = countSession.id;
    pendingSaves.current = pendingSaves.current.then(async () => {
      const result = value === ""
        ? await supabase.from("count_drafts").delete().eq("session_id", sessionId).eq("zone_id", zoneId).eq("product_id", row.product_id).eq("entered_by", session.user.id)
        : await supabase.from("count_drafts").upsert({
          organization_id: organizationId, session_id: sessionId, zone_id: zoneId,
          product_id: row.product_id, quantity: Number(value), unit: row.count_unit,
          entered_by: session.user.id, updated_at: new Date().toISOString(),
        }, { onConflict: "session_id,zone_id,product_id" });
      setNotice(result.error ? "暫存失敗，請按「暫存」重試。" : "已自動儲存");
    });
    await pendingSaves.current;
  }

  async function persistZone(zone: Zone) {
    if (!countSession) return { error: new Error("盤點尚未開始") };
    await pendingSaves.current;
    const rows = zone.zone_products.filter(row => quantities[`${zone.id}:${row.product_id}`] !== undefined && quantities[`${zone.id}:${row.product_id}`] !== "").map(row => ({
      organization_id: organizationId,
      session_id: countSession.id,
      zone_id: zone.id,
      product_id: row.product_id,
      quantity: Number(quantities[`${zone.id}:${row.product_id}`]),
      unit: row.count_unit,
      entered_by: session.user.id,
      updated_at: new Date().toISOString(),
    }));
    if (!rows.length) return { error: null };
    return supabase.from("count_drafts").upsert(rows, { onConflict: "session_id,zone_id,product_id" });
  }

  async function saveDraft(zone: Zone) {
    setBusy(true);
    const { error } = await persistZone(zone);
    setNotice(error ? "暫存失敗，請確認網路再試。" : "已暫存；重新登入後可繼續盤點。");
    setBusy(false);
  }

  async function completeZone(zone: Zone) {
    if (!countSession) return;
    const complete = zone.zone_products.every(row => quantities[`${zone.id}:${row.product_id}`] !== undefined && quantities[`${zone.id}:${row.product_id}`] !== "" && Number.isFinite(Number(quantities[`${zone.id}:${row.product_id}`])) && Number(quantities[`${zone.id}:${row.product_id}`]) >= 0);
    if (!complete) {
      const missing = zone.zone_products.filter(row => !validQuantity(zone, row));
      setNotice(`還有 ${missing.length} 項未完成，請填寫實際數量。`);
      entryInputs.current[missing[0]?.product_id]?.focus();
      return;
    }
    setBusy(true);
    const saved = await persistZone(zone);
    if (saved.error) {
      setNotice("暫存失敗，請確認網路後再送出。");
      setBusy(false);
      return;
    }
    const { error } = await supabase.rpc("complete_pilot_count_zone", { p_session_id: countSession.id, p_zone_id: zone.id });
    setNotice(error ? "送出失敗，請確認每個品項都有數量。" : "此區域已送出並留下盤點紀錄。");
    await loadCountData();
    if (!error) goTo("complete");
  }

  if (!stores.length) return <p className="pilot-empty">目前沒有可存取的門市。</p>;

  const submitted = Boolean(countSession && ["REVIEWING", "CLOSED"].includes(countSession.status));

  const activeCount = Boolean(countSession && !submitted);
  const activeZones = zones.filter(zone => zone.zone_products.length > 0);
  const allComplete = submitted || (activeZones.length > 0 && activeZones.every(zone => progress.some(item => item.zone_id === zone.id && item.status === "COMPLETED")));
  const heading = page === "entry" ? `${selectedZone?.name || "區域"}盤點`
    : page === "import" ? "匯入檔案建立品項"
    : page === "setup" ? "設定儲物區域與品項"
    : page === "zone-edit" ? `${selectedZone?.name || "區域"}品項`
    : page === "catalog" ? "品項與期初"
    : page === "source" ? "匯入來源"
    : page === "details" ? "本次盤點明細"
    : page === "review" ? "盤點差異總覽"
    : canViewFullDetails ? "盤點管理" : "今日盤點";
  const backLabel = page === "overview" ? "返回首頁" : page === "entry" ? "返回區域進度" : page === "zone-edit" ? "返回儲物區域" : "返回盤點任務";
  const summary = <div className="shell-metric-grid count-metrics">
    <div><span>完成區域</span><strong>{submitted ? submittedTotals.zones : completedZoneCount} / {activeZones.length}</strong></div>
    <div><span>本次品項</span><strong>{submitted ? submittedTotals.products : productCount}</strong></div>
  </div>;
  const managementLinks = <section className="shell-section"><div className="shell-section-head"><h2>盤點設定</h2></div>
    <div className="shell-card setup-step-list">
      <button onClick={() => goTo("import")}><b><FileText size={18} /></b><span><strong>匯入檔案建立品項</strong><small>保留原工作表與品項順序</small></span><i>›</i></button>
      <button onClick={() => goTo("setup")}><b><Package size={18} /></b><span><strong>儲物區域與品項</strong><small>{zones.length} 個區域・{productCount} 項</small></span><i>›</i></button>
      <button onClick={() => goTo("catalog")}><b><ClipboardList size={18} /></b><span><strong>品項與期初</strong><small>查看品項、補填未提供的期初</small></span><i>›</i></button>
      <button onClick={() => goTo("source")}><b><FileText size={18} /></b><span><strong>查看完整匯入來源</strong><small>原始檔案、廠商與工作表</small></span><i>›</i></button>
    </div>
  </section>;

  return <section ref={workspaceElement} className="count-workspace count-flow">
    <button className="shell-back" type="button" onClick={() => page === "overview" ? onBack() : goTo(page === "zone-edit" ? "setup" : "overview")}>‹ <span>{backLabel}</span></button>
    {page !== "complete" && <div className="shell-page-intro">
      <span className="page-kicker">{page === "entry" && selectedZone ? `區域盤點・${filledCount(selectedZone)} / ${selectedZone.zone_products.length}` : selectedStore?.store_code}</span>
      <h1>{heading}</h1>
      {page === "entry" && <p>數量會自動儲存；完成前會檢查漏填項目。</p>}
    </div>}

    {page === "overview" && <>
      {busy && !zones.length && <p role="status">正在讀取盤點…</p>}
      {activeCount && <>
        {summary}
        <section className="shell-section"><div className="shell-section-head"><h2>區域進度</h2><span>{completedZoneCount} / {activeZones.length} 已完成</span></div>
          <div className="shell-card zone-progress-list">{activeZones.map((zone, index) => {
            const done = progress.some(item => item.zone_id === zone.id && item.status === "COMPLETED");
            const filled = filledCount(zone);
            return <button key={zone.id} className={`zone-progress-row is-${done ? "complete" : filled ? "active" : "pending"}`} disabled={done || busy} onClick={() => { setSelectedZoneId(zone.id); goTo("entry"); }}>
              <span className="zone-marker">{done ? <Check size={18} /> : index + 1}</span>
              <span className="zone-info"><strong>{zone.name}</strong><small>{zone.zone_products.length} 項{!done && filled > 0 ? `・已填 ${filled} 項` : ""}</small></span>
              <span className="zone-state">{done ? "已完成" : filled ? "繼續盤點" : "開始盤點"}</span>
            </button>;
          })}</div>
        </section>
      </>}
      {submitted && <>
        <section className="completion-state compact"><span><Check /></span><h2>本次盤點完成</h2><p>{submittedTotals.zones} 個區域・{submittedTotals.products} 項已保存</p></section>
        {canViewFullDetails && <div className="shell-button-stack">
          <button className="shell-primary" onClick={() => goTo("review")}>查看盤點差異{discrepancies.length ? `（${discrepancies.length} 項）` : ""}</button>
          <button className="shell-secondary" onClick={() => goTo("details")}>查看本次盤點明細</button>
          {countSession?.status === "CLOSED" && <button className="shell-secondary" onClick={startCount} disabled={busy}>開始下一次盤點</button>}
        </div>}
      </>}
      {!countSession && !busy && (canViewFullDetails ? <section className="shell-card task-hero count-ready">
        <span className="status-pill">{productCount ? "尚未開始" : "尚無品項"}</span>
        <h2>{productCount ? "建立本次盤點" : "先匯入現有品項"}</h2>
        <p>{productCount ? `${activeZones.length} 個區域・${productCount} 項，期初未提供也可開始。` : "選擇 Excel／CSV 檔案即可開始。"}</p>
        <button className="shell-primary full" onClick={() => productCount ? void startCount() : goTo("import")} disabled={busy}>{productCount ? "開始盤點" : "選擇匯入檔案"}</button>
      </section> : <p className="pilot-empty">主管尚未開始盤點，請聯絡主管。</p>)}
      {canViewFullDetails && (activeCount ? <details className="count-management"><summary>盤點設定與資料</summary>{managementLinks}</details> : managementLinks)}
    </>}

    {page === "entry" && selectedZone && activeCount && <>
      <div className="progress count-progress" aria-label={`已填 ${filledCount(selectedZone)} / ${selectedZone.zone_products.length} 項`}><i style={{ width: `${filledCount(selectedZone) / Math.max(1, selectedZone.zone_products.length) * 100}%` }} /></div>
      <div className="shell-card count-entry-list">{selectedZone.zone_products.map(row => {
        const product = productOf(row);
        const supplier = Array.isArray(product?.suppliers) ? product.suppliers[0] : product?.suppliers;
        return <label key={row.product_id}>
          <span><strong>{product?.name}</strong><small className="supplier-note">供應商：{supplier?.name || "未提供"}</small></span>
          <input ref={element => { entryInputs.current[row.product_id] = element; }} aria-label={`${product?.name}數量`} className="count-number" type="number" inputMode="decimal" min="0" step="any" placeholder="未填" value={quantities[`${selectedZone.id}:${row.product_id}`] ?? ""} onChange={event => setQuantities(current => ({ ...current, [`${selectedZone.id}:${row.product_id}`]: event.target.value }))} onBlur={event => { void saveQuantity(selectedZone.id, row, event.target.value); }} />
          <b>{row.count_unit}</b>
        </label>;
      })}</div>
      <div className="count-entry-actions">
        <p role="status">{notice || `已填 ${filledCount(selectedZone)} / ${selectedZone.zone_products.length} 項`}</p>
        <div><button className="shell-secondary" onClick={() => saveDraft(selectedZone)} disabled={busy}>暫存</button><button className="shell-primary" onClick={() => completeZone(selectedZone)} disabled={busy}>{busy ? "儲存中…" : "完成此區域"}</button></div>
      </div>
    </>}

    {page === "complete" && <>
      <section className="completion-state"><span><Check /></span><h1>{allComplete ? "本次盤點完成" : `${selectedZone?.name || "本區"}盤點完成`}</h1><p>{allComplete ? `${submittedTotals.zones} 個區域・${submittedTotals.products} 項已保存` : `本區共 ${selectedZone?.zone_products.length || 0} 項，已保存`}</p></section>
      <div className="shell-button-stack">
        {!allComplete && <button className="shell-primary" onClick={() => goTo("overview")}>繼續下一區</button>}
        {allComplete && canViewFullDetails && <button className="shell-secondary" onClick={() => goTo("review")}>查看盤點差異</button>}
        {allComplete && canViewFullDetails && <button className="shell-secondary" onClick={() => goTo("details")}>查看本次盤點明細</button>}
        <button className="shell-primary" onClick={onBack}>返回首頁</button>
      </div>
    </>}

    {canViewFullDetails && page === "import" && <>
      <section className="shell-card upload-shell"><span><FileText /></span><h2>選擇 Excel／CSV</h2><p>{activeCount ? "本次盤點進行中，完成後可再次匯入。" : "期初空白保留「未提供」，沒有區域先放「未分類」。"}</p><label className="import-button">{busy ? "處理中…" : "選擇檔案"}<input type="file" accept=".xlsx,.xls,.csv" onChange={importInventory} disabled={busy || activeCount} /></label></section>
      {importReport && <section className="shell-card import-results count-import-result"><h2>匯入完成</h2><p>新增 {importReport.added}・既有 {importReport.existing}・失敗 {importReport.failed}</p><small>{importReport.sheetCount} 個工作表・{importReport.parsedRows} 筆品項・略過 {importReport.skipped} 列</small>
        {(importReport.failed > 0 || importReport.skipped > 0) && <details><summary>查看需確認的列</summary><ul>{importReport.results.filter(row => row.status === "FAILED" || row.status === "SKIPPED").map((row, index) => <li key={index}>{row.sheetName} 第 {row.sourceRow} 列｜{row.name}：{row.reason}</li>)}</ul></details>}
      </section>}
      {productCount > 0 && <div className="shell-button-stack"><button className="shell-primary" onClick={() => goTo("overview")}>{activeCount ? "返回本次盤點" : "前往盤點"}</button><button className="shell-secondary" onClick={() => goTo("catalog")}>查看品項與期初</button></div>}
    </>}

    {canViewFullDetails && page === "setup" && <>
      <div className="shell-card zone-progress-list">{zones.map(zone => <button key={zone.id} className="zone-progress-row" type="button" onClick={() => { setSelectedZoneId(zone.id); goTo("zone-edit"); }}><span className="zone-marker"><Package size={18} /></span><span className="zone-info"><strong>{zone.name}</strong><small>{zone.zone_products.length} 項・點入編輯</small></span><ChevronRight size={18} /></button>)}</div>
      {productCount === 0 && !importComplete ? <div className="shell-button-stack"><p className="shell-note">先匯入檔案，再補充少量品項。</p><button className="shell-primary" onClick={() => goTo("import")}>匯入檔案建立品項</button></div> : <>
        {!activeCount ? <>
          <details className="setup-panel"><summary>新增儲物區域</summary><form onSubmit={addZone} className="compact-form"><label>區域名稱<input name="zone_name" placeholder="例如冷藏庫" required /></label><button disabled={busy}>建立區域</button></form></details>
          <details className="setup-panel"><summary>少量手動新增品項</summary><form onSubmit={addProduct} className="compact-form product-form">
            <label>區域<select name="zone_id">{zones.map(zone => <option key={zone.id} value={zone.id}>{zone.name}</option>)}</select></label>
            <label>品項<input name="product_name" required /></label><label>品項代碼<input name="product_code" required /></label><label>單位<input name="unit" required /></label><label>期初數量（可留白）<input name="opening_quantity" type="number" min="0" step="any" placeholder="未提供" /></label><button disabled={busy}>建立品項</button>
          </form></details>
        </> : <p className="shell-note">本次盤點進行中，完成後再新增區域與品項。</p>}
        <div className="shell-button-stack"><button className="shell-secondary" onClick={() => goTo("catalog")}>查看品項與期初</button><button className="shell-primary" onClick={() => goTo("overview")}>返回盤點任務</button></div>
      </>}
    </>}
    {canViewFullDetails && page === "zone-edit" && selectedZone && <ZoneEditor key={selectedZone.id} zone={selectedZone} zones={zones} locked={activeCount} onSaved={async () => { await loadCountData(); setImportRevision(value => value + 1); goTo("setup"); setNotice("區域設定已儲存。"); }} />}
    {canViewFullDetails && page === "catalog" && <InventoryCatalog key={`catalog:${storeId}:${importRevision}`} storeId={storeId} refreshKey={importRevision} expanded />}
    {canViewFullDetails && page === "source" && <ImportHistory key={`${storeId}:${importRevision}`} storeId={storeId} refreshKey={importRevision} expanded />}
    {canViewFullDetails && page === "details" && submitted && <CountDetails sessionId={countSession!.id} />}
    {canViewFullDetails && page === "review" && submitted && <>
      <p className="shell-note">{discrepancies.length ? `${discrepancies.length} 項有差異；期初未提供的品項不計算差異。` : "本次沒有需要處理的差異。"}</p>
      <div className="shell-card discrepancy-list">{discrepancies.map(item => {
        const product = zones.flatMap(zone => zone.zone_products).map(productOf).find(row => row?.id === item.product_id);
        return <article key={item.id}><header><strong>{product?.name || "盤點品項"}</strong><span>{item.difference !== null && item.difference > 0 ? "+" : ""}{item.difference} {product?.count_unit}</span></header></article>;
      })}</div>
      <div className="shell-button-stack"><button className="shell-secondary" onClick={() => goTo("details")}>查看本次盤點明細</button></div>
    </>}
    {notice && page !== "entry" && <p className="count-feedback" role="status">{notice}</p>}
  </section>;
}
