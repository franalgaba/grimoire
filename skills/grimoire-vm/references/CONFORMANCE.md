<!--
This file is generated from docs/reference/grimoire-vm-conformance.md.
Run scripts/sync-references.sh to update.
-->

# Grimoire VM Conformance Checklist and Test Matrix

Status: draft

This document defines a lightweight conformance target for Grimoire VM hosts. It is not a full certification program, but it provides a common baseline so VM implementations behave consistently.

Think of it as a contract between the VM spec and real-world hosts: if you implement these behaviors, users can trust that their spells will execute predictably, even inside a best-effort agent session.

The goal is not perfection. The goal is consistency.

## Conformance profiles

### Core profile (no external tools)

Targets in-agent execution without onchain adapters.

Required capabilities:
- Parse and validate core syntax.
- Evaluate expressions and control flow.
- Execute advisory steps with fallback.
- Maintain bindings and state.
- Emit events and final bindings.

### Tooling profile (actions and adapters)

Adds tool-backed execution.

Required capabilities:
- Resolve venues and skills.
- Enforce constraints passed via `with`.
- Surface tool failures and partial results.

### Onchain profile (protocol adapters)

Adds real adapter execution.

Required capabilities:
- Wallet or signing capability.
- RPC connectivity.
- Protocol adapters available in the host.

## Conformance checklist

A VM host SHOULD satisfy the following:

- Parse/validate: spell name, sections, indentation, references.
- Guards: evaluate pre-run guards and halt on failure.
- Triggers: select a single trigger per run.
- Bindings: params, state, and output bindings tracked.
- Control flow: if/elif/else, loops, try/catch/finally, parallel, pipeline.
- Advisory: schema coercion + fallback behavior.
- Emits: event data preserved and returned.
- Errors: step failures reported with step IDs or locations.
- Purity boundary: strategy semantics stay in VM; tools/commands remain I/O substrate.

## Test matrix (recommended)

Use the following spells as a baseline. These spells already exist in the repository.

