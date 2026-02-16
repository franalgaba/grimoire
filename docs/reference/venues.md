# Venue Adapter Reference

This page documents adapters exposed by `@grimoirelabs/venues` from `packages/venues/src/index.ts`.

## Adapter Model

Each adapter implements `VenueAdapter`:

- `meta`: capability metadata for discovery and constraint support
- `buildAction(action, ctx)`: build EVM tx plan (single or multi-tx)
- `executeAction(action, ctx)`: offchain execution path (optional)

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

Unsupported constraints fail fast with:

`Adapter '<name>' does not support constraint '<constraint>' for action '<action>'`

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
- Data endpoints: `info`, `routers`, `tokens`, `pools`

Implementation notes:

- Uses Universal Router v2 + Quoter when available.
- Returns structured quote metadata and route details.
- Supports `max_slippage`, `min_output`, `max_input`, `deadline`, `require_quote`, `require_simulation`, `max_gas`.
- Supports native ETH in/out mapping to V4 currency conventions.

## `morpho_blue`

- Type: `evm`
- Actions: `lend`, `withdraw`, `borrow`, `repay`
- Data endpoints: `info`, `addresses`, `vaults`

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
- Pendle

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
- `grimoire-hyperliquid`
- `grimoire-pendle`

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

### `grimoire-pendle`

Commands:

- `info`
- `chains`
- `supported-aggregators`
- `markets`
- `assets`
- `market-tokens`
