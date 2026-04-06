# @grimoirelabs/core

## 0.20.0

### Minor Changes

- 32e1a60: Tighten Morpho execution routing and add explicit vault APY metric surfaces.

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

## 0.19.0

### Minor Changes

- edbb992: Add adapter-backed protocol metric comparison support across the stack.

  - Add `apy(venue, asset[, selector])` and generic `metric(surface, venue[, asset[, selector]])` query support in compiler/runtime typing and evaluation.
  - Add venue metric surfaces via `readMetric` (Aave/Morpho APY, Uniswap/Across/Pendle quote output, Hyperliquid/Polymarket mid price), including selector parsing and validation.
  - Wire CLI query-provider behavior so `balance()` works on any RPC and adapter-backed `apy()` / `metric()` work without Alchemy (`price()` still requires Alchemy).
  - Add docs and skill guidance for authoring and validating cross-venue comparison spells, including Morpho selector/market-id targeting.

## 0.18.0

### Minor Changes

- 76b248b: Add deterministic spell formatting support and a new `grimoire format` command.

  - Add `formatGrimoire()` to core for canonical `.spell` formatting with parser diagnostics.
  - Add CLI `format` command with `--write`, `--check`, `--diff`, `--json`, and stdin modes.
  - Enforce formatter exit codes for check/parse/usage paths and add formatter test coverage.

## 0.17.5

### Patch Changes

- 23783df: Fix spell-defined asset resolution for preview/commit transaction workflows.

  - Persist spell assets into preview receipts and use them as the authoritative asset context in `buildTransactions()` and `commit()`, rejecting conflicting caller-provided assets.
  - Include receipt assets in cross-process receipt integrity signing/verification (with legacy fallback for receipts that do not include assets).
  - Thread asset definitions through executor adapter contexts (including offchain `executeAction`) and add commit-time provider chain mismatch checks for parity with `buildTransactions()`.
  - Update Pendle adapter asset merging and PT/YT/SY token matching to handle separator-less symbols like `PTYOETH` and keep chain-matched assets prioritized.

## 0.17.4

### Patch Changes

- a3e1b89: Thread spell-defined asset addresses to venue adapters so custom tokens with explicit addresses (e.g. PTYOETH) are resolved correctly instead of throwing "Unknown asset" errors.

## 0.17.3

### Patch Changes

- cd7c12e: Fix CLI issues identified by platform eval (30% → estimated 55%+ pass rate)

  - **Expression parser**: Accept `.5` as `0.5` in inline expressions (matches main tokenizer behavior)
  - **Uniswap V3**: Guard `min_output` slippage computation when pool returns zero quote — falls through to default slippage instead of throwing
  - **Morpho Blue**: Add Ethereum mainnet default markets (cbBTC/USDC, WBTC/USDC, wstETH/WETH) so Morpho operations on chain 1 no longer fail with "market not configured"
  - **Morpho Blue**: Resolve lend ambiguity when multiple markets share the same loan token — auto-selects first match with warning instead of throwing
  - **Token registry**: Add wstETH to Ethereum SHARED_TOKENS (WBTC and cbBTC already covered by Uniswap default list)

## 0.17.2

### Patch Changes

- 3e99270: Upgrade all package dependencies to latest versions

  Core: ethers ^6.16.0, viem ^2.47.6, yaml ^2.8.3, zod ^4.3.6, typescript ^5.9.3

  CLI: incur ^0.3.8, chalk ^5.6.2, ora ^9.3.0, viem ^2.47.6, pi-coding-agent 0.62.0, typescript ^5.9.3

  - Fix `AuthStorage` constructor change: `new AuthStorage(path)` → `AuthStorage.create(path)`

  Venues: viem ^2.47.6, incur ^0.3.8, @aave/client ^0.9.2, @across-protocol/app-sdk ^0.5.0,
  @morpho-org/blue-sdk ^5.20.0, @morpho-org/blue-sdk-viem ^4.6.0, @nktkas/hyperliquid ^0.32.1,
  @polymarket/clob-client 5.8.0, @uniswap/default-token-list ^18.10.0, @uniswap/sdk-core ^7.12.2,
  @uniswap/v3-sdk 3.29.1, @ethersproject/wallet 5.8.0

  - Remove `"LiquidationMarket"` from Hyperliquid order TIF type (dropped in SDK 0.32.1)
  - Pin @uniswap/v3-sdk to 3.29.1 (3.29.2 uses workspace:\* for sdk-core, breaks external installs)

## 0.17.1

### Patch Changes

- 676f3bf: Fix parser to accept inline single-line asset blocks

  The asset block parser required a newline after each field inside nested braces,
  which rejected the natural single-line form that agents produce:

  ```spell
  assets: {
    USDC: { chain: 8453 }
    cbBTC: { chain: 8453 }
  }
  ```

  The closing `}` is now accepted as an implicit field terminator, so both
  single-line and multi-line inner blocks parse correctly.

