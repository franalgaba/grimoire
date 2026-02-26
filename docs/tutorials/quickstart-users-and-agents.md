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
If `venue doctor` is not recognized by a global install, switch to `npx -y @grimoirelabs/cli@latest` or repo-local invocation.

## 2. Run Execute Setup

Run the execute-mode onboarding flow:

```bash
grimoire setup
```

This guided flow asks for required execute parameters (chain, RPC URL, wallet setup, readiness checks) and configures local execution.

What setup does:

- runs a smoke preview check before wallet/network checks
- if RPC input is blank, uses default public RPC for the selected chain
- configures wallet via existing keystore, env private key import, or generated key
- runs `venue doctor` (unless disabled with `--no-doctor`)
- if password is typed interactively, writes `.grimoire/setup.env` for reuse (disable with `--no-save-password-env`)
- CLI auto-loads nearest `.grimoire/setup.env` on startup unless the same env var is already set

Agent safety notes:

- never paste passwords/private keys into agent prompts
- prefer interactive hidden password prompts
- treat `.grimoire/setup.env` as sensitive plaintext and keep it local-only

## 3. Run a Known Good Spell (No Side Effects)

Use `spells/compute-only.spell` to verify your environment after setup.

```bash
grimoire validate spells/compute-only.spell
grimoire simulate spells/compute-only.spell --chain 1
```

Expected result:

- validation succeeds
- simulation finishes with a successful preview run
- a run record is written unless `--no-state` is used

## 4. Learn the Minimal Spell Shape

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

## 5. Agent-Assisted Workflow

Install Grimoire skills:

```bash
npx skills add https://github.com/franalgaba/grimoire
```

If you are using Claude Code, run the same command in the Claude Code terminal and then start a new session so installed skills are loaded.

Installed skill set includes:

- `skills/grimoire/` for core CLI workflow
- `skills/grimoire-aave/` for Aave snapshots
- `skills/grimoire-uniswap/` for Uniswap snapshots
- `skills/grimoire-morpho-blue/` for Morpho snapshots
- `skills/grimoire-hyperliquid/` for Hyperliquid snapshots
- `skills/grimoire-pendle/` for Pendle metadata snapshots
- `skills/grimoire-polymarket/` for Polymarket order workflow guidance

Starter prompts for the agent:

1. `Create spells/hello.spell with a manual trigger that emits an event using params.amount.`
2. `Validate and simulate spells/hello.spell. If validation fails, fix and re-run until success.`
3. `If the spell has value-moving actions, run cast --dry-run first and summarize risks before live cast.`

## 6. Safe Path for Value-Moving Spells

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
- `docs/how-to/install-grimoire-skills.md`
- `docs/how-to/simulate-on-anvil-fork.md`
- `docs/how-to/use-wallet-commands-end-to-end.md`
- `docs/how-to/use-advisory-decisions.md`
- `docs/reference/spell-syntax.md`
- `docs/reference/cli.md`
