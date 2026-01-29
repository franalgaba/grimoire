# Venues reference

The `@grimoire/venues` package provides official adapters.

## Adapters

- `aave_v3` — Aave V3 via AaveKit
- `morpho_blue` — Morpho Blue
- `uniswap_v3` — Uniswap V3
- `hyperliquid` — Hyperliquid spot/perps (offchain)
- `across` — Across bridge

## Usage

```ts
import { adapters } from "@grimoire/venues";
import { execute } from "@grimoire/core";

await execute({
  spell,
  vault,
  chain,
  executionMode: "execute",
  adapters,
});
```

## Adapter configuration

Use factory functions to pass SDK config:

```ts
import { createAcrossAdapter, createUniswapV3Adapter } from "@grimoire/venues";

const across = createAcrossAdapter({
  integratorId: "0x0000",
  assets: {
    USDC: {
      1: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      10: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
    },
  },
});

const uniswap = createUniswapV3Adapter({
  routers: { 1: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45" },
  slippageBps: 50,
});
```

### Aave V3

```ts
import { createAaveV3Adapter } from "@grimoire/venues";

const aave = createAaveV3Adapter({
  markets: {
    1: "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2",
  },
});
```

### Morpho Blue

```ts
import { createMorphoBlueAdapter } from "@grimoire/venues";

const morpho = createMorphoBlueAdapter({
  markets: [
    {
      id: "usdc-weth-lltv-86",
      loanToken: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      collateralToken: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
      oracle: "0x...",
      irm: "0x...",
      lltv: 860000000000000000n,
    },
  ],
});
```

### Hyperliquid (offchain)

```ts
import { createHyperliquidAdapter } from "@grimoire/venues";

const hyperliquid = createHyperliquidAdapter({
  privateKey: "0x...",
  assetMap: {
    BTC: 0,
    ETH: 1,
  },
});
```

> Hyperliquid requires a private key and executes offchain orders.

## Execution types

- `executionType: "evm"` for on-chain transactions
- `executionType: "offchain"` for venues like Hyperliquid
