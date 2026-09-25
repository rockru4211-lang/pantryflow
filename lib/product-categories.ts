export const PRODUCT_CATEGORIES=['食材','耗材','調料','酒水','待分類'] as const;
export type ProductCategory=typeof PRODUCT_CATEGORIES[number];
export function productCategory(value:unknown):ProductCategory{return PRODUCT_CATEGORIES.includes(value as ProductCategory)?value as ProductCategory:'待分類';}
export function categoryTone(value:string){return ({食材:'food',耗材:'supply',調料:'seasoning',酒水:'drink',待分類:'unknown'} as Record<string,string>)[value]||'unknown';}
