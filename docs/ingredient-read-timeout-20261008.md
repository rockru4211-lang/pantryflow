# Ingredient read timeout fix

Scope: 百花猿 / `beape`, existing Cloudflare Worker. No pricing policy, data consolidation, receiving, inventory or recipe-cost presentation changes.

## Cause and changes

The ingredient catalog could rebuild every alias JSON aggregate for every master. The isolated 1,801-master plan showed 1,801 aggregate loops. Materialize the alias aggregation once. The supply read also scanned every source for every master; group references once and join them, explicitly preserving catalog order. All authorization checks, sources, supplier identity, history and price values remain in the response.

The browser now coalesces overlapping focus/timer reads, skips background polling while hidden, and throttles automatic refresh. A read requested after a write waits for any older read before fetching the committed revision. Reads have a bounded deadline. Read errors retain the last catalog and edits; an initial failure does not display a misleading zero count. A successful write followed by a failed refresh is reported as saved with a synchronization warning, not a failed write.

## Validation

- Production migration `20261008143932_ingredient_supply_read_grouping` applied with an isolated, automatically rolled-back fixture in the same migration transaction.
- Fixture covers owner/outsider/anonymous permissions, stop/restore and confirmation idempotency, stale revisions, saved-price protection, source deduplication, supplier identity, price history, catalog ordering and 1,801 ingredients.
- Isolated full read: about 9.9 s before, 0.65 s after; catalog portion 7.8 s before, 0.28 s after. These are database fixture timings, not browser/network timings.
- All 4,039 existing master records retain their exact pre-migration row fingerprint.
- Frontend regression checks cover concurrent reads, post-write freshness, retry after failure, successful save followed by a failed refresh, and no zero count on initial read failure.

The broader recipe wildcard run exposed three existing failures in unchanged recipe tests (`recipe-drafts` module resolution and two `recipe-editor` UI expectations). They are outside this patch; the deployment regression set and all new read tests pass.

Rollback: restore the previous definitions of `private.ingredient_catalog(uuid)` and `private.ingredient_supply_read(uuid)` from their preceding migrations; no data migration is needed. Revert the frontend commit on `beape` if necessary.
