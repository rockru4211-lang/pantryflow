"use client";

import {RememberPosition} from "./workspace-memory";
import ReceiptImage from "./receipt-image";
import ReceiptDeliveryEditor from "./receipt-delivery-editor";
import {arrivalLabel,pendingDeliveryIssues,pendingReceiptErp,groupReceiptSuppliers,type ReceiptDelivery} from "@/lib/receipt-delivery";
import {useOperation} from "./operation-hooks";
import ContextExpiryForm from "./context-expiry-form";
import ReceiptReviewFields from "./receipt-review-fields";
import ReceiptCardEditor from "./receipt-card-editor";
import { normalizeReceiptPhoto, receiptPhotoAccept } from "@/lib/receipt-photo";
import {matchesReceiptLedgerStatus,selectedReceiptLedgerRows,receiptSubtotal,receiptDetailPage,receiptBatchesWithoutLedger,type ReceiptLedgerFilter} from "@/lib/receipt-ledger";
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
  receipt: { id: string; reviewed_at: string | null } | null;
  review?: { saved_rows: string[]; complete: boolean; confirmed_at?: string | null; confirmed_by?: string | null };
};
type Photo = { file: File; preview: string; hash: string };
type LedgerRow = {
  batch_id:string; run_id:string|null; row_key:string; uploaded_at:string; receipt_date:string|null; supplier_name:string;
  product_code:string|null; product_id:string|null; product_name:string; source_product:string;
  specification:string; unit:string; quantity:number|null; unit_price:number|null; subtotal:number|null;
  mapped:boolean; status:'COMPLETE'|'NEEDS_MAPPING'|'PENDING'; review_allowed:boolean;
};
const normalizedReceiptDate=(value:string|null)=>{if(!value)return null;const raw=String(value).trim();const numeric=raw.match(/^(\d{3,4})[\/.-](\d{1,2})[\/.-](\d{1,2})$/);if(numeric){const sourceYear=Number(numeric[1]);const year=numeric[1].length===3?sourceYear+1911:sourceYear;const month=Number(numeric[2]);const day=Number(numeric[3]);if(year>=1900&&month>=1&&month<=12&&day>=1&&day<=31)return [String(year).padStart(4,"0"),String(month).padStart(2,"0"),String(day).padStart(2,"0")].join("-");}const roc=raw.match(/^(?:民國)?(\d{3})年(\d{1,2})月(\d{1,2})日?$/);if(roc){const year=Number(roc[1])+1911;const month=Number(roc[2]);const day=Number(roc[3]);if(month>=1&&month<=12&&day>=1&&day<=31)return [String(year),String(month).padStart(2,"0"),String(day).padStart(2,"0")].join("-");}const date=new Date(raw);if(Number.isNaN(date.getTime()))return null;return [date.getFullYear(),String(date.getMonth()+1).padStart(2,"0"),String(date.getDate()).padStart(2,"0")].join("-");};
const receiptDate=(value:string|null)=>{const normalized=normalizedReceiptDate(value);return normalized?normalized.replaceAll("-","/"):"未提供";};
const isConfirmed = (b: Batch) => b.status === "COMPLETED" || !!b.review_saved;
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
    [ledgerError,setLedgerError]=useState(""),
    [ledgerSearch,setLedgerSearch]=useState(""),
    [ledgerFilter,setLedgerFilter]=useState<ReceiptLedgerFilter>("PENDING"),
    [ledgerDateFrom,setLedgerDateFrom]=useState(""),
    [ledgerDateTo,setLedgerDateTo]=useState(""),
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
    const [batchRead,ledgerRead] = await Promise.allSettled([
      supabase.rpc("get_pilot_receipts",{p_store_id:storeId}),
      fieldRole ? Promise.resolve({data:[] as unknown[],error:null}) : supabase.rpc("get_pilot_receipt_ledger",{p_store_id:storeId}),
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
    if (page === "issue" && batchId) { setBatchId(""); setDetail(null); return; }
    if (page === "issue" && initialPage === "issue") { onBack(); return; }
    if (page === "list" || (initialBatchId && ["status","published","review","erp-complete"].includes(page)))
      onBack();
    else if (["status","published","review"].includes(page) && batchSource==="company-tasks") setPage("company-tasks");
    else setPage("list");
  };
  function openBatch(b: Batch) {
    if(onOpenReceipt){onOpenReceipt(b.id);return;}
    setBatchSource(page);
    setLoading(true);
    setMessage("");
    setDetail(null);
    setBatchId(b.id);
    initialRoute.current=b.id;
    setPage("status");
  }
  async function act(action: () => Promise<void>) {
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
  async function saveReview() {
    if (!detail?.run) return;
    const runId = detail.run.id;
    await saveReceiptRows(fields, async row => {
      const saved = await supabase.rpc("save_pilot_receipt_review", {
        p_batch_id: batchId,
        p_row_key: row,
        p_run_id: runId,
      });
      if (saved.error) throw saved.error;
      return saved.data as { complete?: boolean };
    });
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
  const erpPending = batches.filter(pendingReceiptErp);
  const visibleLedger=ledger.filter(row=>{
    const statusOk=matchesReceiptLedgerStatus(row.status,ledgerFilter);
    if(!statusOk)return false;
    const date=normalizedReceiptDate(row.receipt_date)||"";
    if(ledgerDateFrom&&date&&date<ledgerDateFrom)return false;
    if(ledgerDateTo&&date&&date>ledgerDateTo)return false;
    const q=ledgerSearch.trim().toLocaleLowerCase();
    if(!q)return true;
    return [row.product_code,row.supplier_name,row.product_name,row.source_product,row.specification,row.receipt_date].some(v=>String(v||"").toLocaleLowerCase().includes(q));
  });
  const pendingLedger=ledger.filter(row=>row.status!=="COMPLETE");
  const completedLedger=ledger.filter(row=>row.status==="COMPLETE");
  const needsMappingLedger=ledger.filter(row=>row.status==="NEEDS_MAPPING");
  const selectedLedgerRows=ledgerError?[]:selectedReceiptLedgerRows(ledger,visibleLedger,selectedLedgerBatchIds);
  const selectedLedgerReceipts=new Set(selectedLedgerRows.map(row=>row.batch_id)).size;
  const selectedHiddenRows=selectedLedgerRows.filter(row=>!visibleLedger.includes(row)).length;
  const selectableLedgerBatchIds=[...new Set(visibleLedger.filter(row=>row.status!=="COMPLETE"&&row.review_allowed&&row.run_id).map(row=>row.batch_id))];
  const unlistedBatches=ledgerError?batches:receiptBatchesWithoutLedger(batches,ledger);
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
    const exportRows=visibleLedger.map(row=>({"商家品項編碼":row.product_code||"待建立","進貨日期":receiptDate(row.receipt_date),"供應商":row.supplier_name,"品名":row.product_name,"包裝規格":row.specification||"未提供","進貨單位":row.unit||"未提供","進貨數量":row.quantity??"","單價":row.unit_price??"","小計":row.subtotal??"","狀態":row.status==="COMPLETE"?"已完成":row.status==="NEEDS_MAPPING"?"待對應":"待核對"}));
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
      {detail&&["status","review","published"].includes(page)&&<section className="shell-card delivery-summary">
        <div><strong>{arrivalLabel(detail.batch.delivery)}</strong><span className={pendingDeliveryIssues(detail.batch.delivery)?'delivery-alert':'delivery-muted'}>異常 {pendingDeliveryIssues(detail.batch.delivery)}</span></div>
        {fieldRole?<button type="button" className="text-button" disabled={busy||operation.busy} onClick={()=>setDeliveryOpen(true)}>修改到貨／處理異常</button>:null}
        {!!detail.batch.delivery?.issues.length&&<details><summary>異常紀錄</summary>{detail.batch.delivery.issues.map(issue=><div className="delivery-issue" key={issue.id}><strong>{issue.name}・{issue.reason}</strong><p>{issue.status==='COMPLETE'?'已處理':'待處理'}{issue.quantity!==null?`・實收 ${issue.quantity} ${issue.unit}`:''}</p>{issue.note&&<p>{issue.note}</p>}</div>)}</details>}
        {detail.batch.erp_required&&<div className="receipt-erp-detail"><strong>{detail.batch.erp_completed_at?'ERP 已完成':'ERP 待完成'}</strong>{detail.batch.erp_completed_at?<p>{detail.erp_actor}・{displayTime(detail.batch.erp_completed_at)}</p>:fieldRole&&detail.job&&<button type="button" className="shell-primary full" disabled={busy||operation.busy} onClick={()=>void act(()=>reportErp([detail.batch.id]))}>{busy||operation.busy?'儲存中…':operation.error?'重試回報 ERP 已完成':'回報 ERP 已完成'}</button>}{operation.error&&<p role="alert">{operation.error}</p>}</div>}
        <details><summary>上傳紀錄</summary><p>上傳時間 {displayTime(detail.batch.uploaded_at)}</p></details>
      </section>}
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
              <div>{intro("進貨資料核對","OCR 完成後直接核對細項，完成後資料自動提供庫存、調撥、廢棄與成本分析。")}</div>
              <div className="receipt-ledger-export"><button type="button" className="shell-secondary" disabled={busy||loading||!!ledgerError} onClick={()=>void exportLedger("xlsx")}><Download className="ui-icon"/>匯出 Excel</button><button type="button" className="text-button" disabled={busy||loading||!!ledgerError} onClick={()=>void exportLedger("csv")}>CSV</button></div>
            </div>
            {ledgerError&&<p className="shell-note" role="alert">{ledgerError}<button type="button" className="text-button" disabled={busy||loading} onClick={()=>void refresh().catch(error=>setMessage(receiptError(error)))}>重新讀取明細</button></p>}
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
            <section className="receipt-admin-table-wrap">
              <table className="receipt-admin-table receipt-ledger-table">
                <thead><tr><th><label><input type="checkbox" aria-label="選取畫面中所有待核對貨單（整張）" disabled={busy||loading||!!ledgerError||!selectableLedgerBatchIds.length} checked={!!selectableLedgerBatchIds.length&&selectableLedgerBatchIds.every(id=>selectedLedgerBatchIds.includes(id))} onChange={e=>setSelectedLedgerBatchIds(e.target.checked?selectableLedgerBatchIds:[])}/>整單</label></th><th>商家品項編碼</th><th>進貨日期</th><th>供應商</th><th>品名</th><th>包裝規格</th><th>進貨單位</th><th>進貨數量</th><th>單價</th><th>小計</th><th>狀態</th><th>操作</th></tr></thead>
                <tbody>{visibleLedger.map(row=><tr key={row.batch_id+":"+row.row_key}><td>{row.status!=="COMPLETE"&&row.review_allowed&&row.run_id&&<input type="checkbox" aria-label={`選取 ${row.supplier_name} ${receiptDate(row.receipt_date)}・${row.product_name} 所屬整張貨單`} disabled={busy||loading||!!ledgerError} checked={selectedLedgerBatchIds.includes(row.batch_id)} onChange={e=>setSelectedLedgerBatchIds(ids=>e.target.checked?[...new Set([...ids,row.batch_id])]:ids.filter(id=>id!==row.batch_id))}/>}</td><td>{row.product_code||"待建立"}</td><td>{receiptDate(row.receipt_date)}</td><td>{row.supplier_name}</td><td><strong>{row.product_name}</strong></td><td>{row.specification||"未提供"}</td><td>{row.unit||"未提供"}</td><td>{row.quantity??"未提供"}</td><td>{row.unit_price===null?"未提供":"NT$ "+Number(row.unit_price).toLocaleString()}</td><td>{row.subtotal===null?"未提供":"NT$ "+Number(row.subtotal).toLocaleString()}</td><td><span className={row.status==="COMPLETE"?"ledger-status done":row.status==="NEEDS_MAPPING"?"ledger-status needs":"ledger-status pending"}>{row.status==="COMPLETE"?"已完成":row.status==="NEEDS_MAPPING"?"待對應":"待核對"}</span></td><td><button type="button" className="text-button" onClick={()=>openLedger(row)}>{row.status==="COMPLETE"?"查看":"編輯"}</button></td></tr>)}</tbody>
              </table>
              {!visibleLedger.length&&<p className="shell-note" style={{padding:16}}>{ledgerError?"進貨明細彙總未能讀取。":loading?"正在讀取…":"目前沒有符合條件的進貨資料。"}</p>}
            </section>
            <div className="receipt-ledger-actions"><span>{ledgerError?"明細讀取恢復後可選取貨單":selectedLedgerReceipts?`已選 ${selectedLedgerReceipts} 張貨單，共 ${selectedLedgerRows.length} 項${selectedHiddenRows?`（含同張貨單在篩選外的 ${selectedHiddenRows} 項）`:""}`:pendingLedger.length?"請選取要核對的整張貨單":"目前沒有待核對資料"}</span><button type="button" className="shell-primary" disabled={busy||loading||!!ledgerError||!selectedLedgerRows.length} onClick={()=>void confirmLedger()}>{busy?"建檔中…":selectedLedgerReceipts?`確認所選 ${selectedLedgerReceipts} 張貨單（${selectedLedgerRows.length} 項）`:"確認所選貨單"}</button></div>
            {!!unlistedBatches.length&&<section className="shell-section"><h2>貨單處理進度</h2><div className="shell-card shell-list">{unlistedBatches.map(batch=><button type="button" className="shell-list-row" key={batch.id} disabled={busy} onClick={()=>openBatch(batch)}><span><strong>{batch.supplier||batch.batch_number}</strong><small>{batch.batch_number}・上傳 {displayTime(batch.uploaded_at)}</small></span><span>{statusName(batch)} ›</span></button>)}</div></section>}
          </>}
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
          {intro(fieldRole?"核對收貨":"進貨明細核對", fieldRole?`${rows.length} 項・點卡片修改資料`:`${rows.length} 項・核對一次，庫存、調撥、廢棄與成本資料後續自動引用`)}
          {fieldRole?<>
            <button className="compact-card" disabled={!canReview||busy} onClick={()=>setCard('document')}><strong>{displayReceiptValue(value('supplier_name','document'))}</strong><small>{displayReceiptValue(value('receipt_date','document'))}・單號 {displayReceiptValue(value('document_number','document'))}</small></button>
            {rows.map((row,index)=><button className="compact-card" key={row} disabled={!canReview||busy} onClick={()=>setCard(row)}><strong>{index+1}. {displayReceiptValue(value('product',row))}</strong><span>{displayReceiptValue(value('quantity',row))} {displayReceiptValue(value('unit',row))}</span><small>{detail.mappings.find(m=>m.row_key===row)?.name||'商品尚未對應'}</small></button>)}
          </>:<section className="receipt-admin-table-wrap">
            <div className="receipt-admin-summary"><span><strong>{displayReceiptValue(value('supplier_name','document'))}</strong><small>{displayReceiptValue(value('receipt_date','document'))}・單號 {displayReceiptValue(value('document_number','document'))}</small></span><button className="shell-secondary" disabled={!canReview||busy} onClick={()=>setCard('document')}>編輯基本資料</button></div>
            <table className="receipt-admin-table"><thead><tr><th>商家品項編碼</th><th>進貨日期</th><th>供應商</th><th>品名</th><th>包裝規格</th><th>進貨單位</th><th>進貨數量</th><th>單價</th><th>小計</th><th>狀態</th><th>備註</th><th>操作</th></tr></thead><tbody>{rows.map(row=>{const mapping=detail.mappings.find(m=>m.row_key===row);return <tr key={row}><td>{mapping?.code||'待建立'}</td><td>{displayReceiptValue(value('receipt_date','document'))}</td><td>{displayReceiptValue(value('supplier_name','document'))}</td><td>{mapping?.name||displayReceiptValue(value('product',row))}</td><td>{displayReceiptValue(value('specification',row))}</td><td>{displayReceiptValue(value('unit',row))}</td><td>{displayReceiptValue(value('quantity',row))}</td><td>{displayReceiptValue(value('unit_price_ex_tax',row))}</td><td>{(()=>{const subtotal=receiptSubtotal(value('quantity',row),value('unit_price_ex_tax',row));return subtotal===null?'未提供':'NT$ '+subtotal.toLocaleString();})()}</td><td>{mapping?'已對應':'待對應'}</td><td>{displayReceiptValue(value('note',row))}</td><td><button type="button" className="text-button" disabled={!canReview||busy} onClick={()=>setCard(row)}>編輯</button></td></tr>})}</tbody></table>
          </section>}
          <details><summary>原始照片與完整辨識資料</summary>{pictures}<ReceiptReviewFields fields={fields} renderField={f=><div key={f.id}><small>{fieldNames[f.field_name]}</small><strong>{displayReceiptValue(f.value)}</strong></div>}/></details>
          {canReview&&<button type="button" className="text-button context-expiry-entry" disabled={busy} onClick={()=>setExpiryOpen(true)}>加入效期提醒</button>}
          {expiryOpen&&<ContextExpiryForm storeId={storeId} contextType="RECEIPT" contextId={batchId} onClose={saved=>{setExpiryOpen(false);if(saved)setMessage('效期提醒已儲存。');}}/>}
          {card&&detail.run&&<ReceiptCardEditor key={card} storeId={storeId} userId={userId} organizationId={organizationId} batchId={batchId} runId={detail.run.id} row={card} fields={fields} mapping={detail.mappings.find(m=>m.row_key===card)} chain={chain} onClose={saved=>{setCard(undefined);if(saved)void act(refresh);}}/>}
          {canReview&&action(fieldRole?"確認收貨":"完成資料核對",()=>void act(saveReview))}
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
