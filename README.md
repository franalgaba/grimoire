# Grimoire

<p align="center"><em>"Verba Volant, Scripta Manent."</em></p>

[![CI](https://github.com/franalgaba/grimoire/actions/workflows/ci.yml/badge.svg)](https://github.com/your-org/grimoire/actions/workflows/ci.yml)

Grimoire is a language for agents to express financial intent with readable syntax and deterministic execution. Spells compile to an intermediate representation (IR) and run through protocol adapters, so you can swap venues by changing aliases and configuration instead of rewriting strategy logic.

[Examples](./spells) | [Skills](./skills)

---

## Start here

Grimoire runs in two delivery modes. Same engine, same spell syntax.

### Embedded runtime (in-process library)

Use this when you want to import the Grimoire engine into your application or agent. Adapters are optional — you can pass them in or use venue data for prototyping.

Install the runtime skill:

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
Create a Grimoire spell named MorphoYieldOptimizer and save it to spells/morpho-yield-optimizer.spell.
Use a snapshot params block, ignore markets with TVL < 5,000,000, and recommend switching when the spread over the current market is > 0.5%. Include a demo snapshot with 3 Morpho USDC markets and emit candidate + recommendation/hold events. No side effects.
```

Run it:

```
Run spells/morpho-yield-optimizer.spell in the Grimoire Runtime with trigger manual. Use defaults and no side effects.
```

Want real data? Replace the `params:` block with live snapshots:

```bash
grimoire venue morpho-blue vaults --chain 8453 --asset USDC --min-tvl 5000000 --format spell
```

For quick protocol prototyping, use the venue CLI to fetch metadata or snapshot `params:` blocks. Execution uses the same engine whether in-agent or via CLI.

See `@grimoirelabs/core` for the embedded runtime API.

### Deterministic runtime (CLI)

Use this for reproducible simulation and onchain execution with adapters and state persistence.

Suggested flow: explore in embedded runtime → record advisory in CLI simulate → replay deterministically in cast.

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

Advisory steps (`**...**` and `advise`) call Pi when a model is configured (spell model, CLI model/provider, or Pi defaults). If no model is available, the runtime uses the spell’s fallback. Record advisory outputs with `simulate` (or `cast --dry-run`), then replay deterministically with `--advisory-replay` for live execution.

See `grimoire --help` for all CLI commands.

---

## Example spell

```spell
spell YieldOptimizer {

  assets: [USDC, DAI]

  venues: {
    aave_v3: @aave_v3
    morpho_blue: @morpho_blue
  }

  params: {
    amount: 100000
  }

  on hourly: {
    if **gas costs justify the move** {
      amount_to_move = to_number(balance(USDC)) * 50%
      aave_v3.withdraw(USDC, amount_to_move)
      morpho_blue.lend(USDC, amount_to_move)
    }
  }
}
```

## Features

- **Human-readable DSL** with brace-delimited syntax
- **Explicit constraints** and limits via `with` and `limits`
- **Adapter-based venues** (SDKs live in `@grimoirelabs/venues`)
- **Onchain + offchain** actions (EVM + Hyperliquid + Yellow + LI.FI)
- **Judgment boundary** with `**...**` and `advise`
- **Structured control flow** (loops, conditionals, try/catch, atomic)
- **State persistence** and run history for deterministic execution
- **Two delivery modes**: embedded runtime (in-process library) and CLI

ENS profile hydration is available on CLI runs via `--ens-name` and `--ens-rpc-url`.

## Documentation

Documentation is being rewritten. Check the `docs/` directory when available.

## Updating

- Update the CLI: `npm i -g @grimoirelabs/cli@latest`
- Use `npx` for latest without install: `npx -y @grimoirelabs/cli@latest <command>`
- Update packages in your project: `npm i @grimoirelabs/core@latest @grimoirelabs/venues@latest`
- Update the runtime skill: re-install with `npx skills add https://github.com/franalgaba/grimoire` (or copy `skills/grimoire-vm` into your agent skills directory again)

## Development

```bash
bun install
bun run validate
```

For onchain tests and advanced workflows, see the docs when available.

## License

MIT
