export type ReceiptField = {
  id: string;
  row_key: string;
  field_name: string;
  raw_value: unknown;
  value: unknown;
  review_status: string;
  confidence: number;
  corrected: boolean;
  source_region: { page?: number } | null;
};
export const fieldNames: Record<string, string> = {
  supplier_name: "供應商",
  document_number: "單號",
  receipt_date: "日期",
  product: "品名 OCR 原文",
  specification: "規格",
  unit: "單位",
  quantity: "數量",
  unit_price_ex_tax: "單價",
  subtotal_ex_tax: "未稅",
  tax: "稅額",
  total_inc_tax: "含稅",
};
export const numericFields = new Set([
  "quantity",
  "unit_price_ex_tax",
  "subtotal_ex_tax",
  "tax",
  "total_inc_tax",
]);
export function receiptRows(fields: ReceiptField[]) {
  return [
    ...new Set(
      fields.filter((f) => f.row_key !== "document").map((f) => f.row_key),
    ),
  ].sort((a,b)=>a.localeCompare(b,"en",{numeric:true}));
}
export function receiptValue(
  fields: ReceiptField[],
  row: string,
  name: string,
) {
  return (
    fields.find((f) => f.row_key === row && f.field_name === name)?.value ??
    null
  );
}
// Reuse the idempotent row-save API, but finish the receipt only after every
// line has been saved. A partial failure leaves saved rows available for retry.
export async function saveReceiptRows(
  fields: ReceiptField[],
  save: (row: string) => Promise<{ complete?: boolean }>,
) {
  const rows = receiptRows(fields);
  if (!rows.length) throw new Error("OCR_NOT_READY");
  let complete = false;
  for (const row of rows) complete = (await save(row)).complete === true;
  if (!complete) throw new Error("RECEIPT_REVIEW_INCOMPLETE");
}
export function displayReceiptValue(value: unknown) {
  return value === null || value === undefined || value === ""
    ? "未提供"
    : String(value);
}
export async function sha256(bytes: ArrayBuffer) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
export async function receiptFingerprint(mode: string, hashes: string[]) {
  return sha256(new TextEncoder().encode(`${mode}:${hashes.join(",")}`).buffer);
}
export function receiptGroups<T>(files: T[], same: boolean) {
  return same ? [files] : files.map((file) => [file]);
}
export function receiptError(error: unknown) {
  const m =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error && "message" in error
        ? String(error.message)
        : String(error);
  const known: Record<string, string> = {
    RECEIPT_HANDLING_USE_REVIEW: "此單包含運費或寄庫領回，請在進貨明細儲存後使用「確認無誤，送入對帳」。",
    SUPPLIER_NAME_REQUIRED: "請在進貨明細修改供應商名稱後儲存。",
    OCR_NO_LINES: "原單未辨識出本次採購品項。可核對原單後手動新增明細。",
    PHOTO_RETAKE_REQUIRED: "這張貨單正在等門市補拍。補拍後可繼續建檔。",
    INVALID_PHOTO_NOTE: "補充說明請控制在 500 字以內。",
    INVALID_PHOTO_REASON: "請選擇重拍原因。",
    RETAKE_SAME_PHOTO: "這張照片與原圖相同，請重新拍攝。",
    PHOTO_PROCESSING_BUSY: "照片已保存，系統正在處理；請稍後選取同一張照片重試。",
    RECEIPT_FILE_SIZE: "請選擇 10 MB 以內的貨單照片或 PDF。",
    RECEIPT_FILE_FORMAT: "請選擇 JPG、PNG、WebP、HEIC 或 PDF。",
    REVISION_CONFLICT: "資料已由其他人更新；您的輸入仍保留，請取消後查看最新資料。",
    DEMO_UNAVAILABLE: '示範模式使用預設貨單，可直接開啟待核對資料；照片上傳與實際辨識需登入。',
    STORE_UPLOADER_REQUIRED: "此身份不能上傳此門市貨單。",
    RECEIPT_REVIEWER_REQUIRED: "此資料由授權核對人員處理。",
    RECEIPT_ACCESS_DENIED: "沒有查看此貨單的權限。",
    DUPLICATE_UPLOAD_IN_STORE: "本店已保存相同貨單，請由主管查看。",
    RECEIPT_DUPLICATE_UPLOAD_PENDING: "此貨單正在上傳，請稍候再重試。",
    RECEIPT_DUPLICATE_LINKED: "此貨單有歷史重複關聯，無法更改門市。",
    ORIGINAL_UPLOAD_INCOMPLETE: "原圖尚未全部上傳，請重新選取相同檔案繼續。",
    PRODUCT_MAPPING_REQUIRED: "明細可先保存；商品對應完成前不計入正式統計。",
    COMPANY_PRODUCT_MAPPING_REQUIRED: "請先完成貨單品項與百花猿商品的對應，再完成建檔。",
    UNIT_MAPPING_CONFLICT: "貨單單位與商品單位不同，請核對原圖及商品對應。",
    QUANTITY_AND_UNIT_REQUIRED: "請依原圖補正實收數量及單位。",
    SUPPLIER_AND_DATE_REQUIRED: "請依原圖補正供應商及日期。",
    RECEIPT_FIELDS_REQUIRE_REVIEW:
      "尚有無法判讀欄位，已保留實際狀態，請依原圖核對。",
    DUPLICATE_RECEIPT_NUMBER:
      "相同供應商、日期及單號已建單，已保留本次原圖，未重複發布。",
    RECEIPT_TOTAL_CONFLICT: "未稅、稅額與含稅金額不一致，請核對原圖。",
    LINE_TOTAL_CONFLICT: "數量乘以單價與小計不一致，請核對原圖。",
    OCR_NOT_READY: "辨識尚未完成，原圖已保存。",
    OCR_VERSION_CHANGED: "辨識版本已更新，請重新開啟貨單。",
    RECEIPT_REVIEW_REQUIRED: "尚有疑慮欄位，請先點選驚嘆號核對後，再確認整張貨單。",
    RECEIPT_REVIEW_INCOMPLETE: "尚有品項未完成保存，已保存的明細仍保留，請重新讀取後重試。",
    PUBLISHED_RECEIPT_IMMUTABLE: "貨單已發布，請重新讀取結果。",
  };
  return (
    Object.entries(known).find(([code]) => m.includes(code))?.[1] ||
    "目前無法完成，原有資料仍保留，請稍後重試。"
  );
}

/** Keep undecided OCR candidates visible even when their individual fields are clear. */
export function receiptReviewFields(
  fields: ReceiptField[],
  states: { row_key: string; decision?: string | null }[],
) {
  const decided = new Set(states.filter(state => state.decision).map(state => state.row_key));
  return fields.filter(field => field.row_key.startsWith("candidate-")
    ? !decided.has(field.row_key)
    : !field.corrected && field.review_status !== "TRUSTED");
}

export function pendingReceiptPurchases(fields: ReceiptField[]) {
  const candidates = new Map<string, { key: string; name: string; quantity: string; amount: string }>();
  for (const field of fields) {
    if (!field.row_key.startsWith("candidate-")) continue;
    const candidate = candidates.get(field.row_key) || { key: field.row_key, name: "", quantity: "", amount: "" };
    const value = field.value ?? field.raw_value;
    const label = typeof value === "number" || typeof value === "string" ? String(value) : "";
    if (field.field_name === "product") candidate.name = label;
    if (field.field_name === "quantity") candidate.quantity = label;
    if (field.field_name === "subtotal_ex_tax") candidate.amount = label;
    candidates.set(field.row_key, candidate);
  }
  return [...candidates.values()];
}
