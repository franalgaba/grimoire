# @grimoirelabs/venues

Official Grimoire venue adapters bundle.

## Adapters

- `aave_v3` (AaveKit TypeScript)
- `uniswap_v3` (Uniswap V3 SDK)
- `uniswap_v4` (Uniswap V4 Universal Router)
- `morpho_blue` (Morpho Blue SDK)
- `hyperliquid` (Hyperliquid SDK, offchain)
- `across` (Across Protocol bridge SDK)
- `pendle` (Pendle Hosted SDK convert adapter)
- `polymarket` (Polymarket CLOB offchain adapter)

## Usage

```ts
import { adapters } from "@grimoirelabs/venues";
import { execute } from "@grimoirelabs/core";

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

## QueryProvider

The package exports an Alchemy-backed `QueryProvider` for on-chain balance reads and token price lookups.

```ts
import { createAlchemyQueryProvider } from "@grimoirelabs/venues";

const queryProvider = createAlchemyQueryProvider({
  provider,
  chainId: 1,
  vault: "0x...",
  rpcUrl: "https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY",
});

// queryProvider.queryBalance("ETH") → on-chain balance
// queryProvider.queryPrice("ETH", "USDC") → price via Alchemy API
```

- `queryBalance` reads on-chain ERC20 balances (or native ETH) via the RPC provider.
- `queryPrice` fetches token prices from the Alchemy Token Prices API. The API key is auto-extracted from the RPC URL, or can be set explicitly via `alchemyApiKey`.

Also exported: `extractAlchemyKey(rpcUrl)` and the `AlchemyQueryProviderConfig` type.

## CLI tools

Each venue exposes a small read-only CLI for fetching public data:

```bash
grimoire-aave health
grimoire-aave markets --chain 1

grimoire-uniswap routers
grimoire-morpho-blue addresses --chain 1

grimoire-across chains
grimoire-across quote --asset USDC --from 1 --to 8453 --amount 1000000000
grimoire-across status --tx-hash 0x...

grimoire-hyperliquid mids
grimoire-hyperliquid l2-book --coin BTC

grimoire-polymarket status
grimoire-polymarket markets list --limit 10 --format json
grimoire-polymarket markets search "bitcoin" --limit 10 --format json
grimoire-polymarket data positions <address> --limit 10 --format json
grimoire-polymarket search-markets --category sports --league "la liga" --open-only true --format json
grimoire-polymarket book --token-id <token_id> --format json
grimoire-polymarket price --token-id <token_id> --side buy --format json
```

Polymarket note:

- `grimoire-polymarket` delegates to the official `polymarket` CLI binary.
- Install with `brew tap Polymarket/polymarket-cli && brew install polymarket`.
- Set `POLYMARKET_OFFICIAL_CLI` to override binary path.
