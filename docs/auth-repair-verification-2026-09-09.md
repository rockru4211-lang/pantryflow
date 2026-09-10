# PF-AUTH-REPAIR-20260909

**Historical v90 report.** The optional OTP and separate verification-page behavior below was rejected in the latest decision. See [the follow-up correction](auth-email-flow-correction-2026-09-09.md) for the superseding implementation and the current delivery acceptance status.

Continues the deployed v89 source `192ac1177da379cc8df91ecbcd48534b96e8210d`, verified with the Sites saved-version API on 2026-09-09. Original URL and shell retained. No database migration, account creation, merchant creation, password change, PIN change, or inventory/receiving write was performed in this repair.

## Implemented

- Management login: forgot-password request, neutral acknowledgement, 60-second retry interval, recovery callback, new-password form, Supabase `updateUser`, global sign-out after success, return to password login. The SDK validates the callback session before the reset form is enabled. A recovery URL without credentials cannot borrow an existing normal session. A user-bound, one-hour marker resumes an interrupted reset without storing another copy of any credential.
- Signup and resend explicitly return to the original App. Email-link verification and the existing optional six-digit OTP remain. Expired/used links can resend on the same page or return to management login. Editing an email does not link accounts; passwords are not persisted in browser storage.
- Real `signInWithOAuth` Google integration and cancellation/error callback handling. Google is shown only when the live Auth settings report it enabled. Identity linking remains entirely with Supabase's verified identity mechanism; the client neither matches users by email nor automatically creates a merchant.
- Workspace reads use the authenticated user ID and existing memberships. Failed profile/store/role reads stop with retry instead of treating a failed request as a new merchant. Stale account reads cannot override a newer login. Auth events schedule workspace queries outside the SDK auth lock.
- Existing employee PIN entrance and role/store routing retained. Existing merchant onboarding RPC remains explicit and idempotent.

## Actual remote settings, checked 2026-09-09 Taiwan 15:20–15:28

- Project: `qckwzwyeqpuqogbydvvl`.
- **Fixed:** Site URL was `http://localhost:3000`, with no additional redirect URLs. Saved Site URL `https://pantryflow-app-shell-preview.rockru4211.chatgpt.site/` and exact original-App root / `?auth=recovery` / `?auth=signup` / `?auth=google` redirects. Saved configuration was read back in the dashboard.
- Email enabled; confirmation required. Neither confirmation nor existing authorization rules was disabled.
- Custom SMTP **disabled**, no Auth send-email hook configured. No reusable SMTP or Google configuration was found in the project source/configuration.
- Google **disabled**, Client IDs **absent**, OAuth Client Secret **absent**. Secret content was not revealed or copied.
- Public Auth settings independently confirmed Google false, email true, and auto-confirm false at `2026-09-09T07:38:01.991Z`.
- A new recovery request for the existing isolated QA account returned HTTP **429**, `email rate limit exceeded`, at `2026-09-09T07:38:02.386Z` (Taiwan **15:38:02**). Subsequent App submission displayed the sending-limit error and disabled retry countdown. This negative QA request does not establish Gmail delivery.
- Auth service dashboard logs were inspected. Earlier `/admin/generate_link` successes belong to PIN/session tests, and do **not** establish email delivery. Historical refresh-token errors are not evidence that SMTP was configured. The rate-limit settings page did not expose an editable email limit while custom SMTP was off; no numerical delivery limit is claimed from that blank field.

## Verification

- 70 automated tests passed, including 12 new callback/recovery tests and existing count/import/receipt/expiry/waste regression checks.
- TypeScript and changed-file ESLint passed; production build required before saving/deployment.
- Browser at 390 × 844: original management and employee entrances, forgot-password form, real rate-limit response, countdown, expired recovery link with resend, expired signup link with same-page resend, and Google cancellation with return to management login.
- Existing `verify-staff` and `verify-manager` accounts logged into `QA0907UI` through the original PIN sequence; employee and supervisor roles were distinct and correct. Reopening retained the store/session. Existing completed count still showed 2 zones / 3 items / 2026-09-09 14:37:11. No count was submitted or changed by these tests.
- Tested callback errors are controlled error URLs, and positive callback bootstrap tests use an Auth adapter. They are **not** substitutes for actual emailed-link redemption or Google consent.
- Data baseline unchanged on readback: 2 organizations, 11 Auth users, 25 memberships, 342 products, 670 count entries, 14 receipt documents, 0 Google identities.
- Content checksums unchanged: memberships `7d36c500f0cdaa5c876bd761abefcbf3`, count entries `515e3042de40aa86459fab8d21e417bc`, receipt documents `efe9ded3d867649811d58cbd155f276f`.
- No schema, grants, RLS, or history changes. Security advisor still reports pre-existing private-table deny-by-default info and existing function/password-protection warnings; this change adds no database function.

## External blockers — acceptance not complete

1. Configure an existing transactional SMTP service in Supabase Authentication → Emails → SMTP Settings: sender address/name, SMTP host/port, username, password, and the provider's verified sender/domain. Confirm provider delivery/rejection logs and sending limits. Built-in Supabase mail cannot be used to qualify delivery to arbitrary non-team Gmail users.
2. Configure a Google Cloud OAuth **Web application** client and consent screen. Authorized origin: the original App origin. Authorized redirect URI: `https://qckwzwyeqpuqogbydvvl.supabase.co/auth/v1/callback`. Save Client ID / Client Secret in Supabase's Google provider and enable it. If the consent screen is in testing, the chosen Gmail tester must be allowed there. Do not enable manual email-based linking or relax nonce/email checks.
3. A user-controlled Gmail test address and the user's direct password/Google entry are still needed. No secret or new password should be supplied in chat. No real Gmail inbox receipt, email-link registration, successful new-password login/old-password rejection, or actual Google consent/identity merge has been certified.

Once configured, reopen the original App → 管理帳號登入. Test 忘記密碼 with the Gmail account, open the latest email, set a new password in the App, and log in again. Test Google twice and check that the existing user/store/membership IDs remain the same. Use a non-team Gmail signup to verify actual inbox delivery and registration; replay its link to verify safe retry without a second merchant.

## Sources

- [Latest product decision](https://app.notion.com/p/3c3e1adc0e18814e98b0f8715a11e28c), [implementation checklist](https://app.notion.com/p/3d0e1adc0e1881908270e70e71e753f0), [login shell specification](https://app.notion.com/p/3cce1adc0e1881d899b6e1a79e220ac7).
- [Supabase SMTP restrictions](https://supabase.com/docs/guides/auth/auth-smtp), [password authentication](https://supabase.com/docs/guides/auth/passwords), [identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking), [Google OAuth](https://supabase.com/docs/guides/auth/social-login/auth-google).
