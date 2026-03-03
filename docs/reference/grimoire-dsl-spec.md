# Grimoire DSL Spec (Current Implementation)

This is an implementation-level spec for the current compiler/runtime stack in `packages/core`.

## Pipeline

```text
.spell source
  -> tokenizer (grimoire/tokenizer.ts)
  -> parser AST (grimoire/parser.ts)
  -> transformer SpellSource (grimoire/transformer.ts)
  -> IR generator SpellIR (compiler/ir-generator.ts)
  -> type checker (compiler/type-checker.ts)
  -> validator (compiler/validator.ts)
```

`compileGrimoire()` runs these stages in order.

## Tokenizer Rules

Core token categories:

- literals: `NUMBER`, `STRING`, `BOOLEAN`, `ADDRESS`, `PERCENTAGE`
- structure: braces, parens, brackets, commas, colons, newlines
- symbols: `VENUE_REF` (`@name`), keywords, identifiers, operators

Important behavior:

- Newlines are emitted unless inside `()` or `[]`.
- Braces do not suppress newline tokens.
- Duration suffixes on numbers (`s`, `m`, `h`, `d`) are normalized to seconds.
- Percentages are normalized to decimal form (`50%` -> `0.5` token value).

## AST Model

Top-level AST (`SpellAST`) includes:

- `sections`
- `triggers`
- `imports`
- `blocks`

Statement-level nodes include:

- control flow (`if`, `for`, `repeat`, `until`, `try`, `parallel`, `pipeline`)
- effect nodes (`method_call`, `emit`, `halt`, `wait`)
- computation nodes (`assignment`, `pass`, `do`, `advise`)

Inline advisory expression nodes are disabled; parser throws `ADVISORY_INLINE_UNSUPPORTED`.

## Transformer Semantics

The transformer converts AST to `SpellSource` and performs these key behaviors:

- Pre-scans assets for decimals (used in unit literal conversion).
- Pre-scans venues to map labels/groups to concrete aliases.
- Resolves `import` trees, namespaces imported blocks, and detects import cycles.
- Expands `do` block invocations by inlining block statements.
- Converts triggers to SpellSource trigger form.
- Converts statements to step-like raw objects (`compute`, `action`, `if`, `try`, etc.).
- Generates sequential step IDs (`compute_1`, `action_2`, ...).
- Stores source location metadata for error-to-source mapping.

Limit handling:

- `limits` section entries are stored as params with `limit_` prefix.

Constraint key normalization in action transform:

- `slippage` -> `max_slippage`
- `min_out` -> `min_output`
- `max_in` -> `max_input`

Morpho-specific action mappings include:

- `morpho_blue.supply_collateral(asset, amount[, market_id])` -> `type: "supply_collateral"`
- `morpho_blue.withdraw_collateral(asset, amount[, market_id])` -> `type: "withdraw_collateral"`
- Optional `market_id` is also mapped for `lend`, `withdraw`, `repay`, and `borrow`.

## IR (`SpellIR`) Structure

Key fields:

- metadata: `id`, `version`, `meta`
- config: `aliases`, `assets`, `skills`, `advisors`, `params`, `state`
- execution: `steps`, `guards`, `triggers`, optional `sourceMap`

Step kinds (normalized):

- `compute`
- `action`
- `conditional`
- `loop`
- `parallel`
- `pipeline`
- `try`
- `advisory`
- `wait`
- `emit`
- `halt`

## Type System (Compile-Time)

Type checker pass (`type-checker.ts`) enforces a structural type system.

Primitive types:

- `number`, `bool`, `string`, `address`, `asset`, `bigint`, `action_result`, `void`, `any`

Compound types:

- `array<T>`
- `record`

Subtyping:

- `asset <: string`
- `address <: string`

Built-in signatures include:

- numeric: `min`, `max`, `abs`, `sum`, `avg`
- chain queries:
  - `balance(asset[, address])` — optional `address` parameter to query a specific wallet
  - `price(base, quote[, source])` — optional `source` string parameter (e.g. `"chainlink"`)
  - `get_apy`, `get_health_factor`, `get_position`, `get_debt`
- conversion: `to_number`, `to_bigint`

The checker validates:

- expression operator compatibility
- assignment compatibility
- condition/guard boolean expectations
- advisory schema-to-binding typing
- action constraint expression typing

## Validator Rules

Validator pass (`validator.ts`) focuses on structural/semantic safety.

Checks include:

- unknown references (steps, advisors, skills, venues)
- dependency cycles
- loop boundedness (`maxIterations > 0`)
- advisory requirements (`timeout`, `fallback`, output schema, output binding)
- advisory policy checks (`on_violation`, clamp constraints)
- expression references in actions and guards
- quoted address literal detection in action token/address fields (`QUOTED_ADDRESS_LITERAL`)

Outputs:

- errors
- warnings
- advisory summaries (dependency paths, downstream irreversible actions, governing constraints)

## Runtime-Visible DSL Consequences

Compilation emits source map data (`stepId -> {line, column}`) when available.

At runtime this is used to enrich step-failed events so error reports can include source coordinates.

## Known Grammar-Level Conventions

- Trailing commas are accepted in list contexts.
- Multiline object literals are supported.
- Parenthesized multiline `with (...)` constraints are supported.
- Inline advisory `**...**` is rejected with migration guidance.
