<!--
This file is generated from docs/reference/grimoire-vm.md.
Run scripts/sync-references.sh to update.
-->

# Grimoire VM (In-Agent) Execution Spec

Status: draft

This document defines how to execute Grimoire `.spell` files inside an agent session (the "Grimoire VM"). It targets best-effort, in-agent execution for prototyping and education. It is not a replacement for the deterministic external runtime.

Use this spec when you need to run a spell directly in a chat or agent environment without the Grimoire CLI/runtime.

## Conformance language

The key words "MUST", "MUST NOT", "SHOULD", "SHOULD NOT", and "MAY" in this document are to be interpreted as described in RFC 2119.

## Relationship to other specs

- The Grimoire DSL reference defines syntax and language semantics.
- This VM spec defines how an agent-hosted VM executes that syntax.
- For deterministic execution, use the external runtime (`simulate` / `cast`).

## Scope

The Grimoire VM:
- Parses and validates `.spell` files using the Grimoire DSL.
- Executes one trigger block.
- Produces a structured execution log with events, bindings, and status.

The Grimoire VM does **not** guarantee:
- Deterministic results.
- Onchain execution safety.
- Availability of any specific tool or adapter.

## Execution environment

The VM host is the agent session (or a wrapper around it). The VM executes steps by:
- Evaluating expressions directly.
- Invoking tools for actions or external data.
- Producing a run log.

The host MUST make tool usage explicit and SHOULD confirm side effects before executing them.

## Inputs

A VM host MUST accept the following inputs:
- **Spell source**: the `.spell` text.
- **Invocation context**: which trigger to run (manual, scheduled, event-driven, etc.).

A VM host SHOULD accept:
- **Parameter overrides**: values for `params`.
- **Persistent state snapshot**: initial `state` values.
- **Tooling catalog**: available tools/adapters for actions.
- **Event feed**: external events for `on event` triggers.

## Outputs

A VM host MUST produce:
- **Run status**: `success` or `failed`.
- **Emitted events**: `emit` steps with payloads.
- **Final bindings**: resolved values for params, state, and outputs.

A VM host SHOULD also produce:
- **Step-level events**: started, completed, failed.
- **Error details**: for failures and skipped steps.
- **Timing metadata**: timestamps or durations.

## Execution lifecycle

1. **Parse** the spell text into a syntax tree.
2. **Validate**:
   - Required sections (spell name, params/venues/etc. if referenced).
   - References (venues, skills, advisors) exist.
   - Advisory steps have `timeout` and `fallback`.
3. **Evaluate guards** (if defined):
   - If any guard fails, abort the run before selecting a trigger.
4. **Select trigger**:
   - See "Trigger selection" below.
5. **Initialize context**:
   - Bind `params` and `state`.
   - Initialize bindings for assets, limits, and named sections as needed.
6. **Execute steps** in order, honoring control flow.
7. **Finalize**:
   - Produce run status, events, final bindings, and state snapshot.

## Trigger selection

A spell can define multiple `on <trigger>:` blocks. The VM MUST execute exactly one trigger per run.

Selection rules:
- If the host explicitly chooses a trigger (e.g., "manual" run), the VM MUST execute that trigger.
- If a trigger depends on an external event or schedule and the host cannot supply that input, the VM SHOULD NOT select it.
- If multiple triggers are eligible, the VM SHOULD ask for user selection or pick the first declared trigger (and log the choice).

In-agent environments typically have no scheduler. In that case:
- `on manual:` is the default.
- `on hourly:`, `on daily:`, or `on <cron>:` MAY be invoked manually by the user or host.

## Bindings and state

Bindings are the VM's working memory. At minimum, the VM MUST support:
- `params.<name>` from the `params:` section (with overrides applied).
- `state.<key>` from the `state:` section (persistent across runs when supported).
- Named outputs from step bindings (e.g., `result = ...`).

The VM SHOULD maintain two state scopes:
- **Persistent**: survives across runs if the host provides storage.
- **Ephemeral**: per-run scratch state.

If persistent storage is unavailable, the VM MUST still track state during the run and emit the final state snapshot.

### State backends (host-defined)

Hosts MAY choose any state backend. Recommended options:
- **In-context**: state stored in conversation history.
- **Filesystem**: state stored in local files per spell.
- **External store**: database or service-backed state.

The VM SHOULD log which backend is used for persistence.

## Tooling and side effects

Actions and some built-in functions require tools. A VM host SHOULD provide a tooling catalog that maps:
- **Venue actions** (e.g., `uniswap_v3.swap`) to tool calls.
- **External data** (e.g., price or balance queries) to tool calls.

If a required tool is missing, the VM MUST fail the step with a clear error.

For side effects (onchain or external actions), the host SHOULD:
- Require explicit confirmation.
- Surface the action details to the user.
- Make failures and partial execution visible.

## Expression evaluation

The VM MUST evaluate expressions as defined in the DSL reference. This includes:
- Arithmetic, comparison, logical, and ternary operators.
- Property and array access.
- Built-in functions (where available).

If a built-in function requires external data and the host cannot provide it, the VM MUST fail the step with a clear error.

## Step semantics

### Assignment

```
value = <expression>
```

- Evaluate the expression.
- Bind the result to `value` in the current context.

### Action calls

```
venue.action(arg1, arg2) [using skill] [with constraints]
```

