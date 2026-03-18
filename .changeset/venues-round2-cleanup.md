---
"@grimoirelabs/venues": patch
---

Venues package round 2 cleanup: consolidate shared utilities and remove dead code

- Extract `applyBps()` and `BPS_DENOMINATOR` into `shared/bps.ts`; remove duplicate implementations from across and pendle adapters
- Extract `validateGasConstraints()` into `shared/constraints.ts`; replace identical gas validation boilerplate in across, pendle, uniswap-v3, and uniswap-v4 adapters
- Replace magic numbers with named constants (`DEFAULT_FEE`, `DEFAULT_DEADLINE_SECONDS`, `DEFAULT_SLIPPAGE_BPS`, `DEFAULT_TICK_SPACING`) in uniswap-v3 and uniswap-v4
- Delete dead `compound-v3.ts` stub (never imported or exported)
- Re-export `isMorphoAction` and `isSupportedPendleAction` from package index
- Add unit tests for `shared/bigint.ts` and `shared/gas.ts`