| Feature | Spell | Profile | Expected output (high level) | Notes |
| --- | --- | --- | --- | --- |
| Basic parsing | `spells/compute-only.spell` | Core | Emits `rebalance_needed` by default (or `no_rebalance_needed` if drift is small). | No tools required. |
| Typed params/assets | `spells/test-typed-params-assets.spell` | Core | Emits `typed_params` with converted amount/bps/duration values. | Validates typed params parsing. |
| Triggers (hourly/daily) | `spells/test-trigger-hourly.spell`, `spells/test-trigger-daily.spell` | Core | `hourly_check` or `daily_report`, persistent counters increment. | Invoke manually in VM. |
| Condition/event triggers | `spells/test-trigger-condition-event.spell` | Core | `manual_trigger` (manual), `condition_triggered` (condition), `event_triggered` (event). | Provide simulated event context. |
| Expressions | `spells/test-complex-expressions.spell` | Core | Emits `calculation` with derived numeric fields. | Arithmetic, logic, and access. |
| Ternary/logical/modulo | `spells/test-ternary.spell`, `spells/test-logical-ops.spell`, `spells/test-modulo.spell` | Core | `result` (ternary), `in_range` + `enabled` (logical ops default), `modulo_result` + `parity` (odd by default). | Expression variants. |
| Output binding | `spells/test-output-binding.spell`, `spells/test-output-binding-conditional.spell` | Tooling | Emits `swapped` with `output` when action executes; conditional emits `skipped` when threshold not met. | Requires action tool or stub result. |
| Loops | `spells/test-repeat-loop.spell`, `spells/test-until-loop.spell`, `spells/test-loop-index.spell` | Core | `repeated(total=3)`, `loop_done(counter=3)`, per-asset `processed` plus `loop_complete(total=600)` with defaults. | Loop semantics. |
| Try/catch/retry | `spells/test-try-catch-retry.spell` | Core | `try_finally` emitted even after error; run completes via catch. | Error handling. |
| Parallel | `spells/test-parallel.spell` | Core | Emits `parallel_done(sum=6)` with defaults. | Join behavior. |
| Pipeline | `spells/test-pipeline.spell` | Core | Emits `pipeline_done` with reduced result (default flow yields `[3]`). | Filter/map/reduce semantics. |
| Blocks/imports | `spells/test-blocks-imports.spell`, `spells/test-import-alias.spell` | Core | Emits `added(sum=5)` from block invocation. | Import resolution. |
| Atomic | `spells/test-atomic.spell`, `spells/test-atomic-revert.spell` | Tooling | `swap_executed` + `atomic_complete` if tools succeed; revert case should fail on tool error. | Atomic semantics. |
| Wait/halt | `spells/test-wait.spell`, `spells/test-halt.spell` | Core | `step_started` then `step_after_wait`; halt stops run under default params. | Timing + termination. |
| State | `spells/test-state-counter.spell`, `spells/test-ephemeral-state.spell` | Core | `counter_updated` increments persistently; `state_check` shows ephemeral values reset each run. | Persistent vs ephemeral state. |
| Advisory (boolean) | `spells/test-ai-judgment.spell` | Tooling | Emits `ai_approved_swap` or `ai_rejected_swap` based on advisory outcome. | Inline advisory prompt + action. |
| Advisory (schema) | `spells/test-advise-output.spell`, `spells/test-advise-schema-object-array.spell` | Core | Emits `advised` with schema-conformant output; enum fallback coerces to first value. | Structured output + coercion. |
| Constraints | `spells/test-constraints.spell`, `spells/test-constraints-extended.spell` | Tooling | Constraints passed to tool; extended case emits `constraints_applied`. | Requires constraint propagation. |
| Skill autoselect | `spells/test-skill-autoselect-implicit.spell`, `spells/test-using-skill-autoselect.spell` | Tooling | Emits `swapped`; defaults/skill routing applied. | Venue/skill routing. |
| Adapter actions (Aave/Uniswap/Across) | `spells/test-aave-deposit.spell`, `spells/test-v3-usdc-to-eth.spell`, `spells/test-across-usdc-base-to-arb.spell` | Onchain | Emits `deposit_done`, `swap_done`, `bridged` if adapters succeed; otherwise tool error surfaced. | Requires adapters + RPC. |

## Interpreting results

- A VM host passes a test if it produces the expected success/failure outcome and matches the spell semantics.
- For tool-dependent spells, a host may pass with stubbed tools as long as constraints, bindings, and errors are surfaced consistently.

## Assumptions for expected outputs

The expected outputs below assume:
- Default params and a fresh state unless stated otherwise.
- Advisory handlers return fallback values for `advise` (structured output).
- Tooling profile runs may stub tool results but must preserve event structure.

If your host uses different defaults or seed state, adjust expected values accordingly and document the deviation in the conformance report.

## Expected outputs (baseline runs)

These outputs describe emitted events (from `emit` statements) in execution order. They intentionally ignore internal ledger events.

### Core profile

**spells/compute-only.spell**
Expected events:
```
rebalance_needed(drift=10, amount=100, fee=0.3)
```

**spells/test-typed-params-assets.spell**
Expected events:
```
typed_params(amount=1500000, slippage=50, interval=300, total=2000000, fee=25)
```

**spells/test-trigger-hourly.spell**
Expected events (first run):
```
hourly_check(run=1)
```

**spells/test-trigger-daily.spell**
Expected events (first run):
```
daily_report(day=1)
```

**spells/test-trigger-condition-event.spell**
Expected events by trigger:
```
manual_trigger(ok=true)
```
```
condition_triggered(interval=1)
```
```
event_triggered(kind="risk.alert")
```

**spells/test-complex-expressions.spell**
Expected events:
```
calculation(principal=10000, interest=500, total=10500, per_period=875, monthly_rate=0.004166666666666667)
```

