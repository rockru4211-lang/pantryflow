"use client";

import {RememberPosition} from "./workspace-memory";
import ReceiptImage from "./receipt-image";
import ReceiptDeliveryEditor from "./receipt-delivery-editor";
import {arrivalLabel,pendingDeliveryIssues,pendingReceiptErp,groupReceiptSuppliers,type ReceiptDelivery} from "@/lib/receipt-delivery";
import {useOperation} from "./operation-hooks";
import ContextExpiryForm from "./context-expiry-form";
import ReceiptReviewFields from "./receipt-review-fields";
import ReceiptCardEditor from "./receipt-card-editor";
import ReceiptDesktopReview from "./receipt-desktop-review";
import ReceiptSourceViewer from "./receipt-source-viewer";
import {hasStoredReceiptDraft} from "@/lib/receipt-review-draft";
import {workspaceStorage} from "@/lib/workspace-storage";
import { normalizeReceiptPhoto, receiptPhotoAccept } from "@/lib/receipt-photo";
import {groupReceiptLedger,matchesReceiptLedgerStatus,selectedReceiptLedgerRows,receiptDetailPage,receiptBatchesWithoutLedger,type ReceiptLedgerFilter} from "@/lib/receipt-ledger";
import {exportRows as exportRowsFile} from "./reports-workspace";
/* eslint-disable react-hooks/refs -- JSX helpers only pass callbacks; refs are read inside events and effects, never while rendering. */
import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, Truck, Check, Download, Search } from "lucide-react";
import { supabase } from "@/lib/supabase-browser";
import {
  displayReceiptValue,
  fieldNames,
  receiptError,
  receiptFingerprint,
  receiptGroups,
  receiptRows,
  receiptValue,
  saveReceiptRows,
  sha256,
  type ReceiptField,
} from "@/lib/receipt-workflow";
import { displayTime } from "./inventory-catalog";
import type { ShellRole } from "./app-shell";

type Page =
  | "list"
  | "inbox"
  | "direct"
  | "upload"
  | "status"
  | "review"
  | "published"
  | "issue"
  | "company-tasks"
  | "erp-complete";
export type Batch = {
  id: string;
  batch_number: string;
  status: string;
  uploaded_at: string;
  work_date: string;
  erp_required: boolean;
  erp_completed_at: string | null;
  erp_completed_by: string | null;
  pages: number;
  supplier: string;
  ocr_status: string | null;
  review_allowed: boolean;
  retry_allowed: boolean;
  job_status: string | null;
  review_saved?: boolean;
  delivery?: ReceiptDelivery;
};
type Detail = {
  batch: Batch;
  review_allowed: boolean;
  full_access: boolean;
  erp_actor: string | null;
  documents: {
    id: string;
    name: string;
    path: string;
    mime_type: string;
    page_order: number;
  }[];
  run: {
    id: string;
    status: string;
    model: string;
    started_at: string;
    completed_at: string | null;
    error_code: string | null;
  } | null;
  job: { status: string; attempt_count: number } | null;
  fields: ReceiptField[];
  mappings: {
    row_key: string;
    product_id: string;
    name: string;
    code: string;
    unit: string;
    specification: string;
  }[];
  line_states?: {row_key:string;included:boolean;source:'AUTO'|'MANUAL';decision:'INCLUDE'|'IGNORE'|null}[];
  manual_lines?: {id:string;supplier_name:string;product_name:string;specification:string;unit:string;quantity:number;unit_price_ex_tax:number|null;line_subtotal_ex_tax:number|null;note:string;deleted_at:string|null}[];
  receipt: { id: string; reviewed_at: string | null } | null;
  review?: { saved_rows: string[]; complete: boolean; confirmed_at?: string | null; confirmed_by?: string | null };
};
type Photo = { file: File; preview: string; hash: string };
type LedgerRow = {
  batch_id:string; run_id:string|null; row_key:string; uploaded_at:string; receipt_date:string|null; supplier_name:string;
  product_code:string|null; product_id:string|null; product_name:string; source_product:string;
  specification:string; unit:string; quantity:number|null; unit_price:number|null; subtotal:number|null;
  mapped:boolean; status:'COMPLETE'|'NEEDS_MAPPING'|'PENDING'; review_allowed:boolean;
  source_kind?:'OCR'|'MANUAL';
};
type ReceiptInboxState='FILE_MISSING'|'OCR_FAILED'|'PROCESSING'|'NEEDS_REVIEW'|'COMPLETE'|'RECEIVED';
type ReceiptInboxRow={
  batch_id:string;batch_number:string;uploaded_at:string;work_date:string;status:string;
  page_count:number;stored_page_count:number;job_status:string|null;run_status:string|null;attempt_count:number;
  last_error:string|null;supplier_name:string;receipt_date:string;line_count:number;complete_line_count:number;
  review_complete:boolean;has_goods_receipt:boolean;state:ReceiptInboxState;
};
type RecordFlag={entity_id:string;state:'LIVE'|'TEST'|'REMOVED';reason:string|null;updated_at:string};
const normalizedReceiptDate=(value:string|null)=>{if(!value)return null;const raw=String(value).trim();const numeric=raw.match(/^(\d{3,4})[\/.-](\d{1,2})[\/.-](\d{1,2})$/);if(numeric){const sourceYear=Number(numeric[1]);const year=numeric[1].length===3?sourceYear+1911:sourceYear;const month=Number(numeric[2]);const day=Number(numeric[3]);if(year>=1900&&month>=1&&month<=12&&day>=1&&day<=31)return [String(year).padStart(4,"0"),String(month).padStart(2,"0"),String(day).padStart(2,"0")].join("-");}const roc=raw.match(/^(?:民國)?(\d{3})年(\d{1,2})月(\d{1,2})日?$/);if(roc){const year=Number(roc[1])+1911;const month=Number(roc[2]);const day=Number(roc[3]);if(month>=1&&month<=12&&day>=1&&day<=31)return [String(year),String(month).padStart(2,"0"),String(day).padStart(2,"0")].join("-");}const date=new Date(raw);if(Number.isNaN(date.getTime()))return null;return [date.getFullYear(),String(date.getMonth()+1).padStart(2,"0"),String(date.getDate()).padStart(2,"0")].join("-");};
const receiptDate=(value:string|null)=>{const normalized=normalizedReceiptDate(value);return normalized?normalized.replaceAll("-","/"):"未提供";};
const isConfirmed = (b: Batch) => b.status === "COMPLETED" || !!b.review_saved;
const localDateKey = (date: Date) => [date.getFullYear(),String(date.getMonth()+1).padStart(2,"0"),String(date.getDate()).padStart(2,"0")].join("-");
const ledgerPeriodRange=(mode:'TODAY'|'WEEK'|'MONTH')=>{
  const now=new Date(),start=new Date(now),end=new Date(now);
  if(mode==='WEEK'){const offset=(now.getDay()+6)%7;start.setDate(now.getDate()-offset);end.setDate(start.getDate()+6);}
  if(mode==='MONTH'){start.setDate(1);end.setMonth(now.getMonth()+1,0);}
  return{from:localDateKey(start),to:localDateKey(end)};
};
const receiptLineState=(row:LedgerRow)=>{
  if(!row.product_id||row.status==='NEEDS_MAPPING')return{label:'品項未建立',tone:'needs'};
  if(row.quantity===null||!row.unit||row.unit==='未提供'||row.unit_price===null)return{label:'需補資料',tone:'needs'};
  if(row.status==='COMPLETE')return{label:'已完成',tone:'done'};
  return{label:'待核對',tone:'pending'};
};
const statusName = (b: Batch) =>
  b.status === "COMPLETED"
    ? "已確認收貨"
    : b.review_saved
      ? "已確認收貨"
      : b.job_status === "FAILED"
        ? "辨識未完成"
        : b.job_status === "QUEUED" || b.job_status === "RUNNING"
          ? "識別中"
          : b.ocr_status === "SUCCEEDED"
            ? "待核對"
            : "上傳未完成";

