---
"@grimoirelabs/core": minor
"@grimoirelabs/venues": minor
"@grimoirelabs/cli": minor
---

Improved venue safety and UX across compile-time checks, runtime constraint handling, adapter behavior, and CLI diagnostics.

Highlights:

- Added safer validation and runtime behavior for action constraints, including better fail-closed paths and clearer adapter support checks.
- Expanded venue adapter guardrails and diagnostics (notably Morpho and Pendle), including stronger preflight validation and quote/gas handling paths.
- Improved `grimoire venue doctor` coverage and reporting so misconfiguration and unsupported routes are easier to diagnose.
- Fixed dry-run/reporting UX issues, including robust serialization of `bigint`-containing event and binding payloads in CLI output.
- Updated spell fixtures, docs, and skills metadata to reflect the new venue safety expectations and operator workflows.
