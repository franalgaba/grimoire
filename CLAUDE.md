---
description: Grimoire - A Portable Execution Language for Onchain Strategies
globs: "*.ts, *.tsx, *.html, *.css, *.js, *.jsx, *.spell, package.json"
alwaysApply: false
---

# Grimoire

A domain-specific language (DSL) for defining and executing onchain DeFi strategies. Strategies are written in `.spell` files using a Python-like indentation-based syntax.

## Agent Portability (LLM-agnostic)

Keep guidance portable across any assistant (e.g., Claude, OpenCode, Amp):

- **Avoid tool-specific assumptions.** Use standard shell commands and Bun scripts; do not depend on proprietary agent APIs.
- **Prefer repo-local context.** Document workflows, examples, and constraints in this repo (docs/ + README + CLAUDE) instead of relying on conversation memory.
- **Use relative paths.** Reference files relative to the repository root.
- **Provide manual fallbacks.** If a workflow is automated by a tool, include the equivalent manual command steps.
- **Keep secrets out of prompts.** Use environment variables and avoid hardcoding private keys or tokens.
- **Explicit dependencies.** If a task requires new dependencies or SDKs, list them and pin versions.

## Project Structure

```
packages/
├── core/                    # Core compiler + runtime (protocol-agnostic)
│   └── src/
│       ├── compiler/        # Spell → IR compilation
│       │   ├── grimoire/    # Tokenizer, parser, transformer
│       │   ├── expression-parser.ts
│       │   ├── ir-generator.ts
│       │   └── validator.ts
│       ├── runtime/         # IR execution engine
│       │   ├── interpreter.ts
│       │   ├── context.ts
│       │   ├── state-store.ts     # StateStore interface + RunRecord types
│       │   ├── sqlite-state-store.ts  # SQLite-based state persistence
│       │   └── steps/       # Step handlers (compute, conditional, loop, etc.)
│       ├── venues/          # Adapter registry + types (no SDKs)
│       ├── types/           # TypeScript type definitions
│       └── builders/        # Fluent API for building spells
├── venues/                  # Official adapters (SDK integrations)
│   └── src/
│       ├── aave-v3.ts
│       ├── uniswap-v3.ts
│       ├── uniswap-v4.ts
│       ├── morpho-blue.ts
│       ├── hyperliquid.ts
│       ├── across.ts
│       └── cli/             # per-venue CLIs
├── cli/                     # grimoire-cast CLI
└── sdk/                     # (WIP) SDK for external integrations
spells/                      # Example spell files
skills/                      # Agent skills (per-venue)
docs/                        # Diátaxis docs
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
    amount: 100000

  limits:
    max_allocation_per_venue: 50%

  venues:
    lending: [@aave_v3, @morpho_blue, @compound_v3]
    swap: @uniswap_v3

  skills:
    dex:
      type: swap
      adapters: [swap]
      default_constraints:
        max_slippage: 50

  advisors:
    risk:
      model: sonnet
      timeout: 30
      fallback: true

  state:
    persistent:
      counter: 0
    ephemeral:
      temp: 0

  on hourly:
    for asset in assets:
      current_balance = balance(asset)

      if current_balance > params.min_amount:
        if **gas costs justify the move** via risk:
          atomic:
            aave_v3.withdraw(asset, params.amount)
            morpho_blue.lend(asset, params.amount)
```

### Syntax Reference

