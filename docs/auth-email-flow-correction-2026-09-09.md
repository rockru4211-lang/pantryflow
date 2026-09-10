# Email flow correction — 2026-09-09

Continues deployed v90, source `a001fdbadf4fb0fd1fe9e375cb0393be754cfc95`. Sites was rechecked before preparing this change: latest version remained 90. The original URL, shell, account/role model and all v89 business features remain. No database migration, account creation, manual email confirmation, PIN change, inventory write or receipt write is part of this repair.

## Implemented

- Signup remains on the original registration form. Status, resend and change Email appear inline. The independent verification page and email OTP input/submit code are removed; verification still requires the email link and a session validated by Supabase.
- Signup, password login and recovery have separate email/password/status state, explicit form/input keys, IDs and autocomplete sections. Password values are never written to browser storage. Only each flow's email, pending state, error/status and retry deadline are stored in its own session draft.
- Signup retry uses `auth.resend({type: "signup"})`; password reset uses `resetPasswordForEmail` exclusively. Both return to their explicit original-App callback. Signup acceptance is described neutrally, including guidance for an already-verified account, because a 200 response does not establish that a new email was sent.
- Recovery callbacks take priority over onboarding. Expired recovery links reopen the forgot-password form with resend. Expired signup links reopen the original signup form. An expired link without a known purpose goes to management login with recovery/signup guidance, never automatically to signup verification.
- SMTP/rate-limit/network failures show a persistent inline explanation. A retry countdown is secondary and does not erase the error when it expires. SMTP/network failures do not start a success countdown. Changing Email does not bypass an active rate-limit deadline.
- Existing PIN entry and authenticated membership reads remain. During logout, the selected store is now cleared by session cleanup, instead of clearing it early and issuing transient queries with an empty store UUID.

## Current error evidence (Taiwan time)

- 16:03:09 and 16:03:55: Auth `/signup`, status 200, event **`user repeated signup: request completed`**. The second event has log ID `6e9879a6-7739-4fe2-88c4-b8eceaec4d51`. These are the user's recent attempts, not evidence of new delivery. Do not attribute them to the earlier 15:38 limit error.
- 16:26:57: this turn's App forgot-password submission using the existing isolated QA account returned **HTTP 429**, **`email rate limit exceeded`**. The corrected original form displayed “寄信服務已達寄送上限，本次未寄出” with a separate retry timer; reopening the App and returning to forgot password retained the error. This is a negative test, not a Gmail delivery test.
- Custom SMTP was freshly inspected during this turn and remains disabled/unconfigured. The previously corrected original-App Site URL/redirect configuration is retained. Email confirmation is not disabled.

## Input regression investigation

The old signup form's controlled Email input and the unkeyed OTP form reused the same DOM position, with the OTP input becoming uncontrolled. A local isolated React fixture reproduced an Email still displayed under “六位數驗證碼”, and React reported a controlled-to-uncontrolled input warning at 16:31:51. The fixture has no Auth service or sending operation, was not added to the App, and was not deployed. This demonstrates a code path that produces the reported symptom without assuming it was caused by Gmail or password-manager autofill. The replacement does not contain an email OTP field or switch to that form.

## Verification and limitations

- 76 automated tests pass: original business regressions, validated/expired recovery callbacks, callback identity isolation, correct mail endpoints and redirect URLs, failure persistence, separate mail drafts and original signup-form rendering without OTP.
- TypeScript and changed-file ESLint pass. Production build and online version/readback are recorded at delivery.
- Browser UI checks: original signup and management entrances, separate forgot-password input, expired signup and recovery handling, unknown expired-link handling, inline error/resend, change Email on the same form, and existing employee PIN login. Tests use a phone-sized viewport; they are not a physical phone or real-inbox delivery certification.
- Existing employee `verify-staff` logged into QA0907UI through store → identity → PIN, reopened the App and retained the correct employee role/store. The existing completed count remained 2 areas / 3 saved items, completed at 14:37:11. No new count was created.
- Baseline remains 2 organizations, 11 Auth users, 25 memberships, 342 products, 670 count entries, 14 receipts. Membership/count/receipt content hashes match the v90 baseline. A final readback is required after deployment.
- Controlled callback-error URLs and the Auth-adapter tests do not replace an email received and opened by a real Gmail user. No real verification-email receipt, reset-email receipt, new-password submission or subsequent password login is marked passed.

## Still required for actual delivery acceptance

The user has been asked for the existing SMTP service and a user-controlled Gmail acceptance address. No reply or reusable SMTP credentials is available at this point. Supabase SMTP needs the provider host, port, username, password, sender name and provider-verified sender address/domain. Secrets must be entered directly in the dashboard, not chat. After configuration, inspect provider delivery/rejection logs and verify an ordinary non-team Gmail inbox receives both emails, opens both links back into this App, completes registration/new-password entry and logs in. The user must enter/submit their new password directly.

[SMTP Settings](https://supabase.com/dashboard/project/qckwzwyeqpuqogbydvvl/auth/smtp) · [Latest product decision](https://app.notion.com/p/3c3e1adc0e18814e98b0f8715a11e28c) · [Supabase default SMTP restrictions](https://supabase.com/docs/guides/auth/auth-smtp) · [Password authentication](https://supabase.com/docs/guides/auth/passwords)
