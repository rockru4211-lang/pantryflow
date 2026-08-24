# Supabase migration ledger — 2026-08-23

This ledger separates production history from legacy filenames currently retained under `supabase/migrations/`. Nothing in this document authorizes a production migration or migration-history repair.

## Production-applied history

| Production version | Name | Source in canonical baseline | State |
| --- | --- | --- | --- |
| `20260820155238` | `pilot_v01_core_schema` | `supabase/baseline/production-applied/20260820155238_pilot_v01_core_schema.sql` | Already applied; never reapply to production |
| `20260820155258` | `harden_rls_helper_permissions` | `supabase/baseline/production-applied/20260820155258_harden_rls_helper_permissions.sql` | Already applied; never reapply to production |
| `20260821040206` | `repair_legacy_table_columns` | `supabase/baseline/production-applied/20260821040206_repair_legacy_table_columns.sql` | Already applied; never reapply to production |
| `20260821040539` | `complete_pilot_v01_schema` | `supabase/baseline/production-applied/20260821040539_complete_pilot_v01_schema.sql` | Already applied; never reapply to production |
| `20260821040603` | `repair_seed_conflict_indexes` | `supabase/baseline/production-applied/20260821040603_repair_seed_conflict_indexes.sql` | Already applied; never reapply to production |
| `20260821040649` | `harden_pilot_helper_functions` | `supabase/baseline/production-applied/20260821040649_harden_pilot_helper_functions.sql` | Already applied; never reapply to production |
| `20260821061154` | `pilot_self_service_onboarding` | `supabase/baseline/production-applied/20260821061154_pilot_self_service_onboarding.sql` | Already applied; never reapply to production |
| `20260821101514` | `real_receipt_ocr_pipeline` | `supabase/baseline/production-applied/20260821101514_real_receipt_ocr_pipeline.sql` | Already applied; never reapply to production |
| `20260821101809` | `harden_receipt_finalization` | `supabase/baseline/production-applied/20260821101809_harden_receipt_finalization.sql` | Already applied; never reapply to production |
| `20260821150409` | `allocate_receipt_ocr_run_version` | `supabase/baseline/production-applied/20260821150409_allocate_receipt_ocr_run_version.sql` | Already applied; never reapply to production |
| `20260822142659` | `daily_receipt_workbench_queue` | `supabase/baseline/production-applied/20260822142659_daily_receipt_workbench_queue.sql` | Already applied; never reapply to production |
| `20260822142701` | `controlled_pilot_catalog_count_lots` | `supabase/baseline/production-applied/20260822142701_controlled_pilot_catalog_count_lots.sql` | Already applied; never reapply to production |
| `20260822142832` | `harden_controlled_pilot_functions` | `supabase/baseline/production-applied/20260822142832_harden_controlled_pilot_functions.sql` | Already applied; never reapply to production |
| `20260822145005` | `fix_count_actor_profile_relationships` | `supabase/baseline/production-applied/20260822145005_fix_count_actor_profile_relationships.sql` | Already applied; never reapply to production |
| `20260822154229` | `store_staff_pin_identity` | `supabase/baseline/production-applied/20260822154229_store_staff_pin_identity.sql` | Already applied; never reapply to production |
| `20260822162954` | `enforce_store_isolation` | `supabase/baseline/production-applied/20260822162954_enforce_store_isolation.sql` | Already applied; never reapply to production |
| `20260823001757` | `owner_business_onboarding` | `supabase/baseline/production-applied/20260823001757_owner_business_onboarding.sql` | Already applied; never reapply to production |
| `20260823133159` | `single_store_operational_slice` | `supabase/baseline/production-applied/20260823133159_single_store_operational_slice.sql` | Already applied; never reapply to production |

## Legacy main ledger

The following existing files are retained without modification, deletion or rename. Their Git blob SHA and SQL SHA-256 are locked in `supabase/baseline/manifest.json`.

| Existing main file | Classification | Production action |
| --- | --- | --- |
| `202608200001_pilot_v01.sql` | Legacy combined/incorrect version history | Never infer as pending; do not push |
| `202608210001_repair_seed_conflict_indexes.sql` | SQL already represented by production version `20260821040603` | Never infer as pending; do not push |
| `202608210002_repair_legacy_table_columns.sql` | SQL already represented by production version `20260821040206` | Never infer as pending; do not push |
| `20260821060423_pilot_self_service_onboarding.sql` | Same purpose as production `20260821061154`, different SQL hash | Never infer as pending; do not push |
| `20260821101514_real_receipt_ocr_pipeline.sql` | Exact production version/source | Already applied |
| `20260821101809_harden_receipt_finalization.sql` | Exact production version/source | Already applied |
| `20260821142316_allocate_receipt_ocr_run_version.sql` | SQL represented by production version `20260821150409` | Never infer as pending; do not push |

`supabase db push` and `supabase migration repair` remain prohibited until a separately approved release process can prove that the CLI will not interpret legacy filenames as production work.
