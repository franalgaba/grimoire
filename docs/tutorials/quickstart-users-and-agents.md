# Tutorial: Quickstart for Users and Agents

This tutorial gives one streamlined onboarding path for both human operators and agent-assisted workflows.

## Goal

Go from zero setup to a successful preview run, then follow the safe path to dry-run/live execution.

## 1. Pick Your CLI Invocation

Choose one way to run `grimoire`:

```bash
# Option A: global install
npm i -g @grimoirelabs/cli
grimoire --help
```

```bash
# Option B: no install
npx -y @grimoirelabs/cli --help
```

```bash
# Option C: repo-local (contributors)
bun run packages/cli/src/index.ts --help
```

Use the same invocation style for all remaining commands in this tutorial.

## 2. Run a Known Good Spell (No Side Effects)

Use `spells/compute-only.spell` to verify your environment.

```bash
grimoire validate spells/compute-only.spell
grimoire simulate spells/compute-only.spell --chain 1
```

Expected result:

- validation succeeds
- simulation finishes with a successful preview run
- a run record is written unless `--no-state` is used

## 3. Learn the Minimal Spell Shape

Use this as the baseline when creating new spells:

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

Then iterate with:

```bash
grimoire validate spells/hello.spell
grimoire simulate spells/hello.spell
```

## 4. Agent-Assisted Workflow

If you are using an agent, load the Grimoire skills from `skills/`:

- `skills/grimoire/` for core CLI workflow
- `skills/grimoire-aave/` for Aave snapshots
- `skills/grimoire-uniswap/` for Uniswap snapshots
- `skills/grimoire-morpho-blue/` for Morpho snapshots
- `skills/grimoire-hyperliquid/` for Hyperliquid snapshots

Starter prompts for the agent:

1. `Create spells/hello.spell with a manual trigger that emits an event using params.amount.`
2. `Validate and simulate spells/hello.spell. If validation fails, fix and re-run until success.`
3. `If the spell has value-moving actions, run cast --dry-run first and summarize risks before live cast.`

## 5. Safe Path for Value-Moving Spells

For swaps/lend/borrow/bridge flows:

```bash
grimoire validate <spell>
grimoire simulate <spell> --chain <id>
grimoire cast <spell> --dry-run --chain <id> --key-env PRIVATE_KEY --rpc-url <rpc>
# live only when dry-run output is acceptable
grimoire cast <spell> --chain <id> --key-env PRIVATE_KEY --rpc-url <rpc>
```

## Next Docs

- `docs/tutorials/first-spell.md`
- `docs/tutorials/preview-to-commit.md`
- `docs/how-to/use-advisory-decisions.md`
- `docs/reference/spell-syntax.md`
- `docs/reference/cli.md`
