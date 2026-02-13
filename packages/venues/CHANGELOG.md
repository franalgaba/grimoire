# @grimoirelabs/venues

## 0.4.0

### Minor Changes

- 69508f1: Implement venue capability metadata, runtime constraint enforcement, and venue diagnostics, plus deprecations/removals from bundled venues.

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

### Patch Changes

- Updated dependencies [69508f1]
  - @grimoirelabs/core@0.10.0

## 0.3.5

### Patch Changes

- Updated dependencies [aafdd76]
  - @grimoirelabs/core@0.9.0

## 0.3.4

### Patch Changes

- Updated dependencies [f1ee667]
  - @grimoirelabs/core@0.8.0

## 0.3.3

### Patch Changes

- Updated dependencies [ea592bc]
  - @grimoirelabs/core@0.7.0

## 0.3.2

### Patch Changes

- Updated dependencies [969710a]
  - @grimoirelabs/core@0.6.0

## 0.3.1

### Patch Changes

- Updated dependencies [001b162]
  - @grimoirelabs/core@0.5.0

## 0.3.0

### Minor Changes

- 7df23a4: Add DefiHack multi-track support across compiler/runtime, venues, and CLI.

  - Add end-to-end `custom` action support in core (transformer, IR generation, runtime action resolution, and executor adapter routing), including nested custom arg evaluation.
  - Add `yellow` offchain adapter for NitroRPC session lifecycle operations with version/quorum/intent/allocation validation.
  - Add `lifi` offchain adapter for `swap`, `bridge`, and `custom compose_execute`, with constraint checks and `toAddress` guardrails (default wallet match, explicit override supported).
  - Add CLI ENS profile hydration for `simulate`/`cast` via `--ens-name` and `--ens-rpc-url`, including safe clamping for ENS-hydrated `max_slippage_bps` (0..500).
  - Add DefiHack demo spells and prompt-first runbook updates, plus venue and CLI reference documentation.

### Patch Changes

- Updated dependencies [7df23a4]
  - @grimoirelabs/core@0.4.0

## 0.2.2

### Patch Changes

- Updated dependencies [7355939]
  - @grimoirelabs/core@0.3.0

## 0.2.1

### Patch Changes

- Updated dependencies [15c805b]
  - @grimoirelabs/core@0.2.0

## 0.2.0

### Minor Changes

- 88719f7: Add VM quickstart scaffold, improve venue CLI help, and add Hyperliquid spell snapshots + tests.
