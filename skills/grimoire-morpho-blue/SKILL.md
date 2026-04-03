---
name: grimoire-morpho-blue
description: Fetches Morpho Blue public deployment metadata using the Grimoire venue CLI. Use when you need contract addresses or adapter info.
---

# Grimoire Morpho Blue Skill

Use this skill to query Morpho Blue deployment metadata and vault snapshots for spell params.

Preferred invocations:

- `grimoire venue morpho-blue ...`
- `npx -y @grimoirelabs/cli venue morpho-blue ...` (no-install)
- `bun run packages/cli/src/index.ts venue morpho-blue ...` (repo-local)
- `grimoire-morpho-blue ...` (direct binary from `@grimoirelabs/venues`)

Recommended preflight:

- `grimoire venue doctor --adapter morpho-blue --chain 8453 --rpc-url <rpc> --json`

Use `--format spell` to emit a `params:` snapshot block.

The snapshot includes provenance fields (`snapshot_at`, `snapshot_source`) and APY data.

APY semantics:

- `apy` / `net_apy` are decimal rates (for example `0.0408` = `4.08%`).
- When reporting, include both decimal and percent display when possible.

## Commands

- `grimoire venue morpho-blue info` — adapter metadata
- `grimoire venue morpho-blue addresses [--chain <id>]` — contract addresses per chain
- `grimoire venue morpho-blue vaults [--chain <id>] [--asset <symbol>] [--min-tvl <usd>] [--min-apy <decimal>] [--min-net-apy <decimal>] [--sort <netApy|apy|tvl|totalAssetsUsd|name>] [--order <asc|desc>] [--limit <n>]` — list and filter vaults
- `grimoire venue morpho-blue vaults-snapshot [--chain <id>] [--asset <symbol>] [--min-tvl <usd>] [--min-apy <decimal>] [--min-net-apy <decimal>] [--sort <netApy|apy|tvl|totalAssetsUsd|name>] [--order <asc|desc>] [--limit <n>]` — generate spell `params:` block for vaults (agent-only)

## Examples

```bash
grimoire venue morpho-blue info --format table
grimoire venue morpho-blue addresses --chain 1
grimoire venue morpho-blue addresses --chain 8453
grimoire venue morpho-blue vaults --chain 8453 --asset USDC --min-tvl 5000000 --format table
grimoire venue morpho-blue vaults --chain 8453 --asset USDC --min-tvl 5000000 --format spell
grimoire venue morpho-blue vaults-snapshot --chain 8453 --asset USDC --min-tvl 5000000
```

Use `vaults-snapshot` to emit a `params:` block for spell inputs. This is an agent-only command (output suppressed in interactive mode).

Example provenance output fields to preserve:

- `snapshot_at`
- `snapshot_source`
- `units` (for example `net_apy=decimal`, `net_apy_pct=percent`, `tvl_usd=usd`)

## Metric Surface (Spell Comparisons)

Morpho exposes the `apy` metric surface and supports selector-based market targeting:

```spell
morpho_apy_default = apy(morpho, USDC)
morpho_apy_market = apy(morpho, USDC, "weth-usdc-86")
morpho_apy_market_id = apy(morpho, USDC, "0x...")
morpho_apy_generic = metric("apy", morpho, USDC, "wbtc-usdc-86")
```

Selector behavior:

- no selector: resolves by `asset` on the active chain and picks the highest-TVL match
- config market selector: use known market ids from adapter config (for example `weth-usdc-86`)
- onchain market id selector: use raw market id (`0x...`)

When multiple vaults/markets exist for one asset, pass an explicit selector for deterministic comparisons.

## Spell Constraints

Morpho Blue actions do not support runtime constraints (`max_slippage`, etc.). The adapter resolves markets by loan token and optional collateral.

```spell
morpho_blue.lend(USDC, params.amount)
morpho_blue.withdraw(USDC, params.amount)
morpho_blue.borrow(USDC, params.amount)
morpho_blue.supply_collateral(cbBTC, params.amount)
morpho_blue.withdraw_collateral(cbBTC, params.amount)
```

**Market resolution is automatic.** When multiple markets match a loan token and no collateral or `market_id` is specified, the adapter auto-selects the first matching market and emits a warning. To target a specific market explicitly, specify `market_id` in the `with()` clause:

```spell
morpho_blue.lend(USDC, params.amount) with (
  market_id="0x1234...abcd",
)
```

Use `grimoire venue morpho-blue vaults` to discover available market IDs.

## Default Markets

The adapter ships with pre-configured markets for Ethereum (chain 1) and Base (chain 8453):

### Ethereum (chain 1)

| Market | Loan | Collateral | LLTV |
|--------|------|-----------|------|
| cbbtc-usdc-1 | USDC | cbBTC | 86% |
| wbtc-usdc-1 | USDC | WBTC | 86% |
| wsteth-weth-1 | WETH | wstETH | 96.5% |

### Base (chain 8453)

| Market | Loan | Collateral | LLTV |
|--------|------|-----------|------|
| cbbtc-usdc-86 | USDC | cbBTC | 86% |
| weth-usdc-86 | USDC | WETH | 86% |

When no collateral is specified, the adapter auto-selects the first matching market by loan token.

## Notes

- Outputs JSON/table; `vaults` also supports `--format spell`.
- Uses the SDK's chain address registry.
- Prefer `--format json` in automation and `--format table` for quick triage.