**spells/test-ternary.spell**
Expected events:
```
result(label=0, capped=500)
```

**spells/test-logical-ops.spell**
Expected events:
```
in_range(amount=500000)
enabled()
```

**spells/test-modulo.spell**
Expected events:
```
modulo_result(value=17, divisor=5, remainder=2, mod2=1)
parity(type="odd")
```

**spells/test-repeat-loop.spell**
Expected events:
```
repeated(total=3)
```

**spells/test-until-loop.spell**
Expected events:
```
loop_done(counter=3)
```

**spells/test-loop-index.spell**
Expected events:
```
processed(asset="USDC", amount=200, running_total=200)
processed(asset="ETH", amount=200, running_total=400)
processed(asset="WETH", amount=200, running_total=600)
loop_complete(total=600)
```

**spells/test-try-catch-retry.spell**
Expected events:
```
try_finally(note="done")
```

**spells/test-parallel.spell**
Expected events:
```
parallel_done(sum=6)
```

**spells/test-pipeline.spell**
Expected events:
```
pipeline_done(result=[3])
```

**spells/test-blocks-imports.spell**
Expected events:
```
added(sum=5)
```

**spells/test-import-alias.spell**
Expected events:
```
added(sum=5)
```

**spells/test-wait.spell**
Expected events:
```
step_started(step=1)
step_after_wait(step=2)
```

**spells/test-halt.spell**
Expected behavior: run halts with reason "Amount exceeds safety limit" and emits no events.

**spells/test-state-counter.spell**
Expected events (first run):
```
counter_updated(run_count=1, total_amount=100)
```

**spells/test-ephemeral-state.spell**
Expected events (first run):
```
state_check(persistent_runs=1, ephemeral_temp=20, ephemeral_sum=10)
```

**spells/test-advise-output.spell**
Expected events (fallback coerced to enum):
```
advised(decision="hold")
```

**spells/test-advise-schema-object-array.spell**
Expected events (fallback object):
```
advised(report={action:"hold", confidence:0.5, notes:"fallback", legs:[{asset:"ETH", amount:1}]})
```

### Tooling profile (additional)

Tooling outputs depend on tool results. The structure below is required even if values are stubbed.

**spells/test-output-binding.spell**
Expected events:
```
swapped(output=<tool_result>)
```

**spells/test-output-binding-conditional.spell**
Expected events:
```
swapped(output=<tool_result>)
```
If the condition is forced false, expect:
```
skipped(reason="below threshold")
```

**spells/test-constraints.spell**
Expected behavior: action invoked with constraints `slippage=50`, `deadline=300` (no emit in spell).

**spells/test-constraints-extended.spell**
Expected events:
```
constraints_applied(amount=100000)
```

**spells/test-skill-autoselect-implicit.spell**
Expected events:
```
swapped(amount=100000)
```

**spells/test-using-skill-autoselect.spell**
Expected events:
```
swapped(amount=100000)
```

**spells/test-ai-judgment.spell**
Expected events depend on advisory outcome:
```
ai_approved_swap(amount=200000000000000)
```
or
```
ai_rejected_swap(reason="advisory_declined")
```

## Reporting

A conformance report SHOULD include:
- VM host name/version.
- Profile(s) claimed.
- Spells executed and outcomes.
- Any deviations from the expected semantics.

## Alignment checks (required for this spec revision)

### VMP-1: No strategy execution outside VM semantics

Pass criteria:

1. Control flow (branching, loops, retries, step ordering) is executed by VM semantics.
2. External tools/commands are used only for action execution, data retrieval, diagnostics, or environment checks.
3. Transcript evidence shows step-level VM progression, not an external script replacing evaluation.

Fail criteria:

1. Host runs spell control flow in Python/Node/bash (or equivalent) and returns only final outputs.
2. Host bypasses VM step semantics for action selection or branching.

