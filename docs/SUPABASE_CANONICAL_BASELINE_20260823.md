# PF-SUPABASE-CANONICAL-BASELINE-20260823

## Scope and safety result

- Source main SHA: `ddedcdcc6e4876fd6d57442e975718ba633a6aaa`.
- Production project was accessed with metadata APIs and read-only SQL only.
- No production schema, row, RLS, migration history, secret or Edge Function was changed.
- Existing `supabase/migrations/` files remain byte-identical.
- The baseline contains schema definitions only; it contains no Auth email, password, session, receipt image or business row data.

## Captured canonical sources

- 18 production-applied migration statements with exact production version, name and SQL SHA-256.
- One blank-only prerequisite for `public.rls_auto_enable()` and the `ensure_rls` event trigger. Production migration `20260820155258` references this object, but production migration history does not contain its creation; the prerequisite is therefore a separately fingerprinted prehistory reconstruction and is prohibited from production.
- Structural fingerprint: `77ba52f81d42c02c1feb9aaa6c9c1b3e782e109be45970d7d27590fcb5d04561`.
- 34 public/private tables, 356 columns, 197 constraints, 68 RLS policies, 34 RPC/helper functions and 26 triggers.
- Four complete production Edge Function packages:

| Function | Production version | `verify_jwt` | Production package fingerprint |
| --- | ---: | --- | --- |
| `process-receipt-ocr` | 11 | true | `80731e7201f59005a6945f46136130c3119056af93f01ce8028f80d926c1f240` |
| `enqueue-receipt-ocr` | 1 | true | `be39e4ed1e76b15be53c9fa404e1379fe69a8586d8780feb449f602996d8fea6` |
| `manage-staff` | 2 | true | `d05edd9d2b5f683ef5c9c4f1f56dd24a643e8114b7445b7da48d037c209233d8` |
| `staff-pin-login` | 1 | false | `bddefeda405b86c4e23fe44a88a597a31745b2d7a8577c8d6f33ce386b65a1be` |

`staff-pin-login` intentionally has `verify_jwt=false` in production because it performs its own PIN verification and session exchange. This baseline records that state; it does not approve or redeploy it.

## Blank local rebuild and diff

The repository currently has no local Docker-compatible runtime, so the reproducible blank-stack test runs in the PR's isolated GitHub Actions runner. It uses no Supabase access token or production secret.

The workflow must produce:

- successful replay of all 18 production-applied statements into a blank local Supabase stack;
- matching structural fingerprint;
- zero missing, unexpected or changed tables, columns, constraints, indexes, policies, functions and triggers;
- uploaded `local-supabase-fingerprint.json` and `supabase-baseline-diff.json` artifacts.

The first isolated replay exposed a concrete production-history gap: migration `20260820155258_harden_rls_helper_permissions` revokes permissions from `public.rls_auto_enable()`, although no retained production migration creates it. Read-only inspection confirmed the current production function and `ensure_rls` event trigger. They are captured under `blank-prerequisites/`, run before the 18 immutable snapshots, and are never production deployment input.

Until the updated workflow completes successfully, blank-environment reconstruction remains **PENDING**, not passed.

## Known remaining risks

1. The seven legacy files remain under `supabase/migrations/` by explicit instruction. A normal linked `db push` can misclassify their version numbers; it remains prohibited.
2. Edge Function package fingerprints come from production metadata. The snapshot preserves every returned source file, but no deployment has been attempted to prove a byte-identical rebuilt bundle.
3. Schema fingerprinting deliberately excludes production rows and Auth identities. It proves structure, not OWNER/ADMIN data completeness or login behavior.
4. The production and current local Supabase image may use different PostgreSQL/Supabase platform versions. Any definition normalization difference must remain visible in the diff report and may not be waived silently.
5. `rls_auto_enable` predates the retained production migration ledger. Its current production definition is recoverable, but its original creation SHA/date is not; the manifest preserves this provenance limitation explicitly.
