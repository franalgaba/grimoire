# Venue Adapter Reference

This page documents adapters exposed by `@grimoirelabs/venues` from `packages/venues/src/index.ts`.

## Adapter Model

Each adapter implements `VenueAdapter`:

- `meta`: capability metadata for discovery and constraint support
- `buildAction(action, ctx)`: build EVM tx plan (single or multi-tx)
- `executeAction(action, ctx)`: offchain execution path (optional)
- `readMetric(request, ctx)`: optional metric query surface for `metric()` / `apy()`

`meta` includes:

- `name`, `supportedChains`, `actions`, `executionType`
- `supportedConstraints`
- `supportsQuote`, `supportsSimulation`, `supportsPreviewCommit`
- `requiredEnv`, `dataEndpoints`

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
- `pendle`
- `polymarket`

## Constraint Matrix

`✓` means the adapter explicitly supports the runtime constraint.

| Adapter | max_slippage | min_output | max_input | deadline | max_price_impact | min_liquidity | require_quote | require_simulation | max_gas |
|---------|--------------|------------|-----------|----------|------------------|---------------|---------------|--------------------|---------|
| `aave_v3` | - | - | - | - | - | - | - | - | - |
| `uniswap_v3` | ✓ | ✓ | ✓ | ✓ | - | - | ✓ | ✓ | ✓ |
| `uniswap_v4` | ✓ | ✓ | ✓ | ✓ | - | - | ✓ | ✓ | ✓ |
| `morpho_blue` | - | - | - | - | - | - | - | - | - |
| `across` | ✓ | ✓ | - | - | - | - | ✓ | ✓ | ✓ |
| `hyperliquid` | - | - | - | - | - | - | - | - | - |
| `pendle` | ✓ | ✓ | - | - | - | - | ✓ | - | ✓ |
| `polymarket` | - | - | - | - | - | - | - | - | - |

Unsupported constraints fail fast with:

`Adapter '<name>' does not support constraint '<constraint>' for action '<action>'`

## Metric Surfaces

These surfaces are available through spell expressions:

- `apy(venue, asset[, selector])`
- `metric(surface, venue[, asset[, selector]])`

| Adapter | Surfaces | Selector examples |
|---------|----------|-------------------|
| `aave_v3` | `apy` | `apy(aave, USDC)` |
| `morpho_blue` | `apy` | `apy(morpho, USDC, "wbtc-usdc-1")` |
| `uniswap_v3` | `quote_out` | `metric("quote_out", uni_v3, USDC, "asset_out=WETH,amount=1000000,fee_tier=3000")` |
| `uniswap_v4` | `quote_out` | `metric("quote_out", uni_v4, USDC, "asset_out=WETH,amount=1000000,fee_tier=3000")` |
| `across` | `quote_out` | `metric("quote_out", across, USDC, "to_chain=8453,amount=1000000")` |
| `pendle` | `quote_out` | `metric("quote_out", pendle, USDC, "asset_out=DAI,amount=1000000,slippage_bps=1000")` |
| `hyperliquid` | `mid_price` | `metric("mid_price", hyperliquid, ETH)` |
| `polymarket` | `mid_price` | `metric("mid_price", polymarket, USDC, "token_id=<clobTokenId>")` |

## Structured Build/Execution Data

Adapters can return structured metadata on build outputs:

- `metadata.quote`: expected in/out bounds, slippage, min/max limits
- `metadata.route`: machine-readable route/preflight context
- `metadata.fees`: fee breakdown payload
- `metadata.warnings`: non-fatal warnings

Offchain execution is normalized through:

- `status` (required)
- `reference` (optional: route/session/order id)
- `raw` (optional provider payload)

## `aave_v3`

- Type: `evm`
- Actions: `lend`, `withdraw`, `borrow`, `repay`
- Data endpoints: `health`, `chains`, `markets`, `market`, `reserve`, `reserves`

Implementation notes:

- Uses `@aave/client` action builders.
- Handles approval-required flows by returning multiple txs.
- In preview/dry-run may emit placeholder tx for insufficient-balance plans.
- Amount handling follows Aave SDK conventions (human vs exact wrappers per action type).

