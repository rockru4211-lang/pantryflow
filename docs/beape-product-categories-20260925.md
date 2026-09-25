# 百花猿品項分類 — 2026-09-25

Target: canonical `beape` branch, existing `beape-ops` Worker and Supabase `qckwzwyeqpuqogbydvvl`.

Supplier and inventory screens now share 食材、耗材、調料、酒水 plus 待分類 and 全部 filters. Supplier categories derive from supplied product identities and may contain multiple categories; the selected category also scopes item counts and price-change indicators. No monthly spending or last-arrival card is added to suppliers.

Inventory category filtering intersects search, storage zone and review status without splitting a product's aggregate quantities. Category cards and the amount tab use the category scope. Full-month confirmation still checks the complete month, regardless of the selected category. Export remains explicitly the full inventory table.

A conservative server classifier supplies categories for known names and existing canonical classifications. Ambiguous names, cooking/drinking wine and unmapped receipt items remain 待分類. Consumable packaging and wine vinegar take precedence over ingredient words. Classifier rules are transparent and deterministic; this is not an AI confidence guarantee. Future imported products use the same rules on read.

Manual changes are saved once per organization product in a private override table, with role checks, compare-and-swap revisions, idempotent request keys and audit history. Inventory row selectors, supplier item selectors and the existing product edit form use the same category. Failed writes retain the proposed selection and expose retry; writes use bounded operation deadlines. Category metadata does not alter original import categories, receipt rows, count quantities, prices, review signatures or closed inventory payloads. Historical screens display the current product classification while preserving saved figures.

Validation:

- TypeScript and targeted ESLint pass. Fourteen category, inventory and supplier-price tests pass.
- Browser tests exercise real components with fixture APIs: multi-category supplier, pending empty supplier, category/zone intersections, cross-page saves, scoped totals, full-month close protection, error retention/retry, amount tab and mobile overflow. Desktop/mobile screenshots inspected.
- SQL rollback fixtures executed against production: owner/logistics success; supervisor/staff and chain-mode denial; cross-organization denial; anonymous and downgraded cached-request denial; repeat-request idempotency; stale revision and invalid category denial; shared reads and atomic product-form saves; classifier edge cases; preserved receipt and closure fingerprints.
- Applied migration versions: `20260925021842` and `20260925022255`; source inventory 145 migrations.
- Full lint still reports the unrelated existing effect-state error at `partners-stores-workspace.tsx:61` and 19 existing warnings. No new target-file lint errors.
- Security advisors: the new private table intentionally has RLS with no direct-access policies, revoked client privileges and access through existing checked RPCs. Existing security-definer/leaked-password warnings are unchanged. Reference: https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy

Browser testing uses fixtures, not an authenticated production-user walkthrough. Deployment must verify the exact served commit and linked assets with the existing production verifier.
