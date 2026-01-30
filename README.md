# Grimoire

**A Portable Execution Language for Onchain Strategies**

[![CI](https://github.com/franalgaba/grimoire/actions/workflows/ci.yml/badge.svg)](https://github.com/your-org/grimoire/actions/workflows/ci.yml)

Grimoire enables you to define, simulate, and execute complex DeFi strategies using a human-readable `.spell` format with Python-like syntax.

## Features

- **Human-readable DSL** - Write strategies in a clean, Python-like syntax
- **Compile-time validation** - Catch errors before execution
- **Adapter-based venues** - Protocol SDKs live outside core (`@grimoire/venues`)
- **Multi-tx approvals** - Adapters return approval + action plans
- **Onchain + offchain** - EVM transactions or offchain execution (Hyperliquid)
- **Bridging support** - Across bridge integration
- **Action constraints** - Slippage, deadlines, and bounds per action
- **Advisory AI integration** - Use `**prompts**` for AI-assisted decisions
- **Atomic transactions** - Group operations for all-or-nothing execution
- **Scheduled triggers** - Run strategies hourly, daily, or manually
- **State persistence** - Spell state survives across runs (SQLite-backed)
- **Execution history** - Run history and ledger events stored per spell

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

## Example Spell

```
spell YieldOptimizer

  version: "1.0.0"
  description: "Optimizes yield across lending protocols"

  assets: [USDC, USDT, DAI]

  params:
    min_amount: 100
    rebalance_threshold: 0.5

  limits:
    max_per_venue: 50%

  venues:
    lending: [@aave_v3, @morpho_blue]
    swap: @uniswap_v3

  on hourly:
    for asset in assets:
      current_rate = lending.get_rate(asset)
      best_rate = max(lending.get_all_rates(asset))

      if best_rate - current_rate > params.rebalance_threshold:
        if **gas costs justify rebalancing**:
          atomic:
            current_venue.withdraw(asset, balance)
            best_venue.deposit(asset, balance)

          emit rebalanced(asset=asset, gain=best_rate - current_rate)
```

## Syntax Highlights

| Feature | Syntax | Description |
|---------|--------|-------------|
| Spell declaration | `spell Name` | Define a new strategy |
| Assets | `assets: [USDC, DAI]` | Tokens the spell interacts with |
| Venue references | `@aave_v3` | Reference to a venue adapter |
| Percentages | `50%` | Automatically converts to 0.5 |
| Triggers | `on hourly:` | Schedule: `manual`, `hourly`, `daily` |
| Loops | `for x in items:` | Iterate over collections |
| Conditionals | `if condition:` | Branch logic with `elif`/`else` |
| Advisory AI | `**prompt**` | AI-assisted decision making |
| Atomic blocks | `atomic:` | Transaction batching |
| Events | `emit name(k=v)` | Emit events for monitoring |

## CLI Commands

| Command | Description |
|---------|-------------|
| `grimoire init` | Initialize a new .grimoire directory |
| `grimoire compile <spell>` | Compile a .spell file to IR |
| `grimoire compile-all [dir]` | Compile all .spell files in a directory |
| `grimoire validate <spell>` | Validate a .spell file |
| `grimoire simulate <spell>` | Simulate spell execution (dry run) |
| `grimoire cast <spell>` | Execute a spell onchain |
| `grimoire venues` | List adapters and supported chains |
| `grimoire history [spell]` | View execution history |
| `grimoire log <spell> <runId>` | View ledger events for a run |

### Venue CLIs

- `grimoire-aave`
- `grimoire-uniswap`
- `grimoire-morpho-blue`
- `grimoire-hyperliquid`

## Project Structure

```
grimoire/
├── packages/
│   ├── core/              # Compiler, runtime, adapter registry
│   │   └── src/
│   │       ├── compiler/  # Tokenizer, parser, IR generator
│   │       ├── runtime/   # Execution engine + state persistence
│   │       ├── venues/    # Adapter registry + types
│   │       ├── types/     # TypeScript definitions
│   │       └── builders/  # Fluent spell builder API
│   ├── venues/            # Official SDK adapters
│   ├── cli/               # Command-line interface
│   └── sdk/               # High-level SDK (WIP)
├── spells/                # Example spell files
├── skills/                # Agent skills (per-venue)
└── docs/                  # Diátaxis documentation
```

## Supported Venues

| Category | Protocols |
|----------|-----------|
| **Lending** | Aave V3, Morpho Blue |
| **Swaps** | Uniswap V3 |
| **Perps** | Hyperliquid |
| **Bridge** | Across |

## Venue Adapters

Adapters live in `@grimoire/venues` and are injected at execution time. Core stays SDK-free.

```ts
import { adapters } from "@grimoire/venues";
import { execute } from "@grimoire/core";

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
import { compile, execute, SqliteStateStore, createRunRecord } from "@grimoire/core";
import { adapters } from "@grimoire/venues";

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

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run `bun run validate` to ensure tests pass
5. Submit a pull request

## License

MIT