The VM MUST:
- Resolve the venue or skill.
- Apply skill defaults and explicit `with` constraints.
- Call an appropriate tool if available.

If no tool is available for the action:
- Emit an error.
- Mark the step failed.
- Continue only if control flow allows it.

### Constraints

Action constraints bound in `with` MUST be passed to the tool (if available) or enforced by the VM. Key constraints include:
- `slippage` / `max_slippage`
- `min_output`
- `max_input`
- `deadline`
- `max_price_impact`
- `min_liquidity`
- `require_quote`
- `require_simulation`
- `max_gas`

### Output binding

```
result = venue.action(...)
```

- Capture the action result (or a tool response) into `result`.

### Conditionals

```
if <condition>:
  ...
elif <condition>:
  ...
else:
  ...
```

- Evaluate conditions in order.
- Execute the first matching branch.

### For loops

```
for item in collection:
  ...
```

- Evaluate `collection`.
- For each element, bind `item` and execute the body.

### Repeat loops

```
repeat N:
  ...
```

- Execute the body exactly `N` times.
- If `N` is invalid or non-positive, fail the step.

### Loop until

```
loop until <condition> max N:
  ...
```

- Execute the body until the condition is true or the max is reached.
- Fail if the condition never becomes true and the loop exceeds `N`.

### Try / catch / finally

```
try:
  ...
catch <error_type>:
  ...
finally:
  ...
```

- Execute `try` block.
- If an error is thrown, run the first matching catch.
- Always run `finally` if present.

If a catch block defines a `retry` policy, the VM SHOULD honor it.

### Parallel

```
parallel join=all on_fail=abort:
  left:
    ...
  right:
    ...
```

In-agent hosts MAY execute branches sequentially, but MUST preserve:
- Join semantics (all/any/first/best/majority).
- Failure semantics (`abort` or `continue`).

If true concurrency is unavailable, the VM MUST log that execution was sequential.

### Pipeline

```
result = items | filter:
  keep = <condition>
| map:
  out = <expression>
```

- Evaluate the source array.
- Apply stages in order.
- Bind `item` and `index` for each stage iteration.
- For `reduce`, bind `acc` to the running accumulator.

### Blocks and imports

```
block name(a, b):
  ...

do name(1, 2)
```

- Blocks define reusable step groups.
- `do` executes the block with arguments.

Imports may bring in blocks:
```
import "blocks/common.spell" as common

do common.add(2, 3)
```

Imported blocks are namespaced by alias (or file stem).

#### Import resolution

- Imports MUST resolve relative to the current spell file.
- Remote or registry imports are not part of the core Grimoire language.
- If a host supports remote imports, it MUST be explicit and logged.

### Atomic blocks

```
atomic:
  ...
```

The VM SHOULD treat atomic blocks as all-or-nothing. If atomicity is not possible in the host, the VM MUST:
- Execute the steps in order.
- Emit a warning that atomicity was not enforced.

### Emit

```
emit event_name(key=value)
```

- Record an event with a name and payload.
- Include it in the run output.

### Halt

```
halt "reason"
```

- Stop execution immediately.
- Mark run as failed unless explicitly handled by enclosing control flow.

### Wait

```
wait 5m
```

- Delay execution if supported.
- If delay is not possible, log a warning and continue.

### Pass

```
pass
```

- No-op.

## Advisory steps

### Inline advisory prompt

```
if **should we proceed?** via risk:
  ...
```

- Evaluate an advisory prompt to a boolean.
- The VM uses its own judgment if no external advisory handler is available.

### Advise statement (structured output)

```
result = advise risk: "Assess risk"
  output:
    type: enum
    values: [low, medium, high]
  timeout: 30
  fallback: "medium"
```

- The VM MUST respect the output schema.
- If the advisory cannot be resolved, it MUST use `fallback`.
- If the output does not match the schema, the VM MUST coerce it to a valid value.

### Advisory metadata

If an advisor declares `skills`, `allowed_tools`, or `mcp` metadata, the VM SHOULD surface this in advisory-start events so external orchestrators can route tools appropriately.

## Error model

The VM MUST distinguish:
- **Syntax errors**: fail before execution.
- **Runtime errors**: fail the current step and apply control flow semantics.
- **Tool errors**: fail the step; include tool name and message.

When a step fails, its `onFailure` behavior applies (default: revert). The VM SHOULD log all failures with step IDs or source locations where possible.

## Logging and events

A VM host SHOULD emit a structured log, for example:

```
Run:
  spell: SafeSwap
  trigger: manual
  status: success

Events:
  - swapped(tx=...)

Bindings:
  decision: true
  state.run_count: 5
```

Recommended event types:
- `run_started`, `run_completed`
- `step_started`, `step_completed`, `step_failed`, `step_skipped`
- `advisory_started`, `advisory_completed`, `advisory_failed`
- `event_emitted`

## Determinism

The Grimoire VM is best-effort and non-deterministic by default. Sources of nondeterminism include:
- Model judgment
- Missing or variable tool availability
- External data queries

For deterministic execution, use the external runtime (`simulate` / `cast`).

## Security and responsibility

The VM executes inside an agent session and may use tools with side effects. The host and user are responsible for:
- Reviewing spells before execution.
- Confirming any real-world actions.
- Verifying outputs before acting on them.

## Conformance

See `references/CONFORMANCE.md` for a checklist and test matrix.
