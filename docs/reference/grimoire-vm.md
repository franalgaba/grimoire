# Grimoire VM (In-Agent) Execution Spec

The Grimoire VM mode runs **inside an agent session**. The agent interprets `.spell` files directly (no external runtime), using available tools to execute steps.

This mode is **best-effort** and is intended for prototyping, education, and quick iteration inside Claude/Codex-style environments.

## Scope

- Input: `.spell` files
- Output: execution log + bindings + emitted events
- Guarantees: follows this spec; does not guarantee deterministic results

## Execution Model

1. Parse the `.spell` file using the Grimoire DSL rules.
2. Validate basic syntax and section structure.
3. Execute the first matching trigger block.
4. Execute steps in order, respecting control flow (if/else, loops, try/catch, parallel).

## Tool Mapping

The VM maps steps to available tools in the agent environment.

- **compute/assign** -> in-session evaluation
- **emit** -> log event with payload
- **advise** -> model judgement using the agent's own reasoning
- **actions** (`swap`, `lend`, `bridge`, etc.) -> call tooling if present
- **wait** -> delay (if supported) or no-op with log

If a required tool is missing:
- Emit a warning
- Mark the step as failed
- Continue only if the spell's control flow allows it

## Advisory Steps

Advisory steps (`advise`) are executed by the agent directly:
- Use the advisory prompt
- Respect the output schema
- If schema is violated, coerce to the nearest valid output

## State and Bindings

- Maintain bindings for params, state, and step outputs
- `state` is best-effort and may be persisted only if the host provides storage
- Emit a final bindings snapshot after execution

## Output Format

At the end of execution, emit a structured log:

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

## Limitations

- Determinism depends on the host agent and tools
- Onchain actions require explicit wallet tooling
- Advisory decisions depend on model behavior

## Recommended Use

- Drafting strategies in-agent
- Sharing and iterating quickly
- Education and prototyping

For production, use the external runtime (`grimoire simulate` / `grimoire cast`).
