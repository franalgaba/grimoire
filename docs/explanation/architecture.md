# System architecture

Grimoire is split into three layers:

1) **Compiler** (`packages/core/src/compiler`) – parses `.spell` into IR.
2) **Runtime** (`packages/core/src/runtime`) – executes IR and emits events.
3) **Venues** (`packages/venues`) – protocol integrations via adapters.

Core is protocol-agnostic; adapters live outside core and are injected at execution.

## Key concepts

- **Spell**: source strategy in `.spell` syntax.
- **IR**: executable form produced by the compiler.
- **Adapter**: per-venue integration that builds transactions or executes offchain.
- **Executor**: routes actions to adapters, supports multi-tx plans.
- **StateStore**: persistence layer for spell state across runs.

## State persistence

The `execute()` function is pure — it accepts `persistentState` as input and returns `finalState` as output. Persistence is an orchestration concern handled by the caller (typically the CLI).

```
                    ┌──────────────┐
                    │  StateStore   │
                    │  (SQLite DB)  │
                    └──────┬───────┘
                           │
              load()       │       save() / addRun()
              ┌────────────┤────────────────┐
              │            │                │
              ▼            │                ▼
    ┌──────────────┐       │     ┌──────────────────┐
    │ persistState │───────┤────▶│  ExecutionResult  │
    └──────────────┘       │     │  .finalState      │
              │            │     │  .ledgerEvents    │
              ▼            │     └──────────────────┘
    ┌──────────────────────┴─────────────┐
    │           execute()                │
    │  (pure — no side effects)          │
    └────────────────────────────────────┘
```

The `SqliteStateStore` uses `bun:sqlite` with three tables:
- `spell_state` — current persistent state per spell (key-value JSON)
- `runs` — execution history with metrics
- `ledger` — full event log per run

Old runs are automatically pruned beyond a configurable limit (default: 100).

### CLI integration

The CLI commands `simulate` and `cast` automatically load and save state via `withStatePersistence()`. The `history` and `log` commands query the stored data. Use `--no-state` to disable persistence or `--state-dir` to use a custom database location.
