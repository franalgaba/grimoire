---
name: grimoire-morpho-blue
description: Fetches Morpho Blue public deployment metadata using the Grimoire venue CLI. Use when you need contract addresses or adapter info.
---

# Grimoire Morpho Blue Skill

Use the `grimoire-morpho-blue` CLI to read Morpho Blue deployment data.

## Commands

- `grimoire-morpho-blue info`
- `grimoire-morpho-blue addresses [--chain <id>]`

## Examples

```bash
grimoire-morpho-blue info
grimoire-morpho-blue addresses --chain 1
grimoire-morpho-blue addresses --chain 8453
```

## Default Markets (Base)

The adapter ships with pre-configured markets for Base (chain 8453):

| Market | Collateral | LLTV |
|--------|-----------|------|
| cbBTC/USDC | cbBTC | 86% |
| WETH/USDC | WETH | 86% |

When no collateral is specified in a spell, the first matching market by loan token is selected.

## Notes

- Outputs JSON plus a human-readable table.
- Uses the SDK's chain address registry.
