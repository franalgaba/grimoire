---
name: grimoire-uniswap
description: Retrieves Uniswap router metadata using the Grimoire venue CLI. Use when you need router addresses, adapter information, or Uniswap V3/V4 details.
---

# Grimoire Uniswap Skill

Use the Grimoire CLI to read public Uniswap adapter data.

Preferred:

- `grimoire venue uniswap ...`

If you installed `@grimoirelabs/venues` directly, you can also use `grimoire-uniswap`.

## When to use

- Fetch Uniswap router metadata, tokens, or pools for quick VM prototyping.
- Produce snapshot `params` blocks with `--format spell` for VM runs.

## Prerequisites

- Global CLI: `npm i -g @grimoirelabs/cli`
- No install: `npx -y @grimoirelabs/cli venue uniswap ...`

## VM snapshot usage

Use `--format spell` to emit a VM-ready `params:` block you can paste into a spell.

## Commands

- `grimoire venue uniswap info [--format <json|table>]`
- `grimoire venue uniswap routers [--chain <id>] [--format <json|table>]`
- `grimoire venue uniswap tokens [--chain <id>] [--symbol <sym>] [--address <addr>] [--source <url>] [--format <json|table|spell>]`
- `grimoire venue uniswap pools --chain <id> --token0 <address|symbol> --token1 <address|symbol> [--fee <bps>] [--limit <n>] [--source <url>] [--format <json|table|spell>] [--endpoint <url>] [--graph-key <key>] [--subgraph-id <id>] [--rpc-url <url>] [--factory <address>]`

If you provide `--rpc-url` (or `RPC_URL`) and omit `--endpoint`/`--graph-key`, pools uses onchain factory lookups instead of The Graph.

## Examples

```bash
grimoire venue uniswap info --format table
grimoire venue uniswap routers
grimoire venue uniswap routers --chain 1
grimoire venue uniswap tokens --chain 1 --symbol USDC --format spell
grimoire venue uniswap pools --chain 1 --token0 USDC --token1 WETH --fee 3000 --format spell
grimoire venue uniswap pools --chain 8453 --token0 USDC --token1 WETH --fee 500 --rpc-url $RPC_URL --format table
grimoire venue uniswap pools --chain 8453 --token0 USDC --token1 WETH --fee 500 --graph-key $GRAPH_API_KEY --subgraph-id <id> --format table
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
