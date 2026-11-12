# Automatic receipt costs and separate recipe trials

## Scope

Confirmed receipt entry supplies effective, date-scoped costs without waiting for financial reconciliation. Ingredient current prices, new waste and transfers, open inventory and recipe latest-cost trials share the same strict identity/unit/source rules. Original purchase price, purchase unit and specification remain separate from normalized recipe-unit costs. Missing or conflicting evidence remains missing, never zero or an inferred conversion.

Recipe approved pricing baselines and saved history are not replaced. The directory and detail dialog show latest trial, amount difference and percentage separately. Existing ingredient edible-yield, preparation yield and serving quantities remain authoritative; no note-based loss inference, tolerance or new loss model was added. Existing manual overrides and saved operations stay fixed.

Future automatic inventory report-unit changes preserve automatic pricing after exact quote/CAS validation. A manual price edit still opts into a fixed override. No existing review, baseline, transaction, closure or mobile draft is backfilled.

## Recovery and publication order

This release was reconstructed on canonical `beape` commit `94a78b745844bd08237df1e67fa01ba71cc2df63` after the previous local worktree became unavailable. The eight 20261111 migration files were recovered from deployed migration statements and their original SHA256 values verified. Frontend and fixtures were reconstructed and tested afresh, not assumed identical to lost commits. The release then integrates supplier-category commit `68c783e7f7fcfaab58bfa6114fc1b16c0a778e1a`; its category filter and test harness are retained alongside quote invalidation. Parallel contract and navigation changes are retained.

The eight 20261111 migrations are already present in production under server-generated history versions. Do not blindly reapply them or run an unreviewed bulk `db push`. Their last migration intentionally preserves the legacy public mobile endpoints until publication.

1. Publish the tested frontend commit on `beape` through the existing Cloudflare workflow.
2. Verify exact production SHA and complete JavaScript/CSS/PDF asset graph at the original BeApe URL.
3. Apply only `activate_mobile_receipt_cost_trials` and `preserve_automatic_inventory_report_units`, with pre-change function-hash checks and transaction-local before/after row digests for 21 protected tables. Abort atomically on drift or row changes.
4. Verify authenticated read paths, role denials, unchanged protected rows, function ACLs and advisor deltas. Do not create test drafts or operations in production.

Rollback preparation retains exact pre-change function definitions and ACLs outside the repository. Restoring endpoint definitions must not modify user records. Existing mobile drafts retain their saved evidence; refresh prices explicitly before saving a legacy draft under the new guard.

## Verification

Fresh source validation covers typecheck, full application tests, full lint, exact-commit build and source contract. Browser QA covers baseline/latest/difference, raw price versus unit conversion, missing values, nested explanations, modal dismissal/reopening and narrow desktop overflow.

Isolated SQL fixtures cover scalar/cache quote parity (896 matrix cases plus state variations), exact identity/store/date/supplier, unit/spec conflicts, missing/zero, read authorization, stale save evidence, idempotency, existing loss arithmetic, mobile saves and legacy behavior, live inventory report-unit conversion, manual overrides and closed/history preservation.

The isolated harness uses a pinned PostgreSQL-compatible PGlite package, minimal service stubs and exact read-only current-production function/view/cache definitions before pending migrations. It is current-schema integration validation, not proof of a clean historical replay or a full Supabase service stack. No production data is copied into fixtures. Security-advisor preexisting warnings are tracked rather than represented as a clean audit.
