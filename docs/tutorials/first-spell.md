# Tutorial: First Spell

This tutorial walks through creating, validating, and simulating a minimal spell.

If you are onboarding from scratch (human or agent-assisted), start with `docs/tutorials/quickstart-users-and-agents.md` first.

## Goal

Create a spell that emits an event and uses one parameter.

## 1. Create the Spell

Create `spells/hello-grimoire.spell`:

```spell
spell HelloGrimoire {
  version: "1.0.0"
  description: "Minimal tutorial spell"

  params: {
    amount: 42
  }

  on manual: {
    doubled = params.amount * 2
    emit hello(amount=params.amount, doubled=doubled)
  }
}
```

## 2. Compile

```bash
grimoire compile spells/hello-grimoire.spell --pretty
```

You should see IR JSON with one trigger and compute/emit steps.

## 3. Validate

```bash
grimoire validate spells/hello-grimoire.spell
```

Validation should pass.

## 4. Simulate

```bash
grimoire simulate spells/hello-grimoire.spell
```

Expected behavior:

- preview completes successfully
- ledger contains `event_emitted` for `hello`
- run is persisted unless `--no-state` is used

## 5. Override Params

```bash
grimoire simulate spells/hello-grimoire.spell --params '{"amount":100}'
```

Now event payload should reflect new values.

## 6. Inspect History

```bash
grimoire history
grimoire history HelloGrimoire
grimoire log HelloGrimoire <run-id>
```

## Next Step

Move to a value-moving action spell (swap/lend) and run `cast --dry-run` before live execution.
