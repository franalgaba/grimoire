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

## Spell Constraints

Morpho Blue actions do not support runtime constraints (`max_slippage`, etc.). The adapter resolves markets by loan token and optional collateral.

```spell
morpho_blue.lend(USDC, params.amount)
morpho_blue.withdraw(USDC, params.amount)
morpho_blue.borrow(USDC, params.amount)
morpho_blue.supply_collateral(cbBTC, params.amount)
morpho_blue.withdraw_collateral(cbBTC, params.amount)
```

**Market resolution is strict.** When multiple markets match a loan token and no `market_id` is specified, the adapter throws an error listing candidate market IDs instead of silently picking one. Single-market resolution remains implicit.

To target a specific market when ambiguous, specify `market_id` in the `with()` clause:

```spell
morpho_blue.lend(USDC, params.amount) with (
  market_id="0x1234...abcd",
)
```

Use `grimoire venue morpho-blue vaults` to discover available market IDs.

## Default Markets (Base)

The adapter ships with pre-configured markets for Base (chain 8453):

| Market | Collateral | LLTV |
|--------|-----------|------|
| cbBTC/USDC | cbBTC | 86% |
| WETH/USDC | WETH | 86% |

When no collateral is specified in a spell, the first matching market by loan token is selected.

## Notes

- Outputs JSON/table; `vaults` also supports `--format spell`.
- Uses the SDK's chain address registry.
- Prefer `--format json` in automation and `--format table` for quick triage.
