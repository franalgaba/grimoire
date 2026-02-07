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

The VM host is the agent session (or a wrapper around it). In VM mode, the session is the runtime.

The VM executes steps by:
- Evaluating expressions directly.
- Invoking tools/providers/approved commands for actions or external data.
- Producing a run log with provenance.

The host MUST make tool usage explicit and SHOULD confirm side effects before executing them.

## VM purity boundary (required)

During VM execution, the host MUST NOT execute strategy semantics outside VM rules.

Disallowed examples:
- Running spell control flow in Python/Node/bash instead of VM step semantics.
- Evaluating conditions/loops/branching externally and only returning a final answer.
- Performing action-selection logic in non-VM code paths that bypass VM steps.

Allowed operations:
- Parse/validate/execute steps with VM semantics.
- Operational shell/tool commands for data retrieval, adapter metadata, diagnostics, or environment checks.
- Auxiliary script usage only when it does not evaluate or replace spell control flow.

Operational commands and scripts are I/O substrate only. They MUST NOT become the strategy execution engine.

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

## Execution boundary (strict structure + bounded judgment)

The VM host MUST:
- Follow spell structure exactly for control flow and step ordering.
- Use model judgment only at explicit semantic boundaries (for example advisory or `**...**` decisions).
- Treat tools/commands as input/output substrate, not as the strategy executor.
- Keep an execution trace that maps outputs back to VM step semantics.

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
- **Approved command-based data sources** (for provider gaps) to explicit command templates.

If a required tool is missing, the VM MUST fail the step with a clear error.

Operational commands MAY be used for data/tooling access, but MUST NOT execute strategy semantics outside VM rules.

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

## Fast path and path guardrails

### Fast path prompts (required)

The VM host MUST execute a fast path for the following prompts:

1. `Create a Grimoire VM spell named <X> and save it to <path>`
2. `Run <path> in the Grimoire VM with trigger manual. Use defaults and no side effects`

Fast path behavior:

1. Read only required skill/reference files and the target spell path.
2. Skip broad filesystem discovery unless a concrete parse/transform/runtime error occurs.
3. Produce output directly from the VM spec + user inputs.

### Execution scope root

If the user provides explicit file path(s), the VM host MUST set `execution_scope_root` to:

1. The provided path parent(s), and
2. The current working directory only when needed for relative resolution.

The VM host MUST NOT read/write outside scope except:

1. Skill reference files needed to execute VM logic.
2. Explicitly user-approved locations.

### Discovery budget (VM artifacts)

For VM runs, discovery SHOULD be bounded and purposeful.

The discovery budget applies only to:

1. Target spell path.
2. Required VM references/skills.
3. Direct import paths in scope.

For fast-path-eligible tasks:

1. Maximum 3 discovery commands before the first draft or run result.
2. No compiler/runtime internals (`dist/compiler/*`, parser/tokenizer internals) unless:
   1. A real parse/transform/runtime error is observed, and
   2. It cannot be resolved from DSL spec or known examples.

## Real-data provider and provenance contract

Real-data fetch SHOULD prefer VM-native provider calls. Command-based fetches are allowed when they preserve VM semantics and are captured in provenance.

### Provider interface (required)

```ts
interface VmDataProvider {
  id: string; // e.g. "grimoire.venue.morpho-blue"
  fetch(input: {
    venue: string;
    dataset: string;
    chainId?: number;
    asset?: string;
    filters?: Record<string, unknown>;
  }): Promise<{
    schema_version: string;
    snapshot_id?: string;
    snapshot_at: string;
    snapshot_source: string; // data source reference
    records: unknown[];
    record_count: number;
    units?: Record<string, string>;
    warnings?: string[];
  }>;
}
```

### Data-source provenance shape (required)

```ts
type VmDataSource =
  | {
      source_type: "provider";
      source_id: string; // provider id
      source_ref: string; // provider URI/reference
    }
  | {
      source_type: "command";
      source_id: string; // command alias
      source_ref: string; // stable command reference string
      command_source: string; // exact executed command
    };
```

### Data source resolution ladder

VM hosts SHOULD resolve real data using this order:

1. Primary configured VM provider.
2. Explicitly configured provider fallback.
3. Approved command-based fetch path.
4. Deterministic failure.

If command-based fetch is used, VM control flow MUST still execute in VM semantics.

Approved command paths SHOULD be templated/allowlisted by the host to avoid execution drift.

### Real-data provenance payload

When VM mode uses real data, hosts MUST normalize provenance into a snapshot payload that includes source metadata:

