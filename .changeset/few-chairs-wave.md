---
"@grimoirelabs/core": minor
"@grimoirelabs/venues": minor
"@grimoirelabs/cli": minor
---

Add DefiHack multi-track support across compiler/runtime, venues, and CLI.

- Add end-to-end `custom` action support in core (transformer, IR generation, runtime action resolution, and executor adapter routing), including nested custom arg evaluation.
- Add `yellow` offchain adapter for NitroRPC session lifecycle operations with version/quorum/intent/allocation validation.
- Add `lifi` offchain adapter for `swap`, `bridge`, and `custom compose_execute`, with constraint checks and `toAddress` guardrails (default wallet match, explicit override supported).
- Add CLI ENS profile hydration for `simulate`/`cast` via `--ens-name` and `--ens-rpc-url`, including safe clamping for ENS-hydrated `max_slippage_bps` (0..500).
- Add DefiHack demo spells and prompt-first runbook updates, plus venue and CLI reference documentation.
