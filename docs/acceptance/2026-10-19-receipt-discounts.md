# Receipt discounts

- Entry point: existing More menu → discount settings; hidden by default.
- Original tax-exclusive unit price stays editable. Percent or per-line tax-exclusive amount computes net subtotal; freight/custody skipped by bulk apply. Individual freight can still be adjusted explicitly.
- Save effective unit price and subtotal for downstream cost/history/accounting, with structured original-price/discount metadata. Reopening restores the original-price editor without applying twice. Notes and source evidence stay intact.
- Existing inclusive-price converter remains available; tax and printed total remain explicit, preserving existing rounding behavior.
- Invalid/excessive discounts rejected. Partial missing prices remain nullable. Discounted subtotal is calculated rather than independently editable.
- Legacy clients preserve discount metadata on non-price edits and clear it when effective prices change.
- Production migration: receipt_line_discounts, applied and verified using transaction-rollback fixtures. Covers authenticated role, staff/cross-store denial, retry idempotency, invalid-save rollback, source OCR preservation, old clients and new structural rows.
- No production receipt data was changed during validation. Security review retains existing scoped RPC guards; private helper has no client execute grants. Existing advisor findings (private RLS without policies, scoped definer RPCs, password protection setting) are unchanged.
- Verification: typecheck; lint (29 pre-existing warnings); 243 receipt tests; full build/test and source/production release checks.
