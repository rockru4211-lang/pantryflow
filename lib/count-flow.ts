export type CountItem = { zone_id: string; zone_name: string; product_id: string; product_name: string; unit: string; supplier?: string; specification?: string; file_name?: string; sheet_name?: string; source_row?: number; file_order?: string; sheet_order?: number };
export type CountResult = { id: string; product_id: string; zone_id: string; zone: string; name: string; unit: string; quantity: number; supplier?: string; specification?: string; file_name?: string; sheet_name?: string; source_row?: number; file_order?: string; sheet_order?: number; entered_at: string; entered_by: string | null; opening_quantity?: number | null; difference?:number|null; confirmed_quantity?:number|null;correction_reason?:string|null;confirmed_at?:string|null;confirmed_by?:string|null };
export function validCountQuantity(value: string | undefined) { return value !== undefined && value.trim() !== '' && Number.isFinite(Number(value)) && Number(value) >= 0; }
export function clampPaperSegment(segment: number, pages: number) { return Number.isFinite(segment) ? Math.max(0,Math.min(Math.floor(segment),Math.max(0,pages-1))) : 0; }
export function paperOrder(rows: CountResult[]) {
  return [...rows].sort((a,b) => (a.file_name ? 0 : 1)-(b.file_name ? 0 : 1) || (a.file_order || '').localeCompare(b.file_order || '') || (a.file_name || '').localeCompare(b.file_name || '') || (a.sheet_order ?? 0)-(b.sheet_order ?? 0) || (a.source_row ?? 0)-(b.source_row ?? 0));
}
export function countExportRows(rows: CountResult[], management: boolean) {
  return rows.map(row => ({ '品名': row.name, '區域': row.zone, '單位': row.unit, '本次數量': row.quantity, '廠商': row.supplier || '未提供', '規格': row.specification || '未提供', '原始檔': row.file_name || '未對應', '工作表': row.sheet_name || '未對應', '來源列': row.source_row || '', '盤點人': row.entered_by || '未提供', '送出時間': row.entered_at, ...(management ? {'期初': row.opening_quantity ?? '未提供','差異':row.difference??'未提供','確認數量':row.confirmed_quantity??row.quantity,'確認原因':countReasonLabel(row.correction_reason),'確認人':row.confirmed_by||'未提供','確認時間':row.confirmed_at||'未提供'} : {}) }));
}

export function countReasonLabel(value?:string|null){return value?({INPUT_ERROR:'輸入錯誤',MISSED_OR_WRONG_ZONE:'漏盤／錯區',WASTE_NOT_RECORDED:'報廢未登',TRANSFER_NOT_RECORDED:'移轉／借用未登',RECEIPT_NOT_RECORDED:'進貨未登',OTHER:'其他'} as Record<string,string>)[value]||value:'未提供';}
