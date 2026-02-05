# Execute a spell with venues

This tutorial runs a swap spell using the deterministic runtime (CLI). VM mode does not bundle adapters.

## 1) Install the CLI

```bash
npm i -g @grimoirelabs/cli
```

## 2) Use a venue spell

Example: `spells/uniswap-swap-execute.spell`. If you're not in this repo, create the file with the following content.

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

## 3) Simulate execution

```bash
grimoire simulate spells/uniswap-swap-execute.spell --chain 1 --rpc-url <rpc>
```

## 4) Dry-run, then execute with a wallet

```bash
grimoire cast spells/uniswap-swap-execute.spell --dry-run --key-env PRIVATE_KEY --rpc-url <rpc>
grimoire cast spells/uniswap-swap-execute.spell --key-env PRIVATE_KEY --rpc-url <rpc>
```

> Tip: avoid passing secrets on the command line; prefer `--key-env`.

## Next steps

- Configure slippage controls: [configure-slippage.md](../how-to/configure-slippage.md)
- Explore venue adapters: [venues.md](../reference/venues.md)
- Programmatic usage: [core-api.md](../reference/core-api.md)
