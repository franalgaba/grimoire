# Advisory Decision Flow

Advisory steps are how Grimoire models AI judgment explicitly inside execution logic.

If you remember one idea:

`advise` is a typed decision contract, not a free-form side channel.

## Why Advisory Is Explicit

Grimoire treats AI judgment as a first-class runtime step with schema checks, fallback behavior, and ledger visibility.

This is why advisory is expressed as:

- a named advisor configuration (`advisors` section)
- an explicit assignment (`decision = advise ...`)
- a declared output schema
- an explicit fallback expression

This keeps decision boundaries auditable and testable.

## Decision Contract Shape

An advisory step defines:

- `prompt`: what is being asked
- `context`: runtime inputs exposed to the advisor
- `output`: the output schema contract
- `on_violation`: schema violation policy (`reject` or `clamp`)
- `timeout`: model-response budget
- `fallback`: deterministic fallback expression

The advisory output is written to a binding (`outputBinding`), then normal control flow consumes it.

## Runtime Execution Path

At runtime, advisory execution proceeds as:

1. Emit `advisory_started` event (prompt + tooling metadata).
2. Resolve advisory context snapshot (params, bindings, state, declared context inputs).
3. Call advisory handler when configured.
4. If handler errors or times out, evaluate `fallback`.
5. Validate output against schema.
6. Apply `on_violation` policy:
   - `reject`: fail the step
   - `clamp`: coerce to schema; fail if safe coercion still cannot satisfy schema
7. Bind final output and emit `advisory_completed`.

This path is deterministic when advisory replay is used.

## Advisory And Safety Model

Advisory does not bypass execution safety controls.

After advisory resolves, the runtime still enforces:

- guard outcomes
- action constraints and limits
- value-flow accounting checks
- preview-to-commit drift checks

Advisory influences decisions, but policy enforcement remains in runtime checks.

## Replay And Reproducibility

Advisory outputs are captured in ledger events during runs.

`--advisory-replay <runId>` reuses those outputs by advisory `stepId`, allowing deterministic re-execution of decision points in dry-run/live workflows.

If replay data is missing for a required advisory step, advisory resolution fails.

## Compile-Time And Validation Coupling

Advisory is integrated with compiler passes:

- parser enforces explicit `advise` statement form
- type checker maps advisory schema to output binding type
- validator enforces required advisory fields and policy shape
- validator emits advisory summaries (`advisory_summaries`) showing downstream dependency and governing constraints

This coupling reduces hidden drift between strategy logic and advisory output shape.

## Practical Tradeoff

Advisory gives flexible judgment, but Grimoire keeps it bounded:

- explicit schema over free text
- explicit fallback over silent failure
- explicit ledger events over opaque execution
- explicit replay over non-deterministic reruns

That is how Grimoire keeps AI-assisted strategy logic inspectable in production.
