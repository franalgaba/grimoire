# Action constraints reference

Action constraints provide execution bounds for adapters.

```ts
interface ActionConstraints {
  maxSlippageBps?: number;
  maxPriceImpactBps?: number;
  deadline?: number; // seconds from now
  minOutput?: Expression;
  maxInput?: Expression;
  minLiquidity?: Expression;
  requireQuote?: Expression;
  requireSimulation?: Expression;
  maxGas?: Expression;
}
```

## Fields

- `maxSlippageBps`: maximum slippage in basis points
- `maxPriceImpactBps`: maximum price impact in basis points
- `deadline`: transaction deadline in seconds
- `minOutput`: minimum output amount
- `maxInput`: maximum input amount
- `minLiquidity`: minimum available liquidity
- `requireQuote`: require a quote before execution
- `requireSimulation`: require a simulation before execution
- `maxGas`: cap on gas usage (wei)

Adapters can use resolved values via `Action.constraints` at runtime.

## Using constraints in spells

Constraints are attached to an action using the `with` clause:

```spell
on manual:
  uniswap_v3.swap(USDC, WETH, params.amount) with slippage=50, deadline=300
```

You can also use expressions:

```spell
on manual:
  uniswap_v3.swap(USDC, WETH, params.amount) with min_output=params.min_out
```

### Supported keys in `.spell`

| Spell key | Maps to | Notes |
|----------|---------|-------|
| `slippage` / `max_slippage` | `maxSlippageBps` | basis points |
| `deadline` | `deadline` | seconds from now |
| `min_output` | `minOutput` | exact-in swaps (min out) |
| `max_input` | `maxInput` | exact-out swaps (max in) |
| `max_price_impact` | `maxPriceImpactBps` | basis points |
| `min_liquidity` | `minLiquidity` | raw amount |
| `require_quote` | `requireQuote` | boolean |
| `require_simulation` | `requireSimulation` | boolean |
| `max_gas` | `maxGas` | wei |

## Skill defaults

Skills can provide default constraints that apply when an action does not specify them:

```spell
skills:
  dex:
    type: swap
    adapters: [uniswap_v3]
    default_constraints:
      max_slippage: 50

on manual:
  dex.swap(USDC, WETH, params.amount) using dex
```

## Spell example

```spell
on manual:
  uniswap_v3.swap(USDC, WETH, params.amount) with max_slippage=50, deadline=300
```

## Programmatic constraints

All listed constraints are available in `.spell` files and in the programmatic API.
