# Store-first onboarding UI evidence

These screenshots render the actual `pilot-v1` page functions and production CSS through `tests/fixtures/store-first-onboarding.html`.

- `*-desktop.png`: exact `1440×1000` CSS viewport evidence.
- `*-mobile.png`: exact `390×844` CSS viewport evidence.
- `*-full.png`: raw capture retained for traceability before the in-app browser's 2:1 DPR normalization.
- `browser-results.json`: viewport measurements, horizontal-overflow check, state, console-error count and back-navigation result.

Fixture names and people are non-production test values. These artifacts prove component layout and browser behavior only. They do not prove Supabase writes, RLS, RPC execution, PIN authentication or production E2E.
