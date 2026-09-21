export type CatalogState = 'ACTIVE' | 'DISABLED' | 'REMOVED' | 'UNCONFIGURED' | 'UNKNOWN';
export type CatalogStatus = {
  product_id: string;
  catalog_state?: string;
  product_is_active?: boolean;
  is_removed?: boolean;
  is_configured?: boolean;
};
export type ImportStatusRow = {product_id: string | null; status: string};
export type ImportRowState = CatalogState | 'FAILED' | 'SKIPPED';

export function catalogState(item: CatalogStatus | undefined): CatalogState {
  if (!item || typeof item.product_is_active !== 'boolean' || typeof item.is_removed !== 'boolean' || typeof item.is_configured !== 'boolean') return 'UNKNOWN';
  if (item.catalog_state === 'REMOVED' && item.is_removed) return 'REMOVED';
  if (item.catalog_state === 'DISABLED' && !item.product_is_active && !item.is_removed) return 'DISABLED';
  if (item.catalog_state === 'ACTIVE' && item.product_is_active && !item.is_removed) return item.is_configured ? 'ACTIVE' : 'UNCONFIGURED';
  return 'UNKNOWN';
}

export function catalogStates(items: CatalogStatus[]): Map<string, CatalogState> {
  const result = new Map<string, CatalogState>();
  for (const item of items) {
    const state = catalogState(item);
    const previous = result.get(item.product_id);
    // Conflicting per-zone states must not silently turn into ready products.
    result.set(item.product_id, previous && previous !== state ? 'UNKNOWN' : state);
  }
  return result;
}

export function importRowState(row: ImportStatusRow, states: Map<string, CatalogState>): ImportRowState {
  if (row.status === 'FAILED') return 'FAILED';
  if (row.status === 'SKIPPED') return row.product_id ? 'REMOVED' : 'SKIPPED';
  if (!row.product_id || !['ADDED', 'EXISTING', 'PENDING'].includes(row.status)) return 'UNKNOWN';
  return states.get(row.product_id) ?? 'UNKNOWN';
}

export const importStateLabel: Record<ImportRowState, string> = {
  ACTIVE: '可盤', DISABLED: '停用', REMOVED: '已移除', UNCONFIGURED: '待配置儲物區', FAILED: '失敗', SKIPPED: '略過', UNKNOWN: '狀態待確認',
};

export function importRowLabel(row: ImportStatusRow, states: Map<string, CatalogState>) {
  if (row.status === 'SKIPPED' && row.product_id) return '來源已移除';
  return importStateLabel[importRowState(row, states)];
}

export function summarizeImportRows(rows: ImportStatusRow[], states: Map<string, CatalogState>) {
  const products = {ACTIVE: new Set<string>(), DISABLED: new Set<string>(), REMOVED: new Set<string>(), UNCONFIGURED: new Set<string>()};
  let failed = 0, unknown = 0, skipped = 0;
  for (const row of rows) {
    const state = importRowState(row, states);
    if (state === 'FAILED') failed++;
    else if (state === 'UNKNOWN') unknown++;
    else if (state === 'SKIPPED') skipped++;
    else if (row.product_id) products[state].add(row.product_id);
  }
  return {
    sourceRows: rows.length,
    builtRows: rows.filter(row => row.product_id && ['ADDED', 'EXISTING', 'PENDING'].includes(row.status)).length,
    ready: products.ACTIVE.size, disabled: products.DISABLED.size, removed: products.REMOVED.size,
    unconfigured: products.UNCONFIGURED.size,
    failed, unknown, skipped,
  };
}

export function importSummaryLabel(summary: ReturnType<typeof summarizeImportRows>) {
  return [`可盤 ${summary.ready} 項`,
    summary.disabled ? `停用 ${summary.disabled} 項` : '',
    summary.removed ? `已移除 ${summary.removed} 項` : '',
    summary.unconfigured ? `待配置 ${summary.unconfigured} 項` : '',
    summary.failed ? `失敗 ${summary.failed} 列` : '',
    summary.unknown ? `待確認 ${summary.unknown} 列` : '',
    summary.skipped ? `略過 ${summary.skipped} 列` : '',
  ].filter(Boolean).join('・');
}
