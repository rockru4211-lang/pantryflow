/** Administrative reconciliation only. Never calls receipt confirmation or stock APIs. */
export type Values = Record<string, unknown>;
export type AdminBatch = {
  id: string; store_id: string; organization_id: string; batch_number: string;
  supplier: string | null; supplier_id: string | null; uploaded_at: string;
  ocr_status: string | null; job_status: string | null;
  delivery: { arrived_on: string | null; arrived_time: string | null; revision: number;
    issues: { id: string; name: string; reason: string; status: string; note?: string }[] };
  row_count: number; reviewed_count: number;
};
export type AdminField = {
  id: string; row_key: string; field_name: string; value: unknown; raw_value: unknown;
  review_status: string; corrected: boolean;
};
export type AdminState = {
  row_key: string; revision: number; values: Values; source_token: string;
  reviewed: boolean; updated_at: string; actor: string | null;
};
export type AdminDocument = {
  batch: { id: string; store_id: string; organization_id: string; batch_number: string;
    delivery: AdminBatch['delivery'] };
  run: { id: string; status: string } | null;
  fields: AdminField[];
  documents: { id: string; name: string; path: string; mime_type: string; page_order: number }[];
  admin: { rows: AdminState[]; tokens: Record<string, string> };
};
export type AdminLine = {
  id: string; batchId: string; batchNumber: string; runId: string; rowKey: string;
  arrivedOn: string | null; supplier: string; values: Values; original: Values;
  revision: number; sourceToken: string; reviewed: boolean; stale: boolean;
};
export type SupplierGroup = {
  key: string; name: string; batches: AdminBatch[]; rowCount: number;
  reviewedCount: number; latestArrival: string | null;
};
export const editableFields = ['product', 'category', 'specification', 'unit', 'quantity',
  'unit_price_ex_tax', 'subtotal_ex_tax', 'product_code', 'note'] as const;
