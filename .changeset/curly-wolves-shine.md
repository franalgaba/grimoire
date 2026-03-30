---
"@grimoirelabs/venues": patch
---

Fix Across bridge asset resolution for chain-scoped spell symbols (for example `USDC_ETH`).

The Across adapter now merges spell-defined `ctx.assets` mappings and can derive the destination token address from the resolved source token address when direct symbol resolution is unavailable. This prevents `No Across asset mapping` failures for valid chain-specific asset aliases.
