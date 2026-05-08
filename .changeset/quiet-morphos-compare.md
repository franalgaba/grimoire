---
"@grimoirelabs/venues": minor
---

Add Morpho Blue market utilization metrics and Morpho Vault V2 liquidity reads.

Morpho Blue now exposes `metric("utilization_bps", morpho, asset, selector)` for market utilization checks. The Morpho venue CLI also includes `vault-liquidity` for onchain Morpho Vault V2 liquidity reads, and Vault V2 liquidity now caps Morpho Market V1 adapter liquidity by available underlying market cash instead of treating adapter accounting assets as immediately withdrawable.
