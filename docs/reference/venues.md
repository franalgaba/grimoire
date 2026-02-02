# Venues reference

The `@grimoire/venues` package provides official adapters.

## Adapters

- `aave_v3` — Aave V3 lending/borrowing (Ethereum, Base)
- `morpho_blue` — Morpho Blue isolated lending markets
- `uniswap_v3` — Uniswap V3 swaps via SwapRouter02
- `uniswap_v4` — Uniswap V4 swaps via Universal Router + Permit2
- `hyperliquid` — Hyperliquid spot/perps (offchain)
- `across` — Across cross-chain bridge

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

Supports Ethereum mainnet and Base with pre-configured market addresses.

```ts
import { createAaveV3Adapter } from "@grimoire/venues";

// Default: Ethereum + Base markets pre-configured
const aave = createAaveV3Adapter();

// Custom markets:
const aave = createAaveV3Adapter({
  markets: {
    1: "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2",     // Ethereum
    8453: "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5",   // Base
  },
});
```

**Amount format:** The `@aave/client` SDK uses human-readable BigDecimal amounts internally. The adapter converts raw spell amounts to human-readable format automatically:

| Action | SDK amount format | Example (0.1 USDC) |
|--------|------------------|---------------------|
| supply | `value: "0.1"` | Human-readable BigDecimal |
| borrow | `value: "0.1"` | Human-readable BigDecimal |
| withdraw | `value: { exact: "100000" }` | Raw amount in `exact` wrapper |
| repay | `value: { exact: "100000" }` | Raw amount in `exact` wrapper |

### Morpho Blue

Ships with default markets for Base (chain 8453). No configuration needed for USDC lending on Base.

```ts
import { createMorphoBlueAdapter } from "@grimoire/venues";

// Default: Base USDC markets (cbBTC/USDC + WETH/USDC) pre-configured
const morpho = createMorphoBlueAdapter();

// Custom markets:
const morpho = createMorphoBlueAdapter({
  markets: [
    {
      id: "usdc-weth-lltv-86",
      loanToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      collateralToken: "0x4200000000000000000000000000000000000006",
      oracle: "0xFEa2D58cEfCb9fcb597723c6bAE66fFE4193aFE4",
      irm: "0x46415998764C29aB2a25CbeA6254146D50D22687",
      lltv: 860000000000000000n,
    },
  ],
});
```

**Default Base markets:**

| Market | Collateral | LLTV | Supply |
|--------|-----------|------|--------|
| cbBTC/USDC | cbBTC | 86% | ~$1.26B |
| WETH/USDC | WETH | 86% | ~$48.7M |

When no collateral is specified in a spell, the first matching market by loan token is selected (cbBTC/USDC for USDC lending).

### Uniswap V3

```ts
import { createUniswapV3Adapter } from "@grimoire/venues";

const uniswap = createUniswapV3Adapter({
  routers: {
    1: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45",
    8453: "0x2626664c2603336E57B271c5C0b26F421741e481",
  },
  slippageBps: 50,
});
```

### Uniswap V4

Uses Universal Router with Permit2 approval flow.

```ts
import { createUniswapV4Adapter } from "@grimoire/venues";

const uniswapV4 = createUniswapV4Adapter({
  routers: {
    1: "0x...",
    8453: "0x...",
  },
  slippageBps: 50,
});
```

### Across (bridge)

Cross-chain bridging. Enforces minimum amounts per token to cover relayer fees.

```ts
import { createAcrossAdapter } from "@grimoire/venues";

const across = createAcrossAdapter({
  integratorId: "0x0000",
  assets: {
    USDC: {
      1: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      8453: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      42161: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    },
  },
});
```

**Minimum bridge amounts** (approximate, varies by route):

| Token | Minimum |
|-------|---------|
| USDC | ~$1.00 |
| WETH | ~0.002 ETH |

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

> Hyperliquid requires a private key and executes offchain orders via the Hyperliquid API. No gas needed.

## Execution types

- `executionType: "evm"` for on-chain transactions (Aave, Morpho, Uniswap, Across)
- `executionType: "offchain"` for venues like Hyperliquid
