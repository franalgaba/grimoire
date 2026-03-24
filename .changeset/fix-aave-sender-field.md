---
"@grimoirelabs/venues": patch
---

Fix Aave V3 adapter GraphQL field names — use `sender` for all actions

The Aave API's GraphQL schema requires `sender` (not `supplier`/`borrower`) for all mutation requests. Validated against the live API: lend and borrow now return valid transactions, withdraw and repay correctly report "no position" business errors instead of schema rejections.
