# @grimoirelabs/venues

## 0.10.7

### Patch Changes

- 81cb1e8: Fix Aave V3 adapter GraphQL field names — use `sender` for all actions

  The Aave API's GraphQL schema requires `sender` (not `supplier`/`borrower`) for all mutation requests. Validated against the live API: lend and borrow now return valid transactions, withdraw and repay correctly report "no position" business errors instead of schema rejections.

## 0.10.6

### Patch Changes

- 9ab4458: Fix Uniswap V3 division by zero when pool quote returns zero output in preview mode

  When the pool quoter returns 0 (e.g. preview mode with no real wallet context), the SDK's `priceImpact`, `minimumAmountOut`, and slippage calculations would divide by zero. Now detects zero quotes and uses safe fallbacks — produces a valid preview result with `~0` expected output instead of crashing.

## 0.10.5

### Patch Changes

- a0aceb1: Fix Aave and Pendle adapter issues from platform eval

  - **Aave V3**: Fix GraphQL request field names — use `supplier` for supply/withdraw and `borrower` for borrow/repay instead of `sender`/`recipient` (fixes "unknown field recipient of type BorrowRequest" error, unblocks 5 eval cases)
  - **Pendle**: Auto-resolve PT/YT/SY token symbols via Pendle API at build time — symbols like `PT_FXSAVE` are now looked up dynamically instead of requiring explicit 0x addresses (unblocks 3 eval cases)
  - **Pendle**: Improved error message for unresolved Pendle assets with guidance on address discovery
  - **Skills**: Updated grimoire-morpho-blue SKILL.md with Ethereum default markets and auto-select behavior
  - **Skills**: Updated grimoire-pendle SKILL.md with PT/YT/SY token resolution documentation

## 0.10.4

### Patch Changes

- cd7c12e: Fix CLI issues identified by platform eval (30% → estimated 55%+ pass rate)

  - **Expression parser**: Accept `.5` as `0.5` in inline expressions (matches main tokenizer behavior)
  - **Uniswap V3**: Guard `min_output` slippage computation when pool returns zero quote — falls through to default slippage instead of throwing
  - **Morpho Blue**: Add Ethereum mainnet default markets (cbBTC/USDC, WBTC/USDC, wstETH/WETH) so Morpho operations on chain 1 no longer fail with "market not configured"
  - **Morpho Blue**: Resolve lend ambiguity when multiple markets share the same loan token — auto-selects first match with warning instead of throwing
  - **Token registry**: Add wstETH to Ethereum SHARED_TOKENS (WBTC and cbBTC already covered by Uniswap default list)

- Updated dependencies [cd7c12e]
  - @grimoirelabs/core@0.17.3

## 0.10.3

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

## 0.10.2

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

## 0.10.1

### Patch Changes

- Updated dependencies [676f3bf]
  - @grimoirelabs/core@0.17.1

## 0.10.0

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

## 0.9.3

### Patch Changes

- cd9f40b: Venues package round 2 cleanup: consolidate shared utilities and remove dead code

  - Extract `applyBps()` and `BPS_DENOMINATOR` into `shared/bps.ts`; remove duplicate implementations from across and pendle adapters
  - Extract `validateGasConstraints()` into `shared/constraints.ts`; replace identical gas validation boilerplate in across, pendle, uniswap-v3, and uniswap-v4 adapters
  - Replace magic numbers with named constants (`DEFAULT_FEE`, `DEFAULT_DEADLINE_SECONDS`, `DEFAULT_SLIPPAGE_BPS`, `DEFAULT_TICK_SPACING`) in uniswap-v3 and uniswap-v4
  - Delete dead `compound-v3.ts` stub (never imported or exported)
  - Re-export `isMorphoAction` and `isSupportedPendleAction` from package index
  - Add unit tests for `shared/bigint.ts` and `shared/gas.ts`
  - Token registry improvements: add `BRIDGE_INDEX` from Uniswap token list `bridgeInfo` extensions, `REVERSE_INDEX` for address→token reverse lookup, and `registerToken()` for runtime registration
  - Export `TokenRecord` interface and new functions: `resolveBridgedTokenAddress`, `tryResolveTokenByAddress`, `registerToken`
  - Simplify Across adapter: remove hardcoded `DEFAULT_ASSETS` map; `resolveAssetAddress` now uses config → registry → bridge index → fallback chain; `assets` config is optional; add `supportedChains` config

## 0.9.2

### Patch Changes

- Updated dependencies [29023f3]
  - @grimoirelabs/core@0.16.0

## 0.9.1

### Patch Changes

- Updated dependencies [26ed9bb]
  - @grimoirelabs/core@0.15.0

## 0.9.0

### Minor Changes

- 340da5d: Wire QueryProvider through the execution pipeline. Adds pluggable `QueryProvider` interface that flows from CLI through `ExecuteOptions` → `ExecutionContext` → `createEvalContext()`, enabling `price()` and `balance()` query functions at runtime. Includes Alchemy-backed implementation (`createAlchemyQueryProvider`) with auto-extracted API key from RPC URL. Type checker now supports optional arguments on built-in functions (`price(base, quote, source?)`, `balance(asset, address?)`).

### Patch Changes

- Updated dependencies [340da5d]
  - @grimoirelabs/core@0.14.0

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
