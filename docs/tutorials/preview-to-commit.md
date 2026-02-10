# Tutorial: Preview to Commit Flow

This tutorial shows how `cast` uses the preview/commit model for irreversible actions.

Prerequisite: complete `docs/tutorials/quickstart-users-and-agents.md`.

## Goal

Run a spell through:

1. preview (`simulate`/receipt)
2. dry-run cast
3. live cast commit

## 1. Pick a Spell With Actions

Use an existing example, e.g.:

- `spells/uniswap-swap-execute.spell`

## 2. Validate

```bash
grimoire validate spells/uniswap-swap-execute.spell
```

## 3. Preview With `simulate`

```bash
grimoire simulate spells/uniswap-swap-execute.spell --chain 1
```

What happens:

- runtime executes all logic in preview mode
- action steps become planned actions in receipt
- receipt status is `ready` or `rejected`

## 4. Dry-Run Cast

```bash
grimoire cast spells/uniswap-swap-execute.spell \
  --dry-run \
  --chain 1 \
  --key-env PRIVATE_KEY \
  --rpc-url <rpc>
```

Dry-run still performs preview but skips irreversible submission.

## 5. Live Cast Commit

```bash
grimoire cast spells/uniswap-swap-execute.spell \
  --chain 1 \
  --key-env PRIVATE_KEY \
  --rpc-url <rpc>
```

Live mode does:

- preview
- commit planned actions if preview receipt is `ready`

## 6. Review Results

```bash
grimoire history <spell-id>
grimoire log <spell-id> <run-id>
```

Look for:

- preview lifecycle events
- action submission/confirmation events
- commit status

## Notes

- If no key is available, `cast` falls back to simulation mode.
- If a spell has no irreversible actions, commit phase is skipped.
