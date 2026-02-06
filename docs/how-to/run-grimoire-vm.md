# Run spells in VM mode (in-agent)

The Grimoire VM executes `.spell` files inside an agent session. It is best-effort and non-deterministic, intended for prototyping, reviews, and dry runs. For deterministic execution and onchain safety, use the external runtime (`grimoire simulate` / `grimoire cast`).

## What VM mode is (and is not)

- **VM mode** runs inside the agent session and uses the tools available to that agent. It is ideal for quick iteration and reviews.
- **VM mode is not deterministic** and does not bundle adapters. If a spell needs live data, you must provide snapshots or allow tools.
- **Deterministic runtime** runs outside the agent (CLI), compiles to IR, and executes with adapters and persistent state.

For a shorter walkthrough, see [VM quickstart (snapshot-driven)](./vm-quickstart.md).

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

## VM mode and venue tools (CLI snapshots)

VM mode ships with no adapters or data sources. For quick prototyping in protocols, use the venue CLI to generate snapshot `params` blocks you can paste into your spell. If your agent allows tools, it can fetch real venue data on demand.

If a spell needs live data (APY, TVL, positions), you must either:
- Provide a data snapshot in `params` (recommended for VM prototyping).
- Allow tools and install the CLI to access venue metadata (or expose your own data tools).

Example (no global install):

```bash
npx -y @grimoirelabs/cli venue morpho-blue info
npx -y @grimoirelabs/cli venue morpho-blue vaults --chain 8453 --asset USDC --min-tvl 5000000 --format spell
npx -y @grimoirelabs/cli venue aave reserves --chain 1 --asset USDC --format spell
npx -y @grimoirelabs/cli venue uniswap pools --chain 1 --token0 USDC --token1 WETH --fee 3000 --format spell
npx -y @grimoirelabs/cli venue uniswap pools --chain 1 --token0 USDC --token1 WETH --fee 3000 --rpc-url $RPC_URL --format spell
npx -y @grimoirelabs/cli venue hyperliquid mids --format spell
```

Provide `--rpc-url` (or `RPC_URL`) to avoid The Graph. For non-mainnet chains, you must pass either a Graph endpoint (`--endpoint` or `--graph-key` + `--subgraph-id`) or an RPC URL.

Using the CLI here only **fetches metadata or snapshots**. It does not make VM execution deterministic.

For deterministic execution with adapters, use the CLI runtime (`grimoire simulate` / `grimoire cast`) which bundles `@grimoirelabs/venues`.

## Using real data in VM mode

VM mode can use real venue data when tools are allowed. Two common patterns:

1) **Pre-fetch snapshots** (recommended): run `grimoire venue ... --format spell`, then paste the `params:` block into your spell.
2) **In-agent fetch**: ask the agent to run `grimoire venue ...` and inject the snapshot into `params` before execution.

Example prompt:

```
Fetch a Morpho USDC vault snapshot with `grimoire venue morpho-blue vaults --chain 8453 --asset USDC --min-tvl 5000000 --format spell`,
then run spells/morpho-yield-optimizer-vm.spell in the Grimoire VM with trigger manual. No side effects.
```

Real data makes VM runs non-deterministic by nature. Use the deterministic runtime when you need reproducible results or onchain safety.

## 2) Provide a spell

You can pass a file path or inline spell text. If you pass a file path, the agent must be able to read it. Imports are resolved relative to the spell file.

Copy/paste demo (create a spell):

```
Create a Grimoire VM spell named MorphoYieldOptimizer and save it to spells/morpho-yield-optimizer-vm.spell.
Use a snapshot params block, ignore markets with TVL < 5,000,000, and recommend switching when the spread over the current market is > 0.5%. Include a demo snapshot with 3 Morpho USDC markets and emit candidate + recommendation/hold events. No side effects.
```

## 3) Choose a trigger

If a spell defines multiple triggers, specify which one to run (e.g., `manual`, `hourly`, `event`, etc.).

Example prompt:

```
Run spells/morpho-yield-optimizer-vm.spell in the Grimoire VM with trigger manual. Use defaults and no side effects.
```

## 4) Optional inputs

- **Params overrides**: provide values for `params` (e.g., JSON).
- **State snapshot**: initial persistent/ephemeral state (or start empty).
- **Tooling**: if you want external side effects (onchain or API calls), explicitly allow them. Otherwise request a dry run.
- **Data snapshots**: provide a timestamped snapshot for any live data needed by the spell.

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

1) Record advisory outputs (optional but recommended):

```bash
bun run packages/cli/src/index.ts simulate spells/yield-optimizer.spell --advisory-pi
```

2) Replay advisory outputs deterministically (optional):

```bash
bun run packages/cli/src/index.ts simulate spells/yield-optimizer.spell --advisory-replay <runId>
```

1) Validate and compile:

```bash
bun run packages/cli/src/index.ts validate spells/yield-optimizer.spell
bun run packages/cli/src/index.ts compile spells/yield-optimizer.spell --pretty
```

3) Simulate with the same params you used in VM mode:

```bash
bun run packages/cli/src/index.ts simulate spells/yield-optimizer.spell -p '{"amount":100000}'
```

4) Dry-run onchain execution (builds transactions, does not send):

```bash
bun run packages/cli/src/index.ts cast spells/yield-optimizer.spell --dry-run --key-env PRIVATE_KEY --rpc-url <rpc>
```

5) Execute live when ready:

```bash
bun run packages/cli/src/index.ts cast spells/yield-optimizer.spell --key-env PRIVATE_KEY --rpc-url <rpc>
```

The VM and runtime share the same syntax and conformance suite. Use VM mode for iteration and review; use the external runtime when you need deterministic execution, adapter enforcement, and state persistence.
