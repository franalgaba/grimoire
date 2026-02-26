# @grimoirelabs/venues

## 0.8.0

### Minor Changes

- 223cefa: Add a full `setup` onboarding flow for execute mode and document secure keystore usage for agent-run environments.

  - add guided `grimoire setup` flow for chain/RPC/wallet onboarding with smoke preview and venue doctor checks
  - support setup-managed password env reuse via `.grimoire/setup.env`, with automatic CLI autoload and `GRIMOIRE_SETUP_ENV_FILE` override
  - add setup security warnings and password-safety guidance for Codex/Claude-style workflows
  - document setup, keystore, and venue doctor behavior updates across README, CLI reference, tutorials, and skills
  - add Polymarket venue support in `@grimoirelabs/venues` (adapter + venue CLI surface) and wire it through Grimoire venue workflows

## 0.7.0

### Minor Changes

- 611b2ca: Improved venue safety and UX across compile-time checks, runtime constraint handling, adapter behavior, and CLI diagnostics.

  Highlights:

  - Added safer validation and runtime behavior for action constraints, including better fail-closed paths and clearer adapter support checks.
  - Expanded venue adapter guardrails and diagnostics (notably Morpho and Pendle), including stronger preflight validation and quote/gas handling paths.
  - Improved `grimoire venue doctor` coverage and reporting so misconfiguration and unsupported routes are easier to diagnose.
  - Fixed dry-run/reporting UX issues, including robust serialization of `bigint`-containing event and binding payloads in CLI output.
  - Updated spell fixtures, docs, and skills metadata to reflect the new venue safety expectations and operator workflows.

### Patch Changes

- Updated dependencies [611b2ca]
  - @grimoirelabs/core@0.13.0

## 0.6.0

### Minor Changes

- db19d26: Add first-class Pendle venue support across core, venues, and CLI.

  - add typed Pendle actions in core compiler/runtime pathways
  - add Pendle hosted SDK adapter with convert planning and approvals
  - add Pendle venue CLI integration and venue proxy routing
  - improve Pendle validation/error handling around routing, gas, and constraints
  - harden Pendle fallback and malformed-response handling coverage in adapter tests

### Patch Changes

- Updated dependencies [db19d26]
  - @grimoirelabs/core@0.12.0

## 0.5.0

### Minor Changes

- a3ead48: Add Phase 1 cross-chain continuation orchestration without DSL changes.

  ### Core

  - add cross-chain orchestrator primitives and receipt/types for source/destination track lifecycle
  - extend runtime/state-store persistence with restart-safe cross-chain tables and schema migrations
  - add handoff param injection and reserved namespace guards for destination execution
  - harden compiler behavior so invalid `do` invocations fail at compile time

  ### CLI

  - add cross-chain `simulate` and `cast` flow with `--destination-spell`, per-chain RPC mappings, handoff timeout/polling, and watch support
  - add `grimoire resume <runId>` for restart-safe continuation of waiting runs
  - validate explicit Morpho market identity mappings in cross-chain mode and persist cross-chain run manifests
  - extend `history`/`log` output with cross-chain lifecycle visibility

  ### Venues

  - add Across handoff lifecycle resolution hooks for settlement polling
  - enforce explicit Morpho market id resolution for cross-chain lend/withdraw/borrow/repay actions

### Patch Changes

- Updated dependencies [a3ead48]
  - @grimoirelabs/core@0.11.0

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
