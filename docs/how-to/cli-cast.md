# Run spells with the CLI

Use the `grimoire cast` or `grimoire simulate` commands to compile and execute spells.

## Simulate execution

```bash
grimoire simulate spells/compute-only.spell --chain 1
```

## Execute with a wallet

```bash
grimoire cast spells/uniswap-swap-execute.spell \
  --key-env PRIVATE_KEY \
  --rpc-url https://eth.llamarpc.com
```

## Dry-run (build transactions without sending)

```bash
grimoire cast spells/uniswap-swap-execute.spell \
  --key-env PRIVATE_KEY \
  --rpc-url https://eth.llamarpc.com \
  --dry-run
```

### Secret handling

Avoid passing secrets as CLI arguments. Prefer environment variables:

```bash
export PRIVATE_KEY=0x...
grimoire cast spells/uniswap-swap-execute.spell --key-env PRIVATE_KEY
```

## State persistence

By default, `simulate` and `cast` automatically persist spell state to `.grimoire/grimoire.db`. This means:

- Persistent state is loaded before execution and saved after.
- Run history (metrics, success/failure, duration) is recorded.
- Ledger events are stored for debugging.

### Custom state directory

```bash
grimoire simulate spells/my-spell.spell --state-dir /path/to/state
```

### Disable state persistence

```bash
grimoire simulate spells/my-spell.spell --no-state
```

## Advisor skills directories

Advisors can reference external skills (Agent Skills) for metadata like allowed tools.
Pass one or more directories that contain skill folders (each with `SKILL.md`):

```bash
grimoire simulate spells/my-spell.spell \
  --advisor-skills-dir ./skills \
  --advisor-skills-dir ~/.agents/skills
```

## View execution history

List all spells with saved state:

```bash
grimoire history
```

Show run history for a specific spell:

```bash
grimoire history MySpell --limit 10
```

View ledger events for a specific run:

```bash
grimoire log MySpell <runId>
```

Use `--json` for machine-readable output on any of these commands.

## Output modes

- `--json` for machine-readable output
- `--verbose` for full error details

## Useful helpers

List adapters and supported chains:

```bash
grimoire venues
```

Compile all spells:

```bash
grimoire compile-all
```

## See also

- [CLI reference](../reference/cli.md)
- [Execution modes](../explanation/execution-modes.md)