Minimal transcript:

```text
User: Run spells/compute-only.spell in VM mode.
VM: step_started(id=1)
VM: step_completed(id=1)
VM: Run:
  status: success
```

### VMP-2: Strict structure + bounded judgment

Pass criteria:

1. VM follows spell structure exactly for step ordering and control flow.
2. Model judgment is used only at explicit semantic boundaries (for example `**...**` advisory decisions).
3. Output trace maps decisions and results back to VM steps.

Fail criteria:

1. Host reorders or skips spell steps without control-flow justification.
2. Model judgment is used to replace deterministic step execution.

Minimal transcript:

```text
User: Run spells/test-ai-judgment.spell manually.
VM: advisory_started(step=if_advisory_1)
VM: advisory_completed(step=if_advisory_1, decision=false)
VM: event_emitted(ai_rejected_swap)
```

### FP-1: Fast path compliance

Pass criteria:

1. For prompt `Create a Grimoire VM spell named <X> and save it to <path>`, VM reads only required references + target path.
2. For prompt `Run <path> in the Grimoire VM with trigger manual. Use defaults and no side effects`, VM returns run output without broad discovery.

Fail criteria:

1. Broad repository scans before first draft/run output with no concrete error.
2. Accessing unrelated files when the target path is explicit.

Minimal transcript:

```text
User: Run spells/vm.spell in the Grimoire VM with trigger manual. Use defaults and no side effects.
VM: Run:
  spell: ...
  trigger: manual
  status: success
```

### PATH-1: Path scope compliance

Pass criteria:

1. `execution_scope_root` contains explicit path parent(s), and cwd only if needed for relative resolution.
2. No read/write outside scope unless skill references or user-approved paths.

Fail criteria:

1. Reads unrelated sibling directories or home paths without approval.

Minimal transcript:

```text
User: Run ./spells/a.spell in VM mode.
VM: (reads ./spells/a.spell and its relative imports only)
```

### DISC-1: Discovery budget compliance

Pass criteria:

1. Fast-path tasks use at most 3 discovery commands before first draft/run output.
2. No compiler internals exploration unless an actual parser/runtime error requires it.

Fail criteria:

1. More than 3 discovery operations in fast path with no error.
2. Inspecting parser/tokenizer internals preemptively.

Minimal transcript:

```text
User: Create VM spell X at spells/x.spell.
VM: (<=3 discovery commands)
VM: file written
```

### RD-1: Snapshot provenance required

Pass criteria:

1. Real-data runs include `snapshot_at`, `snapshot_source`, `snapshot_age_sec`, and units in output.
2. Snapshot schema fields are present in provenance artifacts when stored.

Fail criteria:

1. Real-data run output omits provenance fields.

Minimal transcript:

```text
Data:
  mode: real_snapshot
  snapshot_at: 2026-02-07T12:34:56Z
  snapshot_source: grimoire venue ...
```

### RD-2: Unit semantics required

Pass criteria:

1. APY-like fields are interpreted as decimal rates.
2. Output clarifies decimal vs percent display (`net_apy=decimal`, `net_apy_pct=percent`).

Fail criteria:

1. Treating `0.0408` as 0.0408% instead of 4.08%.

Minimal transcript:

```text
units: net_apy=decimal, net_apy_pct=percent, tvl_usd=usd
```

### RD-3: Freshness policy enforced

Pass criteria:

1. VM computes `snapshot_age_sec`.
2. `on_stale=fail` stops execution before run.
3. `on_stale=warn` continues with warning.

Fail criteria:

1. Stale snapshot ignored under `fail`.

Minimal transcript:

```text
VM: failed - snapshot stale (age=5400, max=3600)
```

### RD-4: Replay by snapshot_id

Pass criteria:

1. When `snapshot_store=on`, VM can replay by exact `snapshot_id`.
2. When `snapshot_store=off`, check is `N/A`.

Fail criteria:

