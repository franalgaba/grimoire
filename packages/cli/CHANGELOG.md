# @grimoirelabs/cli

## 0.15.14

### Patch Changes

- Updated dependencies [d6e76eb]
  - @grimoirelabs/venues@0.10.14

## 0.15.13

### Patch Changes

- Updated dependencies [23783df]
  - @grimoirelabs/core@0.17.5
  - @grimoirelabs/venues@0.10.13

## 0.15.12

### Patch Changes

- Updated dependencies [a3e1b89]
  - @grimoirelabs/core@0.17.4
  - @grimoirelabs/venues@0.10.12

## 0.15.11

### Patch Changes

- Updated dependencies [fba6b56]
  - @grimoirelabs/venues@0.10.11

## 0.15.10

### Patch Changes

- Updated dependencies [c4ec754]
  - @grimoirelabs/venues@0.10.10

## 0.15.9

### Patch Changes

- Updated dependencies [70bde82]
  - @grimoirelabs/venues@0.10.9

## 0.15.8

### Patch Changes

- Updated dependencies [1102ec1]
  - @grimoirelabs/venues@0.10.8

## 0.15.7

### Patch Changes

- Updated dependencies [81cb1e8]
  - @grimoirelabs/venues@0.10.7

## 0.15.6

### Patch Changes

- Updated dependencies [9ab4458]
  - @grimoirelabs/venues@0.10.6

## 0.15.5

### Patch Changes

- Updated dependencies [a0aceb1]
  - @grimoirelabs/venues@0.10.5

## 0.15.4

### Patch Changes

- Updated dependencies [cd7c12e]
  - @grimoirelabs/core@0.17.3
  - @grimoirelabs/venues@0.10.4

## 0.15.3

### Patch Changes

- e20b053: Fix Uniswap pool data fetching and AuthStorage constructor

  Venues:

  - Replace dead The Graph hosted service URL with decentralized network subgraph IDs
    for Ethereum, Optimism, Polygon, Base, and Arbitrum
  - Support `GRAPH_API_KEY` env var for subgraph queries
  - Graceful fallback to on-chain RPC pool lookup when no graph key is set
  - Clear error messages guiding users to set up a Graph API key or use `--rpc-url`

  CLI:

  - Fix pre-existing `AuthStorage.create()` call that doesn't exist at current
    pi-coding-agent version (revert to `new AuthStorage()`)

- Updated dependencies [e20b053]
  - @grimoirelabs/venues@0.10.3

## 0.15.2

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

- Updated dependencies [3e99270]
  - @grimoirelabs/core@0.17.2
  - @grimoirelabs/venues@0.10.2

## 0.15.1

### Patch Changes

- Updated dependencies [676f3bf]
  - @grimoirelabs/core@0.17.1
  - @grimoirelabs/venues@0.10.1

## 0.15.0

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

### Patch Changes

- Updated dependencies [0e628ec]
  - @grimoirelabs/core@0.17.0
  - @grimoirelabs/venues@0.10.0

## 0.14.2

### Patch Changes

- Updated dependencies [cd9f40b]
  - @grimoirelabs/venues@0.9.3

## 0.14.1

### Patch Changes

- Updated dependencies [29023f3]
  - @grimoirelabs/core@0.16.0
  - @grimoirelabs/venues@0.9.2

## 0.14.0

### Minor Changes

- 26ed9bb: Add `--trigger` CLI option for selective trigger execution in multi-trigger spells

  Multi-trigger spells now tag each step with its trigger handler index during compilation, producing a `triggerStepMap` in the IR. The new `--trigger <type>` option on `grimoire cast` filters execution to only the steps belonging to the matched trigger handler (e.g., `--trigger manual`, `--trigger hourly`). Unknown trigger names error with the list of available triggers.

### Patch Changes

- Updated dependencies [26ed9bb]
  - @grimoirelabs/core@0.15.0
  - @grimoirelabs/venues@0.9.1

## 0.13.1

### Patch Changes

- c1d5ac1: Auto-create provider when spells use query functions (`balance()`, `price()`) in guards or expressions, even without explicit `--rpc-url`. Adds `spellUsesQueryFunctions()` static analysis to detect query function calls in spell IR. Documents delimiter rules (commas required inside `()`, newlines inside `{}`) and adds guidance to prefer `price()`/`balance()` over advisory for data fetching.

## 0.13.0

### Minor Changes

- 340da5d: Wire QueryProvider through the execution pipeline. Adds pluggable `QueryProvider` interface that flows from CLI through `ExecuteOptions` → `ExecutionContext` → `createEvalContext()`, enabling `price()` and `balance()` query functions at runtime. Includes Alchemy-backed implementation (`createAlchemyQueryProvider`) with auto-extracted API key from RPC URL. Type checker now supports optional arguments on built-in functions (`price(base, quote, source?)`, `balance(asset, address?)`).

