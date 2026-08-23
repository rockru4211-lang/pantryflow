# PantryFlow Supabase canonical baseline

Baseline ID: `PF-SUPABASE-CANONICAL-BASELINE-20260823`

This directory preserves the schema and Edge Function definitions observed in production on 2026-08-23. It exists to rebuild and compare a **new blank local Supabase stack**. It is not a set of pending production migrations and must never be passed to `supabase db push` against production.

## Authority and state

- `production-applied/`: immutable copies of the 18 SQL statements already recorded in production migration history. Every entry is `already-applied-production` and `future_apply: false` in `manifest.json`.
- `production-schema-fingerprint.json`: production structural snapshot and SHA-256 covering public/private tables, columns, constraints, indexes, RLS, RPC/helper definitions and triggers. It contains no row data, Auth email, token or secret.
- `edge-functions/`: complete source packages returned by the production Function metadata API, plus deployed version, `verify_jwt` and package fingerprint.
- `manifest.json`: machine-readable authority boundary. `future_migrations` is intentionally empty.
- `verify/`: SQL used to fingerprint an isolated rebuilt database.

The seven files under `supabase/migrations/` remain byte-for-byte unchanged because release governance forbids deleting, renaming or rewriting them. They are classified in `manifest.json` as `legacy-main-ledger` and `apply_to_production: false`. Their presence must not be interpreted as pending production work.

## Blank-environment rebuild

The PR workflow starts a Docker-backed local Supabase stack in a temporary directory that contains no repository migrations or seed. It then:

1. replays `production-applied/*.sql` in production order;
2. generates a structural fingerprint with `verify/schema_fingerprint.sql`;
3. compares every table, column, constraint, index, RLS policy, RPC/helper and trigger with the production snapshot;
4. uploads the local fingerprint and detailed diff as a workflow artifact;
5. stops and removes the temporary local stack.

No step links to a remote project, uses production credentials, calls `db push`, repairs migration history or deploys a Function.

## Future migrations

Future schema work must be created separately after this baseline is accepted. A future migration is not production-applied until a protected main-bound deployment records its exact version, SQL SHA-256, Git SHA and workflow run. Never place proposed SQL under `production-applied/`.
