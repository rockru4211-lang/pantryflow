# Historical opening balances and supplier month comparison

Keep the existing inventory and supplier layouts. Inventory's previous quantity heading is 期初. The month selector reads completed native sessions or retained historical month sources, without creating native count entries. A previous confirmed monthly closure takes precedence over an imported previous-month source. Unconfirmed native counts are not used as an opening balance.

Historical originals remain immutable in private.historical_source_records. Exact name/approved alias plus unit must identify one organization product before a link is recorded. Duplicate historical product/unit rows and quantity, unit, mixed-package, custody, cross-store or re-count issues cannot supply a quantity. Price-only issues do not block quantity. Missing quantities and prices are never zero. No historical price is inferred for stock valuation; entirely unpriced subtotals and incomplete whole-period comparisons are null.

Inventory source references include original filename, row locator and values. Historical months are read/export only. New month confirmations continue to store native immutable monthly closures for subsequent opening balances.

Supplier and price-report views use the same month comparison function: latest valid dated observation within the selected month versus the immediately preceding month, for one supplier/product/spec/unit and tax basis. Same-day conflicting prices cannot imply ordering by upload time. Historical prices without tax evidence are labeled reference prices and cannot produce a change percentage. Historical source links open provenance, not fake receipt IDs. Existing verified native receipts, product prices and physical counts are untouched.

Validation: typecheck, relevant Node tests, targeted ESLint and production build; rollback SQL fixtures for roles, foreign store denial, loading imports, retry preservation, null/zero, historical read-only behavior and field-specific eligibility. Full lint retains the pre-existing partners-stores-workspace effect error and unrelated warnings.
