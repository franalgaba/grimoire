---
"@grimoirelabs/core": minor
"@grimoirelabs/venues": minor
"@grimoirelabs/cli": minor
---

Migrate CLI to incur, eliminate implicit resolution, add MetaMorpho vaults, wire up Across venue

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
