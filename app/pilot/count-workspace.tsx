"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase-browser";
import StockWorkspace from './stock-workspace';
import InventoryImportFlow from "./inventory-import-flow";
import ImportHistory from "./import-history";
import InventoryCatalog from "./inventory-catalog";
import CountDetails from "./count-details";
import CountHistory from "./count-history";
import CountScope from "./count-scope";
import ContextExpiryForm from "./context-expiry-form";
import { displayTime } from "./inventory-catalog";
import { validCountQuantity, type CountItem } from "@/lib/count-flow";
import { withCountSaveTimeout } from "@/lib/count-save";
import { sameCountCardDraft, unclassifiedCountZone, type CountCardDraft } from "@/lib/count-card-drafts";
import type { Json } from "@/lib/database.types";
import ZoneEditor from "./zone-editor";
import ProductBasicEditor, { type BasicProduct } from "./product-basic-editor";
import CountEntryCard from "./count-entry-card";
import CountZonePicker, { type CountPickerZone } from "./count-zone-picker";
import CountBlankPaper from "./count-blank-paper";
import { blankCountPaperZones } from "@/lib/count-blank-paper";
import { Check, ChevronRight, ClipboardList, FileText, Package, Plus, Search } from "lucide-react";
import "./count-inline.css";

type Store = { id: string; name: string; store_code: string };
type Supplier = { name: string };
type Product = {
  id: string;
  name: string;
  product_code: string;
  count_unit: string;
  updated_at?:string; specification: string | null; is_active?:boolean; unit_price?:number|null;
  suppliers: Supplier | Supplier[] | null;
};
type ZoneProduct = { product_id: string; count_unit: string; sort_order: number; products: Product | Product[] };
export type Zone = { id: string; name: string; sort_order: number; updated_at?: string; zone_products: ZoneProduct[] };
type CountSession = { id: string; status: string; started_at: string; completed_at: string | null; snapshot: { zones?: CountItem[] }; paper_required: boolean; paper_completed_at: string | null; paper_reviewed_at: string | null };
type Progress = { zone_id: string; status: string; completed_at: string | null; completed_by: string | null };
type Discrepancy = { id: string; product_id: string; difference: number | null; previous_quantity: number | null; previous_confirmed_at: string | null; estimated_quantity: number | null; reason: string | null; status: string };
const productOf = (row: ZoneProduct) => Array.isArray(row.products) ? row.products[0] : row.products;

type CountPage = "overview" | "import" | "setup" | "zone-edit" | "catalog" | "source" | "entry" | "complete" | "details" | "review" | "history" | "management" | "scope" | "paper" | "paper-complete" | "zone-details";

