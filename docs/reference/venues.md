# Venue Adapter Reference

This page documents adapters exposed by `@grimoirelabs/venues` from `packages/venues/src/index.ts`.

## Adapter Model

Each adapter implements `VenueAdapter`:

- `meta`: name, supported chains, actions, execution type
- `buildAction(action, ctx)`: build EVM tx plan (single or multi-tx)
- `executeAction(action, ctx)`: offchain execution path (optional)

Execution types:

- `evm`: action compiled to transaction(s)
- `offchain`: action executed through external API

## Registered Adapters

Default adapter bundle order:

- `aave_v3`
- `uniswap_v3`
- `uniswap_v4`
- `morpho_blue`
- `hyperliquid`
- `across`
- `yellow`
- `lifi`

## `aave_v3`

- Type: `evm`
- Actions: `lend`, `withdraw`, `borrow`, `repay`
- Default markets:
  - chain 1: `0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2`
  - chain 8453: `0xA238Dd80C259a72e81d7e4664a9801593F98d1c5`

Implementation notes:

- Uses `@aave/client` action builders.
- Handles approval-required flows by returning multiple txs.
- In preview/dry-run may emit placeholder tx for insufficient-balance plans.
- Amount handling follows Aave SDK conventions (human vs exact wrappers per action type).

## `uniswap_v3`

- Type: `evm`
- Actions: `swap`
- Default router: `0xE592427A0AEce92De3Edee1F18E0157C05861564` on supported chains

Implementation notes:

- Builds routes/pools via Uniswap V3 SDK.
- Fetches on-chain pool state (`slot0`, `liquidity`) for quote-like pathing.
- Resolves constraints:
  - `maxSlippageBps`
  - `minOutput`
  - `maxInput`
- For native ETH input:
  - wraps ETH to WETH
  - adds approval tx
  - submits swap tx

## `uniswap_v4`

- Type: `evm`
- Actions: `swap`
- Uses Universal Router v2 + quote pathing.

Implementation notes:

- Supports exact-in/exact-out swap modes.
- Uses quoter when available; otherwise fallback behavior applies.
- Applies explicit `min_output` / `max_input` constraints when present.
- Supports native ETH in/out mapping to V4 currency conventions.

## `morpho_blue`

- Type: `evm`
- Actions: `lend`, `withdraw`, `borrow`, `repay`
- Supported chains: `[1, 8453]`

Implementation notes:

- Encodes Blue contract calls with `blueAbi`.
- Uses market resolution by loan token and optional collateral.
- Approval path for `lend` and `repay`.

Default embedded Base markets include:

- cbBTC/USDC (86% LLTV)
- WETH/USDC (86% LLTV)

## `across`

- Type: `evm`
- Actions: `bridge`

Implementation notes:

- Requires numeric `toChain` at action resolution time.
- Uses Across quote API and spoke pool `deposit` simulation.
- Builds approval tx for ERC20 bridge input when required.
- Supports mapped assets (USDC/WETH defaults across multiple chains).

Constraint behavior:

- Honors `maxSlippageBps` and `minOutput` when computing output amount.

## `hyperliquid`

- Type: `offchain`
- Actions: `swap`, `withdraw`
- Supported chains in metadata: `[0, 999]`

Implementation notes:

- `hyperliquidAdapter` requires key-configured factory for real execution.
- `createHyperliquidAdapter` uses private key and asset map.
- `executeAction` sends orders/withdraws via Hyperliquid client APIs.

## `yellow`

- Type: `offchain`
- Actions: `custom`

Supported custom ops:

- `session_open`
- `session_update`
- `session_close_settle`
- `session_transfer`

Implementation notes:

- Talks to NitroRPC endpoints via `YELLOW_RPC_URL`.
- Tracks session version/signers/quorum state internally.
- Enforces version increments and quorum checks before submit.

## `lifi`

- Type: `offchain`
- Actions: `swap`, `bridge`, `custom`

Supported custom op:

- `compose_execute`

Implementation notes:

- Uses LI.FI API (default `https://li.quest/v1`).
- Supports API key/integrator headers.
- Enforces runtime constraints against quote payload where possible:
  - `minOutput`
  - `maxSlippageBps`
  - `maxGas`

## Core vs Venues Boundary

- `@grimoirelabs/core` remains protocol-agnostic.
- All SDK/protocol integration belongs in `@grimoirelabs/venues`.
- Adapters are injected at runtime via `execute({ adapters })`.

## Venue CLI Proxies

`grimoire venue <adapter> ...` proxies to per-venue CLIs currently for:

- Aave
- Uniswap
- Morpho Blue
- Hyperliquid

Across/Yellow/LI.FI currently expose adapters in runtime, not proxied top-level venue CLIs from `grimoire venue`.

## Per-Venue CLI Commands

`@grimoirelabs/venues` publishes these binaries:

- `grimoire-aave`
- `grimoire-uniswap`
- `grimoire-morpho-blue`
- `grimoire-hyperliquid`

### `grimoire-aave`

Commands:

- `health`
- `chains`
- `markets`
- `market`
- `reserve`
- `reserves`

`reserves` supports `--format spell` snapshot output.

### `grimoire-uniswap`

Commands:

- `info`
- `routers`
- `tokens`
- `pools`

`tokens` and `pools` support `--format spell` snapshot output.

### `grimoire-morpho-blue`

Commands:

- `info`
- `addresses`
- `vaults`

`vaults` supports `--format spell` snapshot output.

### `grimoire-hyperliquid`

Commands:

- `mids`
- `l2-book`
- `open-orders`
- `meta`
- `spot-meta`
- `withdraw`

Most read-only commands support `--format spell` snapshot output.
