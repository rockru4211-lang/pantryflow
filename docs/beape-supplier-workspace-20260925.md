# 百花猿供應商定案更新 — 2026-09-25

Target: `beape`, `beape-ops.rockru4211.workers.dev`, Supabase `qckwzwyeqpuqogbydvvl`.

## Scope

Supplier entry now opens the supplier directory directly, with supplied items, price changes and ordering shortcuts. Monthly purchase totals and last delivery are kept in receiving. Detail has exactly two tabs: 品項與進價 and 聯絡與叫貨資料.

Authorized users can create/edit supplier contacts, ordering links/methods, cutoffs, delivery notes and aliases, and add supplier products. Existing catalog editing remains the product edit path. Pending OCR corrections return to the original receiving document; published records retain their existing immutable behavior. Changing contact metadata never rewrites receipt rows.

Price comparisons use two distinct confirmed invoices for the same mapped product, specification and unit. Unknown prices and dates are excluded, explicit zero is preserved, and conflicting prices within an invoice require inspection. Test/removed records are excluded; failure to read flags prevents price reporting. Supplier renames retain old invoice names as aliases; ambiguous aliases are not silently merged. Supplier invoice navigation includes aliases, and ordinary receiving navigation resets that filter.

## Verification

- TypeScript passes; supplier price and receiving tests: 37/37.
- Browser fixtures exercise the actual supplier and receiving components: directory, two tabs, history/source correction and catalog routing, alias-filtered ledger, add supplier/product, edit conflict retention/retry, read-only/failed-price states and desktop/mobile layout.
- Targeted ESLint has zero errors (12 existing receiving unused-variable warnings). Full lint retains the pre-existing `partners-stores-workspace.tsx:61` effect-state error and unrelated warnings.
- Production migration `20260925014257_baihuayuan_supplier_contacts` applied and verified in migration history. Source inventory: 143 migrations.
- Isolated SQL transaction in production passed then rolled back: two business modes × four roles, unauthenticated/direct-table/cross-organization denial, contact read/write, stale revision denial, idempotent retry, unsafe URL denial, old-client field preservation, rename aliases, audit fields, downgraded cached replay denial, and receipt fingerprint preservation. No user business records were changed by tests.
- Existing Supabase advisor findings remain outside this change; private supplier details use RLS plus revoked direct access and role-checked existing RPCs. No new public RPC was introduced.

Browser tests use fixture data; they do not claim an authenticated production-user walkthrough. Production release SHA and linked assets must pass the repository production verifier after deployment.
