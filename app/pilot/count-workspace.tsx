"use client";

import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase-browser";
import { parseInventoryWorkbook, readInventoryWorkbook } from "@/lib/inventory-import";
import ImportHistory from "./import-history";
import InventoryCatalog from "./inventory-catalog";
import CountDetails from "./count-details";
import CountScope from "./count-scope";
import ContextExpiryForm from "./context-expiry-form";
import { displayTime } from "./inventory-catalog";
import { validCountQuantity, type CountItem } from "@/lib/count-flow";
import { withCountSaveTimeout } from "@/lib/count-save";
import type { Json } from "@/lib/database.types";
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
type CountSession = { id: string; status: string; started_at: string; completed_at: string | null; snapshot: { zones?: CountItem[] }; paper_required: boolean; paper_completed_at: string | null; paper_reviewed_at: string | null };
type Progress = { zone_id: string; status: string; completed_at: string | null; completed_by: string | null };
type Discrepancy = { id: string; product_id: string; difference: number | null; previous_quantity: number | null; previous_confirmed_at: string | null; estimated_quantity: number | null; reason: string | null; status: string };
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

type CountPage = "overview" | "import" | "setup" | "zone-edit" | "catalog" | "source" | "entry" | "complete" | "details" | "review" | "management" | "scope" | "paper" | "paper-complete" | "zone-details";

