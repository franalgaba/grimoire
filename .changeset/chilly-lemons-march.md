---
"@grimoirelabs/core": patch
"@grimoirelabs/venues": patch
---

Fix spell-defined asset resolution for preview/commit transaction workflows.

- Persist spell assets into preview receipts and use them as the authoritative asset context in `buildTransactions()` and `commit()`, rejecting conflicting caller-provided assets.
- Include receipt assets in cross-process receipt integrity signing/verification (with legacy fallback for receipts that do not include assets).
- Thread asset definitions through executor adapter contexts (including offchain `executeAction`) and add commit-time provider chain mismatch checks for parity with `buildTransactions()`.
- Update Pendle adapter asset merging and PT/YT/SY token matching to handle separator-less symbols like `PTYOETH` and keep chain-matched assets prioritized.
