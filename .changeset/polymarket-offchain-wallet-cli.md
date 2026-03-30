---
"@grimoirelabs/cli": patch
"@grimoirelabs/venues": patch
---

Improve Polymarket offchain execution wiring and venue CLI coverage.

- Reuse the loaded wallet-manager key for Polymarket adapter configuration in `cast`/`resume` wallet paths (matching Hyperliquid behavior), avoiding a separate Polymarket private key requirement in those flows.
- Expose first-class Polymarket `markets` and `data` command namespaces in the venue CLI wrapper with JSON passthrough and optional auth flags.
- Fix `search-markets` validation to allow boolean-only filters (`open-only`, `active-only`, `tradable-only`) and add regression test coverage.
