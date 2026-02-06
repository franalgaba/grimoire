# Grimoire Extensions Spec (Draft)

Status: Implemented (tool execution remains external). This document describes the extension set and the intended contracts.

## Goals

- Preserve full backward compatibility with existing `.spell` files.
- Keep syntax changes additive and opt-in.
- Treat advisors and advisor skills as first-class metadata, without executing tools in-core.
- Improve safety (constraints), routing (auto-select), observability, and expressiveness (imports, schemas, triggers, units).

## Non-goals

- Implementing tool execution inside Grimoire (tools remain external).
- Breaking existing syntax or changing current semantics.
- Introducing non-deterministic behavior in the compiler.

## Compatibility rules

- Existing spells compile unchanged.
- New syntax is additive; old syntax remains valid.
- Unsupported features in runtime must fail fast with actionable errors unless explicitly opted into “external orchestration mode.”

---

## 1) Advisors as first-class citizens (no tool execution)

### Advisor definitions

Add optional fields to the `advisors` section:

```spell
advisors:
  risk:
    model: "anthropic:sonnet"
    system_prompt: "Be conservative and concise."
    skills: [web-search, x-search]
    allowed_tools: [web.search, x.search]
    mcp: [company-kb, market-data]
    timeout: 30
    fallback: true
    rate_limit:
      max_per_run: 10
      max_per_hour: 100
```

Rules:

- `skills`, `allowed_tools`, and `mcp` are **metadata only** in core.
- They must be emitted into advisory events for external orchestrators.
- `fallback` is the in-core safety net when no advisory model is configured or when advisory fails; external tooling can override via `onAdvisory`.

### Advisory prompts

Advisory expression (boolean) remains:

```spell
if **is this safe?** via risk:
  emit approved()
```

Structured advisory output via `advise` remains, with expanded schema types:

```spell
decision = advise risk: "Assess risk for this swap"
  output:
    type: object
    fields:
      allow:
        type: boolean
      confidence:
        type: number
        min: 0
        max: 1
      rationale:
        type: string
  timeout: 30
  fallback:
    allow: false
    confidence: 0.2
    rationale: "Default fallback"
```

### Output schema (Option B: readable)

Supported `output.type` values:

- `boolean`
- `number` (with optional `min`/`max`)
- `enum` (with required `values`)
- `string` (optional `min_length`/`max_length`/`pattern`)
- `object` (with `fields`)
- `array` (with `items`)

Schema format (Option B):

```spell
output:
  type: array
  items:
    type: object
    fields:
      id:
        type: string
      score:
        type: number
        min: 0
        max: 100
```

### Advisory behavior in `cast`

- `cast` and `simulate` call external advisory when configured (spell model, CLI model/provider, or Pi defaults). If no model is available, they use `fallback`.
- External orchestrators can supply advisory outputs via the Core API `onAdvisory` hook or via replay.

### Validation rules

- `fallback` must conform to the declared schema.
- If `fallback` is an expression (non-literal), validate at runtime.
- Schema violations are hard errors.

---

## 2) Imports and reusable modules

### Syntax

```spell
import "blocks/common.spell"
import "strategies/rebalance.spell" as rebalance
```

### Semantics

- Imports are resolved relative to the current spell file.
- Only `block` definitions are imported.
- Imported blocks are namespaced under the import alias:
  - If `as <alias>` is provided, that is the namespace.
  - Otherwise, the namespace is the file stem (e.g., `rebalance`).

Invocation:

```spell
on manual:
  do rebalance.run(USDC, WETH)
```

### Collision and error handling

- Duplicate aliases or duplicate block names inside a namespace cause a compile error.
- Missing import files cause a compile error.
- Cycles are detected and rejected.

---

## 3) Trigger depth (condition + event)

### Condition triggers

Syntax:

```spell
on condition params.amount > 100000 every 5m:
  emit large_trade(amount=params.amount)
```

Rules:

- `condition` uses standard expressions (no advisory `**...**`).
- `every` accepts duration literals (e.g., `5m`, `1h`, `30s`).
- Default interval is `60s` if `every` is omitted.

### Event triggers

Syntax:

```spell
on event "base.block" where block.number % 100 == 0:
  emit checkpoint(block=block.number)
```

Rules:

- `event` is a string identifier (provider-specific).
- `where` is an optional filter expression.

### IR mapping

Add new trigger types:

```ts
{ type: "condition"; expression: Expression; intervalSeconds: number }
{ type: "event"; event: string; filter?: Expression }
```

Runtime behavior:

- Core runtime errors on unsupported trigger types unless explicitly configured for external orchestration.

---

## 4) Safety constraints beyond slippage

Add to action constraints parsing (all optional):

- `max_gas`: maximum total gas cost (wei).
- `max_price_impact`: basis points.
- `min_liquidity`: minimum available liquidity (raw token units; venue-specific).
- `require_quote`: boolean (fail if quote unavailable).
- `require_simulation`: boolean (fail if simulation unavailable).

Semantics:

- Unsupported constraints are treated as errors when `require_quote`/`require_simulation` is true.
- Venue adapters may enforce additional checks or return `constraint_unsupported`.

---

## 5) Auto-select venues and default skills

### Auto-select behavior

If the method call object matches a defined **skill name**, treat it as a skill:

```spell
skills:
  dex:
    type: swap
    adapters: [uniswap_v3, uniswap_v4]

on manual:
  dex.swap(USDC, WETH, params.amount)  # auto-selects via skill
```

This removes the need for `using dex`.

### Precedence rules

1. Explicit `using <skill>` wins.
2. If the object matches a skill name, resolve via that skill.
3. If the object matches a venue alias, resolve via that venue.
4. Otherwise, compile error.

---

## 6) Observability: standard events

Emit structured events for:

- `advisory.requested` / `advisory.resolved`
- `action.precheck` / `action.executed` / `action.failed`
- `constraint.evaluated`

Event payloads include:

- `spell`, `run_id`, `step_id`, `timestamp`
- `advisor`/`skill`/`venue` when applicable
- `schema` for advisory steps
- `constraints` and evaluation results

CLI:

- `--event-log <path>` writes JSONL events.

---

## 7) Typed params and units

### Param types

```spell
params:
  amount:
    type: amount
    asset: USDC
  slippage:
    type: bps
  interval:
    type: duration
```

### Literal units

Allow in expressions:

- `1.5 USDC` (amount)
- `0.5%` (percent)
- `50 bps` (basis points)
- `30s`, `5m`, `1h` (duration)

Compiler rules:

- If `type` is known, convert to raw units at compile time.
- If `type` is unknown, keep as string and validate at runtime.

---

## Error taxonomy (for new features)

Introduce canonical error tags:

- `import_not_found`
- `import_cycle`
- `schema_invalid`
- `constraint_unsupported`
- `trigger_unsupported`
- `advisor_rate_limited`


## Migration notes

- Existing `import` statements that were ignored will now be enforced; add placeholder files if needed.
- `dex.swap` without `using dex` will resolve via skill if a skill named `dex` exists.
- New constraints are optional and do not affect existing spells unless used.
