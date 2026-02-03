---
name: grimoire-uniswap
description: Retrieves Uniswap router metadata using the Grimoire venue CLI. Use when you need router addresses, adapter information, or Uniswap V3/V4 details.
---

# Grimoire Uniswap Skill

Use the `grimoire-uniswap` CLI to read public Uniswap adapter data.

## Commands

- `grimoire-uniswap info`
- `grimoire-uniswap routers [--chain <id>]`

## Examples

```bash
grimoire-uniswap info
grimoire-uniswap routers
grimoire-uniswap routers --chain 1
```

## Supported Adapters

| Adapter | Router | Approval Flow |
|---------|--------|---------------|
| `@uniswap_v3` | SwapRouter02 | Standard ERC20 approve |
| `@uniswap_v4` | Universal Router | Permit2 |

## Notes

- CLI currently exposes V3 metadata. V4 adapter is available programmatically via `createUniswapV4Adapter()`.
- Outputs JSON plus a human-readable table.
- Only metadata is exposed (no on-chain quote endpoints).
