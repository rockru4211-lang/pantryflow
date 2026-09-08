"use client";

import ReceiptImage from "./receipt-image";
import { normalizeReceiptPhoto, receiptPhotoAccept } from "@/lib/receipt-photo";
/* eslint-disable react-hooks/refs -- JSX helpers only pass callbacks; refs are read inside events and effects, never while rendering. */
import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, Truck, Settings, Check } from "lucide-react";
import { supabase } from "@/lib/supabase-browser";
import type { Json } from "@/lib/database.types";
import {
  displayReceiptValue,
  fieldNames,
  numericFields,
  receiptError,
  receiptFingerprint,
  receiptGroups,
  receiptRows,
  receiptValue,
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
  | "mapping"
  | "published"
  | "company-tasks"
  | "erp-complete";
type Batch = {
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
type Product = {
  id: string;
  name: string;
  product_code: string | null;
  base_unit: string | null;
  specification: string | null;
};
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
  organizationId,
  role,
  businessType,
  onBack,
  returnLabel = "返回首頁",
  initialPage = "list",
  initialBatchId,
}: {
  storeId: string;
  organizationId: string;
  role: ShellRole;
  businessType: string;
  onBack: () => void;
  returnLabel?: string;
  initialPage?: Page;
  initialBatchId?: string;
}) {
  const [page, setPage] = useState<Page>(initialPage),
    [batchId, setBatchId] = useState(initialBatchId || ""),
    [batches, setBatches] = useState<Batch[]>([]),
    [detail, setDetail] = useState<Detail | null>(null),
    [photos, setPhotos] = useState<Photo[]>([]),
    [same, setSame] = useState(true),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [message, setMessage] = useState(""),
    [rowIndex, setRowIndex] = useState(0),
    [imageUrls, setImageUrls] = useState<Record<string, string>>({}),
    [products, setProducts] = useState<Product[]>([]),
    [selectProduct, setSelectProduct] = useState(false),
    [editing, setEditing] = useState(""),
    [editValue, setEditValue] = useState("");
  const initialRoute = useRef(
    initialPage === "company-tasks" ? "" : initialBatchId || "",
  );
  const fileInput = useRef<HTMLInputElement>(null),
    photosRef = useRef<Photo[]>([]),
    savingField = useRef<Promise<boolean> | null>(null),
    uploadLock = useRef(false);
  const chain = businessType === "CHAIN_RESTAURANT",
    fieldRole = role === "STAFF" || role === "SUPERVISOR";
  const refresh = useCallback(async () => {
    const result = await supabase.rpc("get_pilot_receipts", {
      p_store_id: storeId,
    });
    if (result.error) throw result.error;
    setBatches(result.data as unknown as Batch[]);
    if (batchId) {
      const d = await supabase.rpc("get_pilot_receipt", {
        p_batch_id: batchId,
      });
      if (d.error) throw d.error;
      setDetail(d.data as unknown as Detail);
    }
    setLoading(false);
  }, [storeId, batchId]);
  useEffect(() => {
    let active = true;
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
      setPage(
        detail.receipt || detail.review?.complete
          ? "published"
          : detail.review_allowed && detail.run?.status === "SUCCEEDED"
            ? "review"
            : "status",
      );
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
    row = rows[rowIndex] || rows[0] || "",
    fields = detail?.fields || [],
    value = (name: string, key = row) => receiptValue(fields, key, name),
    mapping = detail?.mappings.find((m) => m.row_key === row),
    canReview =
      !!detail?.review_allowed &&
      detail.run?.status === "SUCCEEDED" &&
      !detail.receipt && !detail.review?.complete;
  const back = async () => {
    if ((editing || savingField.current) && !(await saveField())) return;
    setMessage("");
    if (
      page === "list" ||
      page === "status" ||
      page === "published" ||
      page === "erp-complete"
    )
      onBack();
    else if (page === "mapping") setPage("review");
    else setPage("list");
  };
  function openBatch(b: Batch) {
    setMessage("");
    setDetail(null);
    setBatchId(b.id);
    setRowIndex(0);
    setPage(
      isConfirmed(b)
        ? "published"
        : b.review_allowed && b.ocr_status === "SUCCEEDED"
          ? "review"
          : "status",
    );
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
  function saveField(): Promise<boolean> {
    if (savingField.current) return savingField.current;
    if (!editing) return Promise.resolve(true);
    const id = editing;
    const pending = (async () => {
      try {
        const f = fields.find((f) => f.id === id);
        if (!f) return false;
        let v: Json = editValue.trim() || null;
        if (numericFields.has(f.field_name) && v !== null) {
          const number = Number(v);
          if (!Number.isFinite(number)) throw new Error("NUMBER_REQUIRED");
          v = number;
        }
        const result = await supabase.rpc("correct_pilot_receipt_field", {
          p_field_id: id,
          p_value: v,
        });
        if (result.error) throw result.error;
        setEditing("");
        await refresh();
        return true;
      } catch (e) {
        setMessage(receiptError(e));
        return false;
      }
    })().finally(() => {
      savingField.current = null;
    });
    savingField.current = pending;
    return pending;
  }
  async function chooseExisting() {
    const result = await supabase
      .from("products")
      .select("id,name,product_code,base_unit,specification")
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .order("name");
    if (result.error) throw result.error;
    setProducts(result.data);
    setSelectProduct(true);
  }
  async function mapProduct(id?: string, create = false) {
    const result = await supabase.rpc("map_pilot_receipt_product", {
      p_batch_id: batchId,
      p_row_key: row,
      p_product_id: id,
      p_create: create,
    });
    if (result.error) throw result.error;
    setSelectProduct(false);
    await refresh();
  }
  async function saveReview() {
    if (!detail?.run || !(await saveField())) return;
    const saved = await supabase.rpc("save_pilot_receipt_review", {
      p_batch_id: batchId,
      p_row_key: row,
      p_run_id: detail.run.id,
    });
    if (saved.error) throw saved.error;
    if (rowIndex < rows.length - 1) {
      setRowIndex(rowIndex + 1);
      setPage("review");
      await refresh();
      return;
    }
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
  const batchList = (list: Batch[]) => (
    <div className="shell-card shell-list">
      {list.length ? (
        list.map((b) => (
          <button
            key={b.id}
            className="shell-list-row"
            onClick={() => openBatch(b)}
          >
            <FileText className="ui-icon" />
            <span>
              <strong>{b.supplier || b.batch_number}</strong>
              <small>
                {b.pages} 張・{displayTime(b.uploaded_at)}
              </small>
              {b.erp_required && (
                <small>
                  {b.erp_completed_at
                    ? `${b.erp_completed_by}・${displayTime(b.erp_completed_at)} 已回報 ERP`
                    : "待 ERP 驗收"}
                </small>
              )}
            </span>
            <b>{statusName(b)} ›</b>
          </button>
        ))
      ) : (
        <p className="shell-note">{loading ? "正在讀取…" : "目前沒有貨單"}</p>
      )}
    </div>
  );
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
  function fieldButton(f: ReceiptField) {
    return editing === f.id ? (
      <label className="field" key={f.id}>
        {fieldNames[f.field_name]}
        <input
          autoFocus
          aria-label={fieldNames[f.field_name]}
          type={
            numericFields.has(f.field_name)
              ? "number"
              : f.field_name === "receipt_date"
                ? "date"
                : "text"
          }
          step="any"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={() => void saveField()}
          onKeyDown={(e) => {
            if (e.key === "Enter") void saveField();
            if (e.key === "Escape") setEditing("");
          }}
        />
      </label>
    ) : (
      <button
        key={f.id}
        type="button"
        disabled={!canReview || busy}
        onClick={async () => {
          if (!(await saveField())) return;
          setEditing(f.id);
          setEditValue(f.value === null ? "" : String(f.value));
        }}
      >
        <span>
          <small>
            {fieldNames[f.field_name]}
            {f.corrected
              ? "・已修正"
              : f.review_status !== "TRUSTED"
                ? "・請核對"
                : ""}
          </small>
          <strong>{displayReceiptValue(f.value)}</strong>
        </span>
        {canReview && <Settings className="ui-icon" />}
      </button>
    );
  }
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
    <div className="receiving-flow">
      <button className="shell-back" onClick={back}>
        ‹{" "}
        <span>
          {page === "mapping"
            ? "返回核對"
            : page === "upload" || page === "review" || page === "company-tasks"
              ? "返回進貨"
              : returnLabel}
        </span>
      </button>
      {message && (
        <p className="shell-note" role="status">
          {message}
        </p>
      )}
      {page === "list" && (
        <>
          {intro(
            fieldRole
              ? "進貨／收貨"
              : role === "OWNER"
                ? "進貨管理摘要"
                : chain
                  ? "跨店進貨追蹤"
                  : "進貨資料核對",
            fieldRole
              ? "現場上傳貨單並確認實收數量；上傳後可繼續今天的工作。"
              : chain
                ? "查看門市進貨核對與 ERP 驗收提醒狀態。"
                : "核對並確認收貨；原始照片與 OCR 原值完整保留。",
          )}
          {fieldRole ? (
            <section className="shell-card upload-shell">
              <span>
                <Truck className="ui-icon" />
              </span>
              <h2>上傳貨單</h2>
              <p>可拍照或從相簿選擇，一次最多 10 張</p>
              {action("開始上傳", () => {
                setMessage("");
                setPage("upload");
              })}
            </section>
          ) : (
            <div className="shell-metric-grid">
              <div>
                <span>識別中</span>
                <strong>
                  {
                    batches.filter((b) =>
                      ["QUEUED", "RUNNING"].includes(b.job_status || ""),
                    ).length
                  }
                </strong>
              </div>
              <div>
                <span>{chain ? "待 ERP 驗收" : "待核對"}</span>
                <strong>
                  {
                    batches.filter((b) =>
                      chain
                        ? !b.erp_completed_at
                        : b.ocr_status === "SUCCEEDED" &&
                          !isConfirmed(b),
                    ).length
                  }
                </strong>
              </div>
              <div>
                <span>已確認收貨</span>
                <strong>
                  {batches.filter(isConfirmed).length}
                </strong>
              </div>
            </div>
          )}
          <section className="shell-section">
            <div className="shell-section-head">
              <h2>{fieldRole ? "今天的上傳" : "待核對資料"}</h2>
            </div>
            {batchList(
              batches.filter(
                (b) =>
                  b.work_date ===
                  new Date().toLocaleDateString("en-CA", {
                    timeZone: "Asia/Taipei",
                  }),
              ),
            )}
          </section>
        </>
      )}
      {page === "upload" && (
        <>
          {intro(
            "上傳貨單",
            chain
              ? "拍攝貨單留存本次進貨數量；上傳後直接進入 ERP 驗收提醒。"
              : "先選擇照片屬於同一張貨單，或是不同貨單。",
            `進貨 1 / ${chain ? "2" : "4"}`,
          )}
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
          <p className="shell-note">
            {photos.length} / 10 張・原圖完整保留；OCR
            在背景辨識，上傳後不必等待。
          </p>
          {action("確認上傳", () => void upload(), false, !photos.length)}
        </>
      )}
      {page === "status" && (
        <>
          {intro(
            chain ? "進貨 OCR 與公司流程" : "貨單處理狀態",
            chain
              ? "OCR 統計進貨量與 ERP 正式驗收分開進行。"
              : "原圖與辨識進度會持續保存。",
          )}
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
              {detail.run?.status === "SUCCEEDED" && readLines}
              {chain &&
                action("查看公司流程待辦", () => setPage("company-tasks"))}
              {action("返回今日工作", onBack, true)}
            </>
          )}
        </>
      )}
      {page === "review" && detail && (
        <>
          {intro(
            "人工核對・原始單據",
            "每個欄位可回查原始照片；修改會另存操作人與時間。",
            `進貨 2 / 4・第 ${rowIndex + 1} / ${rows.length} 筆`,
          )}
          {pictures}
          <div className="shell-card review-fields">
            {fields
              .filter(
                (f) =>
                  f.row_key === row ||
                  (f.row_key === "document" && rowIndex === 0),
              )
              .sort(
                (a, b) =>
                  Object.keys(fieldNames).indexOf(a.field_name) -
                  Object.keys(fieldNames).indexOf(b.field_name),
              )
              .map(fieldButton)}
          </div>
          {canReview
            ? action(
                "下一筆",
                () =>
                  void act(async () => {
                    if (!(await saveField())) return;
                    setPage("mapping");
                  }),
              )
            : readLines}
        </>
      )}
      {page === "mapping" && detail && (
        <>
          {intro(
            "商品對應",
            "需要彙整同品項時再選擇商品；尚未對應也可儲存。",
            `進貨 3 / 4・第 ${rowIndex + 1} / ${rows.length} 筆`,
          )}
          <section className="shell-card mapping-card">
            <div>
              <small>OCR 品名</small>
              <strong>{displayReceiptValue(value("product"))}</strong>
            </div>
            <span>→</span>
            <div>
              <small>商品主檔</small>
              <strong>
                {mapping ? mapping.name : "尚未對應"}
              </strong>
            </div>
          </section>
          <div className="shell-button-stack">
            {selectProduct ? (
              <label className="field">
                選擇既有商品
                <select
                  aria-label="選擇既有商品"
                  value={mapping?.product_id || ""}
                  onChange={(e) => void act(() => mapProduct(e.target.value))}
                >
                  <option value="">請選擇</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}・{p.specification}・
                      {p.base_unit}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              action("選擇既有商品", () => void act(chooseExisting))
            )}
            {!chain &&
              action(
                "建立新商品",
                () => void act(() => mapProduct(undefined, true)),
                true,
              )}
          </div>
          {action("儲存並確認收貨", () => void act(saveReview))}
        </>
      )}
      {page === "published" && detail && (
        <>
          <section className="completion-state">
            <span>
              <Check className="ui-icon" />
            </span>
            <h1>{detail.receipt || detail.review?.complete ? "收貨確認完成" : "收貨資料已保存"}</h1>
            <p>
              {detail.receipt
                ? "實際進貨數量已確認並保存"
                : "原圖、明細與核對結果已保存；未確認的商品對應、單位或數量不計入庫存。"}
            </p>
            {detail.review?.confirmed_at && (
              <p>{detail.review.confirmed_by}・{displayTime(detail.review.confirmed_at)}</p>
            )}
          </section>
          {detail.full_access && (
            <section className="shell-card review-fields">
              {fields.filter((f) => f.row_key === "document").map(fieldButton)}
            </section>
          )}
          {readLines}
          {detail.full_access && pictures}
          {chain && (
            <section className="shell-card completion-card erp">
              <strong>
                {detail.batch.erp_completed_at
                  ? "ERP 驗收已登記"
                  : "已加入門市公司流程待辦"}
              </strong>
              <p>
                {detail.erp_actor
                  ? `${detail.erp_actor}・${displayTime(detail.batch.erp_completed_at!)}`
                  : "ERP 驗收可由門市稍後統一完成。"}
              </p>
              {action("查看公司流程待辦", () => setPage("company-tasks"))}
            </section>
          )}
          {action(
            initialBatchId ? returnLabel : chain ? "返回今日工作" : "返回進貨首頁",
            () => (initialBatchId || chain ? onBack() : setPage("list")),
            true,
          )}
        </>
      )}
      {page === "company-tasks" && (
        <>
          {intro("門市公司流程待辦", "ERP 依公司制度完成後，再回序登記。")}
          {batches
            .filter((b) => b.erp_required && !!b.job_status)
            .map((b) => (
              <section className="shell-card completion-card erp" key={b.id}>
                <strong>{b.supplier || b.batch_number}</strong>
                <p>
                  {b.erp_completed_at
                    ? `${b.erp_completed_by}・${displayTime(b.erp_completed_at)} 已完成`
                    : "待 ERP 驗收"}
                </p>
                {!b.erp_completed_at &&
                  fieldRole &&
                  action(
                    "回報已完成 ERP 驗收",
                    () =>
                      void act(async () => {
                        const r = await supabase.rpc(
                          "complete_pilot_receipt_erp",
                          { p_batch_id: b.id },
                        );
                        if (r.error) throw r.error;
                        setBatchId(b.id);
                        await refresh();
                        setPage("erp-complete");
                      }),
                  )}
              </section>
            ))}
          <p className="shell-note">
            序只記錄回報人員、門市與時間，不連線或查驗 ERP。
          </p>
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
    </div>
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
  useEffect(() => {
    let active = true;
    const read = async () => {
      const r = await supabase.rpc("get_pilot_receipts", {
        p_store_id: storeId,
      });
      if (active && !r.error) setBatches(r.data as unknown as Batch[]);
    };
    void read();
    const timer = setInterval(() => void read(), 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [storeId]);
  const shown = batches.filter((b) =>
    tasks
      ? (b.erp_required && !b.erp_completed_at && !!b.job_status) ||
        (b.review_allowed &&
          b.ocr_status === "SUCCEEDED" &&
          !isConfirmed(b))
      : !notifications ||
        b.erp_completed_at ||
        (b.review_allowed && !isConfirmed(b)),
  );
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
