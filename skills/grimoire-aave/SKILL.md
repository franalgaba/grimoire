---
name: grimoire-aave
description: Fetches Aave V3 public market data using the Grimoire venue CLI. Use when you need Aave health checks, chain listings, market metadata, or reserve info.
---

# Grimoire Aave Skill

Use the `grimoire-aave` CLI to query Aave market data exposed by the SDK.

## Commands

- `grimoire-aave health`
- `grimoire-aave chains`
- `grimoire-aave markets --chain <id> [--user <address>]`
- `grimoire-aave market --chain <id> --address <market> [--user <address>]`
- `grimoire-aave reserve --chain <id> --market <address> --token <address>`

## Examples

```bash
grimoire-aave health
grimoire-aave chains
grimoire-aave markets --chain 1
grimoire-aave market --chain 1 --address 0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2
grimoire-aave reserve --chain 1 --market 0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2 --token 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48
```

## Notes

- Outputs JSON plus a human-readable table.
- Only public SDK endpoints are exposed.
