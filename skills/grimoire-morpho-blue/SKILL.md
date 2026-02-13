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

- `grimoire venue morpho-blue info [--format <json|table>]`
- `grimoire venue morpho-blue addresses [--chain <id>] [--format <json|table>]`
- `grimoire venue morpho-blue vaults [--chain <id>] [--asset <symbol>] [--min-tvl <usd>] [--min-apy <decimal>] [--min-net-apy <decimal>] [--sort <field>] [--order <asc|desc>] [--limit <n>] [--format <json|table|spell>]`

## Examples

```bash
grimoire venue morpho-blue info --format table
grimoire venue morpho-blue addresses --chain 1
grimoire venue morpho-blue addresses --chain 8453
grimoire venue morpho-blue vaults --chain 8453 --asset USDC --min-tvl 5000000 --format table
grimoire venue morpho-blue vaults --chain 8453 --asset USDC --min-tvl 5000000 --format spell
```

Example provenance output fields to preserve:

- `snapshot_at`
- `snapshot_source`
- `units` (for example `net_apy=decimal`, `net_apy_pct=percent`, `tvl_usd=usd`)

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
