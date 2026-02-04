# Grimoire

<p align="center"><em>"Verba Volant, Scripta Manent."</em></p>

[![CI](https://github.com/franalgaba/grimoire/actions/workflows/ci.yml/badge.svg)](https://github.com/your-org/grimoire/actions/workflows/ci.yml)

Grimoire is a language for agents to express financial intent with readable syntax and deterministic execution. Spells compile to an intermediate representation (IR) and run through protocol adapters, so you can swap venues by changing aliases and configuration instead of rewriting strategy logic.

Agents are always-on, multi-service operators. What they need is a trustable execution layer: explicit constraints, auditable outcomes, and policy-bound actions that do not rely on opaque code or vague prompts. Grimoire makes those boundaries explicit in the language itself.

[Docs](./docs/README.md) | [VM Mode](./docs/how-to/run-grimoire-vm.md) | [VM Quickstart](./docs/how-to/vm-quickstart.md) | [Deterministic Transition](./docs/how-to/transition-to-deterministic.md) | [VM Spec](./docs/reference/grimoire-vm.md) | [CLI](./docs/reference/cli.md) | [Examples](./spells) | [Skills](./skills)

---

```
spell YieldOptimizer

  assets: [USDC, USDT, DAI]

  venues:
    aave_v3: @aave_v3
    morpho_blue: @morpho_blue

  limits:
    max_per_venue: 50%
    min_rate_diff: 0.5%

  params:
    amount: 100000

  advisors:
    risk:
      model: anthropic:sonnet
      timeout: 30
      fallback: true

  on hourly:
    if **gas costs justify the move** via risk:
      amount_to_move = balance(USDC) * 50%
      aave_v3.withdraw(USDC, amount_to_move)
      morpho_blue.lend(USDC, amount_to_move)
```

---

## Install

### VM mode (best-effort, no tools)

This mode runs inside an agent session. It does not ship with venue adapters or data tools.

#### skills.sh

```bash
npx skills add https://github.com/franalgaba/grimoire
```

#### Claude plugin

```bash
claude plugin marketplace add franalgaba/grimoire
claude plugin install grimoire-vm@grimoire
```

### VM mode + venue tooling (metadata and discovery)

If you want venue metadata inside the agent (addresses, market lists), install the CLI and use `grimoire venue`:

```bash
npm i -g @grimoirelabs/cli
grimoire venue morpho-blue info

# Or without a global install:
npx -y @grimoirelabs/cli venue morpho-blue info
```

### Deterministic runtime (adapters + execution)

The CLI bundles adapters from `@grimoirelabs/venues` and can simulate/cast spells:

```bash
npm i -g @grimoirelabs/cli
grimoire --help
```

---

## The Policy-Bound Inversion of Control

Traditional automation requires explicit coordination code. Grimoire inverts this: you declare intent, control flow, and constraints, and the runtime enforces them. The spell is the contract. The execution layer is the IoC container.

### 1. The Session as Runtime

Instead of orchestrating agents from the outside, Grimoire can run inside the agent session via the VM. The session becomes the interpreter, able to execute the spell while preserving context and intent.

### 2. The Judgment Boundary (`**...**`)

When you need AI judgment instead of strict execution, you break out of structure:

```
if **gas costs justify the move** via risk:
  ...
```

The `**...**` syntax is an explicit boundary. Everything outside is deterministic. Everything inside is semantic judgment. This keeps flexibility where it helps and policy where it matters.

### 3. Open Standard, Zero Lock-in

Grimoire is a language specification. Any agent runtime can implement the VM, and any deterministic executor can run the compiled IR. You can switch platforms without rewriting spells.

### 4. Structure + Flexibility

Why not plain English? It is too ambiguous for control flow and constraints. Why not rigid frameworks? They are too inflexible for real-world decisions. Grimoire gives you structure for execution and constraints, and natural language for judgment inside explicit boundaries.

## Features

- **Human-readable DSL** - Write strategies in a clean, Python-like syntax
- **Compile-time validation** - Catch errors before execution
- **Adapter-based venues** - Protocol SDKs live outside core (`@grimoirelabs/venues`)
- **Multi-tx approvals** - Adapters return approval + action plans
- **Onchain + offchain** - EVM transactions or offchain execution (Hyperliquid)
- **Bridging support** - Across bridge integration
- **Action constraints** - Slippage/deadlines/limits per action (`with` clause)
- **Skills + advisors** - Routing defaults and AI advisory metadata
- **Advisory AI integration** - Use `**prompts**` or `advise` for decisions (fallback by default; external handlers optional)
- **Atomic transactions** - Group operations for all-or-nothing execution
- **Structured control flow** - repeat/loop-until, try/catch, parallel, pipeline
- **Scheduled triggers** - Run strategies via manual/hourly/daily/cron/condition/event
- **State persistence** - Spell state survives across runs (SQLite-backed)
- **Execution history** - Run history and ledger events stored per spell
- **Two execution modes** - In-agent VM (best-effort) or external runtime (deterministic)

## Quick Start

```bash
# Install dependencies
bun install

# Validate a spell
bun run packages/cli/src/index.ts validate spells/yield-optimizer.spell

# Compile a spell to IR
bun run packages/cli/src/index.ts compile spells/yield-optimizer.spell --pretty

# Simulate a spell (dry run)
bun run packages/cli/src/index.ts simulate spells/compute-only.spell

# Execute a spell (requires wallet + RPC)
bun run packages/cli/src/index.ts cast spells/uniswap-swap-execute.spell --key-env PRIVATE_KEY --rpc-url <rpc>
```

## Syntax Highlights

| Feature | Syntax | Description |
|---------|--------|-------------|
| Spell declaration | `spell Name` | Define a new strategy |
| Assets | `assets: [USDC, DAI]` | Tokens the spell interacts with |
| Venue references | `@aave_v3` | Reference to a venue adapter |
| Skills | `skills:` | Capability modules and defaults |
| Advisors | `advisors:` | AI advisory metadata and defaults |
| Percentages | `50%` | Automatically converts to 0.5 |
| Triggers | `on hourly:` | Schedule: `manual`, `hourly`, `daily`, cron, condition, event |
| Loops | `for x in items:` | Iterate over collections |
| Repeat/Until | `repeat N:` / `loop until cond max N:` | Safe looping |
| Conditionals | `if condition:` | Branch logic with `elif`/`else` |
| Advisory AI | `**prompt**` / `advise` | AI-assisted decision making |
| Using skill | `using name` | Apply skill defaults/routing (optional when using a skill name) |
| Constraints | `with k=v` | Slippage/deadline/min_output/max_input/max_gas/etc |
| Output binding | `x = action()` | Capture action output |
| Atomic blocks | `atomic:` | Transaction batching |
| Try/catch | `try:` | Error handling + retry |
| Parallel | `parallel:` | Concurrent branches |
| Pipeline | `expr | map:` | Functional stages |
| Block/do | `block` / `do` | Reusable statement blocks |
| Events | `emit name(k=v)` | Emit events for monitoring |

## CLI Commands

| Command | Description |
|---------|-------------|
| `grimoire init [--vm]` | Initialize a new .grimoire directory |
| `grimoire compile <spell>` | Compile a .spell file to IR |
| `grimoire compile-all [dir]` | Compile all .spell files in a directory |
| `grimoire validate <spell>` | Validate a .spell file |
| `grimoire simulate <spell>` | Simulate spell execution (dry run) |
| `grimoire cast <spell>` | Execute a spell onchain |
| `grimoire venues` | List adapters and supported chains |
| `grimoire venue <adapter> [args...]` | Venue metadata (proxy to bundled venue CLIs) |
| `grimoire history [spell]` | View execution history |
| `grimoire log <spell> <runId>` | View ledger events for a run |

## Supported Venues

| Category | Protocols |
|----------|-----------|
| **Lending** | Aave V3, Morpho Blue |
| **Swaps** | Uniswap V3, Uniswap V4 |
| **Perps** | Hyperliquid |
| **Bridge** | Across |

## Venue Adapters

Adapters live in `@grimoirelabs/venues` and are injected at execution time. Core stays SDK-free.

```ts
import { adapters } from "@grimoirelabs/venues";
import { execute } from "@grimoirelabs/core";

await execute({ spell, vault, chain: 1, adapters });
```

Adapters can return multi-transaction plans to handle ERC20 approvals.

## Development

```bash
# Install dependencies (also sets up git hooks)
bun install

# Run tests
bun test

# Run tests with coverage
bun test --coverage

# Type check
bun run typecheck

# Lint
bun run lint

# Fix lint issues
bun run lint:fix

# Run full validation (lint + typecheck + tests)
bun run validate
```

## Architecture

```
Source (.spell) → Tokenizer → Parser → AST → Transformer → SpellSource → IR Generator → SpellIR
```

Execution:

```
SpellIR → Runtime → Executor → (Adapter Registry) → Venue Adapter → Transactions/Offchain
```

## Programmatic Usage

```typescript
import { compile, execute, SqliteStateStore, createRunRecord } from "@grimoirelabs/core";
import { adapters } from "@grimoirelabs/venues";

// Compile a spell
const result = compile(spellSource);
if (!result.success) {
  console.error(result.errors);
  process.exit(1);
}

// Load persisted state
const store = new SqliteStateStore();
const persistentState = await store.load(result.ir.id) ?? {};

// Execute the compiled spell with state
const execResult = await execute({
  spell: result.ir,
  vault: "0x...",
  chain: 1,
  params: { min_amount: 500 },
  persistentState,
  adapters,
});

// Persist results
await store.save(result.ir.id, execResult.finalState);
await store.addRun(result.ir.id, createRunRecord(execResult));
store.close();
```

## Documentation

Docs are organized with the [Diátaxis](https://diataxis.fr/) framework in `docs/`:

- Tutorials
- How-to guides
- Reference
- Explanation

Start at [docs/README.md](./docs/README.md).

## Skills

Grimoire ships agent skills under `skills/`:

- `grimoire` — core CLI commands (compile, validate, simulate, cast)
- `grimoire-vm` — in-agent VM execution spec + conformance references
- `grimoire-aave` — Aave V3 venue metadata (via `grimoire venue aave`)
- `grimoire-uniswap` — Uniswap V3/V4 venue metadata (via `grimoire venue uniswap`)
- `grimoire-morpho-blue` — Morpho Blue venue metadata (via `grimoire venue morpho-blue`)
- `grimoire-hyperliquid` — Hyperliquid venue metadata (via `grimoire venue hyperliquid`)

## More Examples

See the [`spells/`](./spells) directory for more examples:

- `simple-swap.spell` - Basic token swap
- `uniswap-swap-execute.spell` - Uniswap V3 swap execution
- `aave-supply-action.spell` - Aave V3 supply action
- `morpho-blue-lend.spell` - Morpho Blue lend action
- `across-bridge.spell` - Across bridge example
- `yield-optimizer.spell` - Multi-venue yield optimization
- `dca-trading.spell` - Dollar-cost averaging strategy
- `lending-rebalancer.spell` - Lending position rebalancing
- `momentum-trader.spell` - Momentum-based trading
- `hyperliquid-perps.spell` - Perpetual futures trading

## Contributing

See `CONTRIBUTING.md` for contribution guidelines and `AGENTS.md` for project-specific rules (for both humans and agents).

## License

MIT
