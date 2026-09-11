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
  ].sort();
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
    DEMO_UNAVAILABLE: '示範模式使用預設貨單，可直接開啟待核對資料；照片上傳與實際辨識需登入。',
    STORE_UPLOADER_REQUIRED: "此身份不能上傳此門市貨單。",
    RECEIPT_REVIEWER_REQUIRED: "此資料由授權核對人員處理。",
    RECEIPT_ACCESS_DENIED: "沒有查看此貨單的權限。",
    DUPLICATE_UPLOAD_IN_STORE: "本店已保存相同貨單，請由主管查看。",
    ORIGINAL_UPLOAD_INCOMPLETE: "原圖尚未全部上傳，請重新選取相同檔案繼續。",
    PRODUCT_MAPPING_REQUIRED: "明細可先保存；商品對應完成前不計入正式統計。",
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
    RECEIPT_REVIEW_INCOMPLETE: "尚有品項未完成保存，已保存的明細仍保留，請重新讀取後重試。",
    PUBLISHED_RECEIPT_IMMUTABLE: "貨單已發布，請重新讀取結果。",
  };
  return (
    Object.entries(known).find(([code]) => m.includes(code))?.[1] ||
    "目前無法完成，原有資料仍保留，請稍後重試。"
  );
}
