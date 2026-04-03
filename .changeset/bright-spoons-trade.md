---
"@grimoirelabs/core": minor
"@grimoirelabs/venues": minor
"@grimoirelabs/cli": patch
---

Add adapter-backed protocol metric comparison support across the stack.

- Add `apy(venue, asset[, selector])` and generic `metric(surface, venue[, asset[, selector]])` query support in compiler/runtime typing and evaluation.
- Add venue metric surfaces via `readMetric` (Aave/Morpho APY, Uniswap/Across/Pendle quote output, Hyperliquid/Polymarket mid price), including selector parsing and validation.
- Wire CLI query-provider behavior so `balance()` works on any RPC and adapter-backed `apy()` / `metric()` work without Alchemy (`price()` still requires Alchemy).
- Add docs and skill guidance for authoring and validating cross-venue comparison spells, including Morpho selector/market-id targeting.
