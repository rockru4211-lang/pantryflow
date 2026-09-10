# Resume the approved merchant setup after email verification

The latest reported account was verified at 2026-09-09 18:22:23 Asia/Taipei. Its BeApe organization and first store already existed at 18:22:39. The old client treated a populated organization ID as onboarding completion and omitted the approved store and manager confirmation panels.

This change restores the original business → first store → first manager panels and existing CSS. A verified owner resumes a private server-side draft; only final confirmation completes canonical business records. An existing partial organization and store are updated in place. Active employees retain their workspace. Completed owners enter the home screen. Missing or unauthorized workspace state does not start a new merchant or open counting.

The reported account's existing BeApe details were copied into its setup draft. Its organization and store IDs were retained. Previously accepted owners remain complete. Restaurant type and store structure follow the later product master and approved shell, independently. Existing ERP settings remain unchanged.

Validation before publication:

- 86 automated regression tests passed; TypeScript and changed-file ESLint passed.
- `tests/sql/owner-setup.sql` passed against Beta with all fixtures rolled back: verified-owner requirement, draft persistence, back navigation, stale edit rejection, duplicate store-code rejection, one merchant/store on retries, in-place resumption, and employee permissions.
- Existing 3 organizations, 12 Auth users, 26 memberships, 342 products, 670 count entries and 18 receipt documents were unchanged. Count, receipt and membership row hashes matched the pre-change baseline.
- Security review: the new RPC is intentionally executable only by authenticated users; its definer implementation enforces verified identity and canonical ownership/membership. The private draft table is not directly granted to browser roles. Existing unrelated advisory notices were not changed.

The user reported successful mobile email receipt and link opening. A complete physical-phone setup and subsequent password login still require the user to operate their own authenticated account; database fixture tests are not evidence of email delivery or physical-phone acceptance.

Source continues the live v91 commit `9353594467c585f522543e4fd0b08776252cafa0` and retains the subsequently saved inline verification-code and mail-status fixes. No historical operational data was rewritten.
