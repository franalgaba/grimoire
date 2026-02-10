<!--
This file is generated from docs/reference/embedded-runtime.md.
Run scripts/sync-references.sh to update.
-->

# Embedded Runtime

Status: draft

The embedded runtime is the Grimoire execution engine exposed as an importable library (`@grimoirelabs/core`). It runs the same compiler pipeline, interpreter, and preview/commit model as the CLI. The only difference is delivery: you import it into your process instead of spawning a command.

## Conformance language

The key words "MUST", "MUST NOT", "SHOULD", "SHOULD NOT", and "MAY" in this document are to be interpreted as described in RFC 2119.

## Overview

Use the embedded runtime when you need to:

- **Integrate Grimoire into an agent or application** — compile, preview, inspect receipts, and commit without shelling out to a CLI process.
- **Build lower-latency authoring loops** — validate and preview spells with typed objects in-process, inspect receipts programmatically.
- **Control orchestration from the host** — wire your own state backend, approval hooks, advisory handler, and adapter transport.
- **Run deterministic integration tests** — exercise spells inside your test suite with the same semantics as production.

The embedded runtime is **not** a separate execution mode. It shares the same expression evaluator, control flow, guard enforcement, constraint checks, drift policy, advisory resolution, and preview/commit phase separation as the CLI.

## Execution semantics

The embedded runtime uses the same execution semantics as the CLI.

### Execution lifecycle

1. **Compile** the spell source into IR (tokenize → parse → transform → type-check → validate).
2. **Preview** (mandatory for irreversible actions):
   - Evaluate guards — halt if any guard fails.
   - Select and execute the trigger block.
   - Resolve advisory steps (via handler or fallback).
   - Simulate venue actions through adapter preview contracts.
   - Evaluate constraints against simulated results.
   - Compute value-flow accounting (per-asset debit/credit/fee).
   - Generate a Receipt.
3. **Commit** (optional, requires a valid receipt):
   - Validate receipt status (`ready`, not expired).
   - Check approval gates.
   - Re-check drift keys against current state.
   - Execute planned actions through adapters.
   - Update state and ledger.

### Trigger selection

A spell can define multiple `on <trigger>:` blocks. The runtime MUST execute exactly one trigger per run.

- If the host explicitly chooses a trigger, the runtime MUST execute that trigger.
- If multiple triggers are eligible, the runtime SHOULD ask for user selection or pick the first declared trigger.

### Bindings and state

The runtime MUST support:
- `params.<name>` from the `params:` section (with overrides applied).
- `state.<key>` from the `state:` section (persistent across runs when the host provides storage).
- Named outputs from step bindings (e.g., `result = ...`).

Two state scopes:
- **Persistent**: survives across runs if the host provides a `StateStore`.
- **Ephemeral**: per-run scratch state, reset each run.

### Expression evaluation

The runtime MUST evaluate expressions as defined in the DSL reference: arithmetic, comparison, logical, ternary operators, property and array access, and built-in functions.

### Step semantics

All step types are supported identically to CLI execution:

- **Assignment**: `value = <expression>`
- **Action calls**: `venue.action(args) [using skill] [with constraints]`
- **Constraints**: inline or parenthesized `with (...)` form, trailing commas allowed
- **Conditionals**: `if / elif / else` with brace blocks
- **Loops**: `for`, `repeat`, `loop until`
- **Try/catch/finally**: with optional retry policy
- **Parallel**: `parallel join=... on_fail=...` (host MAY execute branches sequentially but MUST preserve join/failure semantics)
- **Pipeline**: `filter / map / reduce` stages
- **Blocks/imports**: `block name(args) { ... }` and `do name(args)`
- **Atomic**: all-or-nothing semantics (host SHOULD enforce; MUST warn if not possible)
- **Emit**: `emit event_name(key=value)`
- **Halt**: `halt "reason"` — stop execution immediately
- **Wait**: `wait 5m` — delay if supported, warn and continue otherwise
- **Pass**: no-op

### Advisory steps

Advisory steps (`advise` and inline `**...**` prompts) resolve during preview, never during commit.

- The host provides an `onAdvisory` handler or the runtime uses the spell's `fallback`.
- `advise` output MUST conform to the declared schema; the runtime coerces if needed.
- If the handler fails or times out, the runtime uses `fallback`.

### Error model

The runtime MUST distinguish:
- **Syntax/type errors**: fail at compile time.
- **Runtime errors**: fail the current step and apply control flow semantics.
- **Tool/adapter errors**: fail the step with tool name and message.

### Runtime purity boundary

The host MUST NOT execute spell control flow outside runtime semantics. External tools and commands are I/O substrate only — they MUST NOT replace spell step evaluation, branching, or action selection.

## Host integration

The embedded runtime delegates transport and infrastructure concerns to the host.

### State backend (StateStore interface)

The host provides a `StateStore` implementation for persistent state and run history. `@grimoirelabs/core` ships `SqliteStateStore` as a ready-made implementation.

### Adapter transport (VenueAdapter interface)

The host provides venue adapters for action execution. Adapters are optional — without them, actions that require adapter execution will fail with a clear error.

### Advisory handler

The host provides an `onAdvisory` callback to resolve advisory steps with an external model. If no handler is provided, the runtime uses the spell's `fallback` value.

### Approval hooks

For actions that exceed `approval_required_above` thresholds, the host provides a `confirmCallback`.

## Conformance

See `references/CONFORMANCE.md` for the test matrix and conformance checklist.
