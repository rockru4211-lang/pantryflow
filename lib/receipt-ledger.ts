export type ReceiptLedgerStatus = 'PENDING' | 'NEEDS_MAPPING' | 'COMPLETE';
export type ReceiptLedgerFilter = ReceiptLedgerStatus | 'ALL';
export type SelectableReceiptRow = {
  batch_id: string;
  row_key: string;
  run_id: string | null;
  status: ReceiptLedgerStatus;
  review_allowed: boolean;
};

export function matchesReceiptLedgerStatus(status: ReceiptLedgerStatus, filter: ReceiptLedgerFilter) {
  return filter === 'ALL' || (filter === 'PENDING' ? status !== 'COMPLETE' : status === filter);
}

// The confirmation API may publish an entire receipt after its last saved row.
// Selection therefore always names a whole receipt, including filtered-out rows.
export function selectedReceiptLedgerRows<T extends SelectableReceiptRow>(rows: T[], visible: T[], batchIds: string[]) {
  const visibleIds = new Set(visible.map(row => row.batch_id));
  const selected = new Set(batchIds.filter(id => visibleIds.has(id)));
  return rows.filter(row => selected.has(row.batch_id) && row.status !== 'COMPLETE' && row.review_allowed && row.run_id);
}

export function receiptSubtotal(quantity: unknown, unitPrice: unknown): number | null {
  const numeric = (value: unknown) => {
    if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  };
  const q = numeric(quantity), price = numeric(unitPrice);
  return q === null || price === null ? null : q * price;
}

export function receiptDetailPage(detail: {
  batch: { status: string };
  receipt?: unknown;
  review?: { complete?: boolean };
  review_allowed: boolean;
  run?: { status: string } | null;
}): 'published' | 'review' | 'status' {
  if (detail.receipt || detail.review?.complete || detail.batch.status === 'COMPLETED') return 'published';
  return detail.review_allowed && detail.run?.status === 'SUCCEEDED' ? 'review' : 'status';
}

export function receiptBatchesWithoutLedger<T extends { id: string; status: string; review_saved?: boolean }>(batches: T[], rows: { batch_id: string }[]) {
  const listed = new Set(rows.map(row => row.batch_id));
  return batches.filter(batch => batch.status !== 'COMPLETED' && !batch.review_saved && !listed.has(batch.id));
}
