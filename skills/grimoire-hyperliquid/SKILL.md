---
name: grimoire-hyperliquid
description: Queries Hyperliquid market data using the Grimoire venue CLI. Use when you need mids, books, metadata, open orders, or a withdrawal call.
---

# Grimoire Hyperliquid Skill

Use this skill for Hyperliquid metadata snapshots and, when explicitly requested, withdrawals.

Preferred invocations:

- `grimoire venue hyperliquid ...`
- `npx -y @grimoirelabs/cli venue hyperliquid ...` (no-install)
- `bun run packages/cli/src/index.ts venue hyperliquid ...` (repo-local)
- `grimoire-hyperliquid ...` (direct binary from `@grimoirelabs/venues`)

Recommended preflight:

- `grimoire venue doctor --adapter hyperliquid --json`
- Ensure `HYPERLIQUID_PRIVATE_KEY` is set before stateful actions (`withdraw`).

Use `--format spell` for snapshot `params:` blocks.

## Commands

- `grimoire venue hyperliquid mids [--format <json|table|spell>]`
- `grimoire venue hyperliquid l2-book --coin <symbol> [--format <json|table|spell>]`
- `grimoire venue hyperliquid open-orders --user <address> [--format <json|table|spell>]`
- `grimoire venue hyperliquid meta [--format <json|table|spell>]`
- `grimoire venue hyperliquid spot-meta [--format <json|table|spell>]`
- `grimoire venue hyperliquid withdraw --amount <usdc> --keystore <path> [--password-env <name>] [--destination <addr>] [--format <json|table>]`

## Examples

```bash
grimoire venue hyperliquid mids --format table
grimoire venue hyperliquid mids --format spell
grimoire venue hyperliquid l2-book --coin BTC
grimoire venue hyperliquid l2-book --coin BTC --format spell
grimoire venue hyperliquid open-orders --user 0x0000000000000000000000000000000000000000
grimoire venue hyperliquid meta
```

## Notes

- `withdraw` is stateful and requires explicit user confirmation plus keystore credentials.
- `mids`, `l2-book`, `open-orders`, `meta`, `spot-meta` are read-only info calls.
- Use `--format spell` for snapshot-based spell inputs.
- Use `--format json` for `meta`/`spot-meta` in automation; `--format table` shows compact summaries for nested payloads.
- `anvil`/`cast` are EVM tools and are not applicable for Hyperliquid execution/diagnostics.