1. `snapshot_store=on` and replay cannot locate/execute snapshot.

Minimal transcript:

```text
User: Replay snapshot 01H...
VM: using snapshot_id=01H...
```

### RD-5: Validation gates enforced

Pass criteria:

1. VM rejects `record_count=0`.
2. VM rejects chain/asset mismatch.
3. VM rejects missing required fields (`snapshot_at`, `snapshot_source`, `records`, `source_type`, `source_id`).
4. VM rejects unrecognized schema version.

Fail criteria:

1. Any invalid snapshot executes without explicit warning/failure.

Minimal transcript:

```text
VM: failed - snapshot validation: record_count must be > 0
```

### RD-6: Extended real-data run report required

Pass criteria:

1. Report includes `Run`, `Data`, `Events`, and `Bindings` blocks.
2. `Data` includes `source_type`, `source_id`, `fetch_attempts`, `selection_policy`, `fallback_used`, and `rejected_count`.

Fail criteria:

1. Partial report shape in real-data mode.

Minimal transcript:

```text
Run:
  status: success
Data:
  source_type: provider
  source_id: grimoire.venue.morpho-blue
  fetch_attempts: 1
  selection_policy: max(net_apy)
  fallback_used: none
  rejected_count: 1
Events:
  - candidate(...)
Bindings:
  best_market: ...
```

### RD-7: Real-data provenance completeness

Pass criteria:

1. Real-data runs report `snapshot_source`, `source_type`, `source_id`, `fetch_attempts`, and `fallback_used`.
2. When `source_type=command`, output also includes `command_source`.
3. `fallback_used` is one of `none|provider_fallback|command_fallback`.

Fail criteria:

1. Any required provenance field is omitted.
2. `source_type=command` without `command_source`.

Minimal transcript:

```text
Data:
  snapshot_source: grimoire://venue/morpho-blue/vaults?chain=8453&asset=USDC
  source_type: provider
  source_id: grimoire.venue.morpho-blue
  fetch_attempts: 1
  fallback_used: none
```

### RD-8: Script/runtime usage does not replace VM control flow

Pass criteria:

1. Any command/script usage is limited to data/tooling operations.
2. VM trace still shows spell-driven steps, branches, and loop boundaries.

Fail criteria:

1. Script output is treated as strategy execution result without VM step evaluation.
2. Host cannot provide step-level evidence for control flow.

Minimal transcript:

```text
VM: command_fetch_started(alias=grimoire-venue-morpho)
VM: command_fetch_completed(alias=grimoire-venue-morpho)
VM: step_started(id=for_assets_1)
VM: step_completed(id=for_assets_1)
```

### RD-9: Deterministic failure when no data path is available

Pass criteria:

1. If provider and approved command paths are unavailable, run ends with `status: failed`.
2. Error includes deterministic code `VM_DATA_SOURCE_UNAVAILABLE`.
3. Error includes remediation guidance (provider configuration or snapshot params).

Fail criteria:

1. Run proceeds with missing data path.
2. Failure lacks deterministic code or remediation.

Minimal transcript:

```text
Run:
  status: failed
  error_code: VM_DATA_SOURCE_UNAVAILABLE
  error: Configure a VM data provider or provide snapshot params.
```

## VM harness checklist (agent skill)

Use this when embedding the Grimoire VM inside an agent skill or prompt.

- Load `references/VM.md` and `references/CONFORMANCE.md`.
- Ask for the spell source or file path.
- If multiple triggers exist, ask which one to run (or log default choice).
- Ask for param overrides and initial state (if any).
- Display available tools/adapters and warn about missing ones.
- Confirm any side-effectful tool calls before execution.
- Evaluate guards before trigger execution and stop on failure.
- If `parallel` is executed sequentially, log that explicitly.
- If `wait` or `atomic` cannot be enforced, log a warning.
- Emit a structured run log with events and final bindings.
- Include step failures with step IDs (and locations if known).
