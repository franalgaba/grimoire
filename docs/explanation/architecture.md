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
