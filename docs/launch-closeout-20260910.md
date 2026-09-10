# 2026-09-10 launch closeout

Baseline: deployed v97 / 7bff342433781e05841e2eba6813d07ea67d7d2f, original Sites URL and Beta qckwzwyeqpuqogbydvvl. Notion master and development plan retrieved at 2026-09-10 17:31 Taiwan; scope is the latest “2026-09-10 上線收尾”.

## Changes

- Preserve the current full app; reconcile the separate GitHub history through a merge retaining the verified Sites tree. GitHub main is canonical; the exact commit is mirrored to Sites main. The former GitHub Pages frontend is replaced by a redirect, not another App. Old commits and branches are retained.
- Password text now states minimum 8, recommended 10+; existing valid passwords remain accepted. Local strength, password managers, show/hide and PIN rules remain. Auth live acceptance on 2026-09-10 17:55 Taiwan rejected a 7-character test, accepted 8 and restored the QA account's secure current password. No test credential is in this record.
- Existing audit rows gain optional attempt/version/store metadata; existing operational quantities and files are unchanged. Independent requests record attempt start and terminal states, with allowlisted metadata only. A failed business transaction cannot roll back its previously committed trace. If connectivity disappears completely, an unclosed attempt remains unknown/unfinished rather than falsely successful.
- Imports distinguish source product rows, added/existing, actual failures/skips, headers/blank/non-product rows and missing openings. “PENDING with product_id” is never an import failure. Duplicate file fingerprints and operation IDs link retries.
- OCR runs link to queue jobs, upload completion, app version and attempts. Queue wait, upload-to-review, whole processor time and actual model-request duration are distinct. Successful/failed model requests remain separate; old records without timing evidence remain incomplete samples.
- Final correction statistics compare each confirmed field once to its original normalized OCR value. Repeated edits and reversions do not inflate final-error counts. Unreviewed fields are not assumed correct.
- Count status transitions record STARTED, SUBMITTED and CLOSED distinctly. REVIEWING with completed_at is still not formally closed.
- Explicit QA/trial enrollment; first real activity starts seven local calendar days. Future/no-activity/not-operating/unfinished are separate. No new merchant page, required setting, analytics dashboard or payment feature.
- Staff pre-login resolution moves to the existing PIN Edge endpoint, with atomic hashed-key rate limits and generic errors. The original store → identity → PIN pages remain. The legacy anonymous RPC is revoked after client release. No email, Auth UUID, PIN, activation secret or member list is returned by context lookup.

## Acceptance evidence

- Eight actual QA identities: authenticated API, cross-merchant rejection, unassigned same-merchant store rejection, direct-table filtering, raw-source/signed-download permissions, blind-count export fields, signout and relogin with the same history verified at 17:55 Taiwan. Owners intentionally retain both assigned stores.
- Staff may retain their own uploaded receipt evidence under the existing receipt permission. Inventory import originals and full count data remain management-only; unrelated stores/merchants cannot access either source bucket.
- Rollback regression verifies trace survival across failed operations, idempotent trace delivery/business requests, metadata filtering, seven-day boundaries and empty-day denominator, protected private tables and rate limits.
- Existing v97 QA credential evidence retained: 13 passwords/7 PINs rotated, old sessions revoked; no new exposure found or unnecessary rotation performed. Local current-access files remain private, outside source/build.
- Google provider is still disabled. Custom SMTP previously saved by the user is retained; Gmail verification and password-reset receipt/return remain unaccepted pending a test recipient. API acceptance does not prove delivery. The requested real-store code is also pending; explicitly classified QA is never counted as real trial data.

Publication and final test evidence will be appended after the exact source is verified and deployed.

The final direct-table audit additionally found legacy organization-wide grants that were broader than the current RPC scopes. A follow-up migration removes raw access to lots, lot events, reviews, supplier history, membership lists and audit logs, removes browser structural privileges, restricts profiles to the current identity, and reserves count correction entries for management. Current UI queries and authorized RPCs are retained; all historical rows remain unchanged.

All current browser database mutations already use authorized RPCs. Direct public-table INSERT/UPDATE/DELETE grants are removed as well, including the legacy self-profile role update. Auth password changes, Storage uploads and service-side processing retain their existing paths.
