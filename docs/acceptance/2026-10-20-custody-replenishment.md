# 寄庫餘量與補貨追蹤

Scope: 百花猿 `beape`; existing Cloudflare `beape-ops`. No changes to 序/main.

- Receipt name picker offers explicitly selected existing custody records, with code/name/confirmed aliases, supplier scope and remaining amount. Selection preserves current receipt amounts and the established ordinary-receiving reminder semantics. Existing delta-only deduction, archive/unarchive, and stock posting behavior remain intact. Confirmed supplier directory renames resolve to the same record.
- Current count cards show supplier custody balance and open-order ETA as a small reference, keyed by product identity. They never populate physical count inputs or include supplier balances in physical count totals. Historical counts do not show today's custody hint.
- Custody list adds optional safety stock, office recipient, inline order tracking, expected arrival, partial arrival, cancellation, and retained order history. Existing safety thresholds remain null; illustrative mockup numbers were not applied.
- Server operations share the existing store lock, use revisions and request IDs, audit changes, and enforce current store/office/session permissions. Order creation does not increase quantity; each confirmed partial arrival increases it once.
- Daily in-app notifications use Taipei dates, run at 10:00 Taipei, and enqueue immediately on relevant changes. One record per custody item/day. Missing ETA continues reminders; confirmed ETA stops reminders; overdue open orders resume reminders. Viewing notifications is not completion. Inactive assigned recipients fall back to active office members. No email, LINE, or external push delivery is added.
- Operations overview includes open replenishments; notification links route directly to the supplier custody tab, including store switching.

Validation before release:

- `npm run typecheck` passed.
- 141 targeted regressions passed, including existing receipt, custody, physical count and overview behavior.
- `npm run lint` passed with 29 pre-existing warnings; changed-file lint clean.
- `npm run verify:source` passed (310 migrations).
- Production migration `20261020031924_custody_replenishment_tracking` applied; cron active (`0 2 * * *`, UTC).
- `tests/sql/custody-replenishment.sql` ran successfully in a single isolated rollback transaction on production. It covers 55−2=53, receipt retries/deltas/removal, office/staff/cross-store denials, assigned-recipient visibility, daily deduplication, missing/confirmed/overdue ETA, partial/full arrival, stale revisions, over-receipt rejection, cancellation, old-client field preservation and physical-stock invariance.
- Before/after fingerprints of existing custody rows (excluding additive columns), receipt corrections, memberships and PIN count matched. Receipt batch count stayed 279. No real order or threshold was created.
- Security advisor delta: only two INFO entries for private RLS tables with no direct-role grants; no newly exposed table/function access.
- Chromium visual automation could not launch because its browser binary was unavailable and browser download returned an invalid archive. Component rendering and interaction regression coverage remains available; no browser screenshot is claimed.

The full application suite and exact-commit build are release gates. After publication verify the exact SHA and served asset graph with `verifyProduction` and the explicit 百花猿 URL.
