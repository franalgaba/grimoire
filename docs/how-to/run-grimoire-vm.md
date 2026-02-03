# Run spells in VM mode (in-agent)

The Grimoire VM executes `.spell` files inside an agent session. It is best-effort and non-deterministic, intended for prototyping, reviews, and dry runs. For deterministic execution and onchain safety, use the external runtime (`grimoire simulate` / `grimoire cast`).

## 1) Install the VM skill

Grimoire ships the VM skill at `skills/grimoire-vm/`. Copy or symlink it into your agent's skills directory.

Example (adjust the path to match your agent):

```bash
SKILLS_DIR="$HOME/.config/agents/skills"
mkdir -p "$SKILLS_DIR"
cp -R skills/grimoire-vm "$SKILLS_DIR/grimoire-vm"
```

If your agent expects a different path, use that path instead.

### Claude plugin (when published)

If you are using Claude Code, install via the plugin system:

```bash
claude plugin marketplace add franalgaba/grimoire
claude plugin install grimoire-vm@grimoire
```

## 2) Provide a spell

You can pass a file path or inline spell text. If you pass a file path, the agent must be able to read it. Imports are resolved relative to the spell file.

## 3) Choose a trigger

If a spell defines multiple triggers, specify which one to run (e.g., `manual`, `hourly`, `event`, etc.).

Example prompt:

```
Run spells/test-state-counter.spell in the Grimoire VM with trigger manual. Use defaults and no side effects.
```

## 4) Optional inputs

- **Params overrides**: provide values for `params` (e.g., JSON).
- **State snapshot**: initial persistent/ephemeral state (or start empty).
- **Tooling**: if you want external side effects (onchain or API calls), explicitly allow them. Otherwise request a dry run.

## 5) Output

The VM returns a structured run log including:
- status (`success` or `failed`)
- emitted events
- final bindings

Example output:

```
Run:
  spell: TestStateCounter
  trigger: manual
  status: success

Events:
  - counter_updated(run_count=1, total_amount=100)

Bindings:
  run_count: 1
  total_amount: 100
```

## VM vs runtime

- **VM mode**: best-effort, fast iteration, reviewable runs inside an agent.
- **External runtime**: deterministic IR execution, adapter enforcement, onchain safety, persistent state.

See the VM spec for detailed semantics: `docs/reference/grimoire-vm.md`.

## Transition to deterministic runtime

When a spell is ready for production execution, run it through the external runtime:

1) Validate and compile:

```bash
bun run packages/cli/src/index.ts validate spells/yield-optimizer.spell
bun run packages/cli/src/index.ts compile spells/yield-optimizer.spell --pretty
```

2) Simulate with the same params you used in VM mode:

```bash
bun run packages/cli/src/index.ts simulate spells/yield-optimizer.spell -p '{"amount":100000}'
```

3) Dry-run onchain execution (builds transactions, does not send):

```bash
bun run packages/cli/src/index.ts cast spells/yield-optimizer.spell --dry-run --key-env PRIVATE_KEY --rpc-url <rpc>
```

4) Execute live when ready:

```bash
bun run packages/cli/src/index.ts cast spells/yield-optimizer.spell --key-env PRIVATE_KEY --rpc-url <rpc>
```

The VM and runtime share the same syntax and conformance suite. Use VM mode for iteration and review; use the external runtime when you need deterministic execution, adapter enforcement, and state persistence.
