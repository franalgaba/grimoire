# Mental Model: What Grimoire Is and How to Think About It

Grimoire is a strategy language and execution system for value-moving workflows.

You describe intent in a spell. Grimoire compiles that spell, evaluates it, and enforces safety controls before irreversible actions are committed.

## What Grimoire Is

Grimoire combines four ideas:

1. A readable DSL (`.spell`) for strategy logic.
2. A compiler pipeline that normalizes strategy source into an executable IR.
3. A runtime that always plans before settling (preview first, then commit).
4. Adapter-based integrations so protocol logic stays outside core.

If you remember one sentence:

Grimoire is "policy-constrained execution of strategy intent."

## Purpose

Grimoire exists to reduce three failures common in strategy automation:

1. Strategy logic coupled to one protocol SDK.
2. Execution without a structured preflight artifact.
3. Poor replayability and weak audit trails after a run.

Grimoire solves this by:

- keeping strategy logic protocol-agnostic in the spell
- generating a preview receipt before settlement
- persisting run history and ledger events for investigation and replay

## What Grimoire Is Not

Grimoire is not:

- a protocol SDK itself
- a black-box optimizer that auto-trades without explicit constraints
- a replacement for wallet/key/risk governance

It is a deterministic execution substrate with explicit boundaries.

## Core Building Blocks

Think in terms of these objects:

- `Spell`: the strategy source text authored by humans/agents.
- `IR`: normalized executable representation produced by compile.
- `Runtime`: executes IR in preview and optional commit phases.
- `Receipt`: preview artifact containing planned actions, constraints, and value deltas.
- `Adapter`: venue integration that can build or execute actions.
- `Run Record + Ledger`: persistent execution trace for history and replay.

## How Strategy Becomes Execution

At a high level:

```text
spell source -> compile -> IR -> preview -> receipt -> (optional) commit
```

Detailed flow:

1. Author spell intent and constraints.
2. Compile to IR with type checking and structural validation.
3. Preview executes full control flow and action planning.
4. Runtime checks constraints and value-flow bounds.
5. Runtime emits receipt (`ready` or `rejected`).
6. Commit executes only from a valid preview receipt.

This means planning and settlement are explicitly separated.

## The Irreversibility Boundary

The most important mental model is the irreversibility boundary:

- compute/state/advisory parsing are reversible runtime work
- value-moving actions are irreversible boundaries

Preview evaluates the full spell without crossing that boundary.
Commit crosses it only when preview conditions remain acceptable.

## Why the Receipt Matters

The receipt is the runtime contract for settlement.

It captures:

- what actions are planned
- which constraints were evaluated
- expected value movement
- drift-sensitive assumptions

Without a valid receipt, commit should not proceed.

## Constraints as Runtime Policy

In Grimoire, constraints are operational policy, not comments.

Examples:

- `max_single_move`
- `approval_required_above`
- `max_slippage`
- `max_value_at_risk`
- `allowed_venues`

These are checked during preview and can reject execution before irreversible steps.

## Adapters and Responsibility Boundaries

Grimoire core does not own protocol SDK behavior.

Boundary:

- `@grimoirelabs/core`: language, compile/runtime semantics, receipts, constraints
- `@grimoirelabs/venues`: SDK-specific integration and venue behavior

This keeps core deterministic and portable while allowing protocol-specific evolution.

## State and Time

A strategy run is not just "one command." It is a time series.

Grimoire persists:

- current spell state
- run-level summaries
- event ledger per run
- provenance data for replay decisions

This enables:

- debugging with historical context
- deterministic advisory/data replay when needed
- safety checks against stale inputs

## CLI vs Library: Same Behavior, Different Entry Point

You can run Grimoire through:

- CLI (`grimoire simulate`, `grimoire cast`)
- library (`compile`, `preview`, `commit`, `execute`)

The mental model should stay the same in both cases:

- compile
- preview
- inspect receipt/results
- commit only when explicitly intended

## How to Reason About Failures

When something fails, classify the failure first:

1. Authoring/compile issue (syntax/type/validator).
2. Preview policy issue (guard/constraint rejection).
3. Adapter/data issue (quote/source availability).
4. Commit safety issue (drift/receipt validity).

This classification usually tells you where to look next.

## Practical Operating Philosophy

For production confidence:

1. Keep spells explicit and constrained.
2. Prefer preview + dry-run before live commit.
3. Treat provenance and replay as part of risk management.
4. Use venue snapshots intentionally; enforce freshness policies.
5. Persist and inspect history for every significant strategy change.

## Next Reading

- `docs/explanation/architecture.md`
- `docs/explanation/preview-commit-model.md`
- `docs/explanation/type-system.md`
- `docs/explanation/data-provenance-and-replay.md`
