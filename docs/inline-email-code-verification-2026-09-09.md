# Inline Email code verification — 2026-09-09

Supersedes the v91 decision to remove all Email code inputs. The latest user request explicitly restores an Email verification code on the original account-creation page, without a separate page. Baseline is the live v91 commit `9353594467c585f522543e4fd0b08776252cafa0`.

## Implementation

- The original registration form remains, with a separate, keyed Email code form on the same page. Email and code have different input IDs/names/autocomplete sections and controlled values. Password fields remain part of signup/login only.
- The code form reads the recipient from the original Email input (including browser autofill), validates that input, and submits only Email plus code. An existing code does not require entering a password or sending another email.
- Verification calls the official Supabase `auth.verifyOtp({ email, token, type: "email" })`. It does not use admin APIs, manually confirm users, modify the auth schema, create a new login mechanism, or accept a client-side success flag.
- An actual authenticated session is required before continuing through existing profile/store/membership reads and the original explicit `create_owner_business` setup flow. An existing business continues through its existing membership; there is no automatic duplicate merchant creation.
- Send cooldown and verification are independent. A resend 429 leaves the verification button usable after the request returns, preserves a code already entered, and keeps the mail error separate from the code error.
- Invalid, expired or used codes show an error next to the code on the original page. Codes and passwords are not persisted in browser storage. Editing the recipient clears the entered code. PIN, recovery-link handling and all inventory/receiving/expiry/history behavior remain.

## Verification completed before live-user acceptance

- 82 automated tests pass, including verification after resend rate limiting, correct official endpoint/type and recipient, malformed/expired/used code failures, missing-session denial, independent forms/password constraints, truthful retry timing, and unchanged business regressions.
- TypeScript, changed-file ESLint and diff validation pass.
- The local App connected to the actual Beta service was exercised with one deliberately invalid code for the existing isolated QA account. Supabase rejected it; the original page displayed the invalid/expired-code error and stayed signed out. No email was sent or account created by this negative test.
- Source checkout and live Site were compared: no newer deployed source than v91 was found at the start of the turn.
- This turn's baseline is 2 organizations, 11 Auth users, 25 memberships, 342 products, 670 count entries and **18** receipt documents. The 18-document baseline already existed when this turn began; do not restore the previous turn's 14-document state. Membership hash `7d36c500f0cdaa5c876bd761abefcbf3`; count hash `515e3042de40aa86459fab8d21e417bc`; receipt hash `9cd24ad82a7b67007651118842bc326d`.
- Auth/security advisor was inspected: pre-existing warnings remain; this repair adds no SQL functions, grants, RLS changes or secrets.

## Actual received-code acceptance still required

The user reports receiving a code without a link. The Beta dashboard currently previews the default confirmation-link template and shows no unconfirmed Auth users; this does not identify the user's mailbox message or prove its purpose. The recipient Email has been requested so the same account can be verified. Do not substitute a generated admin code, mock session or API 200 for an email actually received and entered by the user.

The prepared App must be used to enter the real recipient Email/code, continue through merchant setup when the verified account is new, and verify subsequent login/reopen. New passwords and codes should be entered directly in the App, not in chat. The current user requested publishing after that end-to-end acceptance; delivery status must distinguish completed code/tests from the pending actual received-code acceptance.

References: [Supabase email-code verification](https://supabase.com/docs/reference/javascript/auth-verifyotp), [email templates](https://supabase.com/docs/guides/auth/auth-email-templates), [current free-tier template change](https://supabase.com/changelog/46599-changes-to-email-template-customisation-on-free-tier).

## Follow-up: actual resend failure at 17:32

- The user's 17:32:41 Taiwan screenshot corresponds to a fresh Beta API Gateway log at **2026-09-09 17:32:30 Asia/Taipei**: `POST /auth/v1/signup`, HTTP **429**. This is a new request, not the earlier failure. The original signup page still exposes an enabled "驗證並繼續" action independently of the mail failure.
- The Beta dashboard was rechecked: Custom SMTP is **off**. The email-rate-limit control is disabled and does not expose a numeric value in this dashboard. Current official documentation says default SMTP is limited to authorized team recipients and currently 2 emails/hour. No mail settings, tokens, users or business records were modified during this investigation.
- Fixed a frontend defect: an unspecified quota/reset error previously manufactured a 60-second retry timer. Errors now start a countdown only when Auth provides an explicit interval. Stored legacy error drafts drop that unsupported timer while keeping recipient and failure state. Accepted-request cooldown wording says "可再次嘗試寄送", never promises delivery.
- Tests cover unknown quota reset time, explicit 42-second server delay, reopening both current and legacy drafts, and enabled code verification despite failed mail delivery. TypeScript, ESLint and diff checks pass.
- Sending-service setup remains required for general-user delivery: SMTP host, port, username, secret/password and an authorized From address/name. The user has been asked which existing sending service to use; credentials must be entered directly in the Supabase SMTP settings, never in chat. No repeated test mail is sent until delivery configuration is ready.

References: [Supabase custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp), [Auth rate limits](https://supabase.com/docs/guides/auth/rate-limits).