export default function CountWorkspace({ stores, organizationId, session, initialPage = "overview", onBack, returnLabel="返回首頁", canViewFullDetails = false, canOperateStock = false, canManage = canViewFullDetails, canImport = canManage, businessType = "SINGLE_RESTAURANT", initialSessionId, registerLeave }: {
  stores: Store[];
  organizationId: string;
  session: Pick<Session, 'user'>;
  initialPage?: "overview" | "import" | "setup" | "management" | "catalog" | "start" | "details";
  canManage?: boolean; canImport?: boolean; businessType?: string; initialSessionId?: string; registerLeave?: (handler: (() => Promise<boolean>) | null) => void;
  onBack: () => void;
  returnLabel?:string;
  canViewFullDetails?: boolean;
  canOperateStock?: boolean;
}) {
  const storeId = stores[0]?.id || "";
  const [page, setPage] = useState<CountPage>(initialPage === "start" ? "overview" : initialPage);
  const [selectedZoneId, setSelectedZoneId] = useState("");
  const [historySessionId,setHistorySessionId]=useState<string|undefined>(initialSessionId);
  const [addingCountItem,setAddingCountItem]=useState(false);
  const [zeroItems,setZeroItems]=useState<{product_id:string;name:string;quantity:number;unit:string}[]>([]);
  const [editingProductId, setEditingProductId] = useState("");
  const [stockOpen,setStockOpen]=useState(false);const stockReturnScroll=useRef<number|null>(null);
  useEffect(()=>{if(!stockOpen&&stockReturnScroll.current!==null){workspaceElement.current?.closest(".shell-content")?.scrollTo({top:stockReturnScroll.current});stockReturnScroll.current=null;}},[stockOpen]);
  const [expiryOpen, setExpiryOpen] = useState(false);
  const [zones, setZones] = useState<Zone[]>([]);
  const [countSession, setCountSession] = useState<CountSession | null>(null);
  const [progress, setProgress] = useState<Progress[]>([]);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [entryQuery, setEntryQuery] = useState("");
  const [zonePicker, setZonePicker] = useState<{productId?:string;sourceZoneId?:string;productName?:string;mode?:"assign"|"move"}|null>(null);
  const [batchAssignOpen,setBatchAssignOpen]=useState(false);
  const [batchAssignQuery,setBatchAssignQuery]=useState("");
  const [batchAssignIds,setBatchAssignIds]=useState<string[]>([]);
  const [zoneNotice, setZoneNotice] = useState("");
  const [zoneReloadRequired,setZoneReloadRequired] = useState(false);
  const [countRefreshRequired,setCountRefreshRequired] = useState(false);
  const [draftStatus,setDraftStatus] = useState<Record<string,"empty"|"pending"|"saved"|"error"|"invalid">>({});
  const [hasSaveFailure,setHasSaveFailure] = useState(false);
  const [busy, setBusy] = useState(true);
  const [countDataReady,setCountDataReady] = useState(false);
  const [notice, setNotice] = useState("");
  const [resetOpen,setResetOpen]=useState(false);
  const [moreOpen,setMoreOpen]=useState(false);
  const [discrepancies, setDiscrepancies] = useState<Discrepancy[]>([]);
  const [importComplete, setImportComplete] = useState(false);
  const [importRevision, setImportRevision] = useState(0);
  const [submittedTotals, setSubmittedTotals] = useState({ zones: 0, products: 0 });
  const draftVersions = useRef<Record<string,string | null>>({});
  const savedDrafts = useRef<Record<string,CountCardDraft>>({});
  const dirtyDrafts = useRef<Record<string,CountCardDraft>>({});
  const draftValues = useRef<Record<string,CountCardDraft>>({});
  const mutationLock = useRef(false);
  const zoneRequests = useRef(new Map<string,{signature:string;id:string}>());
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
  function publishDraftStatus() {
    const next:Record<string,"empty"|"pending"|"saved"|"error"|"invalid">={};
    for(const key of new Set([...Object.keys(savedDrafts.current),...Object.keys(dirtyDrafts.current)])) {
      const dirty=dirtyDrafts.current[key], saved=savedDrafts.current[key];
      next[key]=dirty&&dirty.quantity!==""&&!validCountQuantity(dirty.quantity)?"invalid":failedKeys.current.has(key)?"error":dirty?"pending":saved&&(validCountQuantity(saved.quantity)||Boolean(saved.note))?"saved":"empty";
    }
    setDraftStatus(next);setHasSaveFailure(saveFailure.current);
  }

  const productCount = zones.reduce((total, zone) => total + zone.zone_products.filter(p=>productOf(p)?.is_active!==false).length, 0);
  const liveZones = countSession && countSession.snapshot?.zones
    ? zones.map(zone => ({...zone, zone_products: zone.zone_products.filter(row => countSession.snapshot.zones!.some(item => item.zone_id===zone.id && item.product_id===row.product_id)).map(row=>{const snapshot=countSession.snapshot.zones!.find(item=>item.zone_id===zone.id&&item.product_id===row.product_id);return {...row,count_unit:snapshot?.unit||row.count_unit};})}))
    : zones;
  const selectedZone = (["entry","complete","zone-details"].includes(page) ? liveZones : zones).find(zone => zone.id === selectedZoneId);
  const unclassifiedZone = liveZones.find(zone=>unclassifiedCountZone(zone.name));
  const batchAssignableRows = unclassifiedZone?.zone_products.filter(row=>{
    if(selectedZone?.zone_products.some(item=>item.product_id===row.product_id))return false;
    const product=productOf(row);
    const search=batchAssignQuery.trim().toLocaleLowerCase();
    return !search || `${product?.name??""} ${product?.product_code??""} ${Array.isArray(product?.suppliers)?product.suppliers[0]?.name??"":product?.suppliers?.name??""}`.toLocaleLowerCase().includes(search);
  }) ?? [];
  const validQuantity = (zone: Zone, row: ZoneProduct) => {
    const value = quantities[`${zone.id}:${row.product_id}`];
    return validCountQuantity(value);
  };
  const filledCount = (zone: Zone) => zone.zone_products.filter(row => validQuantity(zone, row)).length;
  const completedZoneCount = progress.filter(item => item.status === "COMPLETED").length;
  async function flushDrafts(): Promise<void> {
    if(saveTimer.current){clearTimeout(saveTimer.current);saveTimer.current=null;}
    if(pendingSaves.current){await pendingSaves.current;return;}
    if(!countSession)return;
    const sessionId=countSession.id;
    const job=(async()=>{
      while(Object.keys(dirtyDrafts.current).length){
        const changes=Object.entries(dirtyDrafts.current).filter(([,value])=>value.quantity===""||validCountQuantity(value.quantity)).slice(0,1000);
        if(!changes.length)return;
        const entries=changes.map(([key,value])=>{
          const [zone_id,product_id]=key.split(":");
          return {zone_id,product_id,quantity:value.quantity===""?null:Number(value.quantity),note:value.note||null,expected_updated_at:draftVersions.current[key]||null};
        });
        try {
          const {data,error}=await withCountSaveTimeout(signal=>supabase.rpc("save_pilot_count_drafts",{p_session_id:sessionId,p_entries:entries}).abortSignal(signal));
          if(error)throw error;
          if(!Array.isArray(data)||data.length!==changes.length)throw new Error("COUNT_SAVE_RESPONSE_INVALID");
          const versions=new Map((data as {zone_id:string;product_id:string;updated_at:string}[]).map(r=>[`${r.zone_id}:${r.product_id}`,r.updated_at]));
          for(const [key,value] of changes){
            const stamp=versions.get(key);
            if(!stamp)throw new Error("COUNT_SAVE_RESPONSE_INVALID");
            draftVersions.current[key]=stamp;savedDrafts.current[key]=value;
            if(sameCountCardDraft(dirtyDrafts.current[key],value))delete dirtyDrafts.current[key];
            failedKeys.current.delete(key);
          }
          saveFailure.current=failedKeys.current.size>0;
          publishDraftStatus();
          setNotice(Object.values(dirtyDrafts.current).some(draft=>draft.quantity!==""&&!validCountQuantity(draft.quantity))?"請將無效數量改成 0 或正數；數量與備註仍保留。":Object.keys(dirtyDrafts.current).length?"輸入已保留，正在儲存…":"已自動儲存");
        }catch(error){
          for(const [key] of changes)failedKeys.current.add(key);
          saveFailure.current=true;
          publishDraftStatus();
          const message=error&&typeof error==="object"&&"message" in error?String(error.message):"";
          setNotice(message.includes("COUNT_DRAFT_CHANGED")?"此品項已由他人更新。您填的數量與備註仍保留，請先確認共同進度。":"尚未儲存，已保留輸入。請按「重試儲存」。");
          return;
        }
      }
    })();
    pendingSaves.current=job;
    try{await job;}finally{pendingSaves.current=null;}
  }
  function goTo(next: CountPage) { setNotice(""); setMoreOpen(false); setPage(next); }
  function focusInvalidDraft() {
    const invalid=Object.entries(dirtyDrafts.current).find(([,draft])=>draft.quantity!==""&&!validCountQuantity(draft.quantity));
    if(!invalid)return false;
    setNotice("請先將無效數量改成 0 或正數；數量與備註仍保留。");
    entryInputs.current[invalid[0].split(":")[1]]?.focus();
    return true;
  }
  async function leaveEntry() {
    if (mutationLock.current) { setNotice("正在儲存，請稍候。"); return false; }
    if (editingProductId) { setNotice("請先儲存或取消品項修改。"); return false; }
    if(countRefreshRequired){setNotice("請先重新讀取共同進度，再繼續盤點。");return false;}
    if(focusInvalidDraft())return false;
    await flushDrafts();
    if (saveFailure.current || Object.keys(dirtyDrafts.current).length) { setNotice("數量或備註尚未儲存，請先按「重試儲存」。"); return false; }
    return true;
  }
  async function back() {
    if(!await leaveEntry()) return;
    if(historySessionId&&page==="details"){setHistorySessionId(undefined);goTo("history");return;}
    if(page==="overview"||(page===initialPage&&["import","setup","management","catalog"].includes(page))) { onBack(); return; }
    if(page==="entry") { await loadCountData(); goTo("overview"); }
    else goTo(page==="paper-complete"?"paper":page==="zone-edit"?"setup":page==="paper"?"complete":page==="details"?"overview":["import","setup","catalog","source","scope"].includes(page)?"management":"overview");
  }

  async function loadCountData(nextStoreId = storeId, requestedSessionId = historySessionId) {
    if (!nextStoreId) return;
    const requestId = ++loadRequestId.current;
    let loadedProgress:Progress[]=[];
    setCountDataReady(false);
    setBusy(true);
    // Refresh only untouched sessions; the server locks and preserves every entered quantity.
    if (canManage && !requestedSessionId) {
      const prepared = await supabase.rpc("app_operation", {p_store_id:nextStoreId,p_action:"count.prepare",p_data:{},p_request_id:crypto.randomUUID()});
      if (prepared.error) { setNotice("品項清單尚未同步，請重試。"); setBusy(false); return; }
    }
    const catalog = canViewFullDetails ? await supabase.rpc("get_pilot_inventory_catalog", {p_store_id:nextStoreId}) : null;
    if (catalog?.error) { setNotice("品項清單讀取失敗，請重試。"); setBusy(false); return; }
    const catalogRows = Array.isArray(catalog?.data) ? catalog.data as unknown as {product_id:string;unit:string;is_active:boolean;unit_price:number|null}[] : [];
    const catalogPrices = new Map(catalogRows.map(row=>[`${row.product_id}:${row.unit}`,row.unit_price]));
    const inactiveIds = new Set(catalogRows.filter(p=>!p.is_active).map(p=>p.product_id));
    const { data: zoneData, error: zoneError } = await supabase
      .from("count_zones")
      .select("id,name,sort_order,updated_at,zone_products(product_id,count_unit,sort_order,products(id,name,product_code,count_unit,specification,updated_at,is_active,suppliers(name)))")
      .eq("store_id", nextStoreId)
      .eq("is_active", true)
      .order("sort_order");
    if (requestId !== loadRequestId.current) return;
    if (zoneError) {
      setNotice("目前無法讀取盤點設定。");
      setBusy(false);
      return;
    }
    let loadedZones = ((zoneData as unknown as Zone[]) ?? []).map(zone => ({ ...zone, zone_products: [...zone.zone_products].filter(row=>productOf(row)?.is_active!==false&&!inactiveIds.has(row.product_id)).map(row=>{const product=productOf(row),priceKey=`${row.product_id}:${product.count_unit}`;return {...row,products:{...product,...(catalogPrices.has(priceKey)?{unit_price:catalogPrices.get(priceKey)}:{})}};}).sort((a, b) => a.sort_order - b.sort_order) }));
    if (!requestedSessionId && !loadedZones.some(zone=>!unclassifiedCountZone(zone.name))) {
      const ensured = await supabase.rpc("app_operation",{p_store_id:nextStoreId,p_action:"count.ensure-zones",p_data:{},p_request_id:crypto.randomUUID()});
      if(requestId!==loadRequestId.current)return;
      if(ensured.error){setNotice("預設儲物區尚未建立，仍可在未分類盤點；請稍後重試新增區域。");}
      else {
        const {data: defaults,error:defaultError}=await supabase.from("count_zones").select("id,name,sort_order,updated_at").eq("store_id",nextStoreId).eq("is_active",true).order("sort_order");
        if(requestId!==loadRequestId.current)return;
        if(!defaultError)loadedZones=(defaults??[]).map(zone=>({...zone,zone_products:loadedZones.find(existing=>existing.id===zone.id)?.zone_products??[]}));
      }
    }
    const { data: activeSession, error: sessionError } = await supabase
      .from("inventory_count_sessions")
      .select("id,status,started_at,completed_at,snapshot,paper_required,paper_completed_at,paper_reviewed_at")
      .eq("store_id", nextStoreId)
      .in("status", ["DRAFT", "IN_PROGRESS"])
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
        .in("status", ["REVIEWING", "CLOSED"])
        .order("completed_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (requestId !== loadRequestId.current) return;
      sessionData = latestCompleted;
    }
    if(requestedSessionId) {
      const { data: historic } = await supabase.from("inventory_count_sessions").select("id,status,started_at,completed_at,snapshot,paper_required,paper_completed_at,paper_reviewed_at").eq("id",requestedSessionId).eq("store_id",nextStoreId).maybeSingle();
      sessionData=historic;
    }
    if (sessionData && ["REVIEWING", "CLOSED"].includes(sessionData.status)) {
      const { data: entries } = await supabase.from("count_entries").select("zone_id,product_id").eq("session_id", sessionData.id);
      if (requestId !== loadRequestId.current) return;
      setSubmittedTotals({ zones: new Set(entries?.map(row => row.zone_id)).size, products: new Set(entries?.map(row => `${row.zone_id}:${row.product_id}`)).size });
    }
    if (sessionData) {
      const [{ data: progressData, error: progressError }, { data: draftData, error: draftError }, discrepancyResult] = await Promise.all([
        supabase.from("count_zone_progress").select("zone_id,status,completed_at,completed_by").eq("session_id", sessionData.id),
        supabase.from("count_drafts").select("zone_id,product_id,quantity,note,updated_at").eq("session_id", sessionData.id),
        canViewFullDetails
          ? supabase.from("inventory_count_discrepancies").select("id,product_id,difference,status,previous_quantity,previous_confirmed_at,estimated_quantity,reason").eq("session_id", sessionData.id)
          : Promise.resolve({ data: [] as Discrepancy[] }),
      ]);
      if (requestId !== loadRequestId.current) return;
      if(progressError||draftError){setNotice('目前無法讀取共同進度，請重新進入。');setBusy(false);return;}
      loadedProgress=progressData??[];
      setProgress(loadedProgress);
      const values=Object.fromEntries((draftData ?? []).map(row => [`${row.zone_id}:${row.product_id}`, String(row.quantity ?? "")]));
      const noteValues=Object.fromEntries((draftData ?? []).map(row => [`${row.zone_id}:${row.product_id}`, row.note || ""]));
      draftVersions.current=Object.fromEntries((draftData ?? []).map(row=>[`${row.zone_id}:${row.product_id}`,row.updated_at]));
      const combined=Object.fromEntries((draftData ?? []).map(row => [`${row.zone_id}:${row.product_id}`, {quantity:String(row.quantity??""),note:row.note||""}]));
      savedDrafts.current=combined; draftValues.current={...combined}; dirtyDrafts.current={}; failedKeys.current.clear(); saveFailure.current=false; setQuantities(values);setNotes(noteValues);
      publishDraftStatus();
      if(["REVIEWING","CLOSED"].includes(sessionData.status)) {
        const {data: result}=await supabase.rpc("get_pilot_count_results",{p_session_id:sessionData.id});
        const rows=Array.isArray(result)?result as unknown as {zone_id:string;product_id:string;name:string;quantity:number;unit:string;entered_by:string}[]:[];
        setSubmittedTotals({zones:new Set(rows.map(r=>r.zone_id)).size,products:rows.length});
        setZeroItems(rows.filter(r=>Number(r.quantity)===0).map(r=>({product_id:r.product_id,name:r.name,quantity:r.quantity,unit:r.unit})));
        const {data:completion}=await supabase.rpc('get_pilot_count_completion',{p_session_id:sessionData.id});
        setCompletedBy((completion as {completed_by?:string}|null)?.completed_by||'已保存');
        setPaperCompletedBy((completion as {paper_completed_by?:string}|null)?.paper_completed_by||'未提供');
      }
      setDiscrepancies(discrepancyResult.data ?? []);
    } else {
      setProgress([]);
      setQuantities({});
      setNotes({});savedDrafts.current={};draftValues.current={};dirtyDrafts.current={};draftVersions.current={};failedKeys.current.clear();saveFailure.current=false;
      publishDraftStatus();
      setDiscrepancies([]);
      setZeroItems([]);
    }
    setZones(loadedZones);
    setCountSession(sessionData as unknown as CountSession ?? null);
    setCountRefreshRequired(false);
    setZoneReloadRequired(false);
    setCountDataReady(true);
    if(requestedSessionId && sessionData && ["DRAFT","IN_PROGRESS"].includes(sessionData.status)) setPage("overview");
    setBusy(false);
    return {progress:loadedProgress,status:sessionData?.status};
  }

  async function startCount(selection?: {zone_id:string;product_id:string}[]) {
    setBusy(true);
    const { error } = await supabase.rpc("start_pilot_count", { p_store_id: storeId, p_selection: selection as unknown as Json ?? null });
    await loadCountData();
    if(!error) goTo("overview");
    else setNotice("無法開始盤點，請確認門市已有品項且有執行權限。");
  }
  // The parent keys this workspace by store so navigation cannot retain another store's data.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { let active=true;queueMicrotask(()=>{if(!active)return;if(initialPage==="start")void startCount();else void loadCountData(storeId);});return()=>{active=false;}; }, []);
  // Navigation waits for the same serialized save queue as the input controls.
  useEffect(() => { registerLeave?.(leaveEntry); return () => registerLeave?.(null); });
  useEffect(() => {
    const warnUnsaved=(event:BeforeUnloadEvent)=>{if(Object.keys(dirtyDrafts.current).length||mutationLock.current||editingProductId){event.preventDefault();event.returnValue="";}};
    window.addEventListener("beforeunload",warnUnsaved);
    return()=>window.removeEventListener("beforeunload",warnUnsaved);
  },[editingProductId]);

  const positionSessionId=countSession?.id;
  useEffect(() => {
    workspaceElement.current?.closest(".shell-content")?.scrollTo({ top: 0 });
    if(page==="entry" && positionSessionId){try{const last=localStorage.getItem(`count-position:${session.user.id}:${positionSessionId}:${selectedZoneId}`);if(last)entryInputs.current[last]?.scrollIntoView({block:"center"});}catch{}}
  }, [page, positionSessionId, session.user.id, selectedZoneId]);

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

  async function addCountItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if(!countSession||!selectedZoneId)return;
    if(!await leaveEntry())return;
    const form=event.currentTarget;const data=new FormData(form);
    setBusy(true);
    const {error}=await supabase.rpc("add_pilot_count_item",{p_session_id:countSession.id,p_zone_id:selectedZoneId,p_name:String(data.get("product_name")||""),p_unit:String(data.get("unit")||"")});
    if(error){setNotice("無法新增品項，請確認名稱、單位與權限。");setBusy(false);return;}
    form.reset();setAddingCountItem(false);
    await loadCountData(storeId);
    setSelectedZoneId(selectedZoneId);goTo("entry");setNotice("已加入本次盤點，並保留為後續品項。");setBusy(false);
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

  function saveQuantity(zoneId: string, row: ZoneProduct, value: string) {
    if(!countSession||mutationLock.current) return;
    const key=`${zoneId}:${row.product_id}`;
    setQuantities(current=>({...current,[key]:value}));
    const draft={quantity:value,note:draftValues.current[key]?.note??""};
    dirtyDrafts.current[key]=draft;draftValues.current[key]=draft;
    publishDraftStatus();
    if(value!==""&&!validCountQuantity(value)){setNotice("請填有效數量，未填不會補成 0。");return;}
    scheduleDraftSave();
  }
  function saveNote(zoneId:string, row:ZoneProduct, note:string) {
    if(!countSession||mutationLock.current)return;
    const key=`${zoneId}:${row.product_id}`;
    setNotes(current=>({...current,[key]:note}));
    const draft={quantity:draftValues.current[key]?.quantity??"",note};
    dirtyDrafts.current[key]=draft;draftValues.current[key]=draft;
    publishDraftStatus();
    scheduleDraftSave();
  }
  function scheduleDraftSave() {
    setNotice(Object.values(dirtyDrafts.current).some(draft=>draft.quantity!==""&&!validCountQuantity(draft.quantity))?"請將無效數量改成 0 或正數；數量與備註仍保留。":"輸入已保留，正在儲存…");
    if(saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current=setTimeout(()=>{void flushDrafts();},400);
  }
  async function persistZone() {
    await flushDrafts();
    if(focusInvalidDraft())return {error:new Error("INVALID_QUANTITY")};
    return {error:saveFailure.current||Object.keys(dirtyDrafts.current).length?new Error("UNSAVED"):null};
  }
  async function runZoneOperation(action:string,data:Record<string,Json|undefined>) {
    const signature=JSON.stringify(data);
    const prior=zoneRequests.current.get(action);
    const id=prior?.signature===signature?prior.id:crypto.randomUUID();
    zoneRequests.current.set(action,{signature,id});
    const result=await withCountSaveTimeout(signal=>supabase.rpc("app_operation",{p_store_id:storeId,p_action:action,p_data:data,p_request_id:id}).abortSignal(signal));
    if(result.error)throw result.error;
    zoneRequests.current.delete(action);
    return result.data as Record<string,Json>;
  }
  async function openZonePicker(product?:{productId:string;sourceZoneId:string;productName:string}) {
    if(!await leaveEntry())return;
    setZoneNotice("");setZonePicker(product??{});
  }
  async function openCountZoneCorrection(product:{productId:string;sourceZoneId:string;productName:string}) {
    if(mutationLock.current||countRefreshRequired)return false;
    const saved=await persistZone();
    if(saved.error)return false;
    setZoneNotice("");setZonePicker({...product,mode:"move"});
    return true;
  }
  async function mutateZone(action:"count.assign-zone"|"count.move-zone"|"count.zone-create"|"count.zone-rename",data:Record<string,Json|undefined>) {
    if(mutationLock.current||zoneReloadRequired)return false;
    mutationLock.current=true;setBusy(true);setZoneNotice("");
    const placement=action==="count.assign-zone"||action==="count.move-zone";
    let sent=false;
    try {
      const saved=await persistZone();
      if(saved.error){setZoneNotice("數量或備註尚未儲存，請先重試儲存。");return false;}
      // Read the version only after pending input has reached the server.
      if(placement)data.expected_updated_at=draftVersions.current[`${data.source_zone_id}:${data.product_id}`]||null;
      sent=true;
      await runZoneOperation(action,data);
      const refreshed=await loadCountData();
      if(!refreshed){if(placement){setCountRefreshRequired(true);setZoneReloadRequired(true);setNotice("儲物區已變更，請先重新讀取共同進度，再繼續輸入。");}setZoneNotice("變更已儲存，但最新畫面尚未讀取完成。請按「重新讀取共同進度」。");return false;}
      if(placement)setZonePicker(null);
      if(action==="count.move-zone"){setSelectedZoneId(String(data.target_zone_id));setEntryQuery("");setNotice("儲物區已更正，數量與備註已保留。");}
      return true;
    } catch(error) {
      const message=error&&typeof error==="object"&&"message" in error?String(error.message):"";
      const rejected=/COUNT_DRAFT_CHANGED|ZONE_CONFIGURATION_CHANGED|COUNT_TARGET_ALREADY_HAS_PRODUCT|ZONE_NOT_IN_STORE|COUNT_ZONE_NOT_AVAILABLE|COUNT_SESSION_NOT_ACTIVE|COUNT_NOT_IN_STORE|INVALID_COUNT_ZONE_DESTINATION|UNCLASSIFIED_SOURCE_REQUIRED|UNCLASSIFIED_ZONE_RESERVED|ZONE_NAME_EXISTS|STORE_(?:ACCESS|COUNTER|MANAGER)_REQUIRED/.test(message);
      if(placement&&sent&&/COUNT_DRAFT_CHANGED|ZONE_CONFIGURATION_CHANGED|COUNT_SESSION_NOT_ACTIVE|COUNT_ZONE_NOT_AVAILABLE|ZONE_NOT_IN_STORE/.test(message)){setCountRefreshRequired(true);setZoneReloadRequired(true);setNotice("共同進度已變更，請先重新讀取，再繼續輸入。");}
      if(placement&&sent&&!rejected){setCountRefreshRequired(true);setZoneReloadRequired(true);setNotice("儲物區變更結果尚未確認，請先重新讀取共同進度，再繼續輸入。");setZoneNotice("儲物區變更結果尚未確認，數量與備註已儲存。請先重新讀取共同進度。");}
      else setZoneNotice(message.includes("CHANGED")?"資料已由他人更新，您的輸入已儲存。請重新讀取共同進度。":message.includes("COUNT_TARGET_ALREADY_HAS_PRODUCT")?"這個儲物區已有相同品項，不能重複加入。請選擇其他區域。":message.includes("ZONE_NOT_IN_STORE")||message.includes("COUNT_ZONE_NOT_AVAILABLE")?"這個儲物區已完成或目前無法移動品項，請重新讀取共同進度。":message.includes("COUNT_SESSION_NOT_ACTIVE")?"本次盤點已完成，不能再更改儲物區。請重新讀取共同進度。":message.includes("INVALID_COUNT_ZONE_DESTINATION")?"請選擇與目前不同的儲物區。":message.includes("UNCLASSIFIED_SOURCE_REQUIRED")?"這個品項已不在未分類，請重新讀取共同進度。":message.includes("UNCLASSIFIED_ZONE_RESERVED")?"「未分類」為保留名稱，請使用其他區域名稱。":message.includes("NAME")||message.includes("DUPLICATE")?"請換一個儲物區名稱，不能與現有區域重複。":"尚未完成，數量與備註仍保留，請重試。");
      return false;
    } finally {mutationLock.current=false;setBusy(false);}
  }
  async function assignCountZone(targetZoneId:string) {
    if(!countSession||!zonePicker?.productId||!zonePicker.sourceZoneId)return;
    await mutateZone(zonePicker.mode==="move"?"count.move-zone":"count.assign-zone",{session_id:countSession.id,product_id:zonePicker.productId,source_zone_id:zonePicker.sourceZoneId,target_zone_id:targetZoneId});
  }
  async function assignUnclassifiedBatch() {
    if(!countSession||!selectedZone||!unclassifiedZone||!batchAssignIds.length||mutationLock.current)return;
    mutationLock.current=true;setBusy(true);setZoneNotice("");
    try {
      const saved=await persistZone();
      if(saved.error){setNotice("數量或備註尚未儲存，請先重試儲存。");return;}
      const items=batchAssignIds.map(productId=>({
        product_id:productId,
        expected_updated_at:draftVersions.current[`${unclassifiedZone.id}:${productId}`]||null,
      }));
      await runZoneOperation("count.assign-zone-batch",{
        session_id:countSession.id,
        source_zone_id:unclassifiedZone.id,
        target_zone_id:selectedZone.id,
        items:items as unknown as Json,
      });
      setBatchAssignIds([]);setBatchAssignQuery("");setBatchAssignOpen(false);
      const refreshed=await loadCountData();
      if(refreshed){setSelectedZoneId(selectedZone.id);setNotice(`已批次加入 ${items.length} 項到「${selectedZone.name}」。`);}
      else{setCountRefreshRequired(true);setZoneReloadRequired(true);setNotice("品項已批次移入，但最新畫面尚未讀取完成。請重新讀取共同進度。");}
    } catch(error) {
      const message=error&&typeof error==="object"&&"message" in error?String(error.message):"";
      setNotice(message.includes("COUNT_TARGET_ALREADY_HAS_PRODUCT")?"部分品項已在此區，請重新讀取後再選擇。":message.includes("COUNT_ZONE_NOT_AVAILABLE")||message.includes("COUNT_SESSION_NOT_ACTIVE")?"目前盤點進度已變更，請重新讀取共同進度。":"批次加入尚未完成，請重新整理後再試。");
      setCountRefreshRequired(true);setZoneReloadRequired(true);
    } finally {mutationLock.current=false;setBusy(false);}
  }
  async function createCountZone(name:string) {return mutateZone("count.zone-create",{name:name.trim()});}
  async function renameCountZone(zone:CountPickerZone,name:string) {return mutateZone("count.zone-rename",{id:zone.id,name:name.trim(),updated_at:zone.updated_at});}
  async function reloadZoneProgress() {
    if(mutationLock.current||editingProductId)return;
    mutationLock.current=true;setBusy(true);
    try {
      const saved=await persistZone();
      if(saved.error){setZoneNotice("數量或備註尚未儲存，請先重試儲存。");return;}
      const refreshed=await loadCountData();
      if(refreshed){setZonePicker(null);setZoneNotice("");setNotice("共同進度已更新。");}
      else setZoneNotice("目前無法讀取最新進度，已儲存的輸入仍保留，請重試。");
    } finally {mutationLock.current=false;setBusy(false);}
  }
  async function updateCountProduct(product:BasicProduct) {
    updateProduct(product);
    // Editing an untouched count may rebuild its snapshot with the new unit.
    // No count input is accepted again until that snapshot is read successfully.
    setCountRefreshRequired(true);
    const refreshed=await loadCountData();
    if(!refreshed)setNotice("品項已儲存，請先重新讀取共同進度，再繼續輸入數量。");
    else setNotice("");
  }
  function prepareProductSave() {
    // A timeout may occur after the server changed the snapshot. Keep entry
    // blocked even when that uncertain edit is cancelled without a response.
    setCountRefreshRequired(true);
    setNotice("品項變更結果尚未確認，請先重新讀取共同進度，再繼續輸入數量。");
  }
  async function selectEntryZone(zone:Zone) {
    if(!await leaveEntry())return;
    setSelectedZoneId(zone.id);setEntryQuery("");
    goTo(progress.some(item=>item.zone_id===zone.id&&item.status==="COMPLETED")?"zone-details":"entry");
  }
  async function saveDraft() {
    setBusy(true);
    try{const {error}=await persistZone();if(!error)setNotice("已儲存");}
    catch{setNotice("尚未儲存，已保留輸入。請按「重試儲存」。");}
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
  async function setNextPeriod(productId:string,action:"KEEP"|"EXCLUDE"|"DISABLE") {
    setBusy(true);
    const {error}=await supabase.rpc("set_pilot_count_next_period",{p_store_id:storeId,p_product_id:productId,p_action:action});
    setNotice(error?"設定尚未儲存，請重試。":action==="KEEP"?"下期仍保留盤點。":action==="EXCLUDE"?"已設定下期不列入盤點。":"品項已停用；歷史紀錄仍保留。");
    setBusy(false);
  }
  async function rebuildCountSetup() {
    if(busy)return;
    setBusy(true);setNotice("正在重新建立盤點資料…");
    const {data,error}=await supabase.rpc("reset_pilot_count_setup",{p_store_id:storeId});
    if(error){setNotice("目前無法重新建立盤點資料，請稍後重試。");setBusy(false);return;}
    setResetOpen(false);setImportComplete(false);setImportRevision(v=>v+1);setHistorySessionId(undefined);
    await loadCountData(storeId,undefined);
    goTo("management");
    const summary=data as {products_unlinked?:number;zones_archived?:number;active_counts_removed?:number}|null;
    setNotice(`盤點資料已重新建立：已清除 ${summary?.products_unlinked??0} 個品項配置、${summary?.zones_archived??0} 個區域，可重新匯入正確資料。`);
    setBusy(false);
  }


  async function openHistory(id:string){
    setHistorySessionId(id);
    await loadCountData(storeId,id);
    goTo("details");
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
      const refreshed=await loadCountData();
      if(!refreshed)return;
      const next=liveZones.find(z=>z.zone_products.length&&!refreshed.progress.some(p=>p.zone_id===z.id&&p.status==="COMPLETED"));
      if(next&&["DRAFT","IN_PROGRESS"].includes(refreshed.status||"")){setSelectedZoneId(next.id);goTo("entry");workspaceElement.current?.closest(".shell-content")?.scrollTo({top:0});}
      else if(["REVIEWING","CLOSED"].includes(refreshed.status||"")) goTo("complete");
      else goTo("overview");
    }catch{setNotice("送出尚未確認，已儲存的數量仍在。請重試或返回查看。");}
    finally{setBusy(false);}
  }

  if (!stores.length) return <p className="pilot-empty">目前沒有可存取的門市。</p>;

  const submitted = Boolean(countSession && ["REVIEWING", "CLOSED"].includes(countSession.status));
  const activeCount = Boolean(countSession && !submitted);
  const blankPaperZones = blankCountPaperZones(zones,countSession&&["DRAFT","IN_PROGRESS"].includes(countSession.status)?countSession.snapshot?.zones??[]:undefined);
  const setupLocked = activeCount && (progress.some(p=>p.status==="COMPLETED") || Object.values(quantities).some(validCountQuantity) || Object.values(notes).some(note=>note.trim().length>0));
  function updateProduct(product: BasicProduct) {
    setZones(current => current.map(zone => ({ ...zone, zone_products: zone.zone_products.map(row => row.product_id === product.id
      ? { ...row, products: { ...productOf(row), ...product }, count_unit: activeCount ? row.count_unit : product.count_unit }
      : row) })));
  }
  const activeZones = liveZones.filter(zone => zone.zone_products.length > 0);
  const heading = page === "entry" ? "盤點"
     : page === "management" ? "盤點設定"
    : page === "scope" ? "設定本次盤點品項"
    : page === "paper" ? "紙本謄寫表"
    : page === "import" ? "資料匯入"
    : page === "setup" ? "儲物區域與品項"
    : page === "zone-edit" ? `${selectedZone?.name || "區域"}品項`
    : page === "catalog" ? "期初及品項"
    : page === "source" ? "匯入盤點總覽"
    : page === "details" ? "本次盤點明細"
    : page === "zone-details" ? "本區已盤清單"
    : page === "review" ? "盤點結果"
    : page === "history" ? "盤點歷史"
    : "盤點";
  const backLabel = (page===initialPage&&["import","setup","management"].includes(page))?returnLabel:historySessionId&&page==="details"?"返回盤點歷史":page === "paper-complete" ? "返回紙本謄寫表" : page === "paper" ? "返回完成頁" : page === "overview" ? returnLabel : (page === "entry" || page === "zone-details") ? "返回區域進度" : page === "zone-edit" ? "返回儲物區域" : ["import","setup","catalog","source","scope"].includes(page) ? "返回盤點設定" : "返回盤點任務";
  const managementLinks = <>
    {productCount===0 ? <section className="shell-section">
      <div className="shell-section-head"><h2>第一次建立</h2></div>
      <div className="shell-card setup-step-list">
        {canImport && <button onClick={() => goTo("import")}><b><FileText size={18} /></b><span><strong>匯入檔案建立品項</strong><small>上傳 Excel、CSV、PDF 或照片，系統直接建立盤點資料</small></span><i>›</i></button>}
        {canManage && <button onClick={() => goTo("setup")}><b><ClipboardList size={18} /></b><span><strong>少量手動新增</strong><small>沒有檔案時再使用，不需先完成其他設定</small></span><i>›</i></button>}
      </div>
    </section> : <section className="shell-section">
      <div className="shell-section-head"><h2>盤點資料</h2><span>{productCount} 項</span></div>
      <div className="shell-card setup-step-list">
        <button onClick={() => goTo("catalog")}><b><ClipboardList size={18} /></b><span><strong>品項與期初資料</strong><small>查看品項、期初數量與基本資料</small></span><i>›</i></button>
        {canManage && <button onClick={() => goTo("setup")}><b><Package size={18} /></b><span><strong>儲物區域</strong><small>{zones.length ? `${zones.length} 個區域` : "尚未設定區域"}</small></span><i>›</i></button>}
        {canManage && businessType==='SINGLE_RESTAURANT' && <button disabled={activeCount} onClick={()=>goTo("scope")}><b><ClipboardList size={18} /></b><span><strong>本次盤點品項</strong><small>{activeCount ? "本次盤點進行中，完成後再調整" : "需要時才調整本次要盤點的品項"}</small></span><i>›</i></button>}
      </div>
      {canImport && !activeCount && <button className="text-button" onClick={()=>goTo("import")}>重新匯入資料 ›</button>}
    </section>}

  </>;

  if(stockOpen)return <StockWorkspace storeId={storeId} userId={session.user.id} canManage={canImport} canOperate={canOperateStock} onBack={()=>setStockOpen(false)}/>;
  return <section ref={workspaceElement} className="count-workspace count-flow">
    <button className="shell-back" type="button" onClick={() => void back()}>‹ <span>{backLabel}</span></button>
    {!["complete","paper-complete","source"].includes(page) && <div className="shell-page-intro">
      {page==="management"?<div className="shell-section-head"><h1>{heading}</h1>{canImport&&<button type="button" className="text-button" aria-label="更多盤點設定" title="更多設定" aria-expanded={moreOpen} aria-controls="count-more-actions" onClick={()=>setMoreOpen(value=>!value)}>⋯</button>}</div>:<h1>{heading}</h1>}
    {page === "management" && <p>{productCount ? "平常只需要管理品項與儲物區；有新資料時再匯入。" : "有既有資料就直接匯入，沒有資料才手動新增。"}</p>}
    {page === "entry" && <p>填入數量，自動儲存。</p>}
    {page === "paper" && <p>依門市匯入表的工作表、列次與品項順序呈現。</p>}
    </div>}

    {page === "management" && canViewFullDetails && <>{managementLinks}
      <section className="shell-section">
        <div className="shell-card setup-step-list count-more-entry">
          <button type="button" aria-expanded={moreOpen} aria-controls="count-more-actions" onClick={()=>setMoreOpen(value=>!value)}><b>⋯</b><span><strong>更多操作</strong><small>{canImport ? "匯入盤點總覽、重新建立盤點資料" : "匯入盤點總覽"}</small></span><i>{moreOpen ? "⌄" : "›"}</i></button>
        </div>
        <div id="count-more-actions" hidden={!moreOpen} className="shell-card shell-list">
          <button type="button" className="shell-list-row" onClick={()=>goTo("source")}><span><strong>匯入盤點總覽</strong><small>查看匯入檔案{canImport ? "，左滑整批移除資料與品項" : ""}</small></span><b>›</b></button>
          {canImport && <button type="button" className="shell-list-row" onClick={()=>{setMoreOpen(false);setResetOpen(true);}}><span><strong>重新建立盤點資料</strong><small>清除目前配置後重新建立</small></span><b>›</b></button>}
        </div>
      </section>
    </>}
    {page==="management"&&resetOpen&&<div className="modal-backdrop" role="presentation"><section className="shell-card" role="dialog" aria-modal="true" aria-labelledby="reset-count-title" style={{padding:18,maxWidth:360,margin:"auto"}}>
      <h2 id="reset-count-title">重新建立盤點資料？</h2>
      <p>只在匯錯門市資料或需要整批重建時使用。</p>
      <p className="shell-note">將清除目前 {productCount} 個盤點品項配置、{zones.length} 個儲物區域與尚未完成的盤點；已完成的盤點、進貨、廢棄、借貸與調撥紀錄會保留。</p>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginTop:16}}><button type="button" className="shell-secondary" style={{marginTop:0}} onClick={()=>setResetOpen(false)} disabled={busy}>取消</button><button type="button" className="shell-primary" style={{marginTop:0,background:"#d92d20"}} onClick={()=>void rebuildCountSetup()} disabled={busy}>{busy?"重建中…":"確認重建"}</button></div>
    </section></div>}
    {page === "scope" && canManage && !activeCount && <CountScope zones={zones.map(z=>({...z,zone_products:z.zone_products.filter(p=>productOf(p)?.is_active!==false)}))} previous={countSession?.snapshot?.zones||[]} onStart={startCount}/>}
    {page === "paper" && submitted && <CountDetails sessionId={countSession!.id} paper onPaperComplete={countSession?.paper_completed_at?undefined:()=>paperComplete()}/>}
    {page === "paper-complete" && submitted && <>
      <section className="completion-state"><span><Check /></span><h1>紙本謄寫已完成</h1><p>經手人：{paperCompletedBy}・{displayTime(countSession?.paper_completed_at||null)}</p></section>
      <section className="shell-card completion-card"><strong>下一步</strong><p>等待門市主管確認／稽查<br/>系統原始盤點數量不會被覆蓋</p></section>
      <button className="shell-primary full" onClick={onBack}>{returnLabel}</button>
    </>}
    {page === "zone-details" && countSession && <CountDetails sessionId={countSession.id} zoneId={selectedZoneId}/>}

    {page === "overview" && <>
      {busy && !zones.length && <p role="status">正在讀取盤點…</p>}
      {(!historySessionId||activeCount)&&<div className="shell-section-head count-paper-overview-head"><h2>本次盤點</h2><CountBlankPaper storeName={stores[0].name} zones={blankPaperZones} disabled={busy||!countDataReady||countRefreshRequired||zoneReloadRequired}/></div>}
      {activeCount && <>
        <section className="shell-section"><div className="shell-section-head"><h2>區域進度</h2><span>{completedZoneCount} / {activeZones.length} 已完成</span></div>
          <div className="shell-card zone-progress-list">{activeZones.map((zone, index) => {
            const done = progress.some(item => item.zone_id === zone.id && item.status === "COMPLETED");
            const filled = filledCount(zone);
            return <button key={zone.id} className={`zone-progress-row is-${done ? "complete" : filled ? "active" : "pending"}`} disabled={busy} onClick={() => { setSelectedZoneId(zone.id); goTo(done ? "zone-details" : "entry"); }}>
              <span className="zone-marker">{done ? <Check size={18} /> : index + 1}</span>
              <span className="zone-info"><strong>{zone.name}</strong><small>{zone.zone_products.length} 項{!done && filled > 0 ? `・已填 ${filled} 項` : ""}</small></span>
              <span className="zone-state">{done ? "已完成" : filled ? "進行中" : "未填"}</span>
            </button>;
          })}</div>
          <button type="button" className="text-button count-zone-add" disabled={busy} onClick={()=>void openZonePicker()}><Plus size={18}/>新增區域{canImport?"／修改名稱":""}</button>
        </section>
      </>}
      {submitted && <>
        <section className="completion-state compact"><span><Check /></span><h2>{countSession?.paper_required&&!countSession.paper_completed_at?"實際盤點已完成":"本次盤點完成"}</h2><p>{submittedTotals.zones} 個區域・{submittedTotals.products} 項已保存</p><p>{displayTime(countSession?.completed_at||null)}<br/>完成者：{completedBy||"已保存"}</p></section>
        <div className="shell-button-stack">
          {countSession?.paper_required&&<button className="shell-primary" onClick={()=>goTo("paper")}>{countSession.paper_completed_at?"查看紙本謄寫表":"開啟紙本謄寫表"}</button>}
          <button className="shell-secondary" onClick={()=>goTo("details")}>查看結果</button>
          {!countSession?.paper_required&&<CountDetails sessionId={countSession!.id} management={canViewFullDetails} outputOnly/>}
          {canViewFullDetails&&<button className="shell-secondary" onClick={()=>goTo("review")}>查看盤點差異{discrepancies.some(d=>d.status==='PENDING')?`（${discrepancies.filter(d=>d.status==='PENDING').length} 項待確認）`:''}</button>}
          {canManage&&countSession?.paper_completed_at&&!countSession.paper_reviewed_at&&<button className="shell-primary" onClick={()=>paperComplete(true)}>確認紙本已完成</button>}
          {canManage&&!historySessionId&&submitted&&<button className="shell-primary" onClick={()=>startCount()} disabled={busy}>開始盤點</button>}
        </div>
      </>}
      {!countSession && !busy && (canManage ? <section className="shell-card task-hero count-ready">
        <span className="status-pill">{productCount ? "尚未開始" : "尚無品項"}</span>
        <h2>{productCount ? "開始盤點" : "先建立盤點品項"}</h2>
        <p>{productCount ? `${activeZones.length} 個區域・${productCount} 項` : "有既有資料可匯入，沒有資料也可自行新增品項。"}</p>
        <button className="shell-primary full" onClick={() => productCount ? void startCount() : goTo(canImport ? "import" : "setup")} disabled={busy}>{productCount ? "開始盤點" : "建立盤點資料"}</button>
      </section> : <p className="pilot-empty">主管尚未開始盤點，請聯絡主管。</p>)}
      {canViewFullDetails && <div className="shell-button-stack"><button className="shell-secondary" onClick={()=>goTo("history")}>盤點歷史</button><button className="text-button count-management-link" onClick={()=>goTo(productCount ? "catalog" : canImport ? "import" : "setup")}>品項與盤點資料 ›</button></div>}
    </>}

    {page === "entry" && selectedZone && activeCount && <>
      <nav className="count-zone-tabs" aria-label="盤點儲物區">{liveZones.map(zone=><button type="button" key={zone.id} aria-current={zone.id===selectedZone.id?"page":undefined} disabled={busy||Boolean(editingProductId)} onClick={()=>void selectEntryZone(zone)}>{zone.name}</button>)}</nav>
      <button type="button" className="text-button count-zone-add" disabled={busy||Boolean(editingProductId)} onClick={()=>void openZonePicker()}><Plus size={16}/>新增區域{canImport?"／修改名稱":""}</button>
      <label className="count-entry-search"><Search size={18}/><input type="search" aria-label="搜尋品項" value={entryQuery} onChange={event=>setEntryQuery(event.target.value)} placeholder="搜尋品項"/></label>
      <div className="count-entry-toolbar">
        {!unclassifiedCountZone(selectedZone.name)&&unclassifiedZone&&unclassifiedZone.zone_products.length>0&&<button type="button" className="text-button" disabled={busy||Boolean(editingProductId)||progress.some(item=>item.zone_id===unclassifiedZone.id&&item.status==="COMPLETED")} onClick={()=>{setBatchAssignIds([]);setBatchAssignQuery("");setBatchAssignOpen(true);}}>＋ 從未分類批次加入</button>}
        <button type="button" className="text-button" onClick={()=>setAddingCountItem(value=>!value)} disabled={busy||Boolean(editingProductId)}>＋ 新增品項</button>
      </div>
      {addingCountItem&&<form className="shell-card compact-form product-form" onSubmit={addCountItem}><label>品項名稱<input name="product_name" maxLength={160} required autoFocus/></label><label>單位<input name="unit" maxLength={30} required placeholder="例如 瓶"/></label><div className="shell-button-stack"><button type="button" className="shell-secondary" onClick={()=>setAddingCountItem(false)}>取消</button><button className="shell-primary" disabled={busy}>加入本次盤點</button></div></form>}
      {expiryOpen && countSession && <ContextExpiryForm storeId={storeId} contextType="COUNT" contextId={countSession.id} zoneId={selectedZone.id} onClose={saved => { setExpiryOpen(false); if (saved) setNotice("效期提醒已儲存。"); }} />}
      <div className="progress count-progress" aria-label={`已填 ${filledCount(selectedZone)} / ${selectedZone.zone_products.length} 項`}><i style={{ width: `${filledCount(selectedZone) / Math.max(1, selectedZone.zone_products.length) * 100}%` }} /></div>
      <div className="count-item-cards">{selectedZone.zone_products.filter(row=>{const product=productOf(row);return `${product?.name??""} ${product?.product_code??""}`.toLocaleLowerCase().includes(entryQuery.trim().toLocaleLowerCase());}).map(row => {
        const product = productOf(row);
        const supplier = Array.isArray(product?.suppliers) ? product.suppliers[0] : product?.suppliers;
        const key=`${selectedZone.id}:${row.product_id}`;
        return <CountEntryCard key={key} name={product?.name||"盤點品項"} unit={row.count_unit} supplier={supplier?.name} specification={product?.specification} quantity={quantities[key]??""} note={notes[key]??""} unclassified={unclassifiedCountZone(selectedZone.name)} disabled={busy||countRefreshRequired||Boolean(editingProductId)} saveState={draftStatus[key]||"empty"}
          inputRef={element=>{entryInputs.current[row.product_id]=element;}}
          onQuantity={value=>{saveQuantity(selectedZone.id,row,value);try{localStorage.setItem(`count-position:${session.user.id}:${countSession?.id}:${selectedZoneId}`,row.product_id);}catch{}}}
          onNote={value=>saveNote(selectedZone.id,row,value)} onAssign={()=>void openZonePicker({productId:row.product_id,sourceZoneId:selectedZone.id,productName:product?.name||"盤點品項"})}
          editor={product?<ProductBasicEditor storeId={storeId} userId={session.user.id} product={product} canEditBasic={canImport} onChangeArea={()=>openCountZoneCorrection({productId:row.product_id,sourceZoneId:selectedZone.id,productName:product.name})} onSaved={updateCountProduct} beforeEdit={leaveEntry} onSaveAttempt={prepareProductSave} includePrice modal disabled={busy||countRefreshRequired||Boolean(editingProductId&&editingProductId!==product.id)} onEditingChange={editing=>setEditingProductId(editing?product.id:"")}/>:undefined}/>;
      })}</div>
      {!selectedZone.zone_products.length&&<p className="pilot-empty">此區尚無品項。可從未分類品項卡按「＋儲物區」加入。</p>}
      <details className="count-other-actions"><summary>其他操作</summary><button type="button" className="text-button" disabled={busy||Boolean(editingProductId)} onClick={async()=>{if(!await leaveEntry())return;stockReturnScroll.current=workspaceElement.current?.closest(".shell-content")?.scrollTop||0;setStockOpen(true);}}>分區與解凍</button><button type="button" className="text-button" disabled={busy||Boolean(editingProductId)} onClick={() => setExpiryOpen(true)}>加入效期提醒</button></details>
      <div className="count-entry-actions">
        {countRefreshRequired&&<button type="button" className="shell-secondary" disabled={busy} onClick={()=>void loadCountData()}>重新讀取共同進度</button>}
        <p role="status">{notice || "數量與備註自動儲存"}<small>已填 {filledCount(selectedZone)} / {selectedZone.zone_products.length} 項</small></p>{hasSaveFailure&&<button className="text-button" disabled={busy || Boolean(editingProductId)} onClick={()=>void loadCountData()}>重新讀取共同進度（捨棄未存變更）</button>}
        <div>{hasSaveFailure&&<button className="shell-secondary" onClick={() => saveDraft()} disabled={busy}>重試儲存</button>}<button className="shell-secondary" onClick={async()=>{if(await leaveEntry()){await loadCountData();goTo("overview");}}} disabled={busy||Boolean(editingProductId)}>暫存離開</button><button className="shell-primary" onClick={() => completeZone(selectedZone)} disabled={busy || countRefreshRequired || Boolean(editingProductId)||!selectedZone.zone_products.length}>{busy ? "儲存中…" : "完成此區域"}</button></div>
      </div>
    </>}
    {batchAssignOpen&&selectedZone&&unclassifiedZone&&<div className="count-zone-backdrop"><section className="shell-card count-batch-zone-dialog" role="dialog" aria-modal="true" aria-labelledby="batch-zone-title">
      <header><div><h2 id="batch-zone-title">加入到「{selectedZone.name}」</h2><p>從未分類品項一次勾選多筆。</p></div><button type="button" className="text-button" disabled={busy} onClick={()=>{setBatchAssignOpen(false);setBatchAssignIds([]);}}>關閉</button></header>
      <label className="count-entry-search"><Search size={18}/><input type="search" value={batchAssignQuery} onChange={e=>setBatchAssignQuery(e.target.value)} placeholder="搜尋未分類品項" aria-label="搜尋未分類品項"/></label>
      <div className="count-batch-zone-tools"><span>未分類 {unclassifiedZone.zone_products.length} 項</span>{batchAssignableRows.length>0&&<button type="button" className="text-button" onClick={()=>setBatchAssignIds(ids=>batchAssignableRows.every(row=>ids.includes(row.product_id))?ids.filter(id=>!batchAssignableRows.some(row=>row.product_id===id)):[...new Set([...ids,...batchAssignableRows.map(row=>row.product_id)])])}>{batchAssignableRows.every(row=>batchAssignIds.includes(row.product_id))?"取消全選":"全選目前結果"}</button>}</div>
      <div className="count-batch-zone-list">{batchAssignableRows.map(row=>{const product=productOf(row);const supplier=Array.isArray(product?.suppliers)?product.suppliers[0]:product?.suppliers;return <label key={row.product_id}><input type="checkbox" checked={batchAssignIds.includes(row.product_id)} disabled={busy} onChange={e=>setBatchAssignIds(ids=>e.target.checked?[...ids,row.product_id]:ids.filter(id=>id!==row.product_id))}/><span><strong>{product?.name||"盤點品項"}</strong><small>{supplier?.name||"供應商未提供"}・{row.count_unit}</small></span></label>;})}</div>
      {!batchAssignableRows.length&&<p className="shell-note">{batchAssignQuery?"沒有符合搜尋的未分類品項。":"目前沒有可加入的未分類品項。"}</p>}
      <div className="count-batch-zone-footer"><span>已選 {batchAssignIds.length} 項</span><button type="button" className="shell-primary" disabled={busy||!batchAssignIds.length} onClick={()=>void assignUnclassifiedBatch()}>{busy?"加入中…":`加入 ${batchAssignIds.length} 項`}</button></div>
    </section></div>}
    {zonePicker&&<CountZonePicker zones={zones.filter(zone=>!unclassifiedCountZone(zone.name)&&zone.id!==zonePicker.sourceZoneId&&(!zonePicker.productId||!progress.some(item=>item.zone_id===zone.id&&item.status==="COMPLETED"))).map(zone=>({id:zone.id,name:zone.name,updated_at:zone.updated_at||""}))} productName={zonePicker.productName} title={zonePicker.mode==="move"?"更改儲物區":undefined} busy={busy} selectionBlocked={zoneReloadRequired} notice={zoneNotice} canRename={canImport} onSelect={zonePicker.productId?assignCountZone:undefined} onCreate={createCountZone} onRename={renameCountZone} onReload={reloadZoneProgress} onClose={()=>{if(!mutationLock.current)setZonePicker(null);}}/>}

    {page === "complete" && submitted && <>
<section className="completion-state"><span><Check /></span><h1>{countSession?.paper_required&&!countSession.paper_completed_at?"實際盤點已完成":"本次盤點完成"}</h1><p>{submittedTotals.zones} 個區域・{submittedTotals.products} 項已保存</p><p>{displayTime(countSession?.completed_at||null)}<br/>完成者：{completedBy}</p></section>
<div className="shell-button-stack">
  {countSession?.paper_required&&<button className="shell-primary" onClick={()=>goTo("paper")}>{countSession.paper_completed_at?"查看紙本謄寫表":"開啟紙本謄寫表"}</button>}
  <button className="shell-secondary" onClick={()=>goTo("details")}>查看結果</button>
  {!countSession?.paper_required&&<CountDetails sessionId={countSession!.id} management={canViewFullDetails} outputOnly/>}
  {canViewFullDetails&&discrepancies.length>0&&<button className="shell-secondary" onClick={()=>goTo("review")}>查看盤點差異</button>}
  {canManage&&!historySessionId&&submitted&&<button className="shell-primary" disabled={busy} onClick={()=>startCount()}>開始盤點</button>}
  <button className="shell-primary" onClick={onBack}>{returnLabel}</button>
</div>
    </>}

    {canImport && page === "import" && <>
      <InventoryImportFlow key={storeId} storeName={stores[0]?.name} storeId={storeId} organizationId={organizationId} disabled={busy} onHistory={()=>goTo("source")} onOrganize={()=>goTo("catalog")} onStartCount={canManage?()=>void startCount():undefined} onImported={async()=>{setImportComplete(true);setImportRevision(v=>v+1);await loadCountData();}}/>
    </>}

    {canManage && page === "setup" && <>
      <div className="shell-card zone-progress-list">{zones.map(zone => <button key={zone.id} className="zone-progress-row" type="button" onClick={() => { setSelectedZoneId(zone.id); goTo("zone-edit"); }}><span className="zone-marker"><Package size={18} /></span><span className="zone-info"><strong>{zone.name}</strong><small>{zone.zone_products.length} 項・點入編輯</small></span><ChevronRight size={18} /></button>)}</div>
      {productCount === 0 && !importComplete ? <div className="shell-button-stack"><p className="shell-note">有既有資料可先匯入；沒有資料可直接在下方手動新增品項。</p><button className="shell-secondary" onClick={() => goTo("import")}>資料匯入</button></div> : null}
      {!setupLocked ? <>
        <details className="setup-panel"><summary>新增儲物區域</summary><form onSubmit={addZone} className="compact-form"><label>區域名稱<input name="zone_name" placeholder="例如冷藏庫" required /></label><button disabled={busy}>建立並配置品項</button></form></details>
        <details className="setup-panel" open={productCount===0}><summary>新增品項</summary><form onSubmit={addProduct} className="compact-form product-form">
          <label>區域<select name="zone_id">{zones.map(zone => <option key={zone.id} value={zone.id}>{zone.name}</option>)}</select></label>
          <label>品項<input name="product_name" required /></label><label>單位<input name="unit" required /></label><label>期初數量（可留白）<input name="opening_quantity" type="number" min="0" step="any" placeholder="未提供" /></label><button disabled={busy}>建立品項</button>
        </form></details>
      </> : <p className="shell-note">已輸入盤點數量，完成本次盤點後可再調整區域。</p>}
      {productCount > 0 && <div className="shell-button-stack"><button className="shell-secondary" onClick={() => goTo("catalog")}>查看期初及品項</button><button className="shell-primary" disabled={busy} onClick={() => void startCount()}>{setupLocked?"繼續盤點":"開始盤點"}</button></div>}
    </>}
    {canManage && page === "zone-edit" && selectedZone && <ZoneEditor storeId={storeId} userId={session.user.id} canEditProducts={canManage} onProductSaved={updateProduct} key={selectedZone.id} zone={selectedZone} zones={zones} locked={setupLocked} onSaved={async () => { await loadCountData(); setImportRevision(value => value + 1); goTo("setup"); setNotice("區域設定已儲存。"); }} />}
    {canViewFullDetails && page === "catalog" && <><div className="shell-button-stack">{canManage&&<><button className="shell-primary" onClick={()=>goTo("setup")}>整理儲物區域</button><button className="shell-secondary" disabled={busy} onClick={()=>void startCount()}>開始盤點</button></>}{canImport && <button className="shell-secondary" onClick={()=>goTo("import")}>追加盤點資料</button>}<button className="text-button" onClick={()=>goTo("source")}>查看匯入紀錄 ›</button></div><InventoryCatalog userId={session.user.id} onChanged={async()=>{await loadCountData();}} canEdit={canManage} key={`catalog:${storeId}:${importRevision}`} storeId={storeId} refreshKey={importRevision} expanded /></>}
    {canViewFullDetails && page === "source" && <ImportHistory key={`${storeId}:${importRevision}`} storeId={storeId} refreshKey={importRevision} removable={canImport} storeName={stores[0]?.name} onRemoved={async()=>{await loadCountData();}} />}
    {page === "details" && submitted && <CountDetails sessionId={countSession!.id} management={canViewFullDetails} />}
    {canViewFullDetails && page === "history" && <CountHistory storeId={storeId} management onOpen={id=>void openHistory(id)}/>}
    {canViewFullDetails && page === "review" && submitted && <>
      <p className="shell-note">只顯示需要處理的差異與本期為 0 的品項；正常品項可從「查看結果」查閱。</p>
      {zeroItems.length>0&&<section className="shell-section"><div className="shell-section-head"><h2>本期為 0</h2><span>{zeroItems.length} 項</span></div><div className="shell-card discrepancy-list">{zeroItems.map(item=><article key={`zero-${item.product_id}`}><header><strong>{item.name}</strong><span>0 {item.unit}</span></header><div className="shell-button-stack"><button className="shell-secondary" disabled={busy} onClick={()=>void setNextPeriod(item.product_id,"KEEP")}>保留</button><button className="shell-secondary" disabled={busy} onClick={()=>void setNextPeriod(item.product_id,"EXCLUDE")}>下期不列入</button><button className="text-button" disabled={busy} onClick={()=>void setNextPeriod(item.product_id,"DISABLE")}>停用品項</button></div></article>)}</div></section>}
      {discrepancies.length>0&&<><h2>差異待辦</h2><div className="shell-card discrepancy-list">{discrepancies.map(item => {
        const product = zones.flatMap(zone => zone.zone_products).map(productOf).find(row => row?.id === item.product_id);
        return <article key={item.id}><header><strong>{product?.name || countSession?.snapshot?.zones?.find(p=>p.product_id===item.product_id)?.product_name || "盤點品項"}</strong><span>{item.difference !== null && item.difference > 0 ? "+" : ""}{item.difference} {product?.count_unit}</span></header>
          <p>{displayTime(item.previous_confirmed_at)}：{item.previous_quantity??"未提供"} → {displayTime(countSession?.completed_at||null)}：{item.estimated_quantity}</p>
          {item.status==='PENDING'&&canManage?<><label className="zone-editor-field">差異原因<select aria-label={`差異原因 ${product?.name}`} value={resolution[item.id]||''} onChange={e=>setResolution(r=>({...r,[item.id]:e.target.value}))}><option value="">請選擇原因</option>{[['INPUT_ERROR','輸入錯誤'],['MISSED_OR_WRONG_ZONE','漏盤／錯區'],['WASTE_NOT_RECORDED','報廢未登'],['TRANSFER_NOT_RECORDED','移轉／借用未登'],['RECEIPT_NOT_RECORDED','進貨未登'],['OTHER','其他']].map(([v,t])=><option key={v} value={v}>{t}</option>)}</select></label><label className="zone-editor-field">確認數量<input type="number" min="0" step="any" value={resolutionQuantity[item.id]??String(item.estimated_quantity)} onChange={e=>setResolutionQuantity(r=>({...r,[item.id]:e.target.value}))}/></label><button className="shell-primary" disabled={busy} onClick={()=>resolveDifference(item)}>保存原因與確認數量</button></>:<p>{item.status==='PENDING'?'待主管確認':'已處理'}{item.reason?`・${({INPUT_ERROR:'輸入錯誤',MISSED_OR_WRONG_ZONE:'漏盤／錯區',WASTE_NOT_RECORDED:'報廢未登',TRANSFER_NOT_RECORDED:'移轉／借用未登',RECEIPT_NOT_RECORDED:'進貨未登',OTHER:'其他'} as Record<string,string>)[item.reason]||item.reason}`:''}</p>}</article>;
      })}</div></>}
      <div className="shell-button-stack"><button className="shell-secondary" onClick={() => goTo("details")}>查看結果</button><button className="shell-secondary" onClick={()=>goTo("history")}>盤點歷史</button></div>
    </>}
    {notice && page !== "entry" && <p className="count-feedback" role="status">{notice}</p>}
  </section>;
}
