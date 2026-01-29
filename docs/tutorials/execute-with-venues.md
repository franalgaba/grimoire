# Execute a spell with venues

This tutorial runs a swap spell using the venues package.

## 1) Use a venue spell

Example: `spells/uniswap-swap-execute.spell`

```spell
spell UniswapSwapExecute

  version: "1.0.0"
  description: "Swap USDC for WETH on Uniswap V3"

  assets: [USDC, WETH]

  params:
    amount: 1000000000

  venues:
    uniswap_v3: @uniswap_v3

  on manual:
    uniswap_v3.swap(USDC, WETH, params.amount)
    emit swap_submitted(asset_in=USDC, asset_out=WETH, amount=params.amount)
```

## 2) Execute in simulation mode

```bash
bun -e "import { compileFile, execute } from './packages/core/src/index.ts'; import { adapters } from './packages/venues/src/index.ts'; const res = await compileFile('spells/uniswap-swap-execute.spell'); if (res.success) { const exec = await execute({ spell: res.ir, vault: '0x0000000000000000000000000000000000000000', chain: 1, executionMode: 'simulate', adapters }); console.log(exec.success); }"
```

## 3) Execute with a wallet

Use the CLI when you have a wallet configured:

```bash
grimoire-cast spells/uniswap-swap-execute.spell --key-env PRIVATE_KEY --rpc-url <rpc>
```

> Tip: avoid passing secrets on the command line; prefer `--key-env`.

## Next steps

- Configure slippage controls: [how-to/configure-slippage.md](../how-to/configure-slippage.md)
- Explore venue adapters: [reference/venues.md](../reference/venues.md)
