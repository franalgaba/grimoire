# @grimoirelabs/venues

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
