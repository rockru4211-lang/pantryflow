# Purchase-unit pricing — 2026-10-06

The ingredient master now retains purchase packaging alongside normalized costs. Catalog rows show purchased-unit prices, optional content quantities, and a compact source/date line. Incomplete purchase units/conversions remain saveable. Explicit 1,000g/ml source prices display per kg/litre; package types are never invented from ambiguous names.

Recipe rows show purchase prices and saved line costs together. Price and conversion details are collapsed. The usage-total input can switch from an incompatible purchase unit to the actual usage unit. Pending conversions retain a saved amount when the ingredient identity and usage remain comparable; absent amounts remain pending, not zero. New quotes do not approve saved recipe costs. Existing cost review remains the explicit confirmation path.

Database: ingredient_purchase_units applied to qckwzwyeqpuqogbydvvl (production migration version 20261006031117). Adds nullable private master purchase JSON, retains it through ingredient and recipe-price writes, returns original package/source metadata. Existing role guards, revision checks, idempotency and audit records remain. No existing rows were backfilled or rewritten.

Validation: typecheck, lint (existing warnings only), 103 ingredient/recipe tests. Isolated rollback SQL fixture covers half-bottle cost, missing conversion, 100g conversion, package roundtrip, recipe-price edit, saved recipe preservation, retry, cross-store/staff/anonymous denial. Production data hashes before/after match for all 15 recipe cards, 98 versions and 3,780 existing ingredient records. Security advisors contain existing private-table policy notices and unrelated public-RPC/auth warnings; this change adds no public callable functions or grants.

The future reconciled-receipt-first workflow remains indicated as future. This release does not change existing saved costs or automatically accept newly reconciled prices.
