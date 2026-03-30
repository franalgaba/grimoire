---
"@grimoirelabs/venues": patch
---

Fix Uniswap venue pool discovery and alias routing for Base workflows.

- Fallback to on-chain pool lookups when Graph config is not usable (for example, no API key), using default chain RPCs when available.
- Add Base (8453) Uniswap V3 factory default for metadata pool discovery.
- Add underscore aliases like `uniswap_v4`/`uniswap_v3` in built-in venue discovery.
- Remove `dataEndpoints` from `uniswap_v4` adapter metadata to avoid mismatched metadata endpoint routing.
