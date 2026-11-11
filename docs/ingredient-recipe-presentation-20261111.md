# Ingredient and recipe presentation update

Scope: 百花猿 `beape` only. Purchasing, waste, transfer screens, database schema, prices, historical records, and locked-cost calculations are unchanged.

- Ingredient table keeps supplier-facing item identity primary; kitchen names appear beneath with a compact edit action. Existing aliases remain independently available. Price editing is directly accessible without opening details first.
- Recipe editing prefers explicit kitchen aliases and shows verified purchasing context beneath. Display aliases do not rewrite saved line names or cost identities.
- Top-right and overview totals use the whole saved/preview recipe amount. Component tabs show code/name and the parent recipe's actual usage amount, never the component's batch total. Missing usage remains unknown, nested usage is identified as included in its parent component.
- Overview previews up to three component names/codes/usage amounts; the existing expansion reveals the rest. Recipe editing is one entry point.

Validation: typecheck, source contract, focused UI/cost tests, full regression suite, lint, and production build are run for release. No real operational records are written by these checks. Authenticated visual acceptance is not claimed.
