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

## Advisory steps (AI judgments)

The deterministic runtime calls Pi for `**...**` and `advise` steps when a model is configured (spell model, CLI model/provider, or Pi defaults). If no model is available, it uses the spell’s `fallback`. Use `--advisory-pi` to force Pi even if no model is configured.

## Advisory workflow: explore → record → replay → execute

Use this flow when you want probabilistic judgments once, then deterministic replays:

1) **Explore** (cheap, safe):
   - Run `simulate` while you iterate on the prompt/schema.
2) **Record** (choose one):
   - **`simulate`** when you only need the AI decision and a ledger record.
   - **`cast --dry-run`** when you want the AI decision plus transaction planning.
   - **`cast`** only when you are ready to execute onchain.
3) **Replay** (deterministic):
   - Re-run with `--advisory-replay <runId>` to reuse the recorded advisory outputs.

Example:

```bash
# 1) explore + record advisory output (no txs)
grimoire simulate spells/my-spell.spell --advisory-pi

# 2) replay deterministically
grimoire simulate spells/my-spell.spell --advisory-replay <runId>

# 3) execute onchain using the same advisory outputs
grimoire cast spells/my-spell.spell --advisory-replay <runId> --rpc-url <rpc> --key-env PRIVATE_KEY
```

### OAuth (OpenAI Codex)

Run a one-time Pi login (stores tokens in `~/.pi/agent/auth.json`):

```bash
# If you already have the pi CLI:
pi

# Or run it once with npx:
npx @mariozechner/pi-coding-agent

/login
# select OpenAI Codex
```

Then run your spell with the OAuth-backed provider:

```bash
grimoire simulate spells/my-spell.spell \
  --advisory-pi \
  --advisory-provider openai-codex \
  --advisory-model gpt-5.2 \
  --advisory-tools none
```

If you use a non-default Pi directory, pass it to Grimoire:

```bash
grimoire simulate spells/my-spell.spell --advisory-pi --pi-agent-dir /path/to/pi-agent
```

### Replay advisory outputs

Use a prior run’s ledger to replay advisory outputs deterministically:

```bash
grimoire simulate spells/my-spell.spell --advisory-replay <runId> --state-dir /path/to/state
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