## 0.17.0

### Minor Changes

- 0e628ec: Migrate CLI to incur, eliminate implicit resolution, add MetaMorpho vaults, wire up Across venue

  ## CLI migration to incur

  - Replace `commander` dependency with `incur` (^0.3.4) for command registration and option parsing
  - Rewrite `index.ts` entry point using `Cli.create()` with zod schemas, middleware, and CTAs
  - Restructure wallet commands as a nested `Cli.create("wallet")` sub-CLI
  - All commands now return structured data through `c.ok()` (compile, validate, simulate, cast, resume, history, log, init, setup, venues)
  - All decorative/interactive output moved to stderr; stdout reserved for structured JSON
  - Replace all `process.exit(1)` calls with thrown errors (incur sets exit codes automatically)
  - Remove `collectRepeatedOption` helper (incur handles repeatable options via `z.array()`)
  - New incur features: `--help`/`--version`, `--format toon|json|yaml|md|jsonl`, `--llms`/`--schema`, `mcp add`/`skills add`, shell completions, structured error codes and CTAs
  - Fix venue flag passthrough — intercept `venue` commands before `cli.serve()` to bypass incur's parser rejecting unknown flags meant for proxied venue CLIs

  ## Breaking: Implicit resolution removed

  **Morpho Blue** — Ambiguous market selection is now an error. When multiple markets match a loan token and no `market_id` is specified, the adapter throws listing candidate IDs instead of silently picking the first match. Single-market resolution remains implicit.

  **Uniswap V3 & V4** — `fee_tier` is now required for swap actions. Adapters throw if `action.feeTier` is undefined. DSL syntax: `with (fee_tier=3000)`. The `fee_tier` key in `with()` clauses is extracted as an action parameter, not a constraint.

  **Pendle** — Emits `onWarning` when multiple routes are returned, surfacing that the first (best) route was implicitly selected.

  ## New: MetaMorpho vault deposit/withdraw

  - Added `VaultDepositAction` and `VaultWithdrawAction` types to core action system
  - DSL syntax: `morpho_blue.vault_deposit(USDC, 1000, "0xVaultAddr")` / `morpho_blue.vault_withdraw(USDC, 500, "0xVaultAddr")`
  - Vault address is always required (3rd positional arg) — no implicit resolution
  - Adapter encodes ERC4626 calls via `MetaMorphoAction.deposit()`/`.withdraw()` from `@morpho-org/blue-sdk-viem`
  - Deposit includes asset approval to vault; withdraw is a single tx

  ## New: Across Protocol venue CLI

  - Created `packages/venues/src/cli/across.ts` with commands: `info`, `chains`, `quote`, `routes`, `status`
  - Wired into venue discovery system (`CLI_TO_ADAPTER_MAP`, `BUILTIN_ALIAS_MAP`)
  - Added `grimoire-across` bin entry
  - Live bridge quotes via Across SDK, deposit status tracking via Across API

  ## Fix: Polymarket `search-markets` regression

  - `async *run` generator caused incur to write only progress snapshots to stdout, discarding the final markets data. Fixed by switching to regular `async run` with progress on stderr.

  ## Core type changes

  - `SwapAction` — added optional `feeTier?: number`
  - `VaultDepositAction` / `VaultWithdrawAction` — new action types with required `vault: Address`

## 0.16.0

### Minor Changes

- 29023f3: Add `buildTransactions()` API for client-side signing flows

  New `buildTransactions(options)` function produces unsigned transaction calldata from a preview receipt, enabling the `preview() → buildTransactions() → sign (client) → broadcast` flow for wallets like Privy SDK that require client-side signing.

  Key behaviors:

  - Reuses the same drift-check logic as `commit()` via a shared `performDriftChecks()` helper
  - Rejects offchain-only adapters (no signable calldata; use `commit()` instead)
  - Defers provider creation until an EVM action actually needs gas estimation
  - Forwards `receipt.chainContext.vault` to adapter context so calldata targets the correct recipient
  - Rejects providers whose chain doesn't match the receipt
  - Prevents double-submission by rejecting already-committed receipts
  - Cross-process receipts require HMAC integrity verification via new `signReceipt()` utility

  New exports: `buildTransactions`, `BuildTransactionsOptions`, `BuildTransactionsResult`, `signReceipt`

## 0.15.0

### Minor Changes

- 26ed9bb: Add `--trigger` CLI option for selective trigger execution in multi-trigger spells

  Multi-trigger spells now tag each step with its trigger handler index during compilation, producing a `triggerStepMap` in the IR. The new `--trigger <type>` option on `grimoire cast` filters execution to only the steps belonging to the matched trigger handler (e.g., `--trigger manual`, `--trigger hourly`). Unknown trigger names error with the list of available triggers.

