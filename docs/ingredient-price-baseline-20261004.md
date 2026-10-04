# Three-workbook ingredient price baseline

Imported the supplied monthly procurement workbook and the BeApe / Gras recipe cost workbooks into the existing store-scoped price register. Sources comprise 48 monthly purchasing tabs and all 284 BeApe plus 92 Gras recipe/SOP tabs, including hidden historical tabs. Original Google workbooks were read only.

- Batch: `three-workbook-price-baseline-20261004-v1`
- BeApe: 2,514 new supplier/unit quotations (2,026 confirmed, 488 pending).
- Gras: 1,782 new supplier/unit quotations (1,466 confirmed, 316 pending).
- Total: 4,296 quotations, including 203 missing-price entries. A quotation is not a distinct ingredient; supplier, package and unit variants remain separate.
- Purchasing unit values and explicit package contents are normalized; mass and volume remain separate. Original blank prices never become confirmed zero-cost ingredients.
- Historical recipe formulas are checked against the raw quotation and usage expression. Ambiguous count/weight formulas, conflicting dimensions, future dates and unverified calculations remain pending.
- Existing confirmed name/unit prices are preserved; imported alternatives remain pending until reviewed. No inventory products, receipts, recipe quantities, store assignments or saved recipe cost versions were changed.
- Nonfood supplies and recipe yield/total instruction rows are excluded. Corrections to this import have dedicated audit records.

The recipe picker now includes named historical price-register ingredients even when no inventory product exists. It preserves the price key and unit when selected. Duplicate product names are not guessed. Pending quotations remain searchable but are not used in costing.

The price table displays 50 rows per page, searches every row, keeps the original historical denominator visible, and opens missing imported amounts as blank. The existing roles, pricing precedence and receipt-price linking rules are unchanged.

Validation: 62 focused recipe/cost/register tests passed; typecheck and production build passed; lint has no errors (23 pre-existing warnings). All imported purchase normalizations matched the server calculation. First-batch retry inserted zero rows and created zero additional audit records. No duplicate import keys or out-of-scope stores were found. Existing-price, recipe and saved-version hashes were unchanged.
