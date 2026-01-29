---
name: grimoire-hyperliquid
description: Queries Hyperliquid public market data using the Grimoire venue CLI. Use when you need mid prices, L2 order books, or open orders.
---

# Grimoire Hyperliquid Skill

Use the `grimoire-hyperliquid` CLI for public Hyperliquid market data.

## Commands

- `grimoire-hyperliquid mids`
- `grimoire-hyperliquid l2-book --coin <symbol>`
- `grimoire-hyperliquid open-orders --user <address>`
- `grimoire-hyperliquid meta`
- `grimoire-hyperliquid spot-meta`

## Examples

```bash
grimoire-hyperliquid mids
grimoire-hyperliquid l2-book --coin BTC
grimoire-hyperliquid open-orders --user 0x0000000000000000000000000000000000000000
grimoire-hyperliquid meta
```

## Notes

- Outputs JSON plus a human-readable table.
- Uses Hyperliquid Info endpoints only (no authenticated actions).
