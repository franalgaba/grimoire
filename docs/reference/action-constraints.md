# Action constraints reference

Action constraints provide execution bounds for adapters.

```ts
interface ActionConstraints {
  maxSlippageBps?: number;
  deadline?: number; // seconds from now
  minOutput?: Expression;
  maxInput?: Expression;
  maxGas?: bigint;
}
```

## Fields

- `maxSlippageBps`: maximum slippage in basis points
- `deadline`: transaction deadline in seconds
- `minOutput`: minimum output amount
- `maxInput`: maximum input amount
- `maxGas`: cap on gas usage

Adapters can use resolved values via `Action.constraints` at runtime.

## Using constraints in spells

Constraints are attached to the immediately preceding action step.

```spell
on manual:
  uniswap_v3.swap(USDC, WETH, params.amount)
  constraints:
    max_slippage: 50
    deadline: 300
```

You can also use expressions:

```spell
constraints:
  min_output: params.min_out
  max_input: params.max_in
```

## Spell example

```spell
on manual:
  uniswap_v3.swap(USDC, WETH, params.amount)
  constraints:
    max_slippage: 50
    deadline: 300
```
