---
"@grimoirelabs/core": minor
"@grimoirelabs/venues": minor
---

Tighten Morpho execution routing and add explicit vault APY metric surfaces.

## @grimoirelabs/core

- Enforce explicit `market_id` for Morpho value-moving actions (`lend`, `withdraw`, `borrow`, `repay`, `supply_collateral`, `withdraw_collateral`) during runtime action execution.
- Support `with (market_id=...)` as an action parameter mapping in the Grimoire transformer (instead of treating it like a runtime constraint).

## @grimoirelabs/venues

- Require explicit `market_id` for Morpho market actions in the adapter (no implicit market resolution fallback).
- Validate that Morpho action asset/collateral matches the selected explicit `market_id`.
- Add Morpho vault metric surfaces:
  - `metric("vault_apy", morpho, asset, selector)`
  - `metric("vault_net_apy", morpho, asset, selector)`
- Require explicit vault selector for vault APY metrics (no implicit highest-TVL fallback).
- Keep `apy(morpho, asset[, selector])` for market APY comparisons.
