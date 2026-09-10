# Merchant beta release checklist

- Supabase **Confirm signup** Email template must display `{{ .Token }}` and must not use a confirmation link.
- Keep the canonical Site URL and allowed redirect URLs configured for password reset and future OAuth; signup OTP does not depend on redirects.
- Supabase's built-in SMTP is suitable only for limited project-team testing. Configure and verify a custom SMTP provider before onboarding multiple merchants or treating email delivery as production-ready.
- Do not enable a Service Worker, offline asset cache, or push notifications during this preview phase.