| Feature | Syntax | Example |
|---------|--------|---------|
| Spell declaration | `spell Name` | `spell YieldOptimizer` |
| Arrays | `[item1, item2]` | `assets: [USDC, DAI]` |
| Venue refs | `@name` | `@aave_v3` |
| Venue groups | `name: [@v1, @v2]` | `lending: [@aave_v3, @morpho_blue]` |
| Skills | `skills:` | `skills: ...` |
| Advisors | `advisors:` | `advisors: ...` |
| Percentages | `N%` | `50%` (converts to 0.5) |
| Triggers | `on trigger:` | `on hourly:`, `on daily:`, `on manual:` |
| For loops | `for x in y:` | `for asset in assets:` |
| Repeat loops | `repeat N:` | `repeat 3:` |
| Loop until | `loop until cond max N:` | `loop until done max 10:` |
| If/elif/else | `if cond:` | `if x > 0:` |
| Advisory (AI) | `**prompt**` | `if **is this safe**:` |
| Advise | `x = advise advisor:` | `decision = advise risk: "..."` |
| Atomic blocks | `atomic:` | Transaction grouping |
| Try/catch | `try:` | `try: ... catch *:` |
| Parallel | `parallel ...:` | `parallel join=all:` |
| Pipeline | `expr | map:` | `items | map:` |
| Block/Do | `block` / `do` | `block add(a,b):` |
| Comments | `# comment` | `# Calculate rates` |
| Method calls | `obj.method(args)` | `venue.deposit(asset, amount)` |
| Assignment | `x = expr` | `rate = get_apy("aave_v3", asset)` |
| Using skill | `using name` | `swap(...) using dex` |
| Constraints | `with k=v` | `with slippage=50` |
| Logical ops | `and`, `or`, `not` | `if a > 0 and b < 10:` |
| Emit events | `emit name(k=v)` | `emit done(value=42)` |
| Halt execution | `halt "reason"` | `halt "insufficient balance"` |
| Wait | `wait N` | `wait 3600` (seconds) |

## Example Spells

- `spells/uniswap-swap-execute.spell`
- `spells/aave-supply-action.spell`
- `spells/morpho-blue-lend.spell`
- `spells/across-bridge.spell`
- `spells/hyperliquid-perps.spell`

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

## Venues and Adapters

Core is SDK-free. Protocol integrations live in `@grimoire/venues` and are injected at execution time.

Supported adapters:
- `aave_v3` (AaveKit) — lending/borrowing on Ethereum + Base
- `uniswap_v3` — swaps via SwapRouter02
- `uniswap_v4` — swaps via Universal Router + Permit2
- `morpho_blue` — isolated lending markets
- `hyperliquid` (offchain) — spot + perps via API
- `across` (bridge) — cross-chain bridging

Adapters can return multi-transaction plans to handle approvals. Offchain venues implement `executeAction`.

### Aave V3 Amount Format

The `@aave/client` SDK uses human-readable BigDecimal amounts, not raw token units:
- **supply/borrow**: `value: "0.1"` (human-readable)
- **withdraw/repay**: `value: { exact: "100000" }` (raw units in `exact` wrapper)

The adapter handles this conversion internally using token decimals (USDC=6, WETH=18, etc.).

### Morpho Blue Default Markets

The default adapter ships with well-known Base (chain 8453) markets:
- **cbBTC/USDC** (86% LLTV, ~$1.26B supply)
- **WETH/USDC** (86% LLTV, ~$48.7M supply)

When no collateral is specified in a spell, the first matching market by loan token is selected. To target a specific market, specify the collateral token in the action.

### Across Bridge Minimums

Across enforces minimum bridge amounts per token. For test spells:
- **USDC**: minimum ~$1.00 (1000000 raw). Use >= $1.00 to avoid "amount too low relative to fees".
- **WETH**: minimum ~0.002 ETH. Use >= 0.002 to clear fee thresholds.

## State Persistence

Spell state survives across runs via a SQLite-backed store. The `execute()` function stays pure — persistence is an orchestration concern handled by the CLI or caller.

### Architecture

```
CLI:  state = await store.load(spellId)
CLI:  result = await execute({ ..., persistentState: state })
CLI:  await store.save(spellId, result.finalState)
CLI:  await store.addRun(spellId, createRunRecord(result))
CLI:  await store.saveLedger(spellId, result.runId, result.ledgerEvents)
```

### Key files

