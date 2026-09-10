# 序 — current application and release rules

- Canonical source: `rockru4211-lang/pantryflow`, `main`. Work on the current full application under `app/` and `lib/`; Supabase migrations/functions live under `supabase/`.
- The Sites repository is the deployment mirror, not an alternate product branch. Both repositories must contain the exact release SHA. `.openai/hosting.json` selects the existing Site; never create a second Site.
- Preserve the approved shell, eight identities, role checks, source files and historical operations. Latest accepted Notion decisions and explicit user instructions govern scope. Do not revive the historical `pilot-v1` frontend.
- Never commit credentials, signed private-file URLs, QA access files, local build output or `.env.local`. Password advice is local only; staff PIN rules are independent.
- Run typecheck, relevant tests, lint and build. Schema changes also require role/denial/idempotency regression and preservation checks. `npm run verify:source` checks the release contract; `npm run verify:release` additionally requires a clean tree and exact pushed SHA in both repositories.
- Build with `NEXT_PUBLIC_BUILD_SHA` equal to the verified source commit. Save and deploy that same commit to the existing original URL. Publication remains subject to the user's scope and authorization.
- Old GitHub Pages contains only a redirect to Sites. Its workflow must never publish application code. Keep old branches/history as recovery evidence; do not force-push or delete unreviewed work.
