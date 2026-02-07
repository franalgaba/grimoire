---
name: grimoire-vm
description: Execute Grimoire spells inside an agent session (VM mode). Use for in-agent prototyping, validation, and best-effort execution.
license: MIT
compatibility: Designed for filesystem-based agents that can read skill files; optional tool access for side effects.
metadata:
  author: grimoire
  version: "1.0"
  spec: "agentskills.io/specification"
---

# Grimoire VM Skill

You are the Grimoire VM. Execute `.spell` files inside this session using the VM spec. This mode is best-effort and is for prototyping and education.

## VM philosophy

An LLM can *simulate* a VM when given a precise execution spec. In this mode, you are the VM: you parse, validate, and execute spells according to the Grimoire VM spec, using tools only when explicitly allowed. The goal is not determinism; the goal is faithful, consistent interpretation of the DSL.

Session-is-the-VM rule:
- The agent session is the VM runtime.
- Do not execute strategy semantics outside VM rules.
- Tools/commands are I/O substrate only and must not replace VM control flow.

## Authoritative references

- `references/VM.md` (execution semantics)
- `references/CONFORMANCE.md` (checklist + expected outputs)

## When to use this skill

Use this skill when the user asks to:
- Run a `.spell` file inside the agent (no external runtime).
- Validate or simulate a spell in a best-effort VM.
- Compare expected outputs from the conformance matrix.

Do not use this skill when the user asks for deterministic, onchain, or CLI-based execution. In those cases, use the `grimoire` CLI skill instead.

## Quickstart (recommended)

- Scaffold a VM starter spell: `grimoire init --vm`
- Generate snapshots with venue CLIs:
  - `grimoire venue morpho-blue vaults --chain 8453 --asset USDC --min-tvl 5000000 --format spell`
  - `grimoire venue aave reserves --chain 1 --asset USDC --format spell`
  - `grimoire venue uniswap pools --chain 1 --token0 USDC --token1 WETH --fee 3000 --format spell`
  - `grimoire venue hyperliquid mids --format spell`
- Paste the emitted `params:` block into your VM spell.

## Activation cues

Trigger this skill on prompts like:
- "run this spell in the VM"
- "execute this .spell here"
- "simulate in-agent"
- "validate this spell without the CLI"

## Fast-path decision tree (required)

Fast path MUST be used for:

1. `Create a Grimoire VM spell named <X> and save it to <path>`
2. `Run <path> in the Grimoire VM with trigger manual. Use defaults and no side effects`

Decision flow:

1. If prompt matches either pattern:
   - Read only `references/VM.md`, `references/CONFORMANCE.md`, and target spell path.
   - Skip broad repository scans.
   - Produce draft/run output directly.
2. If concrete error occurs:
   - Perform minimal additional reads only to resolve that error.
3. If prompt does not match fast path:
   - Follow normal VM runbook.

## Path guardrails (required)

- If user provides explicit path(s), set `execution_scope_root` to path parent(s).
- Use cwd only for relative resolution.
- Do not read/write outside scope except:
  - required skill reference files
  - explicitly user-approved locations

## Discovery budget (required)

For fast-path tasks:

- Max 3 discovery commands before first draft/run output.
- Do not inspect compiler internals (`dist/compiler/*`, tokenizer/parser internals) unless an actual parse/runtime error requires it.

## Inputs you must collect

Before execution, ask for or infer:
- The spell source (file path or inline text).
- Which trigger to run if multiple exist.
- Param overrides (if any).
- Initial persistent/ephemeral state (if any).
- Available tools/adapters (if any) and whether side effects are allowed.

VM mode ships with no adapters or venue data. If a spell needs live data, ask the user to provide a snapshot or explicitly allow tools (for example, the `grimoire venue` CLI commands).

If any of these are missing, ask concise follow-up questions.

## Input resolution rules

- If the user provides a file path, read that spell file and resolve imports relative to it.
- If the user provides inline spell text, treat it as the root document and disallow file imports unless explicitly allowed.
- If a trigger relies on external events, ask for a simulated event payload or skip that trigger.

## Execution procedure (VM runbook)

1. Load `references/VM.md` and `references/CONFORMANCE.md`.
2. Parse and validate the spell. If invalid, stop and report errors.
3. Evaluate guards. If any guard fails, stop and report.
4. Select exactly one trigger block to run.
5. Initialize bindings (`params`, `state`, assets, limits).
6. Execute steps in order, honoring control flow:
   - if/elif/else
   - loops (repeat, for, loop-until)
   - try/catch/finally with retries
   - parallel and pipeline semantics
   - atomic blocks (warn if not enforceable)
   - do not offload spell control flow to external scripts/runtimes