```json
{
  "schema_version": "grimoire.vm.snapshot.v2",
  "snapshot_id": "ulid",
  "snapshot_at": "2026-02-07T12:34:56Z",
  "snapshot_source": "grimoire://venue/morpho-blue/vaults?chain=8453&asset=USDC",
  "source_type": "provider",
  "source_id": "grimoire.venue.morpho-blue",
  "source_ref": "grimoire://venue/morpho-blue/vaults?chain=8453&asset=USDC",
  "fetch_attempts": 1,
  "fallback_used": "none",
  "venue": "morpho-blue",
  "dataset": "vaults",
  "chain_id": 8453,
  "asset": "USDC",
  "filters": {
    "min_tvl": 5000000,
    "limit": 3,
    "sort": "netApy",
    "order": "desc"
  },
  "units": {
    "net_apy": "decimal",
    "net_apy_pct": "percent",
    "tvl_usd": "usd"
  },
  "record_count": 3,
  "records": [],
  "source_hash": "sha256:...",
  "status": "ok",
  "warnings": []
}
```

If `source_type=command`, hosts MUST include `command_source` with the exact command executed.

### Snapshot storage mode (opt-in)

Snapshot storage is controlled by `snapshot_store: off|on` and defaults to `off`.

Behavior:

1. `snapshot_store=off`
   1. VM MAY fetch and use real data.
   2. VM MUST still emit provenance in run output.
   3. VM MUST NOT persist `.grimoire/vm-snapshots/*`.
2. `snapshot_store=on`
   1. VM MUST persist snapshot artifacts.
   2. VM MUST support replay by `snapshot_id`.

Storage paths when enabled:

1. `.grimoire/vm-snapshots/index.json`
2. `.grimoire/vm-snapshots/<snapshot_id>.json`

`index.json` minimum shape:

```json
{
  "schema_version": "grimoire.vm.snapshot.index.v1",
  "latest_by_key": {
    "morpho-blue|vaults|8453|USDC|<filters_hash>": "01H..."
  },
  "snapshots": [
    {
      "snapshot_id": "01H...",
      "snapshot_at": "2026-02-07T12:34:56Z",
      "key": "morpho-blue|vaults|8453|USDC|<filters_hash>",
      "status": "ok",
      "record_count": 3,
      "path": ".grimoire/vm-snapshots/01H....json"
    }
  ]
}
```

### Freshness and fallback policy

VM policy fields:

1. `max_snapshot_age_sec` (default `3600`)
2. `on_stale`: `fail|warn` (default `warn`)

Required behavior:

1. VM MUST compute and emit `snapshot_age_sec`.
2. If stale and `on_stale=fail`, VM MUST stop before execution.
3. VM MUST emit `fetch_attempts`.
4. VM MUST emit `fallback_used` as `none|provider_fallback|command_fallback`.
5. If command fallback is used, VM MUST emit `command_source`.

### Validation gates before real-data run

Before executing against real data, VM hosts MUST validate:

1. `record_count > 0`
2. Snapshot `chain_id` and `asset` match the requested run scope
3. Required fields exist: `snapshot_at`, `snapshot_source`, `records`, `source_type`, `source_id`
4. Critical ranking fields are non-null for the selected strategy
5. Snapshot schema version is recognized

### Required real-data run output extension

Real-data VM runs MUST include a `Data` block:

```text
Run:
  spell: <name>
  trigger: <trigger>
  status: <success|failed>

Data:
  mode: real_snapshot
  snapshot_id: <id>
  snapshot_at: <iso>
  snapshot_age_sec: <n>
  snapshot_source: <provider_uri_or_command_ref>
  source_type: <provider|command>
  source_id: <provider_id_or_command_alias>
  fetch_attempts: <n>
  fallback_used: <none|provider_fallback|command_fallback>
  command_source: <exact_command_or_none>
  units: net_apy=decimal, net_apy_pct=percent, tvl_usd=usd
  selection_policy: <formula/criteria>
  rejected_count: <n>

Events:
  - <event>(...)

Bindings:
  <key>: <value>
```

### Failure semantics when no data path is available

If no provider or approved command path can satisfy the request, the VM MUST fail with:

1. `status: failed`
2. `error_code: VM_DATA_SOURCE_UNAVAILABLE`
3. A concrete remediation (for example: configure a VM provider or provide snapshot params).

### Scripting prohibition

VM hosts MUST NOT use ad-hoc scripts to execute spell semantics.

Ad-hoc scripts MAY be used for auxiliary data handling only when:

1. They do not evaluate or replace spell control flow.
2. Provenance captures script/tool source and purpose.
3. Equivalent VM execution semantics remain authoritative.

### APY unit rules

For Morpho and any APY-like fields:

1. `net_apy` and `apy` are decimal rates.
2. `0.0408` means `4.08%`.
3. Reports SHOULD include both decimal and percent display values.

## Security and responsibility

The VM executes inside an agent session and may use tools with side effects. The host and user are responsible for:
- Reviewing spells before execution.
- Confirming any real-world actions.
- Verifying outputs before acting on them.

## Conformance

See `docs/reference/grimoire-vm-conformance.md` for a checklist and test matrix.
