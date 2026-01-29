# Configure slippage and constraints

Action steps accept constraints, which adapters can use to enforce slippage and execution bounds.

## Slippage for Uniswap V3

Uniswap uses `maxSlippageBps`, `minOutput`, or `maxInput`.

Example action step in a spell:

```spell
on manual:
  uniswap_v3.swap(USDC, WETH, params.amount)
  constraints:
    max_slippage: 50
```

Notes:
- `max_slippage` is in basis points (50 = 0.5%)
- For exact output swaps, the adapter uses `maxInput` if provided, or computes it from `max_slippage`.

## Slippage for Across

Across uses the same constraint fields. The adapter converts the quote’s output amount into a minimum based on slippage:

```spell
on manual:
  across.bridge(USDC, params.amount, 10)
  constraints:
    max_slippage: 30
```

## Advanced constraints

You can specify explicit bounds:

```spell
constraints:
  min_output: 990000000
  max_input: 1010000000
```

## See also

- [Action constraints reference](../reference/action-constraints.md)
- [Venues reference](../reference/venues.md)
