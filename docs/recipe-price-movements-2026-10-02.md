# Independent ingredient prices and receiving movements

The ingredient register now has its own sidebar and mobile Other entry. Recipe editing links to this page without showing recipe tabs or import banners on the register. Existing price forms and permissions are retained.

The main table shows supplier, package, raw quote, effective recipe cost, comparable price movement, and price date. Phone layout keeps ingredient, effective cost and edit visible; other information is in the item form. Historical and manual sources remain labelled. Estimates never become receipt prices.

Completed receiving entries refresh recipe costs through the existing workspace, every 30 seconds and on focus. Confirmed product aliases and supplier-specific package conversions follow later receipts. An optional receiving-product match in the price form keeps the original recipe name and quantities intact. Matches are validated against the store organization. Unknown matches remain manual/historical; they are never guessed.

Price movements use the previous confirmed purchase event for the same ingredient, normalized unit, supplier and recorded package. A window calculation deduplicates raw/converted representations of one receipt, avoiding repeated historical scans. Unknown supplier, unknown prior price, different package and historical recipe estimates produce no comparison. Zero previous prices do not produce infinite percentages.

A newly recorded package specification that does not match its approved conversion retains the last usable cost and is flagged for conversion confirmation. Blank legacy receipt specifications still use previously approved conversions; an unrecorded packaging change cannot be inferred. Existing high estimates are preserved as a floor when a matched receipt rises or falls. No recipe document or stored cost snapshot is changed by receiving updates.

Validation: 64 related cost/editor/draft/register tests, TypeScript, lint, production build, source/release checks. Rollback-only SQL fixtures cover rising/falling receipts, nested recipe recalculation, high estimates, package mismatch, organization isolation, access denial, replay and historical snapshot preservation. UI form tests exercise searching/filtering, saving supplier/package matches, and guarding unsaved edits. Browser screenshot validation was unavailable because the environment could not download the Chromium runtime; no authenticated user session was used.