## 0.14.0

### Minor Changes

- 340da5d: Wire QueryProvider through the execution pipeline. Adds pluggable `QueryProvider` interface that flows from CLI through `ExecuteOptions` → `ExecutionContext` → `createEvalContext()`, enabling `price()` and `balance()` query functions at runtime. Includes Alchemy-backed implementation (`createAlchemyQueryProvider`) with auto-extracted API key from RPC URL. Type checker now supports optional arguments on built-in functions (`price(base, quote, source?)`, `balance(asset, address?)`).

## 0.13.0

### Minor Changes

- 611b2ca: Improved venue safety and UX across compile-time checks, runtime constraint handling, adapter behavior, and CLI diagnostics.

  Highlights:

  - Added safer validation and runtime behavior for action constraints, including better fail-closed paths and clearer adapter support checks.
  - Expanded venue adapter guardrails and diagnostics (notably Morpho and Pendle), including stronger preflight validation and quote/gas handling paths.
  - Improved `grimoire venue doctor` coverage and reporting so misconfiguration and unsupported routes are easier to diagnose.
  - Fixed dry-run/reporting UX issues, including robust serialization of `bigint`-containing event and binding payloads in CLI output.
  - Updated spell fixtures, docs, and skills metadata to reflect the new venue safety expectations and operator workflows.

## 0.12.0

### Minor Changes

- db19d26: Add first-class Pendle venue support across core, venues, and CLI.

  - add typed Pendle actions in core compiler/runtime pathways
  - add Pendle hosted SDK adapter with convert planning and approvals
  - add Pendle venue CLI integration and venue proxy routing
  - improve Pendle validation/error handling around routing, gas, and constraints
  - harden Pendle fallback and malformed-response handling coverage in adapter tests

## 0.11.0

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

## 0.10.0

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

## 0.9.0

### Minor Changes

- aafdd76: Add advisory runtime trace improvements for `simulate` and `cast`, including verbose tracing controls and live event streaming.

  CLI:

  - Add `--advisory-trace-verbose` to `simulate` and `cast`.
  - Expand advisory tracing with prompt/schema visibility, model selection events, and detailed tool/advisory lifecycle logs.
  - Improve verbose advisory output handling by coalescing model deltas into joined channel summaries instead of noisy token-per-line logs.
  - Strengthen advisory prompt output guidance for primitive schemas (for example boolean output) with explicit shape hints and examples.

  Core:

  - Add runtime event callback plumbing for preview/commit execution paths so callers can observe ledger events live during execution.

## 0.8.0

### Minor Changes

- f1ee667: Ship the flow-driven runtime update across core and CLI, including preview/commit lifecycle, value-flow enforcement, advisory workflow improvements, and branch-wide docs/skills alignment.

  Core:

  - Add full preview/commit execution lifecycle with receipt-driven settlement flow.
  - Add value-flow accounting and drift enforcement primitives for safer settlement decisions.
  - Expand runtime/session reporting paths and lifecycle handling.
  - Update advisory execution path and related typing/validation behavior.
  - Extend compiler/type-check/validator coverage for advisory and flow constraints.

  CLI:

  - Align `simulate`/`cast` behavior with runtime parity and preview-first flow.
  - Add advisory runtime controls and replay-oriented execution paths.
  - Improve `grimoire venue <adapter>` resolution for global installs and workspace setups.
  - Refresh command behavior/docs wiring for the updated lifecycle.

  Docs and skills:

  - Rework docs to Diataxis structure and update onboarding/reference flow.
  - Update Grimoire skills to match current runtime model, syntax, and advisory workflows.

## 0.7.0

### Minor Changes

- ea592bc: Add compile-time type errors and conversion builtins (SPEC-003 Phase 2). Type checker now produces errors that block compilation instead of warnings. Added `to_number()` and `to_bigint()` conversion builtins so spells can explicitly handle the bigint/number boundary — the common DeFi pattern `to_number(balance(X)) * price(X, Y)` is now well-typed. Updated 8 fixture `.spell` files with explicit `to_number()` calls where `balance()` results are used in arithmetic with `number` values.

## 0.6.0

### Minor Changes

- 969710a: Add diff-stable syntax features (SPEC-002). Constraint clauses now support a parenthesized multi-line form `with (slippage=50, deadline=300,)` so adding or removing a constraint touches exactly one line. Object literals in expressions support multi-line layout with trailing commas. Trailing commas are formalized across all comma-separated contexts (arrays, function args, emit data, constraints, block params). No changes to tokenizer, AST, transformer, IR, or runtime.

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