## `uniswap_v3`

- Type: `evm`
- Actions: `swap`
- Data endpoints: `info`, `routers`, `tokens`, `pools`

Implementation notes:

- Fetches on-chain pool state (`slot0`, `liquidity`) and returns structured quote metadata.
- Supports `max_slippage`, `min_output`, `max_input`, `deadline`, `require_quote`, `require_simulation`, `max_gas`.
- For native ETH input:
  - wraps ETH to WETH
  - adds approval tx
  - submits swap tx

## `uniswap_v4`

- Type: `evm`
- Actions: `swap`
- Data endpoints: none on adapter metadata (use `grimoire venue uniswap ...` for token/pool discovery)

Implementation notes:

- Uses Universal Router v2 + Quoter when available.
- Returns structured quote metadata and route details.
- Supports `max_slippage`, `min_output`, `max_input`, `deadline`, `require_quote`, `require_simulation`, `max_gas`.
- Supports native ETH in/out mapping to V4 currency conventions.

## `morpho_blue`

- Type: `evm`
- Actions: `lend`, `withdraw`, `borrow`, `repay`, `supply_collateral`, `withdraw_collateral`
- Data endpoints: `info`, `addresses`, `vaults`, `markets`

Implementation notes:

- Encodes Blue contract calls with `blueAbi`.
- Uses market resolution by loan token and optional collateral.
- `supply_collateral` / `withdraw_collateral` resolve by collateral token.
- Approval path for `lend`, `repay`, and `supply_collateral`.
- Borrow preflight checks in preview/dry-run fail fast for:
  - zero position collateral
  - insufficient market liquidity
  - clear collateral headroom shortfalls (when oracle price is available)
- Borrow preflight errors include market context and suggest `supply_collateral`.

Default embedded Base markets include:

- cbBTC/USDC (86% LLTV)
- WETH/USDC (86% LLTV)

## `across`

- Type: `evm`
- Actions: `bridge`
- Data endpoints: `quote`, `deposit_simulation`

Implementation notes:

- Requires numeric `toChain`.
- Uses Across quote API + spoke pool deposit simulation.
- Builds approval tx for ERC20 bridge input when required.
- Enforces route minimum bridge amount before tx build.
- Returns structured quote/route/fee metadata, including ETA.
- Supports `max_slippage`, `min_output`, `require_quote`, `require_simulation`, `max_gas`.

## `pendle`

- Type: `evm`
- Actions: `swap`, `add_liquidity`, `add_liquidity_dual`, `remove_liquidity`, `remove_liquidity_dual`, `mint_py`, `redeem_py`, `mint_sy`, `redeem_sy`, `transfer_liquidity`, `roll_over_pt`, `exit_market`, `convert_lp_to_pt`, `pendle_swap`, `custom`
- Data endpoints: `chains`, `supported-aggregators`, `markets`, `assets`, `market-tokens`

Implementation notes:

- Uses Pendle Hosted SDK convert endpoints (`/v3/sdk/{chainId}/convert`) with optional fallback to v2.
- Selects `routes[0]`, builds tx from `route.tx`, and prepends ERC20 approvals from `requiredApprovals`.
- `swap` only supports `mode: exact_in`; `exact_out` fails fast.
- Default aggregator policy is disabled (`enableAggregator=false`) unless explicitly enabled per action.
- Supports `max_slippage`, `min_output`, `require_quote`, `max_gas`.
- `max_slippage` is validated as finite integer bps in `[0, 10000]`.
- Slippage is always sent to Pendle as canonical decimal (`bps / 10000`).

Output token formatting notes:

- For `assetOut` and `outputs`, use bare address literals when passing explicit token addresses.
- Quoted address-like strings (for example `"0x..."`) are invalid and surface validator code `QUOTED_ADDRESS_LITERAL`.

## `hyperliquid`

- Type: `offchain`
- Actions: `custom`, `withdraw`
- Supported chains in metadata: `[0, 999]`
- Data endpoints: `mids`, `l2-book`, `open-orders`, `meta`, `spot-meta`

