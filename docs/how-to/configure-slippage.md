# Configure slippage and constraints

Action steps accept constraints, which adapters can use to enforce slippage and execution bounds.

## Slippage for Uniswap V3

Uniswap adapters read `maxSlippageBps` internally. In `.spell` files, use `max_slippage` in the `with` clause.

Example action step in a spell:

```spell
on manual:
  uniswap_v3.swap(USDC, WETH, params.amount) with max_slippage=50
```

Notes:
- `max_slippage` is in basis points (50 = 0.5%)
- For exact output swaps, the adapter uses `maxInput` if provided, or computes it from `max_slippage`.

## Explicit min/max bounds

For **exact-in** swaps, set a `min_output` floor:

```spell
on manual:
  uniswap_v3.swap(USDC, WETH, params.amount) with min_output=990000
```

For **exact-out** swaps, set a `max_input` cap:

```spell
on manual:
  uniswap_v3.swap(USDC, WETH, params.amount) with max_input=1010000
```

## Slippage for Across

Across uses the same constraint fields. The adapter converts the quote’s output amount into a minimum based on slippage:

```spell
on manual:
  across.bridge(USDC, params.amount, 10) with max_slippage=30
```

## Advanced constraints

Additional constraints supported in `.spell` files:

- `max_gas` (wei)
- `max_price_impact` (bps)
- `min_liquidity` (raw amount)
- `require_quote` / `require_simulation` (boolean)

## See also

- [Action constraints reference](../reference/action-constraints.md)
- [Venues reference](../reference/venues.md)
