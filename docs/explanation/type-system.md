# Type System and Validation

Grimoire uses two static safety layers before runtime:

If you are new, start with `docs/explanation/mental-model.md` before this page.

1. Type checking: expression-level compatibility.
2. Validation: execution-graph and policy-structure integrity.

Together they prevent large classes of strategy authoring mistakes before preview/commit.

## Why Two Static Layers

Type checking and validation solve different problems:

- type checker answers: "are values used in compatible ways?"
- validator answers: "is the strategy structure safe and coherent to run?"

Keeping them separate improves error quality and keeps each pass focused.

## Type Checker: What It Guarantees

Implemented in `packages/core/src/compiler/type-checker.ts`.

The type checker validates:

- operator compatibility (`+`, comparisons, logical ops)
- function argument and return compatibility for built-ins
- assignment compatibility
- boolean requirements in `if`/guards
- advisory schema-to-binding compatibility
- expression typing in action constraints

Type vocabulary is structural:

- primitives: `number`, `bool`, `string`, `address`, `asset`, `bigint`, `void`, `any`
- compounds: `array<T>`, `record`

Subtyping examples:

- `asset` can flow into `string`
- `address` can flow into `string`

This model keeps authoring flexible while preserving meaningful checks.

## Validator: What It Guarantees

Implemented in `packages/core/src/compiler/validator.ts`.

The validator checks execution semantics and dependency integrity:

- unknown references (`venue`, `skill`, `advisor`, step links)
- step dependency cycles
- loop boundedness requirements
- advisory policy requirements
- expression reference resolution in guards/actions

The validator can emit both:

- errors (execution should not proceed)
- warnings (execution can proceed, but intent may be underspecified)

## Advisory Strictness as a First-Class Safety Feature

Advisory steps are treated as structured contracts, not free-form prompts.

Validator expectations include:

- explicit timeout
- explicit fallback
- output schema declaration
- output binding declaration
- known advisor reference
- valid `on_violation` behavior
- clamp behavior only on clampable constraints

This reduces silent failures where advisory output shape drifts from strategy expectations.

## Static Safety Boundaries

Static checks intentionally stop at compile-time knowledge.

They do not guarantee:

- current market/liquidity conditions
- provider/API availability
- adapter settlement success
- drift safety at commit time

Those are runtime responsibilities.

## Static vs Runtime Safety

A practical model:

- static passes prevent malformed strategy intent
- runtime enforces live policy and environmental safety

You need both.

If static checks were the only guard, live conditions could still create unsafe commits.
If runtime checks were the only guard, authoring feedback would be too late and noisy.

## Common Failure Patterns and Interpretation

### Type checker failure

Typical meaning: expression-level mismatch.

Examples:

- non-boolean condition
- invalid function argument type
- assignment of incompatible value type

Action: fix expression/type intent in spell source.

### Validator failure

Typical meaning: structurally unsafe or unresolved execution graph.

Examples:

- unknown advisor/venue/skill
- invalid loop bounds
- missing advisory fallback/timeout
- dependency cycle

Action: fix strategy structure and references.

## Authoring Practices That Work Well

1. Keep params explicit and typed by usage.
2. Avoid ambiguous control-flow expressions.
3. Treat advisory outputs as strict schemas.
4. Keep constraint expressions simple and inspectable.
5. Validate often during spell iteration (`validate` before `simulate`).

## Mental Model Summary

Type checking says "this strategy is internally coherent as code."
Validation says "this strategy is coherent as an executable policy graph."
Runtime then decides whether it is safe to run now.