export default function ReceivingWorkspace({
  storeId,
  userId,
  organizationId,
  role,
  businessType,
  onBack,
  returnLabel = "返回首頁",
  initialPage = "list",
  initialBatchId,
  embedded=false,
  onOpenReceipt,
}: {
  storeId: string;
  userId: string;
  organizationId: string;
  role: ShellRole;
  businessType: string;
  onBack: () => void;
  returnLabel?: string;
  initialPage?: Page;
  initialBatchId?: string;
  embedded?: boolean;
  onOpenReceipt?: (id:string)=>void;
}) {
  const [card,setCard]=useState<string>();
  const [directDraft,setDirectDraft]=useState({supplier_name:"",receipt_date:new Date().toISOString().slice(0,10),document_number:""});
  const [directLines,setDirectLines]=useState([{product_name:"",specification:"",unit:"",quantity:"",unit_price:"",note:""}]);
  const [deliveryOpen,setDeliveryOpen]=useState(false);
  const [selectedErp,setSelectedErp]=useState<string[]>([]);
  const [selectedLedgerBatchIds,setSelectedLedgerBatchIds]=useState<string[]>([]);
  const [batchSource,setBatchSource]=useState<Page>(initialPage);
  const operation=useOperation(storeId,userId);
  const [expiryOpen, setExpiryOpen] = useState(false);
  const [page, setPage] = useState<Page>(initialPage),
    [batchId, setBatchId] = useState(initialBatchId || ""),
    [batches, setBatches] = useState<Batch[]>([]),
    [ledger,setLedger]=useState<LedgerRow[]>([]),
    [inbox,setInbox]=useState<ReceiptInboxRow[]>([]),
    [inboxError,setInboxError]=useState(""),
    [ledgerError,setLedgerError]=useState(""),
    [ledgerSearch,setLedgerSearch]=useState(""),
    [ledgerFilter,setLedgerFilter]=useState<ReceiptLedgerFilter>("ALL"),
    [ledgerPeriod,setLedgerPeriod]=useState<'TODAY'|'WEEK'|'MONTH'|'CUSTOM'>('MONTH'),
    [ledgerDateFrom,setLedgerDateFrom]=useState(()=>ledgerPeriodRange('MONTH').from),
    [ledgerDateTo,setLedgerDateTo]=useState(()=>ledgerPeriodRange('MONTH').to),
    [ledgerSupplier,setLedgerSupplier]=useState("ALL"),
    [ledgerScope,setLedgerScope]=useState<'ALL'|'ACTION'|'COMPLETE'|'TEST'|'REMOVED'>('ALL'),
    [recordView,setRecordView]=useState<'LIVE'|'TEST'|'REMOVED'>('LIVE'),
    [recordFlags,setRecordFlags]=useState<Record<string,RecordFlag>>({}),
    [recordFlagBusy,setRecordFlagBusy]=useState<string|null>(null),
    [detail, setDetail] = useState<Detail | null>(null),
    [photos, setPhotos] = useState<Photo[]>([]),
    [same, setSame] = useState(false),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [message, setMessage] = useState(""),
    [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const initialRoute = useRef(
    initialPage === "company-tasks" ? "" : initialBatchId || "",
  );
  const fileInput = useRef<HTMLInputElement>(null),
    photosRef = useRef<Photo[]>([]),
    uploadLock = useRef(false);
  const chain = businessType === "CHAIN_RESTAURANT",
    fieldRole = role === "STAFF" || role === "SUPERVISOR";
  const readSequence=useRef(0);
  const refresh = useCallback(async () => {
    const sequence=++readSequence.current;
    const [batchRead,ledgerRead,inboxRead,flagsRead] = await Promise.allSettled([
      supabase.rpc("get_pilot_receipts",{p_store_id:storeId}),
      fieldRole ? Promise.resolve({data:[] as unknown[],error:null}) : supabase.rpc("get_pilot_receipt_ledger",{p_store_id:storeId}),
      fieldRole ? Promise.resolve({data:[] as unknown[],error:null}) : supabase.rpc("get_baihuayuan_receipt_inbox",{p_store_id:storeId}),
      fieldRole ? Promise.resolve({data:[] as unknown[],error:null}) : supabase.rpc("get_baihuayuan_record_flags",{p_store_id:storeId,p_entity_type:"RECEIPT_BATCH"}),
    ]);
    if(sequence!==readSequence.current)return;
    if(!fieldRole){
      if(ledgerRead.status==="rejected"||ledgerRead.value.error){
        setLedger([]);
        setSelectedLedgerBatchIds([]);
        setLedgerError("進貨明細彙總未能讀取，仍可從下方開啟貨單。");
      }else{
        setLedger((ledgerRead.value.data||[]) as unknown as LedgerRow[]);
        setLedgerError("");
      }
      if(inboxRead.status==="rejected"||inboxRead.value.error){
        setInbox([]);
        setInboxError("貨單收件箱暫時無法讀取。");
      }else{
        setInbox((inboxRead.value.data||[]) as unknown as ReceiptInboxRow[]);
        setInboxError("");
      }
      if(flagsRead.status==="fulfilled"&&!flagsRead.value.error){
        setRecordFlags(Object.fromEntries(((flagsRead.value.data||[]) as unknown as RecordFlag[]).map(flag=>[flag.entity_id,flag])));
      }
    }
    if(batchRead.status==="rejected")throw batchRead.reason;
    const result=batchRead.value;
    if (result.error) throw result.error;
    setBatches(result.data as unknown as Batch[]);
    let nextDetail:Detail|null=null;
    if (batchId) {
      const d = await supabase.rpc("get_pilot_receipt", {
        p_batch_id: batchId,
      });
      if(sequence!==readSequence.current)return;
      if (d.error) throw d.error;
      const next=d.data as unknown as Detail;
      if ((next.batch as unknown as {store_id?:string}).store_id && (next.batch as unknown as {store_id?:string}).store_id!==storeId) throw Error('STORE_SCOPE_MISMATCH');
      nextDetail=next;
    }
    if(sequence!==readSequence.current)return;
    if(nextDetail)setDetail(nextDetail);
    setLoading(false);
    return nextDetail||undefined;
  }, [storeId, batchId, fieldRole]);
  useEffect(() => {
    let active = true;
    const counter=readSequence;
    const run = () =>
      refresh().catch((e) => {
        if (active) {
          setMessage(receiptError(e));
          setLoading(false);
        }
      });
    void run();
    const timer = setInterval(() => void run(), 6000);
    window.addEventListener("focus", run);
    return () => {
      active = false;
      counter.current++;
      clearInterval(timer);
      window.removeEventListener("focus", run);
    };
  }, [refresh]);
  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);
  useEffect(
    () => () =>
      photosRef.current.forEach((p) => URL.revokeObjectURL(p.preview)),
    [],
  );
  useEffect(() => {
    if (detail && initialRoute.current === detail.batch.id) {
      initialRoute.current = "";
      setPage(receiptDetailPage(detail));
    }
  }, [detail]);
  const paths = detail?.documents.map((d) => d.path).join("|") || "";
  useEffect(() => {
    let active = true;
    if (!paths) return;
    void supabase.storage
      .from("receipt-documents")
      .createSignedUrls(paths.split("|"), 3600)
      .then(({ data, error }) => {
        if (active) {
          if (error) setMessage("原圖暫時無法讀取，請稍後重新開啟。");
          else
            setImageUrls(
              Object.fromEntries(
                (data || []).map((d) => [d.path || "", d.signedUrl || ""]),
              ),
            );
        }
      });
    return () => {
      active = false;
    };
  }, [paths]);
  const rows = receiptRows(detail?.fields || []),
    fields = detail?.fields || [],
    value = (name: string, key: string) => receiptValue(fields, key, name),
    canReview =
      !!detail?.review_allowed &&
      detail.run?.status === "SUCCEEDED" &&
      receiptDetailPage(detail) === "review";
  const back = async () => {
    setMessage("");
    if (page === "company-tasks" && initialPage === "company-tasks") { onBack(); return; }
    if (page === "inbox" && initialPage === "inbox") { onBack(); return; }
    if (page === "direct") { setPage("list"); return; }
    if (page === "issue" && batchId) { setBatchId(""); setDetail(null); return; }
    if (page === "issue" && initialPage === "issue") { onBack(); return; }
    if (page === "list" || (initialBatchId && ["status","published","review","erp-complete"].includes(page)))
      onBack();
    else if (["status","published","review"].includes(page) && batchSource==="company-tasks") setPage("company-tasks");
    else setPage("list");
  };
  function openBatch(b: Batch) {
    if(onOpenReceipt){onOpenReceipt(b.id);return;}
    if(!["status","review","published"].includes(page))setBatchSource(page);
    setLoading(true);
    setMessage("");
    setDetail(null);
    setBatchId(b.id);
    initialRoute.current=b.id;
    setPage("status");
  }
  async function act(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      await action();
    } catch (e) {
      setMessage(receiptError(e));
    } finally {
      setBusy(false);
    }
  }
  async function addPhotos(files: FileList | null) {
    if (!files) return;
    const next = [...photosRef.current];
    let note = "";
    setBusy(true);
    try {
      for (const selected of Array.from(files)) {
        if (next.length >= 10) {
          note = "一次最多 10 張，已保留選取的照片。";
          break;
        }
        let file: File;
        try {
          file = await normalizeReceiptPhoto(selected);
        } catch {
          note = "請選擇 10 MB 以內的 JPG、PNG、WebP、HEIC 或 PDF。";
          continue;
        }
        const hash = await sha256(await file.arrayBuffer());
        if (next.some((p) => p.hash === hash)) {
          note = "已略過重複照片。";
          continue;
        }
        next.push({ file, hash, preview: URL.createObjectURL(file) });
      }
      setPhotos(next);
      setMessage(note);
    } catch (e) {
      setMessage(receiptError(e));
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  async function upload() {
    if (uploadLock.current || !photos.length) return;
    uploadLock.current = true;
    await act(async () => {
      const remaining: Photo[] = [];
      let last = "";
      const errors: string[] = [];
      for (const group of receiptGroups(photos, same)) {
        try {
          const mode = same ? "SAME_RECEIPT" : "SEPARATE_RECEIPTS";
          const { data, error } = await supabase.rpc(
            "begin_pilot_receipt_upload",
            {
              p_store_id: storeId,
              p_fingerprint: await receiptFingerprint(
                mode,
                group.map((p) => p.hash),
              ),
              p_group_mode: mode,
              p_documents: group.map((p) => ({
                sha256: p.hash,
                name: p.file.name,
                mime_type: p.file.type,
                byte_size: p.file.size,
              })),
            },
          );
          if (error) throw error;
          const manifest = data as unknown as {
            batch_id: string;
            documents: {
              sha256: string;
              storage_path: string;
              stored: boolean;
            }[];
          };
          for (const doc of manifest.documents) {
            if (doc.stored) continue;
            const source = group.find((p) => p.hash === doc.sha256);
            if (!source) throw new Error("ORIGINAL_UPLOAD_INCOMPLETE");
            const result = await supabase.storage
              .from("receipt-documents")
              .upload(doc.storage_path, source.file, {
                contentType: source.file.type,
                upsert: false,
              });
            if (result.error) {
              const check = await supabase.rpc("begin_pilot_receipt_upload", {
                p_store_id: storeId,
                p_fingerprint: await receiptFingerprint(
                  mode,
                  group.map((p) => p.hash),
                ),
                p_group_mode: mode,
                p_documents: group.map((p) => ({
                  sha256: p.hash,
                  name: p.file.name,
                  mime_type: p.file.type,
                  byte_size: p.file.size,
                })),
              });
              const state = check.data as unknown as typeof manifest;
              if (
                check.error ||
                !state.documents.find((d) => d.sha256 === doc.sha256)?.stored
              )
                throw result.error;
            }
          }
          const queued = await supabase.functions.invoke(
            "enqueue-receipt-ocr",
            { body: { batchId: manifest.batch_id } },
          );
          if (
            queued.error ||
            queued.data?.results?.some((r: { queued: boolean }) => !r.queued)
          )
            throw new Error(queued.data?.results?.[0]?.error || "QUEUE_FAILED");
          last = manifest.batch_id;
        } catch (e) {
          remaining.push(...group);
          errors.push(receiptError(e));
        }
      }
      photos
        .filter((p) => !remaining.includes(p))
        .forEach((p) => URL.revokeObjectURL(p.preview));
      setPhotos(remaining);
      if (errors.length) {
        setMessage(
          `${errors.length} 批尚未完成。${errors[0]} 成功批次已保存。`,
        );
        await refresh();
      } else if (last) {
        setBatchId(last);
        setDetail(null);
        setPage("status");
      }
    });
    uploadLock.current = false;
  }
  async function saveDirectReceipt(){
    const lines=directLines.filter(line=>line.product_name.trim()||line.quantity.trim()||line.unit.trim());
    if(!directDraft.supplier_name.trim()||!directDraft.receipt_date||!lines.length){setMessage("請填寫供應商、進貨日期與至少一筆明細。");return;}
    if(lines.some(line=>!line.product_name.trim()||!line.unit.trim()||!Number.isFinite(Number(line.quantity))||Number(line.quantity)<=0||line.unit_price!==""&&(!Number.isFinite(Number(line.unit_price))||Number(line.unit_price)<0))){setMessage("每筆明細都需要品名、單位與有效數量；單價可留空。");return;}
    await act(async()=>{
      const result=await supabase.rpc("create_baihuayuan_direct_receipt",{
        p_store_id:storeId,
        p_supplier_name:directDraft.supplier_name.trim(),
        p_receipt_date:directDraft.receipt_date,
        p_document_number:directDraft.document_number.trim(),
        p_lines:lines.map(line=>({
          product_name:line.product_name.trim(),
          specification:line.specification.trim(),
          unit:line.unit.trim(),
          quantity:Number(line.quantity),
          unit_price:line.unit_price===""?null:Number(line.unit_price),
          note:line.note.trim()
        }))
      });
      if(result.error)throw result.error;
      setDirectDraft({supplier_name:"",receipt_date:new Date().toISOString().slice(0,10),document_number:""});
      setDirectLines([{product_name:"",specification:"",unit:"",quantity:"",unit_price:"",note:""}]);
      await refresh();
      setMessage("進貨明細已建立。");
      setPage("list");
    });
  }
    async function saveReview() {
    if (!detail?.run) return;
    const runId = detail.run.id;
    const included=new Set((detail.line_states||[]).filter(row=>row.included).map(row=>row.row_key));
    const reviewFields=(detail.line_states?.length?fields.filter(field=>field.row_key==='document'||included.has(field.row_key)):fields);
    if(receiptRows(reviewFields).length){
      await saveReceiptRows(reviewFields, async row => {
        const saved = await supabase.rpc("save_pilot_receipt_review", {
          p_batch_id: batchId,
          p_row_key: row,
          p_run_id: runId,
        });
        if (saved.error) throw saved.error;
        return saved.data as { complete?: boolean };
      });
    }
    const completed=await supabase.rpc("complete_baihuayuan_receipt",{p_store_id:storeId,p_batch_id:batchId,p_run_id:runId});
    if(completed.error)throw completed.error;
    await refresh();
    setPage("published");
  }
  const intro = (title: string, copy: string, kicker?: string) => (
    <div className="shell-page-intro">
      {kicker && <span className="eyebrow">{kicker}</span>}
      <h1>{title}</h1>
      <p>{copy}</p>
    </div>
  );
  const action = (
    label: string,
    onClick: () => void,
    secondary = false,
    disabled = false,
  ) => (
    <button
      type="button"
      className={`${secondary ? "shell-secondary" : "shell-primary"} full`}
      onClick={onClick}
      disabled={disabled || busy}
    >
      {busy ? "處理中…" : label}
    </button>
  );
  const recordState=(id:string)=>recordFlags[id]?.state||'LIVE';
  const changeRecordState=async(id:string,state:'LIVE'|'TEST'|'REMOVED')=>{let reason:string|null=null;if(state==='REMOVED'){reason=window.prompt("請輸入移出原因，例如：測試資料、重複建立、登記錯誤");if(!reason?.trim())return;}setRecordFlagBusy(id);setMessage("");const{error}=await supabase.rpc("set_baihuayuan_record_state",{p_store_id:storeId,p_entity_type:"RECEIPT_BATCH",p_entity_id:id,p_state:state,p_reason:reason});if(error)setMessage(receiptError(error));else setRecordFlags(prev=>({...prev,[id]:{entity_id:id,state,reason,updated_at:new Date().toISOString()}}));setRecordFlagBusy(null);};
  const erpPending = batches.filter(pendingReceiptErp).filter(b=>recordState(b.id)==='LIVE');
  const activeRecordView=ledgerScope==='TEST'?'TEST':ledgerScope==='REMOVED'?'REMOVED':'LIVE';
  const visibleLedger=ledger.filter(row=>{
    if(recordState(row.batch_id)!==activeRecordView)return false;
    const state=receiptLineState(row);
    if(ledgerScope==='ACTION'&&state.label==='已完成')return false;
    if(ledgerScope==='COMPLETE'&&state.label!=='已完成')return false;
    if(ledgerSupplier!=='ALL'&&row.supplier_name!==ledgerSupplier)return false;
    const date=normalizedReceiptDate(row.receipt_date)||"";
    if(ledgerDateFrom&&date&&date<ledgerDateFrom)return false;
    if(ledgerDateTo&&date&&date>ledgerDateTo)return false;
    const q=ledgerSearch.trim().toLocaleLowerCase();
    if(!q)return true;
    return [row.product_code,row.supplier_name,row.product_name,row.source_product,row.specification,row.receipt_date].some(v=>String(v||"").toLocaleLowerCase().includes(q));
  });
  const groupedLedger=groupReceiptLedger(visibleLedger);
  const ledgerSuppliers=[...new Set(ledger.filter(row=>recordState(row.batch_id)==='LIVE').map(row=>row.supplier_name).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'zh-Hant'));
  const ledgerReceiptCount=new Set(visibleLedger.map(row=>row.batch_id)).size;
  const ledgerTotal=visibleLedger.reduce((sum,row)=>sum+Number(row.subtotal||0),0);
  const ledgerActionCount=visibleLedger.filter(row=>receiptLineState(row).label!=='已完成').length;
  const batchById=new Map(batches.map(batch=>[batch.id,batch]));
  const receiptNavigation=groupReceiptLedger(batches.map(batch=>({batch_id:batch.id,supplier_name:ledger.find(row=>row.batch_id===batch.id)?.supplier_name||batch.supplier||"供應商待確認",batch,date:ledger.find(row=>row.batch_id===batch.id)?.receipt_date||null})));
  const liveLedger=ledger.filter(row=>recordState(row.batch_id)==='LIVE');
  const pendingLedger=liveLedger.filter(row=>row.status!=="COMPLETE");
  const completedLedger=liveLedger.filter(row=>row.status==="COMPLETE");
  const needsMappingLedger=liveLedger.filter(row=>row.status==="NEEDS_MAPPING");
  const inboxNeedsAttention=inbox.filter(row=>recordState(row.batch_id)==='LIVE'&&['FILE_MISSING','OCR_FAILED','NEEDS_REVIEW','RECEIVED'].includes(row.state));
  const inboxProcessing=inbox.filter(row=>row.state==='PROCESSING');
  const inboxComplete=inbox.filter(row=>row.state==='COMPLETE');
  const failedInbox=inbox.filter(row=>recordState(row.batch_id)==='LIVE'&&row.state==='OCR_FAILED'&&row.stored_page_count===row.page_count);
  const inboxStateLabel=(state:ReceiptInboxState)=>state==='FILE_MISSING'?'原圖缺失':state==='OCR_FAILED'?'辨識失敗':state==='PROCESSING'?'辨識中':state==='NEEDS_REVIEW'?'待人工核對':state==='COMPLETE'?'已建檔':'已收到';
  const openInbox=(row:ReceiptInboxRow)=>{const batch=batches.find(item=>item.id===row.batch_id);if(batch)openBatch(batch);else{setMessage('這筆貨單已收到，但清單尚未同步，請重新讀取。');void refresh();}};
  async function retryFailedInbox(){
    if(!failedInbox.length||busy)return;
    await act(async()=>{
      let queued=0,failed=0;
      for(let i=0;i<failedInbox.length;i+=10){
        const batchIds=failedInbox.slice(i,i+10).map(row=>row.batch_id);
        const result=await supabase.functions.invoke("enqueue-receipt-ocr",{body:{batchIds}});
        if(result.error){failed+=batchIds.length;continue;}
        const rows=(result.data?.results||[]) as {queued:boolean}[];
        queued+=rows.filter(row=>row.queued).length;
        failed+=rows.filter(row=>!row.queued).length;
      }
      await refresh();
      if(failed) setMessage("已重新排入 "+queued+" 張；另有 "+failed+" 張未能重新排入，請稍後再試。");
      else setMessage("已重新排入 "+queued+" 張失敗貨單，系統會在背景重新辨識。");
    });
  }
  const selectedLedgerRows=ledgerError?[]:selectedReceiptLedgerRows(ledger,visibleLedger,selectedLedgerBatchIds);
  const selectedLedgerReceipts=new Set(selectedLedgerRows.map(row=>row.batch_id)).size;
  const selectedHiddenRows=selectedLedgerRows.filter(row=>!visibleLedger.includes(row)).length;
  const selectableLedgerBatchIds=[...new Set(visibleLedger.filter(row=>row.status!=="COMPLETE"&&row.review_allowed&&row.run_id).map(row=>row.batch_id))];
  const unlistedBatches=ledgerError?batches:receiptBatchesWithoutLedger(batches,ledger);
  function chooseLedgerPeriod(mode:'TODAY'|'WEEK'|'MONTH'|'CUSTOM'){
    setSelectedLedgerBatchIds([]);setLedgerPeriod(mode);
    if(mode!=='CUSTOM'){const range=ledgerPeriodRange(mode);setLedgerDateFrom(range.from);setLedgerDateTo(range.to);}
  }
  function changeLedgerFilter(filter:ReceiptLedgerFilter){setSelectedLedgerBatchIds([]);setLedgerFilter(filter);}
  function openLedger(row:LedgerRow){
    setBatchSource("list");
    setLoading(true);
    setMessage("");
    setDetail(null);
    setBatchId(row.batch_id);
    initialRoute.current=row.batch_id;
    setPage("status");
  }
  async function confirmLedger(){
    if(ledgerError||loading){setMessage(ledgerError||"進貨明細正在讀取，請稍後再試。");return;}
    const rows=selectedLedgerRows.map(row=>({batch_id:row.batch_id,run_id:row.run_id!,row_key:row.row_key}));
    if(!rows.length){setMessage("請先選取要核對的貨單。");return;}
    try {
      if(rows.some(row=>hasStoredReceiptDraft(workspaceStorage(userId),userId,storeId,row.batch_id,row.run_id))){
        setMessage("所選貨單還有未儲存的修改，請開啟貨單儲存或捨棄草稿，再完成核對。");return;
      }
    } catch {
      setMessage("無法確認本機草稿狀態，請開啟貨單完成核對。");return;
    }
    await act(async()=>{
      const result=await supabase.rpc("confirm_pilot_receipt_ledger",{p_store_id:storeId,p_rows:rows});
      if(result.error)throw result.error;
      const data=result.data as unknown as {confirmed?:number;failed_count?:number};
      await refresh();
      setSelectedLedgerBatchIds([]);
      setMessage(data.failed_count?"已確認 "+(data.confirmed||0)+" 筆；另有 "+data.failed_count+" 筆需要補資料。":"已確認建檔 "+(data.confirmed||rows.length)+" 筆。");
    });
  }
  async function exportLedger(format:"xlsx"|"csv"){
    if(ledgerError||loading){setMessage(ledgerError||"進貨明細正在讀取，請稍後再試。");return;}
    const exportRows=visibleLedger.map(row=>({"商家品項編碼":row.product_code||"待建立","進貨日期":receiptDate(row.receipt_date),"供應商":row.supplier_name,"品名":row.product_name,"包裝規格":row.specification||"未提供","進貨單位":row.unit||"未提供","進貨數量":row.quantity??"","未稅單價":row.unit_price??"","未稅金額":row.subtotal??"","狀態":row.status==="COMPLETE"?"已完成":row.status==="NEEDS_MAPPING"?"待對應":"待核對"}));
    if(!exportRows.length){setMessage("目前沒有可匯出的資料。");return;}
    const stamp=new Date().toISOString().slice(0,10);
    try { await exportRowsFile(exportRows,format,"進貨資料_"+stamp); }
    catch { setMessage("匯出未完成，請重試。"); }
  }
  async function reportErp(ids:string[]) {
    const result=await operation.run('receipt.erp-bulk',{batch_ids:ids});
    if(result){
      setSelectedErp([]);
      await refresh();
      setMessage(`已回報 ${ids.length} 張貨單。進貨異常仍保留待處理。`);
    }
  }
  const batchList = (list: Batch[],selectable=false) => <>
    {groupReceiptSuppliers(list).map(({supplier,receipts})=><section className="shell-section" key={supplier}>
      <h2>{supplier}</h2><div className="shell-card shell-list">
        {receipts.map(b=><div className="delivery-task-row" key={b.id}>
          {selectable&&fieldRole&&<input type="checkbox" aria-label={`選取貨單 ${b.batch_number}`} disabled={busy||operation.busy} checked={selectedErp.includes(b.id)} onChange={e=>setSelectedErp(ids=>e.target.checked?[...ids,b.id]:ids.filter(id=>id!==b.id))}/>}
          <button type="button" className="shell-list-row" disabled={busy||operation.busy} onClick={()=>openBatch(b)}><span><strong>{b.batch_number}</strong><small>{arrivalLabel(b.delivery)}</small></span><span className={pendingDeliveryIssues(b.delivery)?'delivery-alert':'delivery-muted'}>異常 {pendingDeliveryIssues(b.delivery)}<b aria-hidden="true"> ›</b></span></button>
        </div>)}
      </div>
    </section>)}
    {!list.length&&<p className="shell-note">{loading?'正在讀取…':selectable?'目前沒有待完成貨單':'目前沒有貨單'}</p>}
  </>;
  const pictures = detail && (
    <section className="shell-card receipt-preview receipt-images">
      {detail.documents.map((d) => (
        <figure key={d.id}>
          {imageUrls[d.path] ? (
            d.mime_type === "application/pdf" ? (
              <a href={imageUrls[d.path]} target="_blank" rel="noreferrer">
                開啟原始 PDF
              </a>
            ) : (
              <a href={imageUrls[d.path]} target="_blank" rel="noreferrer">
                <ReceiptImage
                  src={imageUrls[d.path]}
                  mime={d.mime_type}
                  alt={`原始貨單第 ${d.page_order} 頁`}
                />
              </a>
            )
          ) : (
            <p>原圖讀取中…</p>
          )}
          <figcaption>
            第 {d.page_order} / {detail.documents.length} 頁・{d.name}
          </figcaption>
        </figure>
      ))}
    </section>
  );
  const readLines = detail && (
    <section className="receipt-lines">
      {rows.map((key) => (
        <article className="receipt-line-card" key={key}>
          <h4>{displayReceiptValue(value("product", key))}</h4>
          <div className="receipt-line-summary">
            <span>
              實收數量
              <b>
                {displayReceiptValue(value("quantity", key))}{" "}
                {displayReceiptValue(value("unit", key))}
              </b>
            </span>
            {detail.full_access && (
              <span>
                單價
                <b>{displayReceiptValue(value("unit_price_ex_tax", key))}</b>
              </span>
            )}
          </div>
          <details>
            <summary>規格與辨識明細</summary>
            {fields
              .filter(
                (f) =>
                  f.row_key === key &&
                  f.field_name !== "product" &&
                  f.field_name !== "quantity",
              )
              .map((f) => (
                <div className="receipt-readonly-field" key={f.id}>
                  <span>{fieldNames[f.field_name]}</span>
                  <strong>{displayReceiptValue(f.value)}</strong>
                </div>
              ))}
          </details>
        </article>
      ))}
    </section>
  );
  const deliverySummary=detail&&(<section className="shell-card delivery-summary">
        <div><strong>{arrivalLabel(detail.batch.delivery)}</strong><span className={pendingDeliveryIssues(detail.batch.delivery)?'delivery-alert':'delivery-muted'}>異常 {pendingDeliveryIssues(detail.batch.delivery)}</span></div>
        {fieldRole?<button type="button" className="text-button" disabled={busy||operation.busy} onClick={()=>setDeliveryOpen(true)}>修改到貨／處理異常</button>:null}
        {!!detail.batch.delivery?.issues.length&&<details><summary>異常紀錄</summary>{detail.batch.delivery.issues.map(issue=><div className="delivery-issue" key={issue.id}><strong>{issue.name}・{issue.reason}</strong><p>{issue.status==='COMPLETE'?'已處理':'待處理'}{issue.quantity!==null?`・實收 ${issue.quantity} ${issue.unit}`:''}</p>{issue.note&&<p>{issue.note}</p>}</div>)}</details>}
        {detail.batch.erp_required&&<div className="receipt-erp-detail"><strong>{detail.batch.erp_completed_at?'ERP 已完成':'ERP 待完成'}</strong>{detail.batch.erp_completed_at?<p>{detail.erp_actor}・{displayTime(detail.batch.erp_completed_at)}</p>:fieldRole&&detail.job&&<button type="button" className="shell-primary full" disabled={busy||operation.busy} onClick={()=>void act(()=>reportErp([detail.batch.id]))}>{busy||operation.busy?'儲存中…':operation.error?'重試回報 ERP 已完成':'回報 ERP 已完成'}</button>}{operation.error&&<p role="alert">{operation.error}</p>}</div>}
        <details><summary>上傳紀錄</summary><p>上傳時間 {displayTime(detail.batch.uploaded_at)}</p></details>
      </section>);
  return (
    <RememberPosition key={`${storeId}:${page}:${["list","company-tasks","issue"].includes(page)?"":batchId}`} name={`receipts:${page}:${["list","company-tasks","issue"].includes(page)?"":batchId}`}><div className={`receiving-flow ${fieldRole?"field-receiving":"admin-receiving"}`}>
      {!embedded&&<button className="shell-back" onClick={back}>
        ‹{" "}
        <span>
          {page === "list" || (page === "company-tasks" && initialPage === "company-tasks") || (initialBatchId && ["status","published","review","erp-complete"].includes(page)) ? returnLabel : batchSource==='company-tasks'&&['status','review','published'].includes(page)?'返回 ERP 待完成':"返回進貨"}
        </span>
      </button>}
      {message && (
        <p className="shell-note" role="status">
          {message}<button type="button" className="text-button" disabled={busy} onClick={()=>void act(refresh)}>重新讀取</button>
        </p>
      )}
      {detail&&["status","review","published"].includes(page)&&!(page==="review"&&!fieldRole)&&deliverySummary}
      {deliveryOpen&&detail&&<ReceiptDeliveryEditor key={detail.batch.id} storeId={storeId} userId={userId} batchId={detail.batch.id} delivery={detail.batch.delivery} names={rows.map(row=>String(value('product',row)||'')).filter(Boolean)} onClose={saved=>{setDeliveryOpen(false);if(saved){setDetail(current=>current?{...current,batch:{...current.batch,delivery:saved}}:current);setBatches(current=>current.map(b=>b.id===batchId?{...b,delivery:saved}:b));void act(refresh);}}}/>}
      {detail?.run?.model==='預設示範資料'&&['status','review','published'].includes(page)&&<p className="shell-note">體驗版以預設品項示範核對與儲存，不辨識照片內容；照片只留在此裝置。</p>}
      {page === "list" && (
        <>
          {fieldRole ? <>
            {intro("進貨／收貨","先上傳貨單建檔；理貨後只有發現問題時，才從首頁「進貨異常回報」補充紀錄。")}
            <section className="shell-card upload-shell">
              <span><Truck className="ui-icon" /></span>
              <h2>上傳貨單</h2>
              <p>可拍照或從相簿選擇，一次最多 10 張</p>
              {action("開始上傳",()=>{setMessage("");setPage("upload");})}
            </section>
            <section className="shell-section"><div className="shell-section-head"><h2>貨單紀錄</h2></div>{batchList(batches)}</section>
          </> : <>
            <div className="receipt-ledger-heading">
              <div>{intro("進貨明細","核對 OCR 建立的資料，或由行政直接新增辦公室收到的進貨明細。")}</div>
              <div className="receipt-ledger-export"><button type="button" className="shell-primary" disabled={busy} onClick={()=>{setMessage("");setPage("direct");}}>＋ 新增進貨明細</button><button type="button" className="shell-secondary" disabled={busy||loading||!!ledgerError} onClick={()=>void exportLedger("xlsx")}><Download className="ui-icon"/>匯出 Excel</button><button type="button" className="text-button" disabled={busy||loading||!!ledgerError} onClick={()=>void exportLedger("csv")}>CSV</button></div>
            </div>
            {ledgerError&&<p className="shell-note" role="alert">{ledgerError}<button type="button" className="text-button" disabled={busy||loading} onClick={()=>void refresh().catch(error=>setMessage(receiptError(error)))}>重新讀取明細</button></p>}
            <div className="compact-tabs record-filter-chips" role="tablist" aria-label="資料狀態">
              <button type="button" className={recordView==="LIVE"?"active":""} onClick={()=>{setRecordView("LIVE");setSelectedLedgerBatchIds([]);}}>正式資料</button>
              <button type="button" className={recordView==="TEST"?"active":""} onClick={()=>{setRecordView("TEST");setSelectedLedgerBatchIds([]);}}>測試資料</button>
              <button type="button" className={recordView==="REMOVED"?"active":""} onClick={()=>{setRecordView("REMOVED");setSelectedLedgerBatchIds([]);}}>已移出</button>
            </div>
            <div className="receipt-ledger-metrics">
              <button type="button" className={ledgerFilter==="PENDING"?"active":""} onClick={()=>changeLedgerFilter("PENDING")}><small>待核對</small><strong>{ledgerError?"未能讀取":loading?"讀取中":pendingLedger.length}</strong></button>
              <button type="button" className={ledgerFilter==="COMPLETE"?"active":""} onClick={()=>changeLedgerFilter("COMPLETE")}><small>已完成</small><strong>{ledgerError?"未能讀取":loading?"讀取中":completedLedger.length}</strong></button>
              <button type="button" className={ledgerFilter==="NEEDS_MAPPING"?"active":""} onClick={()=>changeLedgerFilter("NEEDS_MAPPING")}><small>待補資料</small><strong>{ledgerError?"未能讀取":loading?"讀取中":needsMappingLedger.length}</strong></button>
            </div>
            <div className="receipt-ledger-toolbar">
              <label><span>起日</span><input type="date" value={ledgerDateFrom} onChange={e=>{setSelectedLedgerBatchIds([]);setLedgerDateFrom(e.target.value);}}/></label>
              <label><span>迄日</span><input type="date" value={ledgerDateTo} onChange={e=>{setSelectedLedgerBatchIds([]);setLedgerDateTo(e.target.value);}}/></label>
              <select value={ledgerFilter} onChange={e=>changeLedgerFilter(e.target.value as ReceiptLedgerFilter)} aria-label="核對狀態"><option value="PENDING">待核對</option><option value="NEEDS_MAPPING">待補資料</option><option value="COMPLETE">已完成</option><option value="ALL">全部狀態</option></select>
              <label className="receipt-ledger-search"><Search className="ui-icon"/><input type="search" value={ledgerSearch} onChange={e=>{setSelectedLedgerBatchIds([]);setLedgerSearch(e.target.value);}} placeholder="搜尋供應商、品項或商家編碼" aria-label="搜尋進貨資料"/></label>
              {(ledgerSearch||ledgerDateFrom||ledgerDateTo||ledgerFilter!=="PENDING")&&<button type="button" className="text-button" onClick={()=>{setLedgerSearch("");setLedgerDateFrom("");setLedgerDateTo("");changeLedgerFilter("PENDING");}}>清除條件</button>}
            </div>
            <label className="receipt-ledger-select-all"><input type="checkbox" aria-label="選取畫面中所有待核對貨單（整張）" disabled={busy||loading||!!ledgerError||!selectableLedgerBatchIds.length} checked={!!selectableLedgerBatchIds.length&&selectableLedgerBatchIds.every(id=>selectedLedgerBatchIds.includes(id))} onChange={e=>setSelectedLedgerBatchIds(e.target.checked?selectableLedgerBatchIds:[])}/>選取畫面中所有待核對貨單（整張）</label>
            {groupedLedger.map(group=><section className="receipt-supplier-group" key={group.supplier}><h2>{group.supplier} <small>・{group.receipts.length} 張貨單</small></h2><div className="receipt-admin-table-wrap">
              <table className="receipt-admin-table receipt-ledger-table">
                <thead><tr><th>整單</th><th>商家品項編碼</th><th>進貨日期</th><th>供應商</th><th>品名</th><th>包裝規格</th><th>進貨單位</th><th>進貨數量</th><th>未稅單價</th><th>未稅金額</th><th>狀態</th><th>操作</th></tr></thead>
                {group.receipts.map(receipt=><tbody key={receipt.batchId}><tr className="receipt-ledger-batch-row"><td colSpan={12}><div className="receipt-batch-heading"><span>{receiptDate(receipt.items[0].receipt_date)}・上傳編號 {batches.find(batch=>batch.id===receipt.batchId)?.batch_number||"待確認"}・{receipt.items.length} 項 {recordState(receipt.batchId)==='TEST'&&<em className="record-flag test">測試</em>}{recordState(receipt.batchId)==='REMOVED'&&<em className="record-flag removed">已移出</em>}</span><span className="record-actions">{recordView==='LIVE'?<><button type="button" className="text-button" disabled={recordFlagBusy===receipt.batchId} onClick={()=>void changeRecordState(receipt.batchId,'TEST')}>標記測試</button><button type="button" className="text-button danger-text" disabled={recordFlagBusy===receipt.batchId} onClick={()=>void changeRecordState(receipt.batchId,'REMOVED')}>移出</button></>:<button type="button" className="text-button" disabled={recordFlagBusy===receipt.batchId} onClick={()=>void changeRecordState(receipt.batchId,'LIVE')}>恢復正式</button>}</span></div></td></tr>{receipt.items.map(row=><tr key={row.batch_id+":"+row.row_key}><td>{row.status!=="COMPLETE"&&row.review_allowed&&row.run_id&&<input type="checkbox" aria-label={`選取 ${row.supplier_name} ${receiptDate(row.receipt_date)}・${row.product_name} 所屬整張貨單`} disabled={busy||loading||!!ledgerError} checked={selectedLedgerBatchIds.includes(row.batch_id)} onChange={e=>setSelectedLedgerBatchIds(ids=>e.target.checked?[...new Set([...ids,row.batch_id])]:ids.filter(id=>id!==row.batch_id))}/>}</td><td>{row.product_code||"待建立"}</td><td>{receiptDate(row.receipt_date)}</td><td>{row.supplier_name}</td><td><strong>{row.product_name}</strong></td><td>{row.specification||"未提供"}</td><td>{row.unit||"未提供"}</td><td>{row.quantity??"未提供"}</td><td>{row.unit_price===null?"未提供":"NT$ "+Number(row.unit_price).toLocaleString()}</td><td>{row.subtotal===null?"未提供":"NT$ "+Number(row.subtotal).toLocaleString()}</td><td><span className={row.status==="COMPLETE"?"ledger-status done":row.status==="NEEDS_MAPPING"?"ledger-status needs":"ledger-status pending"}>{row.status==="COMPLETE"?"已完成":row.status==="NEEDS_MAPPING"?"待對應":"待核對"}</span></td><td><button type="button" className="text-button" onClick={()=>openLedger(row)}>{row.status==="COMPLETE"?"查看":"編輯"}</button></td></tr>)}</tbody>)}
              </table>
            </div></section>)}
            {!visibleLedger.length&&<p className="shell-note">{ledgerError?"進貨明細彙總未能讀取。":loading?"正在讀取…":"目前沒有符合條件的進貨資料。"}</p>}
            <div className="receipt-ledger-actions"><span>{ledgerError?"明細讀取恢復後可選取貨單":selectedLedgerReceipts?`已選 ${selectedLedgerReceipts} 張貨單，共 ${selectedLedgerRows.length} 項${selectedHiddenRows?`（含同張貨單在篩選外的 ${selectedHiddenRows} 項）`:""}`:pendingLedger.length?"請選取要核對的整張貨單":"目前沒有待核對資料"}</span><button type="button" className="shell-primary" disabled={busy||loading||!!ledgerError||!selectedLedgerRows.length} onClick={()=>void confirmLedger()}>{busy?"建檔中…":selectedLedgerReceipts?`確認所選 ${selectedLedgerReceipts} 張貨單（${selectedLedgerRows.length} 項）`:"確認所選貨單"}</button></div>
            {!!unlistedBatches.length&&<section className="shell-section"><h2>貨單處理進度</h2><div className="shell-card shell-list">{unlistedBatches.map(batch=><button type="button" className="shell-list-row" key={batch.id} disabled={busy} onClick={()=>openBatch(batch)}><span><strong>{batch.supplier||batch.batch_number}</strong><small>{batch.batch_number}・上傳 {displayTime(batch.uploaded_at)}</small></span><span>{statusName(batch)} ›</span></button>)}</div></section>}
          </>}
        </>
      )}
      {page === "inbox" && !fieldRole && (
        <>
          <div className="receipt-ledger-heading"><div>{intro("貨單收件箱","管理現場上傳、辨識與需要人工介入的貨單；正式資料請到「進貨明細」。")}</div></div>
          <section className="receipt-inbox">
            <div className="shell-section-head"><div><h2>貨單狀態</h2><small>OCR 失敗不會消失；原圖完整的失敗貨單可一次重新辨識。</small></div>{!!failedInbox.length&&<button type="button" className="shell-secondary receipt-retry-all" disabled={busy} onClick={()=>void retryFailedInbox()}>{busy?"重新排入中…":"重新辨識失敗貨單（"+failedInbox.length+"）"}</button>}</div>
            {inboxError?<p className="shell-note" role="alert">{inboxError}</p>:<div className="receipt-inbox-summary">
              <div><small>已收到</small><strong>{inbox.length}</strong></div>
              <div><small>需處理</small><strong>{inboxNeedsAttention.length}</strong></div>
              <div><small>處理中</small><strong>{inboxProcessing.length}</strong></div>
              <div><small>已建檔</small><strong>{inboxComplete.length}</strong></div>
            </div>}
            {!!inboxNeedsAttention.length&&<div className="shell-card shell-list receipt-inbox-list">
              {inboxNeedsAttention.map(row=><button type="button" className="shell-list-row" key={row.batch_id} onClick={()=>openInbox(row)}>
                <span><strong>{row.supplier_name||row.batch_number}</strong><small>{row.batch_number}・{receiptDate(row.receipt_date)}・上傳 {displayTime(row.uploaded_at)}</small><small>{row.line_count?row.complete_line_count+"/"+row.line_count+" 項可用":row.stored_page_count+"/"+row.page_count+" 張原圖已保存"}</small></span>
                <span className={row.state==='OCR_FAILED'||row.state==='FILE_MISSING'?'ledger-status needs':'ledger-status pending'}>{inboxStateLabel(row.state)} ›</span>
              </button>)}
            </div>}
            {!inboxError&&!inboxNeedsAttention.length&&<p className="shell-note">目前沒有需要人工介入的貨單。</p>}
          </section>
        </>
      )}
      {page === "direct" && !fieldRole && (
        <>
          {intro("新增進貨明細","供應商貨單直接送到辦公室時，由行政直接建立；完成後會進入同一份進貨明細。")}
          <section className="shell-card direct-receipt-head">
            <label><span>供應商</span><input value={directDraft.supplier_name} onChange={e=>setDirectDraft({...directDraft,supplier_name:e.target.value})} placeholder="輸入供應商名稱"/></label>
            <label><span>進貨日期</span><input type="date" value={directDraft.receipt_date} onChange={e=>setDirectDraft({...directDraft,receipt_date:e.target.value})}/></label>
            <label><span>單號（選填）</span><input value={directDraft.document_number} onChange={e=>setDirectDraft({...directDraft,document_number:e.target.value})}/></label>
          </section>
          <div className="receipt-admin-table-wrap"><table className="receipt-admin-table direct-receipt-table"><thead><tr><th>品名</th><th>規格／備註</th><th>單位</th><th>數量</th><th>未稅單價</th><th>未稅金額</th><th>操作</th></tr></thead><tbody>
            {directLines.map((line,index)=><tr key={index}>
              <td><input value={line.product_name} onChange={e=>setDirectLines(rows=>rows.map((r,i)=>i===index?{...r,product_name:e.target.value}:r))}/></td>
              <td><input value={line.specification} onChange={e=>setDirectLines(rows=>rows.map((r,i)=>i===index?{...r,specification:e.target.value}:r))}/></td>
              <td><input value={line.unit} onChange={e=>setDirectLines(rows=>rows.map((r,i)=>i===index?{...r,unit:e.target.value}:r))}/></td>
              <td><input type="number" min="0.000001" step="any" value={line.quantity} onChange={e=>setDirectLines(rows=>rows.map((r,i)=>i===index?{...r,quantity:e.target.value}:r))}/></td>
              <td><input type="number" min="0" step="any" value={line.unit_price} onChange={e=>setDirectLines(rows=>rows.map((r,i)=>i===index?{...r,unit_price:e.target.value}:r))}/></td>
              <td>{line.quantity&&line.unit_price?"NT$ "+(Number(line.quantity)*Number(line.unit_price)).toLocaleString():"—"}</td>
              <td><button type="button" className="text-button danger-text" disabled={directLines.length===1} onClick={()=>setDirectLines(rows=>rows.filter((_,i)=>i!==index))}>刪除</button></td>
            </tr>)}
          </tbody></table></div>
          <div className="direct-receipt-actions"><button type="button" className="shell-secondary" onClick={()=>setDirectLines(rows=>[...rows,{product_name:"",specification:"",unit:"",quantity:"",unit_price:"",note:""}])}>＋ 再加一筆</button><div><button type="button" className="shell-secondary" onClick={()=>setPage("list")}>取消</button><button type="button" className="shell-primary" disabled={busy} onClick={()=>void saveDirectReceipt()}>{busy?"建立中…":"完成建檔"}</button></div></div>
        </>
      )}
            {page === "issue" && (
        <>
          {!batchId ? <>
            {intro("進貨異常回報","理貨完成後有問題才回報；正常進貨不需要再操作。")}
            <section className="shell-section"><div className="shell-section-head"><h2>最近進貨</h2></div><div className="shell-card shell-list">{batches.slice(0,12).map(b=><button type="button" className="shell-list-row" key={b.id} onClick={()=>{setBatchId(b.id);setDetail(null);setMessage("");}}><span><strong>{b.supplier||b.batch_number}</strong><small>{displayTime(b.uploaded_at)}・{b.batch_number}</small></span><b>›</b></button>)}</div></section>
            {!batches.length&&<p className="shell-note">目前沒有可選擇的進貨紀錄。</p>}
          </> : !detail ? <p role="status">正在讀取本次進貨…</p> : <>
            {intro("進貨異常回報",(detail.batch.supplier||detail.batch.batch_number)+"・"+displayTime(detail.batch.uploaded_at))}
            <section className="shell-card result-list"><div><span>本次品項</span><strong>{rows.length} 項</strong></div><div><span>已回報異常</span><strong>{detail.batch.delivery?.issues.length||0} 項</strong></div></section>
            {!!detail.batch.delivery?.issues.length&&<section className="shell-card shell-list">{detail.batch.delivery.issues.map(issue=><div className="shell-list-row" key={issue.id}><span><strong>{(issue.name||"未命名品項")+"・"+issue.reason}</strong><small>{issue.quantity!==null?"實收 "+issue.quantity+" "+issue.unit:"數量未填"}{issue.note?"・"+issue.note:""}</small></span></div>)}</section>}
            <button type="button" className="shell-primary full" disabled={busy||operation.busy} onClick={()=>setDeliveryOpen(true)}>新增／編輯異常</button>
            <p className="shell-note">少貨、多貨、未收到、效期太短、品項錯誤或其他問題才需要回報。</p>
          </>}
        </>
      )}
      {page === "upload" && (
        <>
          {intro(
            "上傳貨單",
            "拍照或選取貨單，上傳後系統在背景辨識與建檔；不需要留在這裡等待。",
            undefined,
          )}
          <input
            ref={fileInput}
            type="file"
            accept={receiptPhotoAccept}
            multiple
            hidden
            aria-label="選取貨單照片"
            onChange={(e) => void addPhotos(e.target.files)}
          />
          <section className="shell-card photo-grid">
            {photos.map((p, i) => (
              <div key={p.hash} style={{ position: "relative" }}>
                {p.file.type === "application/pdf" ? (
                  <FileText className="ui-icon" />
                ) : (
                  <ReceiptImage
                    src={p.preview}
                    mime={p.file.type}
                    alt={`第 ${i + 1} 張`}
                    style={{
                      width: "100%",
                      height: 100,
                      objectFit: "cover",
                      borderRadius: 10,
                    }}
                  />
                )}
                <small>第 {i + 1} 張</small>
                <button
                  aria-label={`移除第 ${i + 1} 張`}
                  disabled={busy}
                  onClick={() => {
                    URL.revokeObjectURL(p.preview);
                    setPhotos(photos.filter((x) => x.hash !== p.hash));
                  }}
                >
                  ×
                </button>
              </div>
            ))}
            <button
              disabled={busy || photos.length >= 10}
              onClick={() => fileInput.current?.click()}
            >
              ＋<small>新增照片</small>
            </button>
          </section>
          {photos.length>1&&<details><summary>同單多頁選項</summary>
          <div className="choice-grid">
            <button
              className={`choice ${same ? "active" : ""}`}
              disabled={busy}
              onClick={() => setSame(true)}
            >
              <strong>同一張貨單</strong>
              <small>多頁或不同角度</small>
            </button>
            <button
              className={`choice ${!same ? "active" : ""}`}
              disabled={busy}
              onClick={() => setSame(false)}
            >
              <strong>不同貨單</strong>
              <small>系統分批建立</small>
            </button>
          </div>
          </details>}
          <p className="shell-note">
            {photos.length} / 10 張・原圖完整保留；OCR
            在背景辨識，上傳後不必等待。
          </p>
          {photos.length>0&&<p role="status">將建立 {same?1:photos.length} 張貨單</p>}
          {action("確認上傳", () => void upload(), false, !photos.length)}
        </>
      )}
      {page === "status" && (
        <>
          {intro(detail?.batch.batch_number || "貨單", displayReceiptValue(value('supplier_name','document')))}
          {!detail ? (
            <p className="shell-note">讀取中…</p>
          ) : (
            <>
              <section className="shell-card status-timeline">
                <div className="done">
                  <i />
                  <span>
                    <strong>
                      {detail.job ? "貨單照片已上傳" : "原圖上傳尚未完整"}
                    </strong>
                    <small>{displayTime(detail.batch.uploaded_at)}</small>
                  </span>
                </div>
                <div className="current">
                  <i />
                  <span>
                    <strong>
                      {detail.run?.status === "SUCCEEDED"
                        ? "辨識已完成"
                        : detail.job?.status === "FAILED"
                          ? "辨識未完成，原圖已保留"
                          : !detail.job
                            ? "請完成原圖上傳"
                            : "AI 識別中"}
                    </strong>
                    <small>
                      {detail.run?.status === "SUCCEEDED"
                        ? `${rows.length} 筆品項`
                        : !detail.job
                          ? "重新選取相同貨單即可繼續上傳。"
                          : detail.job.status === "FAILED"
                            ? "可稍後重試，原圖與貨單已保存。"
                            : "可以返回今日工作，背景會接續處理。"}
                    </small>
                  </span>
                </div>
                <div className={detail.receipt || detail.review?.complete ? "done" : ""}>
                  <i />
                  <span>
                    <strong>
                      {detail.receipt || detail.review?.complete
                        ? "收貨已確認"
                        : chain
                          ? "門市核對／公司流程"
                          : "等待行政／後勤核對"}
                    </strong>
                    <small>
                      {detail.review?.complete
                        ? `${detail.review.confirmed_by || "已確認"}・${displayTime(detail.review.confirmed_at || "")}`
                        : detail.receipt && !chain
                          ? "收貨明細已保存"
                          : detail.erp_actor
                            ? `${detail.erp_actor} 已回報 ERP 驗收`
                            : chain
                              ? "ERP 驗收可稍後統一完成"
                              : "由行政／後勤接續整理"}
                    </small>
                  </span>
                </div>
              </section>
              {detail.job?.status === "FAILED" &&
                action(
                  "重試辨識",
                  () =>
                    void act(async () => {
                      const r = await supabase.functions.invoke(
                        "enqueue-receipt-ocr",
                        { body: { batchId } },
                      );
                      if (
                        r.error ||
                        r.data?.results?.some(
                          (x: { queued: boolean }) => !x.queued,
                        )
                      )
                        throw r.error || new Error("QUEUE_FAILED");
                      await refresh();
                    }),
                  true,
                )}
              {detail.run?.status === "SUCCEEDED" && (fieldRole ? <section className="shell-card completion-card"><Check className="ui-icon"/><h2>貨單已建檔</h2><strong>{displayReceiptValue(value('supplier_name','document'))}</strong><p>{rows.length} 項進貨資料已保存。請繼續理貨；若發現少貨、多貨、未收到、效期過短或品項錯誤，再從首頁進入「進貨異常回報」。</p></section> : readLines)}
              {canReview&&action(fieldRole?"核對收貨":"開始核對",()=>setPage("review"))}
              {action(fieldRole?'返回首頁':initialBatchId?returnLabel:batchSource==='company-tasks'?'返回 ERP 待完成':'返回進貨', fieldRole?onBack:()=>void back(), true)}
            </>
          )}
        </>
      )}
      {page === "review" && detail && (
        <>
          {fieldRole&&intro("核對收貨",`${rows.length} 項・點卡片修改資料`)}
          {fieldRole?<>
            <button className="compact-card" disabled={!canReview||busy} onClick={()=>setCard('document')}><strong>{displayReceiptValue(value('supplier_name','document'))}</strong><small>{displayReceiptValue(value('receipt_date','document'))}・單號 {displayReceiptValue(value('document_number','document'))}</small></button>
            {rows.map((row,index)=><button className="compact-card" key={row} disabled={!canReview||busy} onClick={()=>setCard(row)}><strong>{index+1}. {displayReceiptValue(value('product',row))}</strong><span>{displayReceiptValue(value('quantity',row))} {displayReceiptValue(value('unit',row))}</span><small>{detail.mappings.find(m=>m.row_key===row)?.name||'商品尚未對應'}</small></button>)}
          </>:detail.run&&<ReceiptDesktopReview
            key={`${userId}:${storeId}:${batchId}:${detail.run.id}`}
            storeId={storeId} userId={userId} batchId={batchId} runId={detail.run.id}
            fields={fields} mappings={detail.mappings} lineStates={detail.line_states||[]} manualLines={detail.manual_lines||[]} chain={chain} canReview={canReview} busy={busy}
            pictures={<ReceiptSourceViewer key={batchId} documents={detail.documents} imageUrls={imageUrls}/>}
            navigation={disabled=><label className="receipt-review-switcher">切換貨單<select aria-label="切換核對貨單（依供應商分組）" value={batchId} disabled={disabled} onChange={event=>{const selected=batches.find(batch=>batch.id===event.target.value);if(selected)openBatch(selected);}}>{receiptNavigation.map(group=><optgroup key={group.supplier} label={group.supplier}>{group.receipts.map(receipt=>{const item=receipt.items[0];return <option value={item.batch_id} key={item.batch_id}>{receiptDate(item.date)}・{item.batch.batch_number}・{statusName(item.batch)}</option>;})}</optgroup>)}</select></label>}
            onRefresh={refresh} onComplete={saveReview}
          />}
          {!fieldRole&&<details className="receipt-delivery-more"><summary>到貨、異常與上傳紀錄{pendingDeliveryIssues(detail.batch.delivery)?`・${pendingDeliveryIssues(detail.batch.delivery)} 項待處理`:""}</summary>{deliverySummary}</details>}
          <details><summary>{fieldRole?'原始照片與完整辨識資料':'完整辨識資料'}</summary>{fieldRole&&pictures}<ReceiptReviewFields fields={fields} renderField={f=><div key={f.id}><small>{fieldNames[f.field_name]}</small><strong>{displayReceiptValue(f.value)}</strong></div>}/></details>
          {canReview&&<button type="button" className="text-button context-expiry-entry" disabled={busy} onClick={()=>setExpiryOpen(true)}>加入效期提醒</button>}
          {expiryOpen&&<ContextExpiryForm storeId={storeId} contextType="RECEIPT" contextId={batchId} onClose={saved=>{setExpiryOpen(false);if(saved)setMessage('效期提醒已儲存。');}}/>}
          {fieldRole&&card&&detail.run&&<ReceiptCardEditor key={card} storeId={storeId} userId={userId} organizationId={organizationId} batchId={batchId} runId={detail.run.id} row={card} fields={fields} mapping={detail.mappings.find(m=>m.row_key===card)} chain={chain} onClose={saved=>{setCard(undefined);if(saved)void act(refresh);}}/>}
          {fieldRole&&canReview&&action("確認收貨",()=>void act(saveReview))}
        </>
      )}
      {page === "published" && detail && (
        <>
          <section className="shell-card completion-card"><Check className="ui-icon"/><h1>{fieldRole?"收貨確認完成":"資料核對完成"}</h1><strong>{displayReceiptValue(value('supplier_name','document'))}</strong><p>{displayReceiptValue(value('receipt_date','document'))}・{rows.length} 項</p>{!fieldRole&&<p>已發布本次核對資料，供庫存、調撥、廢棄與成本分析後續引用。</p>}{rows.map(row=><p key={row}>{displayReceiptValue(value('product',row))} {displayReceiptValue(value('quantity',row))} {displayReceiptValue(value('unit',row))}</p>)}</section>
          <details><summary>查看完整紀錄</summary>{detail.review?.confirmed_at&&<p>{detail.review.confirmed_by}・{displayTime(detail.review.confirmed_at)}</p>}{readLines}{detail.full_access&&pictures}<p className="shell-note">未確認的商品對應、單位或數量保留待整理，不計入庫存。</p></details>
          {action(
            initialBatchId?returnLabel:batchSource==='company-tasks'?'返回 ERP 待完成':'返回進貨',
            () => void back(),
          )}
        </>
      )}
      {page === "company-tasks" && (
        <>
          {intro("ERP 待完成", fieldRole?"勾選貨單，回報 ERP 已完成。":"查看門市尚未回報的貨單。")}
          <p role="status">{loading?'正在讀取…':`${erpPending.length} 張待完成`}</p>
          {batchList(erpPending,true)}
          {fieldRole&&erpPending.length>0&&<button type="button" className="shell-primary full" disabled={busy||operation.busy||!selectedErp.length} onClick={()=>void act(()=>reportErp(selectedErp))}>{busy||operation.busy?'儲存中…':`${operation.error?'重試回報':'回報'} ERP 已完成${selectedErp.length?`（${selectedErp.length}）`:''}`}</button>}
          {operation.error&&<p role="alert">{operation.error}</p>}
        </>
      )}
      {page === "erp-complete" && detail && (
        <>
          <section className="completion-state">
            <span>
              <Check className="ui-icon" />
            </span>
            <h1>ERP 驗收已登記</h1>
            <p>
              {detail.erp_actor}・
              {displayTime(detail.batch.erp_completed_at || "")}
            </p>
          </section>
          <section className="shell-card completion-card">
            <strong>本次進貨完成</strong>
            <p>
              ✓ 貨單照片已留存
              <br />✓ 已回報 ERP 驗收完成
              <br />✓ 已記錄門市通知
            </p>
            <small>序只記錄回報人員、門市與時間，不連線或查驗 ERP。</small>
          </section>
          {action("返回今日工作", onBack)}
        </>
      )}
    </div></RememberPosition>
  );
}

export function ReceivingActivity({
  storeId,
  onOpen,
  notifications = false,
  tasks = false,
}: {
  storeId: string;
  onOpen: (id: string, companyTask?: boolean) => void;
  notifications?: boolean;
  tasks?: boolean;
}) {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [readError,setReadError]=useState("");
  const [retry,setRetry]=useState(0);
  useEffect(() => {
    let active = true;
    const read = async () => {
      const r = await supabase.rpc("get_pilot_receipts", {
        p_store_id: storeId,
      });
      if(active){if(r.error)setReadError(receiptError(r.error));else{setBatches(r.data as unknown as Batch[]);setReadError("");}}
    };
    void read();
    const timer = setInterval(() => void read(), 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [storeId,retry]);
  const shown = batches.filter((b) =>
    tasks
      ? pendingDeliveryIssues(b.delivery)>0 || (b.erp_required && !b.erp_completed_at && !!b.job_status) ||
        (b.review_allowed &&
          b.ocr_status === "SUCCEEDED" &&
          !isConfirmed(b))
      : !notifications ||
        b.erp_completed_at ||
        (b.review_allowed && !isConfirmed(b)),
  );
  if(readError)return <p className="pilot-message" role="alert">{readError}<button type="button" onClick={()=>setRetry(v=>v+1)}>重新讀取進貨</button></p>;
  if (!shown.length) return null;
  return (
    <section className="shell-section">
      <div className="shell-section-head">
        <h2>{tasks ? "進貨待辦" : notifications ? "進貨通知" : "進貨紀錄"}</h2>
      </div>
      <div className="shell-card shell-list">
        {shown.map((b) => (
          <button
            key={b.id}
            className="shell-list-row"
            onClick={() =>
              onOpen(b.id, tasks && b.erp_required && !b.erp_completed_at)
            }
          >
            <FileText className="ui-icon" />
            <span>
              <strong>{b.supplier || b.batch_number}</strong>
              <small>
                {b.erp_completed_at
                  ? `${b.erp_completed_by}・${displayTime(b.erp_completed_at)} 已回報 ERP 驗收`
                  : `${displayTime(b.uploaded_at)}・${statusName(b)}`}
              </small>
            </span>
            <b>›</b>
          </button>
        ))}
      </div>
    </section>
  );
}
