# @grimoirelabs/venues

Official Grimoire venue adapters bundle.

## Adapters

- `aave_v3` (AaveKit TypeScript)
- `morpho_blue` (Morpho Blue SDK)
- `uniswap_v3` (Uniswap V3 SDK)
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

## CLI tools

Each venue exposes a small read-only CLI for fetching public data:

```bash
grimoire-aave health
grimoire-aave markets --chain 1

grimoire-uniswap routers
grimoire-morpho-blue addresses --chain 1

grimoire-hyperliquid mids
grimoire-hyperliquid l2-book --coin BTC

grimoire-polymarket status
grimoire-polymarket markets list --limit 10 --format json
grimoire-polymarket markets search "bitcoin" --limit 10 --format json
grimoire-polymarket search-markets --category sports --league "la liga" --open-only true --format json
grimoire-polymarket clob book <token_id> --format json
grimoire-polymarket clob price <token_id> --side buy --format json
```

Polymarket note:

- `grimoire-polymarket` delegates to the official `polymarket` CLI binary.
- Install with `brew tap Polymarket/polymarket-cli && brew install polymarket`.
- Set `POLYMARKET_OFFICIAL_CLI` to override binary path.
