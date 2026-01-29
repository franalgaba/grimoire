# @grimoire/venues

Official Grimoire venue adapters bundle.

## Adapters

- `aave_v3` (AaveKit TypeScript)
- `morpho_blue` (Morpho Blue SDK)
- `uniswap_v3` (Uniswap V3 SDK)
- `hyperliquid` (Hyperliquid SDK, offchain)
- `across` (Across Protocol bridge SDK)

## Usage

```ts
import { adapters } from "@grimoire/venues";
import { execute } from "@grimoire/core";

await execute({
  spell,
  vault,
  chain,
  wallet,
  provider,
  executionMode: "execute",
  adapters,
});
```

Adapters may require configuration via factory functions for production use.

## CLI tools

Each venue exposes a small read-only CLI for fetching public data:

```bash
grimoire-aave health
grimoire-aave markets --chain 1

grimoire-uniswap routers
grimoire-morpho-blue addresses --chain 1

grimoire-hyperliquid mids
grimoire-hyperliquid l2-book --coin BTC
```
