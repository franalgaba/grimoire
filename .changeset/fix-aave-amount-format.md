---
"@grimoirelabs/venues": patch
---

Fix Aave V3 withdraw/repay amount format and add approval fallback

- **Amount format**: Withdraw and repay now use `{ exact: humanAmount }` instead of `{ exact: rawAmount }`. The Aave SDK's `exact` wrapper expects human-readable amounts (e.g. `"1"` for 1 USDC), not raw token units (`"1000000"`). Previously passing raw amounts caused the SDK to interpret 1 USDC as 1,000,000 USDC. All four actions now consistently convert raw→human via `toHumanAmount()`.
- **Approval fallback**: When the Aave SDK skips approval generation (observed on Base), the adapter now checks on-chain allowance and injects an `approve()` transaction if needed.