export default function CountWorkspace({ stores, organizationId, session, initialPage = "overview", onBack, canViewFullDetails = false, canManage = canViewFullDetails, businessType = "SINGLE_RESTAURANT", initialSessionId, registerLeave }: {
  stores: Store[];
  organizationId: string;
  session: Session;
  initialPage?: "overview" | "import" | "setup" | "management" | "start" | "details";
  canManage?: boolean; businessType?: string; initialSessionId?: string; registerLeave?: (handler: (() => Promise<boolean>) | null) => void;
  onBack: () => void;
  canViewFullDetails?: boolean;
}) {
  const storeId = stores[0]?.id || "";
  const [page, setPage] = useState<CountPage>(initialPage === "start" ? "overview" : initialPage);
  const [selectedZoneId, setSelectedZoneId] = useState("");
  const [expiryOpen, setExpiryOpen] = useState(false);
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
  const draftVersions = useRef<Record<string,string | null>>({});
  const savedQuantities = useRef<Record<string,string>>({});
  const dirtyQuantities = useRef<Record<string,string>>({});
  const saveFailure = useRef(false);
  const failedKeys=useRef(new Set<string>());
  const [resolution, setResolution] = useState<Record<string,string>>({});
  const [resolutionQuantity, setResolutionQuantity] = useState<Record<string,string>>({});
  const [completedBy, setCompletedBy] = useState("");
  const [paperCompletedBy,setPaperCompletedBy]=useState("");
  const loadRequestId = useRef(0);
  const pendingSaves = useRef<Promise<void> | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const entryInputs = useRef<Record<string, HTMLInputElement | null>>({});
  const workspaceElement = useRef<HTMLElement | null>(null);

  const selectedStore = stores.find(store => store.id === storeId);
  const productCount = zones.reduce((total, zone) => total + zone.zone_products.length, 0);
  const liveZones = countSession && countSession.snapshot?.zones
    ? zones.map(zone => ({...zone, zone_products: zone.zone_products.filter(row => countSession.snapshot.zones!.some(item => item.zone_id===zone.id && item.product_id===row.product_id))})).filter(zone=>zone.zone_products.length)
    : zones;
  const selectedZone = (["entry","complete","zone-details"].includes(page) ? liveZones : zones).find(zone => zone.id === selectedZoneId);
  const validQuantity = (zone: Zone, row: ZoneProduct) => {
    const value = quantities[`${zone.id}:${row.product_id}`];
    return validCountQuantity(value);
  };
  const filledCount = (zone: Zone) => zone.zone_products.filter(row => validQuantity(zone, row)).length;
  const completedZoneCount = progress.filter(item => item.status === "COMPLETED").length;
  function goTo(next: CountPage) { setNotice(""); setPage(next); }
  async function leaveEntry() {
    await flushDrafts();
    if (saveFailure.current || Object.keys(dirtyQuantities.current).length) { setNotice("數量尚未儲存，請按暫存重試後再離開。"); return false; }
    return true;
  }
  async function back() {
    if(!await leaveEntry()) return;
    if(page==="overview") { onBack(); return; }
    if(page==="entry") { await loadCountData(); goTo("overview"); }
    else goTo(page==="paper-complete"?"paper":page==="zone-edit"?"setup":page==="paper"||page==="zone-details"?"complete":["import","setup","catalog","source","scope"].includes(page)?"management":"overview");
  }

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
    const { data: activeSession, error: sessionError } = await supabase
      .from("inventory_count_sessions")
      .select("id,status,started_at,completed_at,snapshot,paper_required,paper_completed_at,paper_reviewed_at")
      .eq("store_id", nextStoreId)
      .in("status", ["DRAFT", "IN_PROGRESS", "REVIEWING"])
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (requestId !== loadRequestId.current) return;
    if(sessionError){setNotice('目前無法讀取盤點進度，請重新進入。');setBusy(false);return;}
    let sessionData = activeSession;
    if (!sessionData) {
      const { data: latestCompleted } = await supabase
        .from("inventory_count_sessions")
        .select("id,status,started_at,completed_at,snapshot,paper_required,paper_completed_at,paper_reviewed_at")
        .eq("store_id", nextStoreId)
        .in("status", ["CLOSED"])
        .order("completed_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (requestId !== loadRequestId.current) return;
      sessionData = latestCompleted;
    }
    if(initialSessionId) {
      const { data: historic } = await supabase.from("inventory_count_sessions").select("id,status,started_at,completed_at,snapshot,paper_required,paper_completed_at,paper_reviewed_at").eq("id",initialSessionId).eq("store_id",nextStoreId).maybeSingle();
      sessionData=historic;
    }
    setCountSession(sessionData as unknown as CountSession ?? null);
    if (sessionData && ["REVIEWING", "CLOSED"].includes(sessionData.status)) {
      const { data: entries } = await supabase.from("count_entries").select("zone_id,product_id").eq("session_id", sessionData.id);
      if (requestId !== loadRequestId.current) return;
      setSubmittedTotals({ zones: new Set(entries?.map(row => row.zone_id)).size, products: new Set(entries?.map(row => `${row.zone_id}:${row.product_id}`)).size });
    }
    if (sessionData) {
      const [{ data: progressData, error: progressError }, { data: draftData, error: draftError }, discrepancyResult] = await Promise.all([
        supabase.from("count_zone_progress").select("zone_id,status,completed_at,completed_by").eq("session_id", sessionData.id),
        supabase.from("count_drafts").select("zone_id,product_id,quantity,updated_at").eq("session_id", sessionData.id),
        canViewFullDetails
          ? supabase.from("inventory_count_discrepancies").select("id,product_id,difference,status,previous_quantity,previous_confirmed_at,estimated_quantity,reason").eq("session_id", sessionData.id)
          : Promise.resolve({ data: [] as Discrepancy[] }),
      ]);
      if (requestId !== loadRequestId.current) return;
      if(progressError||draftError){setNotice('目前無法讀取共同進度，請重新進入。');setBusy(false);return;}
      setProgress(progressData ?? []);
      const values=Object.fromEntries((draftData ?? []).map(row => [`${row.zone_id}:${row.product_id}`, String(row.quantity ?? "")]));
      draftVersions.current=Object.fromEntries((draftData ?? []).map(row=>[`${row.zone_id}:${row.product_id}`,row.updated_at]));
      savedQuantities.current=values; dirtyQuantities.current={}; failedKeys.current.clear(); saveFailure.current=false; setQuantities(values);
      if(["REVIEWING","CLOSED"].includes(sessionData.status)) {
        const {data: result}=await supabase.rpc("get_pilot_count_results",{p_session_id:sessionData.id});
        const rows=Array.isArray(result)?result as unknown as {zone_id:string;entered_by:string}[]:[];
        setSubmittedTotals({zones:new Set(rows.map(r=>r.zone_id)).size,products:rows.length});
        const {data:completion}=await supabase.rpc('get_pilot_count_completion',{p_session_id:sessionData.id});
        setCompletedBy((completion as {completed_by?:string}|null)?.completed_by||'已保存');
        setPaperCompletedBy((completion as {paper_completed_by?:string}|null)?.paper_completed_by||'未提供');
      }
      setDiscrepancies(discrepancyResult.data ?? []);
    } else {
      setProgress([]);
      setQuantities({});
      setDiscrepancies([]);
    }
    if(initialSessionId && sessionData && ["DRAFT","IN_PROGRESS"].includes(sessionData.status)) setPage("overview");
    setBusy(false);
  }

  // The parent keys this workspace by store so navigation cannot retain another store's data.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if(initialPage==="start") void startCount(); else void loadCountData(storeId); }, []);
  // Navigation waits for the same serialized save queue as the input controls.
  useEffect(() => { registerLeave?.(leaveEntry); return () => registerLeave?.(null); });

  useEffect(() => {
    workspaceElement.current?.closest(".shell-content")?.scrollTo({ top: 0 });
    if(page==="entry" && countSession){try{const last=localStorage.getItem(`count-position:${session.user.id}:${countSession.id}`);if(last)entryInputs.current[last]?.scrollIntoView({block:"center"});}catch{}}
  }, [page, countSession, session.user.id]);

  async function addZone(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    const { data: newZoneId, error } = await supabase.rpc("create_pilot_zone", { p_store_id: storeId, p_name: String(data.get("zone_name") || "") });
    setNotice(error ? "無法建立區域，請確認名稱與權限。" : "盤點區域已建立。");
    if (!error) { form.reset(); await loadCountData(); setSelectedZoneId(newZoneId!); goTo("zone-edit"); }
    setBusy(false);
  }

  async function addProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    const { data: productId, error } = await supabase.rpc("create_pilot_product", {
      p_store_id: storeId,
      p_product_code: String(data.get("product_code") || `ITEM-${crypto.randomUUID().slice(0,8).toUpperCase()}`),
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

  async function startCount(selection?: {zone_id:string;product_id:string}[]) {
    setBusy(true);
    const { error } = await supabase.rpc("start_pilot_count", { p_store_id: storeId, p_selection: selection as unknown as Json ?? null });
    await loadCountData();
    if(!error) goTo("overview");
    else setNotice(error.message.includes("PREVIOUS_COUNT_REVIEW_REQUIRED") ? "請先完成上一筆盤點的差異／紙本確認。" : "無法開始盤點，請確認門市已有品項且有執行權限。");
  }
  function saveQuantity(zoneId: string, row: ZoneProduct, value: string) {
    if(!countSession) return;
    const key=`${zoneId}:${row.product_id}`;
    dirtyQuantities.current[key]=value;
    if(value!==""&&!validCountQuantity(value)){setNotice("請填有效數量，未填不會補成 0。");return;}
    setNotice("數量已保留，正在儲存…");
    if(saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current=setTimeout(()=>{void flushDrafts();},400);
  }
  async function flushDrafts(): Promise<void> {
    if(saveTimer.current){clearTimeout(saveTimer.current);saveTimer.current=null;}
    if(pendingSaves.current){await pendingSaves.current;return;}
    if(!countSession)return;
    const sessionId=countSession.id;
    const job=(async()=>{
      while(Object.keys(dirtyQuantities.current).length){
        const changes=Object.entries(dirtyQuantities.current).filter(([,value])=>value===""||validCountQuantity(value)).slice(0,1000);
        if(!changes.length)return;
        // One atomic request for all pending rows, rather than a request per
        // keystroke that can leave a 96-row zone waiting on dozens of timeouts.
        const entries=changes.map(([key,value])=>{
          const [zone_id,product_id]=key.split(":");
          return {zone_id,product_id,quantity:value===""?null:Number(value),expected_updated_at:draftVersions.current[key]||null};
        });
        try {
          const {data,error}=await withCountSaveTimeout(signal=>supabase.rpc("save_pilot_count_drafts",{p_session_id:sessionId,p_entries:entries}).abortSignal(signal));
          if(error)throw error;
          if(!Array.isArray(data)||data.length!==changes.length)throw new Error("COUNT_SAVE_RESPONSE_INVALID");
          const versions=new Map((data as {zone_id:string;product_id:string;updated_at:string}[]).map(r=>[`${r.zone_id}:${r.product_id}`,r.updated_at]));
          for(const [key,value] of changes){
            const stamp=versions.get(key);
            if(!stamp)throw new Error("COUNT_SAVE_RESPONSE_INVALID");
            draftVersions.current[key]=stamp;savedQuantities.current[key]=value;
            if(dirtyQuantities.current[key]===value)delete dirtyQuantities.current[key];
            failedKeys.current.delete(key);
          }
          saveFailure.current=failedKeys.current.size>0;
          setNotice(Object.keys(dirtyQuantities.current).length?"數量已保留，正在儲存…":"已自動儲存");
        }catch(error){
          for(const [key] of changes)failedKeys.current.add(key);
          saveFailure.current=true;
          const message=error&&typeof error==="object"&&"message" in error?String(error.message):"";
          setNotice(message.includes("COUNT_DRAFT_CHANGED")?"此品項已由他人更新。您填的數量仍保留，請先確認共同進度。":"尚未儲存，您填的數量仍保留。請按「暫存」重試。");
          return;
        }
      }
    })();
    pendingSaves.current=job;
    try{await job;}finally{pendingSaves.current=null;}
  }
  async function persistZone() {
    await flushDrafts();
    return {error:saveFailure.current||Object.keys(dirtyQuantities.current).length?new Error("UNSAVED"):null};
  }
  async function saveDraft() {
    setBusy(true);
    try{const {error}=await persistZone();if(!error)setNotice("已暫存，可返回或重新登入續填。");}
    catch{setNotice("尚未儲存，您填的數量仍保留。請再按暫存。");}
    finally{setBusy(false);}
  }
  async function paperComplete(review=false) {
    if(!countSession)return;
    setBusy(true);
    try {
      const {error}=await withCountSaveTimeout(signal=>supabase.rpc("complete_pilot_count_paper",{p_session_id:countSession.id,p_review:review}).abortSignal(signal));
      if(error){setNotice("目前無法完成，請確認盤點與謄寫狀態。");return;}
      await loadCountData();goTo(review?"complete":"paper-complete");setNotice(review?"主管紙本確認已保存。":"謄寫完成，已保存經手人與時間。");
    } catch { setNotice("謄寫完成尚未確認，請重試。已保存的紀錄不會重複新增。"); }
    finally {setBusy(false);}
  }
  async function resolveDifference(item:Discrepancy) {
    if(!resolution[item.id]){setNotice("請選擇差異原因。");return;}
    const quantity=resolutionQuantity[item.id]??String(item.estimated_quantity);
    if(!validCountQuantity(quantity)){setNotice("請填寫確認數量。");return;}
    setBusy(true);const {error}=await supabase.rpc("resolve_pilot_count_discrepancy",{p_discrepancy_id:item.id,p_reason:resolution[item.id],p_action:"CORRECTION",p_quantity:Number(quantity)});
    await loadCountData();setNotice(error?"差異尚未完成，請重新進入確認。":"差異原因已保存，原始盤點保留。");
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
    try {
      const saved = await persistZone();
      if (saved.error) return;
      const { error } = await withCountSaveTimeout(signal=>supabase.rpc("complete_pilot_count_zone", { p_session_id: countSession.id, p_zone_id: zone.id }).abortSignal(signal));
      if(error){setNotice("送出尚未完成，已儲存的數量仍在，請重試。");return;}
      await loadCountData();
      goTo("complete");
    }catch{setNotice("送出尚未確認，已儲存的數量仍在。請重試或返回查看。");}
    finally{setBusy(false);}
  }

  if (!stores.length) return <p className="pilot-empty">目前沒有可存取的門市。</p>;

  const submitted = Boolean(countSession && ["REVIEWING", "CLOSED"].includes(countSession.status));

  const activeCount = Boolean(countSession && !submitted);
  const activeZones = liveZones.filter(zone => zone.zone_products.length > 0);
  const allComplete = submitted || (activeZones.length > 0 && activeZones.every(zone => progress.some(item => item.zone_id === zone.id && item.status === "COMPLETED")));
  const heading = page === "entry" ? `${selectedZone?.name || "區域"}盤點`
     : page === "management" ? "盤點設定與資料"
    : page === "scope" ? "勾選本次盤點品項"
    : page === "paper" ? "紙本謄寫表"
    : page === "import" ? "匯入檔案建立品項"
    : page === "setup" ? "設定儲物區域與品項"
    : page === "zone-edit" ? `${selectedZone?.name || "區域"}品項`
    : page === "catalog" ? "品項與期初"
    : page === "source" ? "匯入來源"
    : page === "details" ? "本次盤點明細"
    : page === "zone-details" ? "本區已盤清單"
    : page === "review" ? "盤點差異總覽"
    : canViewFullDetails ? "盤點管理" : "今日盤點";
  const backLabel = page === "paper-complete" ? "返回紙本謄寫表" : page === "paper" ? "返回完成頁" : page === "overview" ? "返回首頁" : page === "entry" ? "返回區域進度" : page === "zone-edit" ? "返回儲物區域" : ["import","setup","catalog","source","scope"].includes(page) ? "返回盤點設定" : "返回盤點任務";
  const summary = <div className="shell-metric-grid count-metrics">
    <div><span>完成區域</span><strong>{submitted ? submittedTotals.zones : completedZoneCount} / {submitted ? submittedTotals.zones : activeZones.length}</strong></div>
    <div><span>本次品項</span><strong>{submitted ? submittedTotals.products : activeCount ? liveZones.reduce((n,z)=>n+z.zone_products.length,0) : productCount}</strong></div>
  </div>;
  const managementLinks = <section className="shell-section"><div className="shell-section-head"><h2>盤點設定</h2></div>
    <div className="shell-card setup-step-list">
      {canManage && <button onClick={() => goTo("import")}><b><FileText size={18} /></b><span><strong>匯入檔案建立品項</strong><small>保留原工作表與品項順序</small></span><i>›</i></button>}
      {canManage && <button onClick={() => goTo("setup")}><b><Package size={18} /></b><span><strong>儲物區域與品項</strong><small>{zones.length} 個區域・{productCount} 項</small></span><i>›</i></button>}
      <button onClick={() => goTo("catalog")}><b><ClipboardList size={18} /></b><span><strong>品項與期初</strong><small>查看品項、補填未提供的期初</small></span><i>›</i></button>
      <button onClick={() => goTo("source")}><b><FileText size={18} /></b><span><strong>查看完整匯入來源</strong><small>原始檔案、廠商與工作表</small></span><i>›</i></button>
    </div>
  </section>;

  return <section ref={workspaceElement} className="count-workspace count-flow">
    <button className="shell-back" type="button" onClick={() => void back()}>‹ <span>{backLabel}</span></button>
    {!["complete","paper-complete"].includes(page) && <div className="shell-page-intro">
      <span className="page-kicker">{page === "entry" && selectedZone ? `區域盤點・${filledCount(selectedZone)} / ${selectedZone.zone_products.length}` : selectedStore?.store_code}</span>
      <h1>{heading}</h1>
    {page === "entry" && <p>數量會自動儲存；完成前會檢查漏填項目。</p>}
    {page === "paper" && <p>依門市匯入表的工作表、列次與品項順序呈現。</p>}
    </div>}

      {page === "management" && canViewFullDetails && <>{managementLinks}{canManage && <button className="shell-secondary full" disabled={activeCount} onClick={()=>goTo("scope")}>勾選本次盤點品項</button>}</>}
    {page === "scope" && canManage && !activeCount && <CountScope zones={zones} previous={countSession?.snapshot?.zones||[]} onStart={startCount}/>}
    {page === "paper" && submitted && <CountDetails sessionId={countSession!.id} paper onPaperComplete={countSession?.paper_completed_at?undefined:()=>paperComplete()}/>}
    {page === "paper-complete" && submitted && <>
      <section className="completion-state"><span><Check /></span><h1>紙本謄寫已完成</h1><p>經手人：{paperCompletedBy}・{displayTime(countSession?.paper_completed_at||null)}</p></section>
      <section className="shell-card completion-card"><strong>下一步</strong><p>等待門市主管確認／稽查<br/>系統原始盤點數量不會被覆蓋</p></section>
      <button className="shell-primary full" onClick={onBack}>返回首頁</button>
    </>}
    {page === "zone-details" && countSession && <CountDetails sessionId={countSession.id} zoneId={selectedZoneId}/>}

    {page === "overview" && <>
      {busy && !zones.length && <p role="status">正在讀取盤點…</p>}
      {activeCount && <>
        {summary}
        <section className="shell-section"><div className="shell-section-head"><h2>區域進度</h2><span>{completedZoneCount} / {activeZones.length} 已完成</span></div>
          <div className="shell-card zone-progress-list">{activeZones.map((zone, index) => {
            const done = progress.some(item => item.zone_id === zone.id && item.status === "COMPLETED");
            const filled = filledCount(zone);
            return <button key={zone.id} className={`zone-progress-row is-${done ? "complete" : filled ? "active" : "pending"}`} disabled={busy} onClick={() => { setSelectedZoneId(zone.id); goTo(done ? "zone-details" : "entry"); }}>
              <span className="zone-marker">{done ? <Check size={18} /> : index + 1}</span>
              <span className="zone-info"><strong>{zone.name}</strong><small>{zone.zone_products.length} 項{!done && filled > 0 ? `・已填 ${filled} 項` : ""}</small></span>
              <span className="zone-state">{done ? "已完成" : filled ? "繼續盤點" : "開始盤點"}</span>
            </button>;
          })}</div>
        </section>
      </>}
      {submitted && <>
        <section className="completion-state compact"><span><Check /></span><h2>{countSession?.paper_required&&!countSession.paper_completed_at?"實際盤點已完成":"本次盤點完成"}</h2><p>{submittedTotals.zones} 個區域・{submittedTotals.products} 項已保存</p><p>{displayTime(countSession?.completed_at||null)}<br/>完成者：{completedBy||"已保存"}</p></section>
        <div className="shell-button-stack">
          {countSession?.paper_required&&<button className="shell-primary" onClick={()=>goTo("paper")}>{countSession.paper_completed_at?"查看紙本謄寫表":"開啟紙本謄寫表"}</button>}
          <button className="shell-secondary" onClick={()=>goTo("details")}>查看本次盤點明細</button>
          {!countSession?.paper_required&&<CountDetails sessionId={countSession!.id} management={canViewFullDetails} outputOnly/>}
          {canViewFullDetails&&<button className="shell-secondary" onClick={()=>goTo("review")}>查看盤點差異{discrepancies.some(d=>d.status==='PENDING')?`（${discrepancies.filter(d=>d.status==='PENDING').length} 項待確認）`:''}</button>}
          {canManage&&countSession?.paper_completed_at&&!countSession.paper_reviewed_at&&<button className="shell-primary" onClick={()=>paperComplete(true)}>確認紙本已完成</button>}
          {canManage&&!initialSessionId&&countSession?.status==='CLOSED'&&(!countSession.paper_required||countSession.paper_reviewed_at)&&businessType!=='CHAIN_RESTAURANT'&&<button className="shell-primary" onClick={()=>startCount()} disabled={busy}>開始下一次盤點</button>}
        </div>
      </>}
      {!countSession && !busy && (canManage ? <section className="shell-card task-hero count-ready">
        <span className="status-pill">{productCount ? "尚未開始" : "尚無品項"}</span>
        <h2>{productCount ? "開始盤點" : "先匯入現有品項"}</h2>
        <p>{productCount ? `${activeZones.length} 個區域・${productCount} 項` : "選擇 Excel／CSV 檔案即可開始。"}</p>
        <button className="shell-primary full" onClick={() => productCount ? void startCount() : goTo("import")} disabled={busy}>{productCount ? "開始盤點" : "選擇匯入檔案"}</button>
      </section> : <p className="pilot-empty">主管尚未開始盤點，請聯絡主管。</p>)}
      {canViewFullDetails && <button className="text-button count-management-link" onClick={()=>goTo("management")}>盤點設定與資料 ›</button>}
    </>}

    {page === "entry" && selectedZone && activeCount && <>
      <button type="button" className="text-button context-expiry-entry" onClick={() => setExpiryOpen(true)}>加入效期提醒</button>
      {expiryOpen && countSession && <ContextExpiryForm storeId={storeId} contextType="COUNT" contextId={countSession.id} zoneId={selectedZone.id} onClose={saved => { setExpiryOpen(false); if (saved) setNotice("效期提醒已儲存。"); }} />}
      <div className="progress count-progress" aria-label={`已填 ${filledCount(selectedZone)} / ${selectedZone.zone_products.length} 項`}><i style={{ width: `${filledCount(selectedZone) / Math.max(1, selectedZone.zone_products.length) * 100}%` }} /></div>
      <div className="shell-card count-entry-list">{selectedZone.zone_products.map(row => {
        const product = productOf(row);
        const supplier = Array.isArray(product?.suppliers) ? product.suppliers[0] : product?.suppliers;
        return <div className="count-entry-row" key={row.product_id}>
          <span><strong>{product?.name}</strong><details className="count-item-more"><summary>廠商與規格</summary><small>{supplier?.name || "未提供"}｜{product?.specification || "未提供"}</small></details></span>
          <input ref={element => { entryInputs.current[row.product_id] = element; }} aria-label={`${product?.name}數量`} className="count-number" type="number" inputMode="decimal" min="0" step="any" placeholder="未填" value={quantities[`${selectedZone.id}:${row.product_id}`] ?? ""} onChange={event => { const value=event.target.value;setQuantities(current => ({ ...current, [`${selectedZone.id}:${row.product_id}`]: value }));void saveQuantity(selectedZone.id,row,value);try{localStorage.setItem(`count-position:${session.user.id}:${countSession?.id}`,row.product_id);}catch{} }} />
          <b>{row.count_unit}</b>
        </div>;
      })}</div>
      <div className="count-entry-actions">
        <p role="status">{notice || `已填 ${filledCount(selectedZone)} / ${selectedZone.zone_products.length} 項`}</p>{saveFailure.current&&<button className="text-button" onClick={()=>void loadCountData()}>重新讀取共同進度（捨棄未存變更）</button>}
        <div><button className="shell-secondary" onClick={() => saveDraft()} disabled={busy}>暫存</button><button className="shell-primary" onClick={() => completeZone(selectedZone)} disabled={busy}>{busy ? "儲存中…" : "完成此區域"}</button></div>
      </div>
    </>}

    {page === "complete" && <>
      <section className="completion-state"><span><Check /></span><h1>{allComplete ? countSession?.paper_required&&!countSession.paper_completed_at?"實際盤點已完成":"本次盤點完成" : `${selectedZone?.name || "本區"}盤點完成`}</h1><p>{allComplete ? `${submittedTotals.zones} 個區域・${submittedTotals.products} 項已保存` : `本區共 ${selectedZone?.zone_products.length || 0} 項，已保存`}</p>{allComplete&&<p>{displayTime(countSession?.completed_at||null)}<br/>完成者：{completedBy}</p>}</section>
      <div className="shell-button-stack">
        {!allComplete&&<><button className="shell-secondary" onClick={()=>goTo("zone-details")}>查看已盤清單</button><button className="shell-primary" onClick={()=>goTo("overview")}>繼續下一區</button></>}
        {allComplete&&countSession?.paper_required&&<button className="shell-primary" onClick={()=>goTo("paper")}>{countSession.paper_completed_at?"查看紙本謄寫表":"開啟紙本謄寫表"}</button>}
        {allComplete&&<button className="shell-secondary" onClick={()=>goTo("details")}>查看本次盤點明細</button>}
        {allComplete&&!countSession?.paper_required&&<CountDetails sessionId={countSession!.id} management={canViewFullDetails} outputOnly/>}
        {allComplete&&canViewFullDetails&&discrepancies.length>0&&<button className="shell-secondary" onClick={()=>goTo("review")}>查看盤點差異</button>}
        {allComplete&&canManage&&!initialSessionId&&countSession?.status==='CLOSED'&&(!countSession.paper_required||countSession.paper_reviewed_at)&&businessType!=='CHAIN_RESTAURANT'&&<button className="shell-primary" disabled={busy} onClick={()=>startCount()}>開始下一次盤點</button>}
        <button className={allComplete?"shell-primary":"text-button"} onClick={onBack}>返回首頁</button>
      </div>
    </>}

    {canManage && page === "import" && <>
      <section className="shell-card upload-shell"><span><FileText /></span><h2>選擇 Excel／CSV</h2><p>{activeCount ? "本次盤點進行中，完成後可再次匯入。" : "期初空白保留「未提供」，沒有區域先放「未分類」。"}</p><label className="import-button">{busy ? "處理中…" : "選擇檔案"}<input type="file" accept=".xlsx,.xls,.csv" onChange={importInventory} disabled={busy || activeCount} /></label></section>
      {importReport && <section className="shell-card import-results count-import-result"><h2>匯入完成</h2><p>新增 {importReport.added}・既有 {importReport.existing}・失敗 {importReport.failed}</p><small>{importReport.sheetCount} 個工作表・{importReport.parsedRows} 筆品項・略過 {importReport.skipped} 列</small>
        {(importReport.failed > 0 || importReport.skipped > 0) && <details><summary>查看需確認的列</summary><ul>{importReport.results.filter(row => row.status === "FAILED" || row.status === "SKIPPED").map((row, index) => <li key={index}>{row.sheetName} 第 {row.sourceRow} 列｜{row.name}：{row.reason}</li>)}</ul></details>}
      </section>}
      {productCount > 0 && <div className="shell-button-stack"><button className="shell-primary" onClick={() => activeCount||submitted ? goTo("overview") : void startCount()}>{activeCount ? "返回本次盤點" : submitted ? "查看盤點結果" : "開始盤點"}</button><button className="shell-secondary" onClick={() => goTo("catalog")}>查看品項與期初</button></div>}
    </>}

    {canManage && page === "setup" && <>
      <div className="shell-card zone-progress-list">{zones.map(zone => <button key={zone.id} className="zone-progress-row" type="button" onClick={() => { setSelectedZoneId(zone.id); goTo("zone-edit"); }}><span className="zone-marker"><Package size={18} /></span><span className="zone-info"><strong>{zone.name}</strong><small>{zone.zone_products.length} 項・點入編輯</small></span><ChevronRight size={18} /></button>)}</div>
      {productCount === 0 && !importComplete ? <div className="shell-button-stack"><p className="shell-note">先匯入檔案，再補充少量品項。</p><button className="shell-primary" onClick={() => goTo("import")}>匯入檔案建立品項</button></div> : <>
        {!activeCount ? <>
          <details className="setup-panel"><summary>新增儲物區域</summary><form onSubmit={addZone} className="compact-form"><label>區域名稱<input name="zone_name" placeholder="例如冷藏庫" required /></label><button disabled={busy}>建立並配置品項</button></form></details>
          <details className="setup-panel"><summary>少量手動新增品項</summary><form onSubmit={addProduct} className="compact-form product-form">
            <label>區域<select name="zone_id">{zones.map(zone => <option key={zone.id} value={zone.id}>{zone.name}</option>)}</select></label>
            <label>品項<input name="product_name" required /></label><label>單位<input name="unit" required /></label><label>期初數量（可留白）<input name="opening_quantity" type="number" min="0" step="any" placeholder="未提供" /></label><button disabled={busy}>建立品項</button>
          </form></details>
        </> : <p className="shell-note">本次盤點進行中，完成後再新增區域與品項。</p>}
        <div className="shell-button-stack"><button className="shell-secondary" onClick={() => goTo("catalog")}>查看品項與期初</button><button className="shell-primary" onClick={() => goTo("overview")}>返回盤點任務</button></div>
      </>}
    </>}
    {canManage && page === "zone-edit" && selectedZone && <ZoneEditor key={selectedZone.id} zone={selectedZone} zones={zones} locked={activeCount} onSaved={async () => { await loadCountData(); setImportRevision(value => value + 1); goTo("setup"); setNotice("區域設定已儲存。"); }} />}
    {canViewFullDetails && page === "catalog" && <InventoryCatalog canEdit={canManage} key={`catalog:${storeId}:${importRevision}`} storeId={storeId} refreshKey={importRevision} expanded />}
    {canViewFullDetails && page === "source" && <ImportHistory key={`${storeId}:${importRevision}`} storeId={storeId} refreshKey={importRevision} expanded />}
    {page === "details" && submitted && <CountDetails sessionId={countSession!.id} management={canViewFullDetails} />}
    {canViewFullDetails && page === "review" && submitted && <>
      <p className="shell-note">{discrepancies.length ? `${discrepancies.length} 項有差異；期初未提供的品項不計算差異。` : "本次沒有需要處理的差異。"}</p>
      <div className="shell-card discrepancy-list">{discrepancies.map(item => {
        const product = zones.flatMap(zone => zone.zone_products).map(productOf).find(row => row?.id === item.product_id);
        return <article key={item.id}><header><strong>{product?.name || countSession?.snapshot?.zones?.find(p=>p.product_id===item.product_id)?.product_name || "盤點品項"}</strong><span>{item.difference !== null && item.difference > 0 ? "+" : ""}{item.difference} {product?.count_unit}</span></header>
          <p>{displayTime(item.previous_confirmed_at)}：{item.previous_quantity??"未提供"} → {displayTime(countSession?.completed_at||null)}：{item.estimated_quantity}</p>
          {item.status==='PENDING'&&canManage?<><label className="zone-editor-field">差異原因<select aria-label={`差異原因 ${product?.name}`} value={resolution[item.id]||''} onChange={e=>setResolution(r=>({...r,[item.id]:e.target.value}))}><option value="">請選擇原因</option>{[['INPUT_ERROR','輸入錯誤'],['MISSED_OR_WRONG_ZONE','漏盤／錯區'],['WASTE_NOT_RECORDED','報廢未登'],['TRANSFER_NOT_RECORDED','移轉／借用未登'],['RECEIPT_NOT_RECORDED','進貨未登'],['OTHER','其他']].map(([v,t])=><option key={v} value={v}>{t}</option>)}</select></label><label className="zone-editor-field">確認數量<input type="number" min="0" step="any" value={resolutionQuantity[item.id]??String(item.estimated_quantity)} onChange={e=>setResolutionQuantity(r=>({...r,[item.id]:e.target.value}))}/></label><button className="shell-primary" disabled={busy} onClick={()=>resolveDifference(item)}>保存原因與確認數量</button></>:<p>{item.status==='PENDING'?'待主管確認':'已處理'}{item.reason?`・${({INPUT_ERROR:'輸入錯誤',MISSED_OR_WRONG_ZONE:'漏盤／錯區',WASTE_NOT_RECORDED:'報廢未登',TRANSFER_NOT_RECORDED:'移轉／借用未登',RECEIPT_NOT_RECORDED:'進貨未登',OTHER:'其他'} as Record<string,string>)[item.reason]||item.reason}`:''}</p>}</article>;
      })}</div>
      <div className="shell-button-stack"><button className="shell-secondary" onClick={() => goTo("details")}>查看本次盤點明細</button>{canManage&&countSession?.status==="CLOSED"&&<button className="shell-primary" onClick={()=>goTo("overview")}>返回盤點結果</button>}</div>
    </>}
    {notice && page !== "entry" && <p className="count-feedback" role="status">{notice}</p>}
  </section>;
}
