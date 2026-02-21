# Author Pendle Routes Safely

This guide shows how to avoid the most common Pendle authoring failures in Grimoire.

## Goal

Write Pendle actions that pass validation and produce predictable routing inputs.

## Rules

1. Always set `max_slippage` for swaps/converts.
2. Provide output tokens via `assetOut` or `outputs`.
3. Use bare `0x...` address literals for token addresses (no quotes).

## Examples

Good (`assetOut` symbol):

```spell
pendle.swap(USDC, PT, params.amount) with max_slippage=50
```

Good (`outputs` with bare addresses):

```spell
pendle.add_liquidity(USDC, params.amount, [0x0000000000000000000000000000000000000001]) with max_slippage=75
```

Bad (quoted address literals):

```spell
pendle.add_liquidity(USDC, params.amount, ["0x0000000000000000000000000000000000000001"]) with max_slippage=75
```

The bad example triggers:

- `QUOTED_ADDRESS_LITERAL`
- `Detected quoted address literal "0x...". Use bare address literal 0x... (without quotes).`

## Slippage Behavior

- `max_slippage` is basis points (bps).
- Valid range is integer `[0, 10000]`.
- Runtime converts bps to decimal for Pendle API (`50 -> 0.005`, `123 -> 0.0123`).

## Verification Steps

1. Run `grimoire validate <spell> --strict`.
2. Run `grimoire simulate <spell> --chain <id> --rpc-url <url>`.
3. Run `grimoire venue doctor --adapter pendle --chain <id> --json`.
