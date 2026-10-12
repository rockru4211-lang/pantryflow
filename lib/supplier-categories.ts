export const SUPPLIER_CATEGORIES = ['食材', '酒水', '耗材'] as const;
export type SupplierCategory = typeof SUPPLIER_CATEGORIES[number] | '';
export function supplierCategory(value?: string | null): SupplierCategory {
  if(value==='調料')return '食材';
  if(value==='酒類')return '酒水';
  return SUPPLIER_CATEGORIES.includes(value as typeof SUPPLIER_CATEGORIES[number]) ? value as SupplierCategory : '';
}
export function supplierCategoryTone(value?: string | null) {
  return ({食材: 'food', 耗材: 'supply', 酒水: 'drink', '': 'unknown'})[supplierCategory(value)];
}
