# 序 — current application and release rules

- Canonical source: `rockru4211-lang/pantryflow`, `main`. Work on the current full application under `app/` and `lib/`; Supabase migrations/functions live under `supabase/`.
- Production is Cloudflare at `https://pantryflow.rockru4211.workers.dev/`, sourced from GitHub `main`. Do not create, publish or maintain previews or a Sites mirror. Historical Sites files remain recovery evidence only.
- The September 22, 2026 launch scope is inventory counts, receiving, borrowing/lending and transfers. Prioritize completion, retry safety and traceable records; defer additional features and shell redesign.
- Preserve the approved shell, eight identities, role checks, source files and historical operations. Latest accepted Notion decisions and explicit user instructions govern scope. Do not revive the historical `pilot-v1` frontend.
- Never commit credentials, signed private-file URLs, QA access files, local build output or `.env.local`. Password advice is local only; staff PIN rules are independent.
- Run typecheck, relevant tests, lint and build. Schema changes also require role/denial/idempotency regression and preservation checks. `npm run verify:source` checks the release contract; `npm run verify:release` additionally requires a clean tree and exact pushed SHA in canonical GitHub main. Confirm Cloudflare deployment separately.
- Build with `NEXT_PUBLIC_BUILD_SHA` equal to the verified source commit. Save and deploy that same commit to the existing original URL. Publication remains subject to the user's scope and authorization.
- Old GitHub Pages contains only a redirect to Cloudflare. Its workflow must never publish application code. Keep old branches/history as recovery evidence; do not force-push or delete unreviewed work.
