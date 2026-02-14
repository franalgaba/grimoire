---
"@grimoirelabs/core": minor
"@grimoirelabs/cli": minor
"@grimoirelabs/venues": minor
---

Add Phase 1 cross-chain continuation orchestration without DSL changes.

### Core

- add cross-chain orchestrator primitives and receipt/types for source/destination track lifecycle
- extend runtime/state-store persistence with restart-safe cross-chain tables and schema migrations
- add handoff param injection and reserved namespace guards for destination execution
- harden compiler behavior so invalid `do` invocations fail at compile time

### CLI

- add cross-chain `simulate` and `cast` flow with `--destination-spell`, per-chain RPC mappings, handoff timeout/polling, and watch support
- add `grimoire resume <runId>` for restart-safe continuation of waiting runs
- validate explicit Morpho market identity mappings in cross-chain mode and persist cross-chain run manifests
- extend `history`/`log` output with cross-chain lifecycle visibility

### Venues

- add Across handoff lifecycle resolution hooks for settlement polling
- enforce explicit Morpho market id resolution for cross-chain lend/withdraw/borrow/repay actions