export const fieldLabels: Record<string, string> = {
  product: '品項名稱', category: '品項分類', specification: '規格', unit: '單位',
  quantity: '數量', unit_price_ex_tax: '單價（未稅）', subtotal_ex_tax: '小計（未稅）',
  product_code: '品項編碼', note: '備註', arrived_on: '到貨日期',
};
export function text(value: unknown): string { return value == null ? '' : String(value); }
export function finiteNumber(value: unknown): number | null {
  if (value == null || typeof value === 'boolean' || (typeof value === 'string' && !value.trim())) return null;
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const n = Number(value); return Number.isFinite(n) ? n : null;
}
export function money(value: unknown): string {
  const n = finiteNumber(value);
  return n == null ? '未填' : new Intl.NumberFormat('zh-TW', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n);
}
export function calculatedSubtotal(quantity: unknown, price: unknown): number | null {
  const q = finiteNumber(quantity), p = finiteNumber(price);
  if (q == null || p == null) return null;
  const value = q * p;
  if (!Number.isFinite(value) || value < 0 || value > 1e12) return null;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
export function lineSubtotal(values: Values): number | null {
  // Keep a supplied invoice subtotal (including a genuine zero) rather than replacing a discount.
  return finiteNumber(values.subtotal_ex_tax) ?? calculatedSubtotal(values.quantity, values.unit_price_ex_tax);
}
export function supplierKey(batch: AdminBatch): string {
  const scope = `${batch.organization_id}:${batch.store_id}:`;
  if (batch.supplier_id) return `${scope}id:${batch.supplier_id}`;
  const name = batch.supplier?.trim();
  if (!name || name === batch.batch_number) return `${scope}unassigned`;
  // Exact names only; never fuzzy-match, lowercase or remove punctuation from supplier names.
  return `${scope}name:${name}`;
}
export function groupSuppliers(batches: AdminBatch[]): SupplierGroup[] {
  const groups = new Map<string, SupplierGroup>();
  for (const b of batches) {
    const key = supplierKey(b);
    const name = b.supplier?.trim();
    const g = groups.get(key) ?? { key, name: name && name !== b.batch_number ? name : '未辨識供應商（待歸戶）',
      batches: [], rowCount: 0, reviewedCount: 0, latestArrival: null };
    g.batches.push(b); g.rowCount += b.row_count; g.reviewedCount += b.reviewed_count;
    if (b.delivery.arrived_on && (!g.latestArrival || b.delivery.arrived_on > g.latestArrival)) g.latestArrival = b.delivery.arrived_on;
    groups.set(key, g);
  }
  return [...groups.values()].sort((a,b) => a.name.localeCompare(b.name, 'zh-Hant'));
}
export function inArrivalRange(b: AdminBatch, from: string, to: string, includeUndated: boolean): boolean {
  const d = b.delivery.arrived_on;
  if (!d) return includeUndated;
  return (!from || d >= from) && (!to || d <= to);
}
export function documentLines(doc: AdminDocument, supplier: string): AdminLine[] {
  if (!doc.run || doc.run.status !== 'SUCCEEDED') return [];
  const keys = [...new Set(doc.fields.filter(f => f.row_key !== 'document').map(f => f.row_key))]
    .sort((a,b) => a.localeCompare(b, 'en', { numeric: true }));
  return keys.map(rowKey => {
    const original: Values = Object.fromEntries(doc.fields.filter(f => f.row_key === rowKey).map(f => [f.field_name, f.value]));
    const saved = doc.admin.rows.find(r => r.row_key === rowKey);
    const token = doc.admin.tokens[rowKey];
    const stale = !!saved && saved.source_token !== token;
    return { id: `${doc.batch.id}:${rowKey}`, batchId: doc.batch.id, batchNumber: doc.batch.batch_number,
      runId: doc.run!.id, rowKey, arrivedOn: doc.batch.delivery.arrived_on, supplier,
      original, values: { ...original, ...(saved?.values ?? {}) }, revision: saved?.revision ?? 0,
      sourceToken: token, reviewed: !!saved?.reviewed && !stale, stale };
  });
}
export function sortLines(lines: AdminLine[], descending = false): AdminLine[] {
  return [...lines].sort((a,b) => {
    if (!a.arrivedOn && b.arrivedOn) return 1;
    if (a.arrivedOn && !b.arrivedOn) return -1;
    const date = (a.arrivedOn ?? '').localeCompare(b.arrivedOn ?? '');
    return (descending ? -date : date) || a.batchNumber.localeCompare(b.batchNumber, 'en', {numeric:true})
      || a.batchId.localeCompare(b.batchId) || a.rowKey.localeCompare(b.rowKey, 'en', {numeric:true});
  });
}
export function filterLines(lines: AdminLine[], search: string, state: string): AdminLine[] {
  const q = search.trim().toLocaleLowerCase();
  return lines.filter(l => (state === 'all' || (state === 'reviewed' ? l.reviewed : !l.reviewed)) &&
    (!q || [l.batchNumber, ...Object.values(l.values)].some(v => text(v).toLocaleLowerCase().includes(q))));
}
export function totals(lines: AdminLine[]): { sum: number; missing: number } {
  let cents = 0, missing = 0;
  for (const l of lines) { const n = lineSubtotal(l.values); if (n == null) missing++; else cents += Math.round(n * 100); }
  return { sum: cents / 100, missing };
}
export function cleanValues(values: Values, showCodes: boolean): Values {
  const out: Values = {};
  for (const key of editableFields) {
    // Switching off codes hides them; it never clears a previously saved code.
    if (key === 'product_code' && !showCodes) continue;
    const v = values[key];
    if (['quantity','unit_price_ex_tax','subtotal_ex_tax'].includes(key)) {
      if (v == null || text(v).trim() === '') { out[key] = null; continue; }
      const n = finiteNumber(v);
      const cap = key === 'subtotal_ex_tax' ? 1e12 : 1e9;
      if (n == null || n < 0 || n > cap) throw new Error(`${fieldLabels[key]}請填有效的非負數字。`);
      out[key] = n;
    } else {
      const s = text(v).trim();
      const cap = key === 'note' ? 1000 : key === 'product_code' ? 80 : key === 'unit' ? 30 : 200;
      if (s.length > cap) throw new Error(`${fieldLabels[key]}最多 ${cap} 個字。`);
      out[key] = s;
    }
  }
  return out;
}
/** Strings remain literal spreadsheet cells; no inferred formulas or numeric product codes. */
export function exportMatrix(lines: AdminLine[], showCodes: boolean): (string | number | null)[][] {
  const heading = ['到貨日期','供應商','貨單編號',...(showCodes ? ['品項編碼'] : []),'品項分類','品項名稱','規格','單位','數量','單價（未稅）','小計（未稅）','核對狀態','備註'];
  return [heading, ...lines.map(l => [l.arrivedOn ?? '到貨日期未填', l.supplier, l.batchNumber,
    ...(showCodes ? [text(l.values.product_code)] : []), text(l.values.category), text(l.values.product),
    text(l.values.specification), text(l.values.unit), finiteNumber(l.values.quantity),
    finiteNumber(l.values.unit_price_ex_tax), lineSubtotal(l.values), l.reviewed ? '已核對完成' : '待核對', text(l.values.note)])];
}
export function adminError(error: unknown): string {
  const obj = typeof error === 'object' && error ? error as { message?: string; code?: string } : {};
  const message = error instanceof Error ? error.message : obj.message ?? String(error);
  if (message.includes('REVISION_CONFLICT') || message.includes('SOURCE_CHANGED')) return '資料已由其他人更新，輸入已保留。請取消編輯、重新讀取後比對。';
  if (message.includes('OCR_VERSION_CHANGED')) return '辨識版本已更新，輸入已保留。請重新讀取原始資料。';
  if (message.includes('ADMIN_RECEIPT_ACCESS_DENIED')) return '目前身份沒有此門市的行政核對權限。';
  if (message.includes('OCR_NOT_READY')) return '辨識尚未完成，請稍後重新讀取。';
  if (message.includes('REVIEW_REQUIRED_FIELDS')) return '完成核對前，請補齊品名、數量、單位與到貨日期。';
  if (message.includes('PGRST202') || obj.code === 'PGRST202' || message.includes('Could not find the function')) return '行政核對資料庫更新尚未安裝，請先完成本次資料庫 migration；目前未寫入任何核對資料。';
  if (message.includes('INVALID_')) return '資料格式不正確，請檢查欄位後重試。';
  if (message.includes('REQUEST_REUSED')) return '這次儲存請求已變更，請重新開啟編輯後再試。';
  return '目前無法儲存或讀取，輸入與原始資料仍保留，請稍後重試。';
}
