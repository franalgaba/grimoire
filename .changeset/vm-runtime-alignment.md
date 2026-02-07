---
"@grimoirelabs/cli": minor
"@grimoirelabs/core": minor
---

Implement VM real-data and runtime alignment features.

For `@grimoirelabs/cli`:
- Add `--data-replay`, `--data-max-age`, and `--on-stale` to `simulate` and `cast`.
- Add unified run reporting with `Run`, `Data`, `Events`, and `Bindings` blocks.
- Add JSON run envelopes that include machine-readable provenance.
- Enforce stale-data policy (`fail|warn`) and replay resolution by run ID or snapshot ID.
- Persist provenance metadata into state-backed run records.

For `@grimoirelabs/core`:
- Extend run records with optional provenance metadata.
- Persist and load provenance in `SqliteStateStore` (with schema migration support).
- Keep `createRunRecord` compatible while allowing provenance attachment.