Implementation notes:

- Order placement is represented as `custom` action with `op: "order"`.
- Order args are strictly validated at adapter boundary (`coin`, `price`, `size`, side/buy-sell).
- `hyperliquidAdapter` requires key-configured factory for real execution.
- Foundry EVM tools (`anvil`, `cast`) are not applicable to Hyperliquid execution/diagnostics.

## `polymarket`

- Type: `offchain`
- Actions: `custom`
- Supported chains in metadata: `[137]`
- Data endpoints: `book`, `midpoint`, `spread`, `events`, `markets`

Implementation notes:

- Order placement is represented as `custom` action with `op: "order"`.
- Supported custom ops: `order`, `cancel_order`, `cancel_orders`, `cancel_all`, `heartbeat`.
- `order` normalization accepts CLOB-style fields (`token_id`, `price`, `size`, `side`, `order_type`) and transformer-style aliases (`coin`, `arg0..arg5`).
- Uses `@polymarket/clob-client` under the hood and maps:
  - `GTC`/`GTD` -> `createAndPostOrder`
  - `FOK`/`FAK` -> `createAndPostMarketOrder`
- `reduce_only` is treated as a compatibility alias for `neg_risk` (boolean) or `tick_size` (string) when present.
- The Grimoire Polymarket venue CLI wrapper (`grimoire venue polymarket ...`) uses the official `polymarket` CLI binary as backend.
  - Install: `brew tap Polymarket/polymarket-cli && brew install polymarket`
  - Optional override: `POLYMARKET_OFFICIAL_CLI=/path/to/polymarket`
- `polymarketAdapter` resolves auth from env by default:
  - required: `POLYMARKET_PRIVATE_KEY` (when adapter is not key-configured programmatically)
  - optional API creds: `POLYMARKET_API_KEY`, `POLYMARKET_API_SECRET`, `POLYMARKET_API_PASSPHRASE`
  - optional derive toggle: `POLYMARKET_DERIVE_API_KEY` (default: true)
- `grimoire cast` / `grimoire resume` key-based paths inject the same loaded wallet key into the Polymarket adapter factory, so a separate `POLYMARKET_PRIVATE_KEY` env is not required there.
- Advanced users can inject a prebuilt client with `createPolymarketAdapter({ client })`.

## QueryProvider

`@grimoirelabs/venues` exports a `QueryProvider` factory backed by Alchemy for on-chain balance reads and token price lookups.

### `createAlchemyQueryProvider(config)`

Creates a `QueryProvider` with two capabilities:

