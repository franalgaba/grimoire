# Architecture

Grimoire is a layered system:

1. Language and compiler normalize strategy intent.
2. Runtime evaluates intent under explicit safety policy.
3. Adapters bridge strategy actions to real venues.
4. CLI/library entry points orchestrate execution context and persistence.

The architecture is designed to keep semantics stable while integrations evolve.

If you are new, read `docs/explanation/mental-model.md` first.

## Design Principles

The current architecture follows these principles:

- protocol-agnostic core
- explicit irreversibility boundary (preview before commit)
- reproducibility through receipts, ledger, and replay metadata
- composability through adapters rather than hardcoded protocol logic

## Package Boundaries

- `packages/core`
  - compiler, runtime, execution types, wallet/provider utilities, state-store contracts
- `packages/venues`
  - protocol/offchain adapter implementations and venue metadata CLIs
- `packages/cli`
  - command surface, option parsing, environment wiring, persistence integration
- `skills/`
  - operator/agent playbooks for installation and execution workflows

The critical boundary is:

- core owns language + runtime semantics
- venues own protocol-specific SDK/API behavior

## System Topology

```text
           +---------------------------+
           |       User / Agent        |
           +-------------+-------------+
                         |
          +--------------v--------------+
          | Entry Point (CLI or Library)|
          +--------------+--------------+
                         |
              +----------v----------+
              |   Compiler Pipeline  |
              | source -> AST -> IR  |
              +----------+----------+
                         |
              +----------v----------+
              | Runtime (preview)    |
              | constraints + receipt|
              +----------+----------+
                         |
             ready receipt? yes/no
                         |
              +----------v----------+
              | Runtime (commit)     |
              | adapter settlement   |
              +----------+----------+
                         |
              +----------v----------+
              | State + Ledger Store |
              +----------------------+
```

## Compiler Architecture

Compiler stages are intentionally separated so each layer does one job well:

1. Tokenizer/parser: syntax correctness.
2. Transformer: semantic normalization into `SpellSource`.
3. IR generator: executable step graph (`SpellIR`).
4. Type checker: structural type safety.
5. Validator: semantic integrity and safety structure checks.

Why this matters:

- parser errors remain syntax-focused
- type errors remain expression-focused
- validator errors remain execution-structure-focused

This separation improves diagnosability for users and tooling.

## Runtime Architecture

Runtime is centered in `interpreter.ts` and supporting step executors.

Key components:

- `ExecutionContext`: bindings, state, params, metrics, helper services.
- Step handlers (`runtime/steps/*`): compute, conditional, loops, advisory, action, emit, wait, etc.
- Preview/commit orchestration: consistent phase order and gating.
- Ledger stream: structured event trail for run-level observability.
- Receipt registry and drift checks: commit safety gates.

Runtime responsibility is not only "execute steps." It must also enforce policy.

## Policy Plane vs Execution Plane

A useful mental split:

- execution plane: run control flow, compute expressions, call adapters
- policy plane: evaluate limits/constraints, stale-data policy, advisory replay, drift checks

In practice, both are interleaved in preview and commit, but this distinction helps debugging:

- wrong branch/step behavior -> execution plane issue
- rejection despite valid logic -> policy plane issue

## Adapter Architecture

Adapters implement the venue contract and encapsulate integration specifics.

Typical adapter responsibilities:

- map generic action intent to protocol API/tx calls
- enforce adapter-level argument normalization
- return tx plans (EVM) or execute offchain actions
- surface structured errors

Core only sees the adapter interface, not protocol SDK internals.

Benefits:

- venue upgrades do not force DSL/runtime redesign
- testing can isolate adapter failures from compiler/runtime semantics
- new venues can be added without touching core language behavior

## Persistence Architecture

State persistence is intentionally outside pure runtime execution.

Pattern:

1. load prior persistent state
2. execute runtime with that state
3. persist final state
4. append run record
5. append ledger entries

This separation keeps runtime deterministic and makes persistence pluggable (`StateStore`).

## Entry Point Architecture

CLI and library share compiler/runtime behavior, but differ in orchestration concerns:

- CLI handles flags, env vars, wallet source resolution, and console output.
- Library usage lets host applications own orchestration and lifecycle.

In both paths, the underlying flow is the same:

- compile
- preview
- optional commit
- capture results

## Operational Data Flow (CLI)

`simulate` / `cast` flow:

1. parse command flags and environment.
2. compile spell source.
3. hydrate params (optional replay/ENS/advisory controls).
4. load persistent state (unless disabled).
5. run preview (and optional commit for cast/live path).
6. persist run metadata and ledger.
7. return machine/human-readable output.

This is the concrete path most users interact with.

## Extension Points

Main extension seams:

- new venues via adapter implementations in `packages/venues`
- custom persistence via alternate `StateStore`
- host-level orchestration through library APIs
- agent workflows via skills and docs

These seams are deliberate and reduce pressure to modify core semantics for every new use case.

## Failure Surface and Debug Strategy

Architecture-aware debugging flow:

1. Compile failed -> inspect syntax/type/validator messages.
2. Preview rejected -> inspect constraints/guards/advisory/policy input.
3. Commit failed -> inspect drift/receipt validity/wallet-execution logs.
4. Inconsistent external behavior -> inspect adapter and provider inputs.

This maps failure classes to subsystem ownership quickly.

## Why This Architecture Works

The architecture trades some upfront structure for long-term stability:

- clear ownership boundaries
- consistent safety lifecycle
- protocol portability
- reproducible runs and post-mortem traceability

For users, this means strategy logic can evolve without constantly rewriting execution infrastructure.
