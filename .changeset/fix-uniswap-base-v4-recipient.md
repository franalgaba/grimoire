---
"@grimoirelabs/venues": patch
---

Move Base swaps from Uniswap V3 to V4 and fix zero-address recipient

- **Uniswap V3**: Removed Base (8453) from supported chains. The old SwapRouter (`0xE592...`) references a different factory internally on Base, computing wrong pool addresses and producing no-op swaps that succeed on-chain but move zero tokens.
- **Uniswap V4**: Added `FEE_TO_TICK_SPACING` mapping (500→10, 3000→60, 10000→200, 100→1) so the adapter auto-selects correct tickSpacing per fee tier instead of hardcoding 60. Base swaps now route through V4's Universal Router with correct pool resolution. Validated with real token transfers on Anvil fork.
- **Zero-address recipient**: Uniswap V3, Morpho Blue, and Pendle adapters now treat `vault: "0x000...000"` as "no vault" and fall back to `walletAddress`. Previously the `??` operator did not catch the zero-address string, causing swap output tokens to be sent to the burn address.
