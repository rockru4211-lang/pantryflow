export type CountCardDraft = { quantity: string; note: string };

export type CountDraftConflict = {
  shared: CountCardDraft;
  updatedAt: string | null;
};

export type SharedCountDraft = {
  zone_id: string;
  product_id: string;
  quantity: number | null;
  note: string | null;
  updated_at: string;
};

// Compare only local edits. A colleague's work in another area is never a
// conflict, even when that area contains the same product.
export function findCountDraftConflicts(
  dirty: Record<string, CountCardDraft>,
  versions: Record<string, string | null>,
  rows: SharedCountDraft[],
): Record<string, CountDraftConflict> {
  const shared = new Map(rows.map(row => [`${row.zone_id}:${row.product_id}`, row]));
  const conflicts: Record<string, CountDraftConflict> = {};
  for (const [key, local] of Object.entries(dirty)) {
    const row = shared.get(key);
    const updatedAt = row?.updated_at ?? null;
    if (updatedAt === (versions[key] ?? null)) continue;
    const remote = { quantity: String(row?.quantity ?? ""), note: row?.note ?? "" };
    // Match the server's normalized comparison for a response-lost retry.
    const quantityMatches = local.quantity === "" ? remote.quantity === ""
      : remote.quantity !== "" && Number(local.quantity) === Number(remote.quantity);
    if (quantityMatches && local.note.trim() === remote.note) continue;
    conflicts[key] = { shared: remote, updatedAt };
  }
  return conflicts;
}

export function sameCountCardDraft(left: CountCardDraft | undefined, right: CountCardDraft | undefined): boolean {
  return Boolean(left && right && left.quantity === right.quantity && left.note === right.note);
}

export function unclassifiedCountZone(name: string): boolean {
  return name.replace(/\s/g, "") === "未分類";
}
