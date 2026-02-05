# Grimoire

<p align="center"><em>"Verba Volant, Scripta Manent."</em></p>

[![CI](https://github.com/franalgaba/grimoire/actions/workflows/ci.yml/badge.svg)](https://github.com/your-org/grimoire/actions/workflows/ci.yml)

Grimoire is a language for agents to express financial intent with readable syntax and deterministic execution. Spells compile to an intermediate representation (IR) and run through protocol adapters, so you can swap venues by changing aliases and configuration instead of rewriting strategy logic.

[Docs](./docs/README.md) | [Examples](./spells) | [Skills](./skills)

---

## Start here

Grimoire runs in two execution environments. The spell syntax is the same; the guarantees are different.

### VM mode (in-agent, best-effort)

Use this when you want to run inside an agent session for prototyping and reviews. VM mode does not bundle adapters, but it can use real venue data when the agent is allowed to run tools (for example, `grimoire venue ...`).

Install the VM skill:

```bash
npx skills add https://github.com/franalgaba/grimoire
```

Or copy it manually:

```bash
SKILLS_DIR="$HOME/.config/agents/skills"
mkdir -p "$SKILLS_DIR"
cp -R skills/grimoire-vm "$SKILLS_DIR/grimoire-vm"
```

Copy/paste demo (agent prompts):

```
Create a Grimoire VM spell named MorphoYieldOptimizer and save it to spells/morpho-yield-optimizer-vm.spell.
Use a snapshot params block, ignore markets with TVL < 5,000,000, and recommend switching when the spread over the current market is > 0.5%. Include a demo snapshot with 3 Morpho USDC markets and emit candidate + recommendation/hold events. No side effects.
```

Run it in VM mode:

```
Run spells/morpho-yield-optimizer-vm.spell in the Grimoire VM with trigger manual. Use defaults and no side effects.
```

Want real data? Replace the `params:` block with live snapshots:

```bash
grimoire venue morpho-blue vaults --chain 8453 --asset USDC --min-tvl 5000000 --format spell
```

For quick protocol prototyping, use the venue CLI to fetch metadata or snapshot `params:` blocks for VM runs. Execution still happens inside the agent session.

Next steps: [run-grimoire-vm.md](./docs/how-to/run-grimoire-vm.md), [vm-quickstart.md](./docs/how-to/vm-quickstart.md)

### Deterministic runtime (CLI)

Use this for reproducible simulation and onchain execution with adapters and state persistence.

```bash
npm i -g @grimoirelabs/cli

grimoire simulate spells/compute-only.spell --chain 1

grimoire cast spells/uniswap-swap-execute.spell \
  --dry-run \
  --key-env PRIVATE_KEY \
  --rpc-url <rpc>
```

When you are ready to execute live:

```bash
grimoire cast spells/uniswap-swap-execute.spell --key-env PRIVATE_KEY --rpc-url <rpc>
```

Next steps: [cli-cast.md](./docs/how-to/cli-cast.md), [transition-to-deterministic.md](./docs/how-to/transition-to-deterministic.md)

---

## Example spell

```spell
spell YieldOptimizer

  assets: [USDC, DAI]

  venues:
    aave_v3: @aave_v3
    morpho_blue: @morpho_blue

  params:
    amount: 100000

  on hourly:
    if **gas costs justify the move**:
      amount_to_move = balance(USDC) * 50%
      aave_v3.withdraw(USDC, amount_to_move)
      morpho_blue.lend(USDC, amount_to_move)
```

## Features

- **Human-readable DSL** with Python-like indentation
- **Explicit constraints** and limits via `with` and `limits`
- **Adapter-based venues** (SDKs live in `@grimoirelabs/venues`)
- **Onchain + offchain** actions (EVM + Hyperliquid)
- **Judgment boundary** with `**...**` and `advise`
- **Structured control flow** (loops, conditionals, try/catch, atomic)
- **State persistence** and run history for deterministic execution
- **Two execution environments**: in-agent VM and deterministic runtime

## Documentation

- Start here: [docs/README.md](./docs/README.md)
- Spell syntax: [docs/reference/spell-syntax.md](./docs/reference/spell-syntax.md)
- CLI: [docs/reference/cli.md](./docs/reference/cli.md)
- VM spec: [docs/reference/grimoire-vm.md](./docs/reference/grimoire-vm.md)

## Development

```bash
bun install
bun run validate
```

For onchain tests and advanced workflows, see [docs/how-to/run-tests.md](./docs/how-to/run-tests.md).

## License

MIT
