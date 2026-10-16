type Product = {id: string; name: string; base_unit?: string | null; count_unit?: string | null};
const nameKey = (name: string) => name.normalize('NFKC').trim().toLocaleLowerCase();
const unitKey = (unit: string) => {
  const key = nameKey(unit);
  return ({kg:'公斤',g:'克',l:'公升',毫升:'ml'} as Record<string,string>)[key] || key;
};
/** Exact normalized name and equivalent unit only. Never fuzzy-match historic operations. */
export function operationProduct(products: Product[], name: string, unit: string): Product | null {
  if (!name.trim() || !unit.trim()) return null;
  const matches = products.filter(p => nameKey(p.name) === nameKey(name) &&
    [p.base_unit,p.count_unit].some(u => !!u && unitKey(u) === unitKey(unit)));
  const ids = new Set(matches.map(p => p.id));
  return ids.size === 1 ? matches[0] : null;
}
export function operationRecordStatus(record: {review_status?: string; product_id?: string | null}) {
  return [record.review_status === 'PENDING' ? '待確認' : '已確認',
    record.product_id ? '' : '待對應食材'].filter(Boolean).join('・');
}
