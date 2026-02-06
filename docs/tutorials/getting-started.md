# Getting started (choose a mode)

Grimoire runs spells in two execution environments. The spell syntax is the same; the guarantees and tooling are different.

- **VM mode (in-agent, best-effort)**: great for prototyping and reviews inside an agent session. No adapters or live data by default.
- **Deterministic runtime (CLI)**: adapter-backed execution with reproducible simulation and onchain safety.

## VM mode (in-agent)

### 1) Install the VM skill

If your agent supports the Skills CLI:

```bash
npx skills add https://github.com/franalgaba/grimoire
```

Or copy the skill manually from this repo:

```bash
SKILLS_DIR="$HOME/.config/agents/skills"
mkdir -p "$SKILLS_DIR"
cp -R skills/grimoire-vm "$SKILLS_DIR/grimoire-vm"
```

### 2) Run a compute-only spell

Use `spells/compute-only.spell` from this repo (or create your own). If you need a starter spell, see [first-spell.md](first-spell.md). Then prompt your agent:

```
Run spells/compute-only.spell in the Grimoire VM with trigger manual. Use defaults and no side effects.
```

You should see a `rebalance_needed` or `no_rebalance_needed` event.

Want a wow demo? Copy/paste these prompts:

```
Create a Grimoire VM spell named MorphoYieldOptimizer and save it to spells/morpho-yield-optimizer-vm.spell.
Use a snapshot params block, ignore markets with TVL < 5,000,000, and recommend switching when the spread over the current market is > 0.5%. Include a demo snapshot with 3 Morpho USDC markets and emit candidate + recommendation/hold events. No side effects.
```

```
Run spells/morpho-yield-optimizer-vm.spell in the Grimoire VM with trigger manual. Use defaults and no side effects.
```

### 3) Use snapshots when you need live inputs

VM mode does not include adapters or data sources. For quick prototyping in protocols, use venue snapshots in `params` (real data when tools are allowed):

```bash
npx -y @grimoirelabs/cli venue morpho-blue vaults --chain 8453 --asset USDC --min-tvl 5000000 --format spell
```

Paste the output `params:` block into your spell. This uses the CLI for metadata only; execution still happens inside the agent session. For a full walkthrough, see [VM quickstart](../how-to/vm-quickstart.md).

## Deterministic runtime (CLI)

### 1) Install the CLI

```bash
npm i -g @grimoirelabs/cli
```

### 2) Simulate a spell

```bash
grimoire simulate spells/compute-only.spell --chain 1
```

Some adapters require RPC access; add `--rpc-url <rpc>` when needed.

If your spell contains `**...**` or `advise` steps, advisory calls Pi when a model is configured (spell model, CLI model/provider, or Pi defaults). If no model is available, it uses the spell fallback. See [Run spells with the CLI](../how-to/cli-cast.md) for OAuth and replay options.

Tip: record advisory outputs with `simulate`, then replay them deterministically for `cast` by using `--advisory-replay <runId>`.

### 3) Dry-run, then execute onchain

```bash
grimoire cast spells/uniswap-swap-execute.spell --dry-run --key-env PRIVATE_KEY --rpc-url <rpc>
grimoire cast spells/uniswap-swap-execute.spell --key-env PRIVATE_KEY --rpc-url <rpc>
```

## Next steps

- Write a spell: [first-spell.md](first-spell.md)
- Run the VM in detail: [run-grimoire-vm.md](../how-to/run-grimoire-vm.md)
- Run with the CLI: [cli-cast.md](../how-to/cli-cast.md)
- Transition from VM to deterministic: [transition-to-deterministic.md](../how-to/transition-to-deterministic.md)
- Spell syntax reference: [spell-syntax.md](../reference/spell-syntax.md)
