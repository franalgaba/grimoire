---
name: grimoire-uniswap
description: Retrieves Uniswap V3 router metadata using the Grimoire venue CLI. Use when you need router addresses or adapter information.
---

# Grimoire Uniswap Skill

Use the `grimoire-uniswap` CLI to read public Uniswap V3 adapter data.

## Commands

- `grimoire-uniswap info`
- `grimoire-uniswap routers [--chain <id>]`

## Examples

```bash
grimoire-uniswap info
grimoire-uniswap routers
grimoire-uniswap routers --chain 1
```

## Notes

- Outputs JSON plus a human-readable table.
- Only metadata is exposed (no on-chain quote endpoints).
