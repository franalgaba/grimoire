---
"@grimoirelabs/venues": patch
---

Fix missing ERC20 approve transactions in Aave V3 adapter on Base

The Aave SDK's GraphQL API returns `ApprovalRequired` on Ethereum but `TransactionRequest` directly on Base, skipping the approval step. This caused `buildTransactions()` to return only the supply/repay calldata without an `approve()` call, resulting in "ERC20: transfer amount exceeds allowance" reverts.

Added a fallback: when the SDK doesn't generate an approval for lend/repay actions and a provider with `readContract` is available, the adapter now checks on-chain allowance and injects an `approve()` transaction if needed. Validated against the live Aave API on both Ethereum and Base.