- **`queryBalance(asset, address?)`** -- on-chain `ERC20.balanceOf()` via the RPC provider. Native ETH is handled via `provider.getBalance()`. Defaults to the configured vault address when `address` is omitted.
- **`queryPrice(base, quote)`** -- token price via the [Alchemy Token Prices API](https://docs.alchemy.com/reference/token-prices). Requires an Alchemy API key. USD-denominated stablecoins (USD, USDC, USDT) are treated as 1:1 USD.

Config type -- `AlchemyQueryProviderConfig`:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `provider` | `Provider` | yes | EVM RPC provider for balance reads |
| `chainId` | `number` | yes | Chain ID for token address resolution |
| `vault` | `Address` | yes | Default address for balance queries |
| `alchemyApiKey` | `string` | no | Explicit Alchemy API key |
| `rpcUrl` | `string` | no | Used to extract API key if `alchemyApiKey` is not set |

API key resolution: if `alchemyApiKey` is not provided, the factory calls `extractAlchemyKey(rpcUrl)` which matches the pattern `https://{network}.g.alchemy.com/v2/{key}`. If no key is available, `queryPrice` throws at call time; `queryBalance` always works.

Also exported: `extractAlchemyKey(rpcUrl?: string): string | undefined`

Example:

```ts
import { createAlchemyQueryProvider } from "@grimoirelabs/venues";

const qp = createAlchemyQueryProvider({
  provider,
  chainId: 1,
  vault: "0xYourVault",
  rpcUrl: "https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY",
});

const balance = await qp.queryBalance("USDC");       // on-chain balance
const price   = await qp.queryPrice("ETH", "USDC");  // price via Alchemy API
```

## Core vs Venues Boundary

- `@grimoirelabs/core` remains protocol-agnostic.
- All SDK/protocol integration belongs in `@grimoirelabs/venues`.
- Adapters are injected at runtime via `execute({ adapters })`.

## Venue Plugin Discovery

Venues are discovered automatically via the `VenueManifest` contract:

```ts
interface VenueManifest {
  name: string;        // e.g. "aave", "gmx"
  aliases?: string[];  // e.g. ["aave-v3"]
  cli: string;         // absolute path to CLI entry point
  adapter?: string;    // absolute path to adapter module
}
```

**Built-in venues** are discovered by scanning `packages/venues/src/cli/` (dev) or `dist/cli/` (prod). Adding a new CLI file and adapter automatically wires it into the system.

**External venues** are discovered from `node_modules/grimoire-venue-*` and `@*/grimoire-venue-*` packages that include a `"grimoire"` field with `type: "venue"` in their `package.json`.

See `docs/how-to/add-a-venue.md` for step-by-step contribution instructions.

## Venue CLI Proxies

`grimoire venue <adapter> ...` proxies to per-venue CLIs via the discovery system. Built-in venues:

- Aave (aliases: aave-v3)
- Uniswap (aliases: uniswap-v3, uniswap-v4)
- Morpho Blue (aliases: morpho)
- Across (aliases: across-protocol)
- Hyperliquid
- Pendle
- Polymarket

External `grimoire-venue-*` packages are also discovered and routed automatically.

`grimoire venue doctor ...` runs cross-adapter diagnostics from the main CLI without calling a per-venue binary.

## Venue CLI Output Formats

Per-venue CLIs support `--format <auto|json|table>` (plus `spell` for snapshot-capable commands).

`auto` behavior:

- table only when output is TTY-friendly and data is flat (primitive values)
- JSON for nested payloads or non-TTY runs (recommended for automation)

`table` behavior for nested payloads:

- nested arrays/objects are summarized to compact cells
- use `--format json` when full nested payload detail is required

## Per-Venue CLI Commands

`@grimoirelabs/venues` publishes these binaries:

- `grimoire-aave`
- `grimoire-uniswap`
- `grimoire-morpho-blue`
- `grimoire-across`
- `grimoire-hyperliquid`
- `grimoire-pendle`
- `grimoire-polymarket`

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

### `grimoire-across`

Commands:

- `info`
- `chains`
- `quote`
- `status`
- `routes`

`quote` returns bridge quotes with fees, limits, and estimated fill time. `status` checks deposit progress by origin tx hash. `routes` lists available chain pairs for a given asset.

### `grimoire-hyperliquid`

Commands:

- `mids`
- `l2-book`
- `open-orders`
- `meta`
- `spot-meta`
- `withdraw`

Most read-only commands support `--format spell` snapshot output.

### `grimoire-pendle`

Commands:

- `info`
- `chains`
- `supported-aggregators`
- `markets`
- `assets`
- `market-tokens`

### `grimoire-polymarket`

Commands:

- Official passthrough command groups:
`markets`, `data`.
- Canonical agent commands:
`info`, `status`, `search-markets`.
- Blocked groups (not exposed by wrapper):
`wallet`, `bridge`, `approve`, `ctf`, `setup`, `upgrade`, `shell`.
- Legacy aliases remain for backward compatibility (`server-time`, `market`, `book`, `midpoint`, `spread`, `price`, `last-trade-price`, `tick-size`, `neg-risk`, `fee-rate`, `price-history`, `order`, `trades`, `open-orders`, `balance-allowance`, `closed-only-mode`) but should not be used for new agent flows.

`search-markets` supports cross-category discovery filters: `--query`, `--slug`, `--question`,
`--event`, `--tag`, `--category`, `--league`, `--sport`, plus pagination controls including
`--stop-after-empty-pages`.
