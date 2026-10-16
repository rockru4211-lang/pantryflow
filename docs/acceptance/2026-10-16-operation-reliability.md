# 百花猿現場作業資料保護

## Scope

- Preserve the existing BeApe/Gras field registration and office review workflow.
- Never turn pending registration into approved stock or financial data automatically.
- No database migrations or historical quantity/price changes in this release.

## Changes

- Spot quantities and reasons are stored on the device on input, scoped by authenticated user, store and workflow. Reopening reads the server before restoring local input; a newer shared revision prevents autosaving over another user's edits.
- Spot mutation requests are journaled before dispatch. A timeout or reopening reuses the original request ID and payload. A matching server receipt is required before clearing recovery data.
- Onsite waste forms retain all fields and expiry/risk context. Uncertain submissions remain immutable and retryable after reopening. Completed receipts are persisted before showing success, so a post-commit device-storage failure cannot silently cause a fresh request.
- Both workflows detect a competing local tab and refuse to overwrite its recovery snapshot. Unavailable/corrupt storage is shown as an error, never described as a saved server record.
- Waste item linking requires a unique exact normalized name and equivalent unit. No fuzzy matching, historical merging, or automatic approval.
- Transfer/waste office lists display confirmation and unresolved product identity in their existing table, including exports.

## Verification

- Added recovery tests for dropped network replies, reopening, immutable retries, double clicks, invalid responses, pre-send and post-commit storage failures, competing tabs, corrupt snapshots, account/store isolation and shared revision conflicts.
- Added exact-product matching and unresolved-identity status tests.
- Retained and adapted spot mutation and completion regression tests.
- Run typecheck, affected-file lint, source verification, production build and the complete application test suite before publication.
- Verify the exact deployed source SHA and all linked production assets after publication.

## Limits

- Device drafts are a recovery aid, not server backups. Clearing browser storage or changing devices cannot recover unsubmitted device-only input.
- Pending historical operations and unmatched historical product IDs remain unchanged and require review; available price quotations do not prove a stable product link.
- Automated tests use isolated fixtures; this release does not insert artificial operations into the live stores.
