---
"@grimoirelabs/core": minor
---

Add `buildTransactions()` API for client-side signing flows

New `buildTransactions(options)` function produces unsigned transaction calldata from a preview receipt, enabling the `preview() → buildTransactions() → sign (client) → broadcast` flow for wallets like Privy SDK that require client-side signing.

Key behaviors:
- Reuses the same drift-check logic as `commit()` via a shared `performDriftChecks()` helper
- Rejects offchain-only adapters (no signable calldata; use `commit()` instead)
- Defers provider creation until an EVM action actually needs gas estimation
- Forwards `receipt.chainContext.vault` to adapter context so calldata targets the correct recipient
- Rejects providers whose chain doesn't match the receipt
- Prevents double-submission by rejecting already-committed receipts
- Cross-process receipts require HMAC integrity verification via new `signReceipt()` utility

New exports: `buildTransactions`, `BuildTransactionsOptions`, `BuildTransactionsResult`, `signReceipt`
