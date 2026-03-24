---
"@grimoirelabs/venues": patch
---

Fix Aave and Pendle adapter issues from platform eval

- **Aave V3**: Fix GraphQL request field names — use `supplier` for supply/withdraw and `borrower` for borrow/repay instead of `sender`/`recipient` (fixes "unknown field recipient of type BorrowRequest" error, unblocks 5 eval cases)
- **Pendle**: Auto-resolve PT/YT/SY token symbols via Pendle API at build time — symbols like `PT_FXSAVE` are now looked up dynamically instead of requiring explicit 0x addresses (unblocks 3 eval cases)
- **Pendle**: Improved error message for unresolved Pendle assets with guidance on address discovery
- **Skills**: Updated grimoire-morpho-blue SKILL.md with Ethereum default markets and auto-select behavior
- **Skills**: Updated grimoire-pendle SKILL.md with PT/YT/SY token resolution documentation
