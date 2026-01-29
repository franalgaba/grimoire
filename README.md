# Grimoire

**A Portable Execution Language for Onchain Strategies**

[![CI](https://github.com/your-org/grimoire/actions/workflows/ci.yml/badge.svg)](https://github.com/your-org/grimoire/actions/workflows/ci.yml)

Grimoire enables you to define, simulate, and execute complex DeFi strategies using a human-readable `.spell` format with Python-like syntax.

## Features

- **Human-readable DSL** - Write strategies in a clean, Python-like syntax
- **Compile-time validation** - Catch errors before execution
- **Multi-venue support** - Integrate with Aave, Morpho, Uniswap, and more
- **Advisory AI integration** - Use `**prompts**` for AI-assisted decisions
- **Atomic transactions** - Group operations for all-or-nothing execution
- **Scheduled triggers** - Run strategies hourly, daily, or manually

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
    lending: [@aave_v3, @morpho, @compound_v3]
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
| Venue references | `@aave_v3` | Reference to a DeFi protocol |
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
| `grimoire validate <spell>` | Validate a .spell file |
| `grimoire simulate <spell>` | Simulate spell execution (dry run) |
| `grimoire cast <spell>` | Execute a spell onchain |

## Project Structure

```
grimoire/
├── packages/
│   ├── core/              # Compiler and runtime
│   │   └── src/
│   │       ├── compiler/  # Tokenizer, parser, IR generator
│   │       ├── runtime/   # Execution engine
│   │       ├── types/     # TypeScript definitions
│   │       └── builders/  # Fluent spell builder API
│   ├── cli/               # Command-line interface
│   └── sdk/               # High-level SDK (WIP)
├── spells/                # Example spell files
└── docs/                  # Specifications
```

## Supported Venues

| Category | Protocols |
|----------|-----------|
| **Lending** | Aave V3, Morpho, Compound V3 |
| **Swaps** | Uniswap V3, 1inch |
| **Perps** | Hyperliquid |

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
                     ↓           ↓        ↓         ↓              ↓              ↓
                  Tokens      Syntax    Tree    Normalized      YAML-like      Executable
                             Check              Structure        Format          Format
```

## Programmatic Usage

```typescript
import { compile, execute } from "@grimoire/core";

// Compile a spell
const result = compile(spellSource);
if (!result.success) {
  console.error(result.errors);
  process.exit(1);
}

// Execute the compiled spell
const execResult = await execute({
  spell: result.ir,
  vault: "0x...",
  chain: 1,
  params: { min_amount: 500 },
});

console.log("Execution result:", execResult);
```

## More Examples

See the [`spells/`](./spells) directory for more examples:

- `simple-swap.spell` - Basic token swap
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