- `runtime/state-store.ts` — `StateStore` interface, `RunRecord` type, `createRunRecord()` helper
- `runtime/sqlite-state-store.ts` — `SqliteStateStore` class using `bun:sqlite`
- `cli/src/commands/state-helpers.ts` — `withStatePersistence()` wrapper for CLI commands

### StateStore interface

```typescript
interface StateStore {
  load(spellId: string): Promise<Record<string, unknown> | null>;
  save(spellId: string, state: Record<string, unknown>): Promise<void>;
  addRun(spellId: string, run: RunRecord): Promise<void>;
  getRuns(spellId: string, limit?: number): Promise<RunRecord[]>;
  saveLedger(spellId: string, runId: string, entries: LedgerEntry[]): Promise<void>;
  loadLedger(spellId: string, runId: string): Promise<LedgerEntry[] | null>;
  listSpells(): Promise<string[]>;
}
```

### SQLite schema

Database lives at `.grimoire/grimoire.db` (configurable via `--state-dir`). Three tables: `spell_state` (persistent state), `runs` (execution history), `ledger` (event logs per run). Old runs are pruned beyond `maxRuns` (default 100).

### CLI flags

- `--state-dir <dir>` — custom directory for `grimoire.db` (on `simulate`, `cast`, `history`, `log`)
- `--no-state` — disable persistence entirely (on `simulate`, `cast`)

### Usage

```typescript
import { SqliteStateStore, createRunRecord, execute } from "@grimoire/core";

const store = new SqliteStateStore(); // defaults to .grimoire/grimoire.db
const state = await store.load("my-spell") ?? {};
const result = await execute({ spell, vault, chain: 1, persistentState: state });
await store.save("my-spell", result.finalState);
await store.addRun("my-spell", createRunRecord(result));
store.close();
```

## Action Constraints (Slippage)

Action constraints are resolved at runtime and attached to `Action.constraints` for adapter use.

- `maxSlippageBps`, `minOutput`, `maxInput`, `deadline`
- Used by Uniswap V3/V4 swaps and Across bridging

## Bridge Actions

`bridge` actions compile from `venue.bridge(asset, amount, to_chain)` and are supported by the Across adapter. The IR requires a literal chain ID for `to_chain`.

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

### Onchain Test Suite

```bash
# Simulate only (no wallet needed):
./scripts/run-onchain-tests.sh

# Dry-run (builds txs, estimates gas, does NOT send):
./scripts/run-onchain-tests.sh --dry-run

# Live execution on Base:
CHAIN=8453 ./scripts/run-onchain-tests.sh --execute

# Resume from a specific phase after failure:
./scripts/run-onchain-tests.sh --execute --start-phase 4

# Recovery mode — return stranded funds to Base:
./scripts/run-onchain-tests.sh --recover
```

Phases: 0 (compile) → 1 (simulate pure) → 2 (simulate features) → 3 (cast features) → 4 (cast venues) → 5 (multi-chain). Phase 5 writes checkpoints to `.grimoire/test-suite/checkpoint` and skips completed sub-steps on resume. Phase 5 is automatically skipped if earlier phases have failures.

### Compile All Spells

```bash
for file in spells/*.spell; do
  bun -e "import { compileFile } from './packages/core/src/compiler/index.ts'; const res = await compileFile('$file'); if (!res.success) { console.error(res.errors); process.exit(1); }"
done
```

## CLI

- `grimoire compile <spell>` — compile a `.spell` file to IR
- `grimoire compile-all [dir]` — compile all `.spell` files in a directory
- `grimoire validate <spell>` — validate a `.spell` file
- `grimoire simulate <spell>` — simulate execution (dry run), with state persistence
- `grimoire cast <spell>` — execute a spell onchain, with state persistence
- `grimoire history [spell]` — view execution history (all spells or runs for one spell)
- `grimoire log <spell> <runId>` — view ledger events for a specific run
- `grimoire venues` — list available venue adapters
- `grimoire init` — initialize a new `.grimoire` directory
- Per-venue CLIs in `@grimoire/venues`:
  - `grimoire-aave`
  - `grimoire-uniswap`
  - `grimoire-morpho-blue`
  - `grimoire-hyperliquid`

