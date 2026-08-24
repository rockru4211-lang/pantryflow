# PF-EMPLOYEE-MANAGER-COUNT-FOUNDATION-20260824

## Release state

- Branch-only implementation. Do not deploy before review and migration approval.
- `20260824043544_employee_manager_count_foundation.sql` is **FUTURE-APPLY ONLY** and has not been applied to production.
- The formal Pages URL continues to represent `main`; this branch has no Pages preview by repository governance.
- No `localStorage` or demo-data fallback is permitted in the formal application.

## Closed loop

1. A manager maintains products and zone assignments.
2. A manager creates today's count with exactly one locked opening source.
3. Active staff memberships receive an assignment record for the task.
4. An employee selects the assigned task and zone, enters only current quantities, and completes the zone.
5. Completed zones lock. Differences are generated only after every zone is complete.
6. A manager selects a reason and opens a recorded recount; the original employee entries remain immutable.
7. The employee recounts the reopened zone. The new entries are linked as `RECOUNT` entries and the difference is recalculated.

## Supabase dependencies

Existing canonical tables used: `profiles`, `store_memberships`, `stores`, `products`,
`count_zones`, `zone_products`, `store_product_opening_balances`,
`inventory_count_sessions`, `count_zone_progress`, `count_drafts`, `count_entries`,
`inventory_count_discrepancies`, and `audit_logs`.

Future migration adds `inventory_count_task_assignments`,
`inventory_count_recount_events`, the locked `opening_source` and `task_date` columns,
and RPCs `import_count_catalog`, `set_manual_opening_balance`,
`create_count_session_with_source`, and `open_count_recount`. It replaces
`complete_pilot_count_zone` so assignment checks, recount entries, recalculation,
locking, and audit records are one transaction.

RLS permits employees to read their own task assignments. Managers can read store
assignments and create/read/update recount events. Security-definer RPCs re-check
active store membership and manager role or explicit task assignment.

## Verification boundary

JavaScript syntax, render behavior, import validation, migration markers, PostgreSQL
syntax parsing, responsive browser rendering, and console output are verified in the
feature branch. A real authenticated end-to-end write test cannot pass until the
future migration is explicitly approved and applied to a non-production Supabase
test project. Production remains unchanged.
