---
"@grimoirelabs/venues": patch
"@grimoirelabs/cli": patch
---

Fix Uniswap pool data fetching and AuthStorage constructor

Venues:
- Replace dead The Graph hosted service URL with decentralized network subgraph IDs
  for Ethereum, Optimism, Polygon, Base, and Arbitrum
- Support `GRAPH_API_KEY` env var for subgraph queries
- Graceful fallback to on-chain RPC pool lookup when no graph key is set
- Clear error messages guiding users to set up a Graph API key or use `--rpc-url`

CLI:
- Fix pre-existing `AuthStorage.create()` call that doesn't exist at current
  pi-coding-agent version (revert to `new AuthStorage()`)
