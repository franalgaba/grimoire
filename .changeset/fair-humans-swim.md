---
"@grimoirelabs/core": minor
"@grimoirelabs/venues": minor
"@grimoirelabs/cli": minor
---

Implement venue capability metadata, runtime constraint enforcement, and venue diagnostics, plus deprecations/removals from bundled venues.

### `@grimoirelabs/core`

- Add and export venue capability types (`VenueConstraint`, `VenueQuoteMetadata`, `VenueBuildMetadata`) and support metadata-bearing venue build results.
- Extend preview/execute runtime wiring so adapter registries and provider context are available during preview, enabling adapter-aware quote/simulation checks.
- Enforce adapter constraint compatibility during action execution and preview.
- Enforce quote/simulation/max-gas constraint paths via adapter build metadata in preview when required.
- Improve adapter resolution and chain-support errors in executor and normalize offchain transaction results with status/reference propagation.
- Add validator warnings for removed bundled venue aliases (`lifi`, `yellow`) and deprecated `hyperliquid.swap` usage.
- Improve compiler transforms for custom `order` actions and `lend` method mapping.

### `@grimoirelabs/venues`

- Remove bundled `yellow` and `lifi` adapters from exports and default adapter list.
- Add shared constraint utilities and a shared token registry used across adapters.
- Enrich adapter metadata (`supportedConstraints`, quote/simulation support, required env, data endpoints, preview/commit support).
- Update Uniswap V3/V4, Across, Aave, and Morpho adapters to:
  - assert supported constraints,
  - attach structured quote/route/fee metadata,
  - support gas-aware constraint enforcement where applicable.
- Update Hyperliquid adapter to offchain `custom` order semantics (`op: order`) plus withdraw handling with normalized offchain status/reference payloads.

### `@grimoirelabs/cli`

- Add `grimoire venue doctor` command for adapter registration, required env, chain support, and RPC reachability diagnostics.
- Extend `grimoire venue` to route `doctor` requests through the built-in doctor command.
- Add `--rpc-url` support to `simulate` and wire provider context for constraint-aware preview flows.
- Extend `validate` with warnings for unsupported venue constraints inferred from candidate adapters.
- Expand `venues` table output with capability columns (constraints, quote/sim, preview/commit, env, endpoints).
