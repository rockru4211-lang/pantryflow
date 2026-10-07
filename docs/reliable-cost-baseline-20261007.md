# Reliable cost baseline — 2026-10-07

Scope: 百花猿 production, BeApe and Gras. Procurement is the primary historical source; recipe prices fill gaps and remain labelled reference prices. Explicit manual prices retain priority. Original workbooks and confirmed operational snapshots are preserved.

## Data reconciliation

- Reused the three existing source imports; read 92 Gras and 284 BeApe recipe workbook tabs and refreshed June–September procurement ranges.
- Added 623 valid, source-row-addressed procurement quotes (BeApe 358, Gras 265). Replaying the first 100 inserted zero rows and zero audit records.
- Reconciled 2,186 non-manual master prices, 21 explicit package measures and 17 reviewed aliases; grouped 534 equivalent metadata-only aliases while preserving original master IDs.
- Excluded 25 invalid/conflicting procurement rows. Two previously confirmed conflicting quotations and their two non-manual selected masters were returned to pending, with old/new audit records.
- Preserved hashes for manual prices, recipes, recipe versions/approvals, transfer records and waste records. No closed inventory records existed in the checked dataset.

## Shared pricing behavior

Inventory uses month-end prices; movements use operation date and the originating store. A confirmed purchase price precedes a recipe reference. Unit conversion requires compatible dimensions or explicit package content. The previous gram-to-kilogram cache error is fixed. Ambiguous quantities, sizes and vintages remain missing instead of becoming zero.

The desktop sheet provides 帶入進價, 只看缺價 and price provenance. Quotes are previewed in the existing rows and require Save. Selected replacements require confirmation. Editing price-related fields invalidates the quote provenance. Existing locked recipe costs and confirmed movement snapshots are not repriced by this release.

September inventory audit: BeApe 105/206 rows priced, 101 missing; Gras 74/159 priced, 85 missing (includes zero-quantity rows). Displayed sums remain partial until missing source prices, package conversions and product identities are resolved. This release does not implement gross-profit reporting; sales and complete period costs are prerequisites.

## Validation

- 50 relevant JavaScript tests pass; typecheck and source contract pass (242 migrations).
- Lint has zero errors and 26 pre-existing warnings.
- Isolated production rollback fixture covers source/date ordering, unit and package conversion, selected-reference aliases, manual prices, batch ordering and access denial.
- Chromium test covers quote preview, explicit save, retry identity and recovery; no page errors.
- All eight accompanying migrations verified applied to production before release.

Publication must use the exact committed source and verify the BeApe release SHA plus linked JavaScript, CSS and PDF assets using the existing production verification script.
