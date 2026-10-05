# Saved recipe costs and confirmation

The recipe screen formerly recalculated costs from the latest ingredient prices on every read. It now retains saved version snapshots and presents current prices separately for review.

- Restored the exact latest saved snapshots for 15 existing recipe/preparation cards: 5 complete costs and 10 partial records. No historical recipe, price or receipt rows were rewritten.
- Added private, append-only cost approvals with administrative confirmation, optimistic revision/approval checks, a server-generated proposal token and idempotent request replay. The token prevents accepting a price or nested preparation that changed since review without relying on rounded browser numeric values.
- Saved line costs (including nested preparations and missing amounts) remain fixed across price changes. Editing quantity uses the retained unit cost; replacing an ingredient computes an unconfirmed draft. Initial or updated costs are approved explicitly after saving/reloading the recipe.
- The review panel lists recipes and preparations, old/new line amounts, total difference and prior approval dates. A complete proposal is required before confirmation. Keeping the original cost does not modify data.
- Restored partial snapshots are not represented as fully calculated costs. Missing items remain pending until the user completes and confirms the proposal.

Validation: 84 recipe tests, typecheck, lint (existing warnings only), source contract check; rollback-only SQL fixtures covering confirmation, price-change preservation, old-version preservation, stale proposal rejection, autosave isolation, retry idempotency, owner access, supervisor/outsider/anonymous denial. Production migration `20261005033732_recipe_cost_confirmation` applied; all 15 restored snapshots exactly match original version documents and costs.