## Documentation & Skills Maintenance

Docs live in `docs/` and follow the Diátaxis structure:
- tutorials/
- how-to/
- reference/ (includes `grimoire-dsl-spec.md` — the full DSL specification)
- explanation/

Skills live in `skills/` and provide LLM-consumable context:
- `skills/grimoire/` — Core CLI commands
- `skills/grimoire-spell/` — Spell authoring reference
- `skills/grimoire-testing/` — Unit tests + onchain test suite
- `skills/grimoire-aave/` — Aave V3 venue CLI + amount format
- `skills/grimoire-uniswap/` — Uniswap V3/V4 venue CLI
- `skills/grimoire-morpho-blue/` — Morpho Blue venue CLI + default markets
- `skills/grimoire-hyperliquid/` — Hyperliquid venue CLI

**Keep docs and skills in sync with code changes.** When modifying any of the following, update the corresponding docs and skills:

| Change | Update |
|--------|--------|
| New/changed CLI command or flag | `docs/reference/cli.md`, `skills/grimoire/SKILL.md`, this file |
| New/changed DSL syntax or feature | `docs/reference/grimoire-dsl-spec.md`, `skills/grimoire-spell/SKILL.md` |
| New/changed venue adapter | `docs/reference/venues.md`, matching `skills/grimoire-<venue>/SKILL.md` |
| New venue adapter added | Create `skills/grimoire-<venue>/SKILL.md`, update `docs/reference/venues.md` |
| Test runner changes | `docs/how-to/run-tests.md`, `skills/grimoire-testing/SKILL.md` |
| Wallet/keystore changes | `docs/reference/cli.md` (wallet section) |
| Bridge/amount thresholds | `docs/how-to/bridge-with-across.md`, `docs/reference/venues.md` |
| State persistence changes | This file (State Persistence section) |
| New example spells | `README.md` (Examples section), `docs/reference/grimoire-dsl-spec.md` |

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

// Venue adapters
interface VenueAdapter {
  meta: VenueAdapterMeta;
  buildAction: (action: Action, ctx: VenueAdapterContext) => Promise<VenueBuildResult>;
  executeAction?: (action: Action, ctx: VenueAdapterContext) => Promise<VenueExecutionResult>;
}

// Compilation result
interface CompilationResult {
  success: boolean;
  ir?: SpellIR;
  errors: CompilationError[];
  warnings: CompilationWarning[];
}

// State persistence
interface StateStore {
  load(spellId: string): Promise<Record<string, unknown> | null>;
  save(spellId: string, state: Record<string, unknown>): Promise<void>;
  addRun(spellId: string, run: RunRecord): Promise<void>;
  getRuns(spellId: string, limit?: number): Promise<RunRecord[]>;
  saveLedger(spellId: string, runId: string, entries: LedgerEntry[]): Promise<void>;
  loadLedger(spellId: string, runId: string): Promise<LedgerEntry[] | null>;
  listSpells(): Promise<string[]>;
}

// Run record (stored in SQLite)
interface RunRecord {
  runId: string;
  timestamp: string;
  success: boolean;
  error?: string;
  duration: number;
  metrics: RunMetrics;
  finalState: Record<string, unknown>;
}
```

## Usage Example

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

// Execute the spell
const execResult = await execute({
  spell: result.ir,
  vault: "0x...",
  chain: 1,
  params: { amount: 1000 },
  persistentState,
  adapters,
});

// Persist results
await store.save(result.ir.id, execResult.finalState);
await store.addRun(result.ir.id, createRunRecord(execResult));
await store.saveLedger(result.ir.id, execResult.runId, execResult.ledgerEvents);
store.close();
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
