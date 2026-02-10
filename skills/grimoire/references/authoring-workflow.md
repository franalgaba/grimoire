# Authoring Workflow (Agent Procedure)

Use this procedure whenever creating or editing `.spell` files.

## 1. Load Context

1. Read `references/syntax-capabilities.md`.
2. Identify the target spell path and trigger intent (`manual`, `hourly`, etc.).
3. Identify whether the spell has value-moving actions.

## 2. Author With Minimal Safe Skeleton

Start from:

```spell
spell Hello {
  params: {
    amount: 42
  }

  on manual: {
    doubled = params.amount * 2
    emit hello(amount=params.amount, doubled=doubled)
  }
}
```

Then incrementally add venues/actions/guards/advisory blocks.

## 3. Compile/Validate Loop

Run:

```bash
<grimoire-cmd> validate <spell-path>
```

If validation fails:

1. fix the highest-impact error first
2. re-run `validate`
3. repeat until success

For advisory-heavy spells:

```bash
<grimoire-cmd> validate <spell-path> --strict
```

Use strict mode to force explicit advisory hygiene (`context`, `within`, explicit `on_violation`).

## 4. Preview Loop

Run:

```bash
<grimoire-cmd> simulate <spell-path> --chain <id>
```

If simulate fails:

1. identify phase (`compile`, `preview policy`, adapter/data, etc.)
2. patch spell/params/config
3. re-run simulate

For advisory flows, inspect whether failure is:

1. model/tooling resolution (`advisory_failed`)
2. output schema mismatch (`Advisory output violated schema`)
3. replay data mismatch (missing advisory output for step id)

## 5. Value-Moving Safety Path

For spells with irreversible actions:

1. require dry-run first:

```bash
<grimoire-cmd> cast <spell-path> --dry-run --chain <id> --key-env PRIVATE_KEY --rpc-url <rpc>
```

2. summarize risks and expected behavior
3. request explicit user confirmation before live cast

If advisory gates execution policy, prefer deterministic path:

1. preview and capture run id
2. dry-run cast with `--advisory-replay <runId>`
3. live cast with `--advisory-replay <runId>` after confirmation

## 6. Snapshot/Data Inputs

If spell depends on venue snapshots:

1. use matching venue skill command with `--format spell`
2. paste/merge params carefully
3. enforce freshness policy where needed (`--data-max-age`, `--on-stale`)

## 7. Done Criteria

A spell task is done only when:

1. syntax matches supported capabilities
2. `validate` passes
3. `simulate` passes or failure is explicitly documented
4. dry-run is performed for value-moving flows
5. live-cast confirmation gate is respected

For advisory-driven spells, also require:

1. advisory output schema is explicit and validated
2. fallback behavior is acceptable under failure
3. replay policy is documented when deterministic behavior is required