### Patch Changes

- Updated dependencies [340da5d]
  - @grimoirelabs/core@0.14.0
  - @grimoirelabs/venues@0.9.0

## 0.12.0

### Minor Changes

- 223cefa: Add a full `setup` onboarding flow for execute mode and document secure keystore usage for agent-run environments.

  - add guided `grimoire setup` flow for chain/RPC/wallet onboarding with smoke preview and venue doctor checks
  - support setup-managed password env reuse via `.grimoire/setup.env`, with automatic CLI autoload and `GRIMOIRE_SETUP_ENV_FILE` override
  - add setup security warnings and password-safety guidance for Codex/Claude-style workflows
  - document setup, keystore, and venue doctor behavior updates across README, CLI reference, tutorials, and skills
  - add Polymarket venue support in `@grimoirelabs/venues` (adapter + venue CLI surface) and wire it through Grimoire venue workflows

### Patch Changes

- Updated dependencies [223cefa]
  - @grimoirelabs/venues@0.8.0

## 0.11.0

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
  - @grimoirelabs/venues@0.7.0

## 0.10.0

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
  - @grimoirelabs/venues@0.6.0

## 0.9.0

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
  - @grimoirelabs/venues@0.5.0

## 0.8.0

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
  - @grimoirelabs/venues@0.4.0

## 0.7.0

### Minor Changes

- aafdd76: Add advisory runtime trace improvements for `simulate` and `cast`, including verbose tracing controls and live event streaming.

  CLI:

  - Add `--advisory-trace-verbose` to `simulate` and `cast`.
  - Expand advisory tracing with prompt/schema visibility, model selection events, and detailed tool/advisory lifecycle logs.
  - Improve verbose advisory output handling by coalescing model deltas into joined channel summaries instead of noisy token-per-line logs.
  - Strengthen advisory prompt output guidance for primitive schemas (for example boolean output) with explicit shape hints and examples.

  Core:

  - Add runtime event callback plumbing for preview/commit execution paths so callers can observe ledger events live during execution.

### Patch Changes

- Updated dependencies [aafdd76]
  - @grimoirelabs/core@0.9.0
  - @grimoirelabs/venues@0.3.5

## 0.6.1

### Patch Changes

- d30b41f: Fix Node CLI reliability for common local workflows.

  - Allow `grimoire venue <adapter>` to resolve bundled `@grimoirelabs/venues` via package exports-safe entrypoint resolution.
  - Make `simulate` and `cast` continue without persisted state (with warning) when Node sqlite backend is unavailable instead of hard-failing.

## 0.6.0

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

### Patch Changes

- Updated dependencies [f1ee667]
  - @grimoirelabs/core@0.8.0
  - @grimoirelabs/venues@0.3.4

## 0.5.3

### Patch Changes

- Updated dependencies [ea592bc]
  - @grimoirelabs/core@0.7.0
  - @grimoirelabs/venues@0.3.3

## 0.5.2

### Patch Changes

- Updated dependencies [969710a]
  - @grimoirelabs/core@0.6.0
  - @grimoirelabs/venues@0.3.2

## 0.5.1

### Patch Changes

- Updated dependencies [001b162]
  - @grimoirelabs/core@0.5.0
  - @grimoirelabs/venues@0.3.1

## 0.5.0

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
  - @grimoirelabs/venues@0.3.0

## 0.4.0

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

### Patch Changes

- Updated dependencies [7355939]
  - @grimoirelabs/core@0.3.0
  - @grimoirelabs/venues@0.2.2

## 0.3.0

### Minor Changes

- 15c805b: Add Pi-backed advisory execution with auto model resolution and deterministic replay.

  - CLI: enable advisory by default when a model is configured (spell, CLI flags, or Pi defaults), keep `--advisory-pi` as force mode, and add replay-first resolution behavior.
  - Core: extend advisory handler interfaces for step-level traceability (`stepId`, `emit`) and emit advisory/tool trace ledger events for audit and replay.
  - Docs/skills: clarify VM vs deterministic runtime and document the exploration -> record -> replay -> execute workflow.

### Patch Changes

- Updated dependencies [15c805b]
  - @grimoirelabs/core@0.2.0
  - @grimoirelabs/venues@0.2.1

## 0.2.0

### Minor Changes

- 88719f7: Add VM quickstart scaffold, improve venue CLI help, and add Hyperliquid spell snapshots + tests.

### Patch Changes

- Updated dependencies [88719f7]
  - @grimoirelabs/venues@0.2.0
