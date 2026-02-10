# @grimoirelabs/core

## 0.5.0

### Minor Changes

- 001b162: Migrate .spell DSL from indentation-based to brace-delimited syntax (SPEC-001). Spells now use `{` / `}` for all blocks instead of Python-style 2-space indentation. This is a breaking change to the language surface — all existing `.spell` files must be updated to use braces. The AST, transformer, IR, and runtime are unchanged.

## 0.4.0

### Minor Changes

- 7df23a4: Add DefiHack multi-track support across compiler/runtime, venues, and CLI.

  - Add end-to-end `custom` action support in core (transformer, IR generation, runtime action resolution, and executor adapter routing), including nested custom arg evaluation.
  - Add `yellow` offchain adapter for NitroRPC session lifecycle operations with version/quorum/intent/allocation validation.
  - Add `lifi` offchain adapter for `swap`, `bridge`, and `custom compose_execute`, with constraint checks and `toAddress` guardrails (default wallet match, explicit override supported).
  - Add CLI ENS profile hydration for `simulate`/`cast` via `--ens-name` and `--ens-rpc-url`, including safe clamping for ENS-hydrated `max_slippage_bps` (0..500).
  - Add DefiHack demo spells and prompt-first runbook updates, plus venue and CLI reference documentation.

## 0.3.0

### Minor Changes

- 7355939: Implement VM real-data and runtime alignment features.

  For `@grimoirelabs/cli`:

  - Add `--data-replay`, `--data-max-age`, and `--on-stale` to `simulate` and `cast`.
  - Add unified run reporting with `Run`, `Data`, `Events`, and `Bindings` blocks.
  - Add JSON run envelopes that include machine-readable provenance.
  - Enforce stale-data policy (`fail|warn`) and replay resolution by run ID or snapshot ID.
  - Persist provenance metadata into state-backed run records.

  For `@grimoirelabs/core`:

  - Extend run records with optional provenance metadata.
  - Persist and load provenance in `SqliteStateStore` (with schema migration support).
  - Keep `createRunRecord` compatible while allowing provenance attachment.

## 0.2.0

### Minor Changes

- 15c805b: Add Pi-backed advisory execution with auto model resolution and deterministic replay.

  - CLI: enable advisory by default when a model is configured (spell, CLI flags, or Pi defaults), keep `--advisory-pi` as force mode, and add replay-first resolution behavior.
  - Core: extend advisory handler interfaces for step-level traceability (`stepId`, `emit`) and emit advisory/tool trace ledger events for audit and replay.
  - Docs/skills: clarify VM vs deterministic runtime and document the exploration -> record -> replay -> execute workflow.
