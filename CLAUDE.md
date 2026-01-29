---
description: Grimoire - A Portable Execution Language for Onchain Strategies
globs: "*.ts, *.tsx, *.html, *.css, *.js, *.jsx, *.spell, package.json"
alwaysApply: false
---

# Grimoire

A domain-specific language (DSL) for defining and executing onchain DeFi strategies. Strategies are written in `.spell` files using a Python-like indentation-based syntax.

## Project Structure

```
packages/
├── core/                    # Core compiler and runtime
│   └── src/
│       ├── compiler/        # Spell → IR compilation
│       │   ├── grimoire/    # Tokenizer, parser, transformer
│       │   ├── expression-parser.ts
│       │   ├── ir-generator.ts
│       │   └── validator.ts
│       ├── runtime/         # IR execution engine
│       │   ├── interpreter.ts
│       │   ├── context.ts
│       │   └── steps/       # Step handlers (compute, conditional, loop, etc.)
│       ├── types/           # TypeScript type definitions
│       └── builders/        # Fluent API for building spells
├── cli/                     # Command-line interface
└── sdk/                     # (WIP) SDK for external integrations
spells/                      # Example spell files
```

## Grimoire Syntax

Spells use a Python-like indentation-based syntax (2-space indent):

```
spell YieldOptimizer

  version: "1.0.0"
  description: "Optimizes yield across lending venues"
  assets: [USDC, USDT, DAI]

  params:
    min_amount: 100
    threshold: 0.5

  limits:
    max_allocation_per_venue: 50%

  venues:
    lending: [@aave_v3, @morpho, @compound_v3]
    swap: @uniswap_v3

  state:
    persistent:
      counter: 0
    ephemeral:
      temp: 0

  on hourly:
    for asset in assets:
      rates = lending.get_supply_rates(asset)
      best_venue = max(rates, key=rate)

      if rate_diff > limits.min_rebalance_threshold:
        if **gas costs justify the move**:
          atomic:
            current_venue.withdraw(asset, balance)
            best_venue.deposit(asset, balance)
```

### Syntax Reference

| Feature | Syntax | Example |
|---------|--------|---------|
| Spell declaration | `spell Name` | `spell YieldOptimizer` |
| Arrays | `[item1, item2]` | `assets: [USDC, DAI]` |
| Venue refs | `@name` | `@aave_v3` |
| Venue groups | `name: [@v1, @v2]` | `lending: [@aave, @morpho]` |
| Percentages | `N%` | `50%` (converts to 0.5) |
| Triggers | `on trigger:` | `on hourly:`, `on daily:`, `on manual:` |
| For loops | `for x in y:` | `for asset in assets:` |
| If/elif/else | `if cond:` | `if x > 0:` |
| Advisory (AI) | `**prompt**` | `if **is this safe**:` |
| Atomic blocks | `atomic:` | Transaction grouping |
| Comments | `# comment` | `# Calculate rates` |
| Method calls | `obj.method(args)` | `venue.deposit(asset, amount)` |
| Assignment | `x = expr` | `rates = get_rates()` |
| Logical ops | `and`, `or`, `not` | `if a > 0 and b < 10:` |
| Emit events | `emit name(k=v)` | `emit done(value=42)` |
| Halt execution | `halt "reason"` | `halt "insufficient balance"` |
| Wait | `wait N` | `wait 3600` (seconds) |

## Compiler Pipeline

```
Source (.spell) → Tokenizer → Parser → AST → Transformer → SpellSource → IR Generator → SpellIR
```

Key files:
- `grimoire/tokenizer.ts` - Indentation-aware lexer, emits INDENT/DEDENT tokens
- `grimoire/parser.ts` - Recursive descent parser
- `grimoire/ast.ts` - AST node type definitions
- `grimoire/transformer.ts` - AST → SpellSource conversion
- `ir-generator.ts` - SpellSource → SpellIR (executable format)

## Commands

### Development

```bash
bun install          # Install dependencies (also sets up git hooks)
bun test             # Run all tests
bun test --coverage  # Run tests with coverage report
bun run validate     # Run lint + typecheck + tests
```

### Linting & Formatting

```bash
bun run lint         # Check for lint errors (biome)
bun run lint:fix     # Auto-fix lint issues
bun run format       # Format code
bun run typecheck    # TypeScript type checking
```

### Testing Specific Files

```bash
bun test packages/core/src/compiler/grimoire/  # Test grimoire module
bun test --coverage packages/core/             # Coverage for core package
```

## Pre-commit Hooks

Git hooks are managed by lefthook and installed automatically via `bun install`:

- **pre-commit**: Runs lint + typecheck in parallel
- **pre-push**: Runs full test suite

To manually install hooks: `bunx lefthook install`

## CI/CD

GitHub Actions runs on push/PR to main:
- Lint check (biome)
- Type check (tsc)
- Test suite with coverage

See `.github/workflows/ci.yml`

## Key Types

```typescript
// Compiled spell (executable)
interface SpellIR {
  id: string;
  version: string;
  trigger: Trigger;
  assets: AssetDef[];
  params: ParamDef[];
  aliases: VenueAlias[];
  steps: Step[];
  guards: GuardDef[];
}

// Step types
type Step = ComputeStep | ActionStep | ConditionalStep | LoopStep | EmitStep | HaltStep | WaitStep;

// Compilation result
interface CompilationResult {
  success: boolean;
  ir?: SpellIR;
  errors: CompilationError[];
  warnings: CompilationWarning[];
}
```

## Usage Example

```typescript
import { compile, execute } from "@grimoire/core";

// Compile a spell
const result = compile(spellSource);
if (!result.success) {
  console.error(result.errors);
  process.exit(1);
}

// Execute the spell
const execResult = await execute({
  spell: result.ir,
  vault: "0x...",
  chain: 1,
  params: { amount: 1000 },
});
```

## Bun Runtime

Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun install` instead of `npm install`
- Use `bun run <script>` instead of `npm run <script>`
- Bun automatically loads .env, so don't use dotenv.

### Bun APIs

- `Bun.serve()` for HTTP servers (supports WebSockets, HTTPS)
- `bun:sqlite` for SQLite
- `Bun.file` for file operations
- `bun:test` for testing

## Testing Conventions

```typescript
import { describe, test, expect } from "bun:test";

describe("Feature", () => {
  test("does something", () => {
    expect(result).toBe(expected);
  });
});
```

Test files are named `*.test.ts` and colocated with source files.

## Expression Parser

The expression parser (`expression-parser.ts`) handles:
- Arithmetic: `+`, `-`, `*`, `/`, `%`
- Comparison: `==`, `!=`, `<`, `>`, `<=`, `>=`
- Logical: `AND`, `OR`, `NOT` (case-insensitive)
- Ternary: `condition ? then : else`
- Function calls: `max(a, b)`, `min(x, y)`
- Property access: `obj.prop`, `arr[0]`

Note: The Grimoire syntax uses lowercase `and`, `or`, `not` which get normalized.
