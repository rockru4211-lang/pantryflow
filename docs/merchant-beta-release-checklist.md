# Merchant beta release checklist

- Supabase **Confirm signup** Email template must display `{{ .Token }}` and must not use a confirmation link.
- Keep the canonical Site URL and allowed redirect URLs configured for password reset and future OAuth; signup OTP does not depend on redirects.
- Supabase's built-in SMTP is suitable only for limited project-team testing. Configure and verify a custom SMTP provider before onboarding multiple merchants or treating email delivery as production-ready.
- Do not enable a Service Worker, offline asset cache, or push notifications for the current launch scope. The user has stopped previews.

## Import and production regression gates

- Before merging, verify first import, multiple files, partial success and retry, removal/re-import idempotency, store isolation, manual deactivation and historical count/value preservation. Run the SQL fixtures against all migrations in CI; production fixtures must use isolated rollback data.
- Recognition that already succeeded should be reused for a save retry within the current page. Do not automatically retry paid OCR or claim that in-memory recovery survives a reload.
- Apply and verify required migrations on the actual production project; clean CI database success alone is insufficient.
- Use the canonical main commit at the existing Cloudflare Workers URL from `release-source.json`. Run `npm run verify:release` on a clean exact-main checkout and build with that SHA.
- After publication, run `EXPECTED_BUILD_SHA=<full main SHA> npm run verify:production`. The main workflow also checks this after its complete database/frontend verification: current workspace SHA, HTML no-store and linked JS/CSS/PDF module availability. A passed build is not proof the intended version is serving.
- Report remaining actual-device/original-file validation separately. Public asset checks do not execute an authenticated workflow or prove Gemini quota availability.