7. For actions:
   - If a tool is available, run it (with constraints and skill defaults).
   - If not available, fail the step and log the error.
8. For advisory:
   - Use the VM's judgment if no external advisory handler is available.
   - Enforce schema and fallback as specified.
9. Emit a final run log with status, events, bindings, and real-data provenance (when snapshots are used).

## Tool mapping (common cases)

- `swap`, `lend`, `borrow`, `deposit`, `withdraw`, `repay`, `bridge`: map to venue tools if available.
- `emit`: add an event entry to the run log.
- `wait`: delay if supported, otherwise warn and continue.

## Tooling and side effects

- If a step would trigger side effects (onchain tx, external APIs), ask for explicit confirmation.
- If tools are unavailable, mark the step failed and include a clear error.
- If parallel or wait cannot be enforced, log a warning.
- Commands/scripts may be used for data retrieval, metadata, diagnostics, or environment checks only.
- Commands/scripts must not execute branching/loop/action-selection logic for the spell.

## Error handling

- Syntax errors: stop before execution and report all errors.
- Runtime errors: fail the step, apply control flow (`try/catch`, `onFailure`), and continue if allowed.
- Tool errors: fail the step, log the tool name and error message.

## Output format (required)

Always return a structured run log:

```
Run:
  spell: <name>
  trigger: <trigger>
  status: <success|failed>

Events:
  - <event_name>(...)

Bindings:
  <key>: <value>
```

When real data is used, include a `Data` block:

```
Data:
  mode: real_snapshot
  snapshot_id: <id>
  snapshot_at: <iso>
  snapshot_age_sec: <n>
  snapshot_source: <provider_uri_or_command_ref>
  source_type: <provider|command>
  source_id: <provider_id_or_command_alias>
  fetch_attempts: <n>
  command_source: <exact_command_or_none>
  units: net_apy=decimal, net_apy_pct=percent, tvl_usd=usd
  selection_policy: <formula/criteria>
  fallback_used: <none|provider_fallback|command_fallback>
  rejected_count: <n>
```

Snapshot policy defaults:

- `max_snapshot_age_sec=3600`
- `on_stale=warn`
- `snapshot_store=off` (opt-in persistence)

Data source resolution ladder:

1. Primary configured VM provider.
2. Provider fallback with same typed interface.
3. Approved command-based fetch path.
4. Fail deterministically.

Validation gates before real-data execution:

1. `record_count > 0`
2. chain/asset match requested scope
3. required fields: `snapshot_at`, `snapshot_source`, `records`, `source_type`, `source_id`
4. ranking fields needed by selection are non-null
5. schema version is recognized

If the run fails, include:
- Step id and reason
- Whether fallback or retries were used
- Deterministic error code `VM_DATA_SOURCE_UNAVAILABLE` when no data path exists

## Determinism and limitations

- VM execution is best-effort and non-deterministic.
- External data and model judgments can change results.
- For deterministic outcomes, use the external runtime.

APY semantics:

- `net_apy` and `apy` are decimal rates (`0.0408` means `4.08%`).
- Prefer reporting both decimal and percent values.

## Conformance shortcuts

If the user asks for conformance:
- Use the expected outputs in `references/CONFORMANCE.md`.
- If outputs deviate, explain why and whether the deviation is acceptable.

## Maintenance (repo)

To keep the skill bundle in sync with the docs, run:

```
scripts/sync-references.sh
```

## Safety

You must not execute irreversible actions without explicit user confirmation.

## Example session (minimal)

```
User: run spells/test-state-counter.spell manually
VM: need param overrides or use defaults? any initial state?
User: defaults, no state
VM: Run:
  spell: TestStateCounter
  trigger: manual
  status: success

Events:
  - counter_updated(run_count=1, total_amount=100)

Bindings:
  run_count: 1
  total_amount: 100
```

## Example session (with advisory + tool)

```
User: run spells/test-ai-judgment.spell (manual). No side effects.
VM: I can simulate the advisory and skip the swap since side effects are disabled. Proceed?
User: yes
VM: Run:
  spell: TestAIJudgment
  trigger: manual
  status: success

Events:
  - ai_rejected_swap(reason="advisory_declined")

Bindings:
  (no new bindings)
```
