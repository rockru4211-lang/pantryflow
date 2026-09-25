export const SUPPLIER_CATEGORIES = ['食材', '耗材', '調料', '酒類', '待分類'] as const;
export type SupplierCategory = typeof SUPPLIER_CATEGORIES[number];
export function supplierCategory(value?: string | null): SupplierCategory {
  return SUPPLIER_CATEGORIES.includes(value as SupplierCategory) ? value as SupplierCategory : '待分類';
}
export function supplierCategoryTone(value?: string | null) {
  return ({食材: 'food', 耗材: 'supply', 調料: 'seasoning', 酒類: 'drink', 待分類: 'unknown'})[supplierCategory(value)];
}
