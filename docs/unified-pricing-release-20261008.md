# Unified pricing and editing release — database verified

Target: existing `rockru4211-lang/pantryflow` `beape` application and existing `beape-ops` Worker. Do not modify `main` or deploy to Sites.

## Requested behavior

- Confirm standard prices once in the ingredient price table, with an effective date and change reason. New invoice prices remain candidates until confirmed.
- Keep actual receipt prices and existing transaction/recipe snapshots. New inventory, transfer and waste operations share the confirmed standard and package conversion rules.
- Distinguish quantity units from purchase-price units. Preserve purchase/package evidence with saved operations; unresolved conversions remain blank.
- Keep edit controls left, new/import/export controls right, and save/cancel at the bottom of shared operations. Show formal/draft tabs; place removed/test records under More.
- Save drafts by account, store, module and month. Use compare-and-swap to reject stale device overwrites.
- Preserve supplier stop/restore history and existing aliases. Add detailed waste reason choices while retaining historic reason values.

## Validation and production database

- TypeScript and source-contract validation passed (249 migrations).
- 77 focused tests passed: conversion, incomplete prices, draft retries, ingredient-price UI, inventory costs and locked recipe costs.
- Production migrations applied with explicit user approval: `unified_standard_prices_and_drafts` (server version `20261008043213`) and `unified_sheet_price_basis_guards` (`20261008043729`). Local filenames retain their CLI creation timestamps.
- Both migrations ran inside atomic preservation gates. All 371 previously priced product/store entries retained their exact numeric quotes. Digests of recipe cards/versions/approvals, price entries, movements, waste records/reviews, inventory closures/reviews/adjustments, ingredient masters and aliases remained unchanged.
- Isolated rollback fixtures passed: effective dates, kg/g/台斤 conversion, no automatic invoice adoption, cloud draft module/month isolation, stale-device rejection, anonymous/outsider denial, idempotent retries, supplier stop/restore history, explicit incomplete package prices remaining NULL, and cents rounding on new waste writes.
- Standard baseline/version and cloud draft tables have RLS enabled and no direct client grants. Existing reviewed package mappings are frozen at cutover; subsequent explicit standard changes use reviewed conversion evidence.
- Full source lint passed with 0 errors (26 existing warnings). Exact-commit build remains a release gate. Publish the verified commit via the existing `beape` workflow, then call `verifyProduction` with the original Worker URL and that exact SHA. Deployment is complete only when the served SHA and linked JS/CSS/PDF assets pass.

Future-dated price scheduling is not enabled; the editor accepts today or a past effective date. Existing saved transactions and recipe locks are preserved. Incomplete package conversion is left unpriced until the user supplies the missing content details.
