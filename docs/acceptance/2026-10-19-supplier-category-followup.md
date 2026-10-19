# Supplier duplicate cleanup and receipt category continuity

The 16:27 screenshot showed supplier names split between a familiar name and a company/OCR name. The receipt editor also preferred the supplier master over the last saved invoice choice and sorted history by invoice date, so entering September invoices in October could reuse an older classification.

## Changes

- Group 品鮮樸食 / 品鮮璞食股份有限公司 under 品鮮璞食; 嘉文生技有限公司 / 嘉文鵝肉 under 嘉文鵝肉; 壽福培根 / 壽福美景小廚 / 壽福美墨 under 壽福培根. Explicit approved groups are in `scripts/supplier-name-followup-20261019.json`.
- Reuse the existing canonical supplier links. Original supplier IDs, old names and source foreign keys remain; old names stay searchable. The three groups had no supplier attachments. Carry missing 嘉文 contact, phone, primary supplies and notes to the canonical record without overwriting populated fields.
- For a new untouched invoice, choose the same supplier's most recently saved nonempty invoice classification, including confirmed aliases, then fall back to the supplier master. Invoice date no longer overrides save order. Custom and multiple tags remain supported; partial names do not select another supplier.
- Expose the existing receipt edit timestamp through the scoped reader. No new write permission or change to financial fingerprints. Previously saved invoice categories, manual choices and existing item classifications/amounts are preserved.

## Production database evidence

- Project: `qckwzwyeqpuqogbydvvl`; BeApe organization only.
- Applied migration: `20261019083624_receipt_category_history_time`; timestamp projection verified present, private reader still unavailable directly to authenticated callers.
- Cleanup recovery evidence remains private under `screenshot-followup-20261019-1627` and `screenshot-followup-20261019-1627-details` in `private.supplier_name_cleanup_audits`.
- In the cleanup transaction, checksums confirmed receipt headers/lines/corrections, original-photo metadata, OCR, products and other organizations were unchanged. Supplier row count remained unchanged.
- Readback confirmed exactly one selectable supplier for each canonical name, all aliases present, food classification retained, and 嘉文 contact/phone present.

## Validation

- 55 focused category/editor tests passed, including save-and-next, entering old invoices, canonical aliases, async arrival, manual classification, prices and retry preservation.
- Isolated rollback SQL fixtures passed for invoice category persistence/timestamps, amount preservation, denied roles/cross-store access, retry replay, canonical supplier lookup and preservation of original IDs/OCR.
- Typecheck and source contract passed. Lint: zero errors, 29 existing warnings.
- Full tests require generated build assets; run them after building the exact release commit. Publish only after build/tests pass and verify that exact SHA and asset graph on the original BeApe URL.
- Security advisor review showed no finding on the changed private reader. Existing project-wide informational/private-RLS and public guarded-RPC notices and the existing leaked-password-protection warning were outside this change; no permissions were broadened.

## Recovery

Revert the frontend commit if needed. The additive timestamp can remain harmlessly. Supplier source rows remain intact; recovery of canonical links/details must use the private before-state audit and compare current values before applying it, so subsequent staff edits are not overwritten.
