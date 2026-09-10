# 序｜餐飲庫存管理

The full restaurant application uses the approved shell and real Supabase Auth, storage and operations. Independent restaurants and chains each support staff, supervisors, backoffice/area supervisors and owners within their assigned stores.

- Application: https://pantryflow-app-shell-preview.rockru4211.chatgpt.site/
- Canonical repository: https://github.com/rockru4211-lang/pantryflow — `main`
- Frontend: `app/`, `lib/`; backend: `supabase/`
- Sites deployment mirror: the repository bound to `.openai/hosting.json`; push the exact same commit as GitHub `main`.
- Backend: Beta `qckwzwyeqpuqogbydvvl`; contract and publication checks: `release-source.json`.
- Previous deployed rollback baseline: v97, `7bff342433781e05841e2eba6813d07ea67d7d2f`. Data migrations are additive; rollback does not reset operational data.

## Development and verification

Use Node >=22.13, `npm ci`, then `npm run dev`. Local `.env.local` contains only the Supabase URL/publishable key and public build metadata. Secrets stay in Supabase/Sites settings.

Run `npm run typecheck`, `npm test`, `npm run lint`, `npm run verify:source` and `npm run build`. New database changes require the SQL regression fixtures under `tests/sql/` against a safe rollback transaction or a clean local database. GitHub CI also resets and verifies the full migration chain.

For release, review and merge the current full-app changes into GitHub `main`, push the same SHA to Sites `main`, run `npm run verify:release`, then build with that exact SHA and publish through Sites. Save the commit, schema migration, Site version and deployment result in the release acceptance record. Never copy an older GitHub tree over a newer verified Sites version.

`legacy-redirect/` preserves old GitHub Pages bookmarks without maintaining another application or login. The Pages workflow publishes only that redirect. Existing historical branches and commits remain available.

## Trial evidence and limitations

See `docs/launch-closeout-20260910.md`. Operational attempts contain only allowlisted metadata and safe error codes, linked to existing audit records, OCR runs and count sessions. Trial enrollment is explicit, and QA is excluded. Seven days starts at each enrolled store's first real operation; historical QA cannot supply a trial success rate. Product operators can use `scripts/trial-report.sql` through their authorized Supabase access; there is no new merchant dashboard or payment integration.

Verified management Email/password and activated staff PIN are available. Google provider enablement and actual Gmail confirmation/recovery round trips must be reported separately from API success. Password policy is minimum 8, recommendation 10+, with local advice and no third-party scoring.
