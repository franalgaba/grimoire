# Add and organize spells

Spells live in the top-level `spells/` directory.

## Create a new spell

```spell
spell MySpell

  version: "1.0.0"
  description: "Describe the strategy"

  assets: [USDC]

  params:
    amount: 1000000

  venues:
    uniswap_v3: @uniswap_v3

  on manual:
    uniswap_v3.swap(USDC, WETH, params.amount)
```

## Organize by intent

Recommended naming:

- `*-execute.spell` for direct execution
- `*-optimizer.spell` for decisioning logic
- `*-rebalance.spell` for periodic adjustments

## Validate spells

```bash
bun -e "import { compileFile } from './packages/core/src/compiler/index.ts'; const res = await compileFile('spells/my-spell.spell'); console.log(res.success);"
```
