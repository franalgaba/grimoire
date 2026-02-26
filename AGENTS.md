---
description: Grimoire - A Portable Execution Language for Onchain Strategies
globs: "*.ts, *.tsx, *.html, *.css, *.js, *.jsx, *.spell, package.json"
alwaysApply: false
---

# Development Rules

## First Message
If the user did not give a concrete task in their first message, read `README.md`, then ask which area to work on (compiler/runtime, venues, CLI, docs, skills). Based on the answer, read the relevant docs or package readmes.

## Agent Portability (LLM-agnostic)
- Avoid tool-specific assumptions. Use standard shell commands and Bun scripts.
- Prefer repo-local context. Document workflows in this repo instead of relying on conversation memory.
- Use relative paths.
- Provide manual fallbacks if a workflow is automated.
- Keep secrets out of prompts; use environment variables.
- If a task needs new dependencies, list them and pin versions.

## Code Quality
- No `any` unless absolutely necessary.
- Avoid Bun-only APIs in `packages/core`, `packages/venues`, and `packages/cli`. If you must use Bun APIs, add a Node fallback.
- Keep protocol SDKs out of `@grimoirelabs/core` (core stays protocol-agnostic).
- Prefer deterministic, side-effect-free logic in compiler/runtime.
- Ask before removing functionality or changing DSL semantics.

## Commands
- For code changes, run `bun run validate` unless the user says otherwise.
- Docs-only changes do not require tests.
- Onchain tests are expensive: only run when requested. Use `--dry-run` first.
- Never commit unless the user asks.

## Git Rules
- Do not use destructive commands (`git reset --hard`, `git checkout .`, `git clean -fd`) unless explicitly asked.
- Stage only files you changed in this session.

## GitHub Issues
When reading issues, read all comments. Use:
```bash
gh issue view <number> --json title,body,comments,labels,state
```

## PR Workflow
Work in a feature branch if requested. Do not open PRs unless asked.

## Tools
- Bun for install/test/build: `bun install`, `bun test`, `bun run ...`
- Biome for lint/format: `bun run lint`, `bun run format`
- TypeScript: `bun run typecheck`
- Skills validation: `bunx skills-ref validate <skill-dir>` (for example `skills/grimoire`, `skills/grimoire-aave`)
- Changesets: `bunx changeset`

## Style
- Keep answers concise and technical.
- No emojis in commits, issues, or code comments.

## Changelog
Location: `CHANGELOG.md` (root). Format follows Keep a Changelog.
- Add new entries only under `## Unreleased`.
- Do not edit already-released version sections.
- Use Changesets for normal release notes. Only edit `CHANGELOG.md` when asked.

## Releasing
- Initial `0.1.0` publish is manual (see `docs/how-to/publish.md`).
- After that, use Changesets + CI. Do not bump versions manually.

# Project Overview

Grimoire is a DSL for defining and executing onchain DeFi strategies. Strategies are written in `.spell` files using a brace-delimited syntax (`{` ... `}`).

# Project Structure

```
packages/
  core/                      # Core compiler + runtime (protocol-agnostic)
    src/
      compiler/              # Spell -> IR compilation
        grimoire/            # Tokenizer, parser, transformer
        expression-parser.ts
        ir-generator.ts
        validator.ts
      runtime/               # IR execution engine
        interpreter.ts
        context.ts
        state-store.ts       # StateStore interface + RunRecord types
        sqlite-state-store.ts # SQLite-based state persistence
        steps/               # Step handlers (compute, conditional, loop, etc.)
      venues/                # Adapter registry + types (no SDKs)
      types/                 # TypeScript type definitions
      builders/              # Fluent API for building spells
  venues/                    # Official adapters (SDK integrations)
    src/
      aave-v3.ts
      uniswap-v3.ts
      uniswap-v4.ts
      morpho-blue.ts
      hyperliquid.ts
      across.ts
      cli/                   # per-venue CLIs
  cli/                       # Grimoire CLI
  sdk/                       # (WIP) SDK for external integrations
spells/                      # Example spell files
skills/                      # Agent skills (core CLI + per-venue metadata workflows)
docs/                        # Diataxis docs
```

# Grimoire Syntax

Spells use a brace-delimited syntax (`{` ... `}`):

```
spell YieldOptimizer {
  version: "1.0.0"
  description: "Optimizes yield across lending venues"
  assets: [USDC, USDT, DAI]

  params: {
    min_amount: 100
    amount: 100000
  }

  limits: {
    max_allocation_per_venue: 50%
  }

  venues: {
    aave_v3: @aave_v3
    morpho_blue: @morpho_blue
    uniswap_v3: @uniswap_v3
  }

  skills: {
    dex: {
      type: swap
      adapters: [uniswap_v3]
      default_constraints: {
        max_slippage: 50
      }
    }
  }

  advisors: {
    risk: {
      model: anthropic:sonnet
      timeout: 30
      fallback: true
    }
  }

  state: {
    persistent: {
      counter: 0
    }
    ephemeral: {
      temp: 0
    }
  }

  on hourly: {
    for asset in assets {
      current_balance = balance(asset)

      if current_balance > params.min_amount {
        if **gas costs justify the move** via risk {
          atomic {
            aave_v3.withdraw(asset, params.amount)
            morpho_blue.lend(asset, params.amount)
          }
        }
      }
    }
  }
}
```

## Syntax Reference

| Feature | Syntax | Example |
|---------|--------|---------|
| Spell declaration | `spell Name {` | `spell YieldOptimizer {` |
| Arrays | `[item1, item2]` | `assets: [USDC, DAI]` |
| Venue refs | `@name` | `@aave_v3` |
| Venue groups | `name: [@v1, @v2]` | `lending: [@aave_v3, @morpho_blue]` |
| Skills | `skills: {` | `skills: { ... }` |
| Advisors | `advisors: {` | `advisors: { ... }` |
| Percentages | `N%` | `50%` (converts to 0.5) |
| Triggers | `on trigger: {` | `on hourly: {`, `on daily: {`, `on manual: {` |
| For loops | `for x in y {` | `for asset in assets {` |
| Repeat loops | `repeat N {` | `repeat 3 {` |
| Loop until | `loop until cond max N {` | `loop until done max 10 {` |
| If/elif/else | `if cond {` | `if x > 0 {` |
| Advisory (AI) | `advise advisor: "prompt"` | `decision = advise risk: "is this safe" { output: { type: boolean }, fallback: true }` |
| Advise | `x = advise advisor:` | `decision = advise risk: "..."` |
| Atomic blocks | `atomic {` | Transaction grouping |
| Try/catch | `try {` | `try { ... } catch *: {` |
| Parallel | `parallel ... {` | `parallel join=all: {` |
| Pipeline | `expr | map: {` | `items | map: {` |
| Block/Do | `block` / `do` | `block add(a,b) {` |
| Comments | `# comment` | `# Calculate rates` |
| Method calls | `obj.method(args)` | `venue.deposit(asset, amount)` |
| Assignment | `x = expr` | `rate = get_apy("aave_v3", asset)` |
| Using skill | `using name` | `swap(...) using dex` |
| Constraints | `with k=v` or `with (k=v, ...)` | `with max_slippage=50` or multi-line `with (\n  slippage=50,\n  deadline=300,\n)` |
| Logical ops | `and`, `or`, `not` | `if a > 0 and b < 10 {` |
| Emit events | `emit name(k=v)` | `emit done(value=42)` |
| Halt execution | `halt "reason"` | `halt "insufficient balance"` |
| Wait | `wait N` | `wait 3600` (seconds) |
| Trailing commas | allowed in all lists | `[USDC, ETH,]`, `f(a, b,)`, `with (k=v,)` |
| Multi-line objects | `{ key: val }` across lines | `{` / `  a: 1,` / `  b: 2,` / `}` |

# Example Spells

- `spells/uniswap-swap-execute.spell`
- `spells/aave-supply.spell`
- `spells/morpho-blue-lend.spell`
- `spells/across-bridge.spell`
- `spells/hyperliquid-perps.spell`

# Compiler Pipeline

```
Source (.spell) -> Tokenizer -> Parser -> AST -> Transformer -> SpellSource -> IR Generator -> SpellIR -> Type Checker -> Validator
```

Key files:
- `packages/core/src/compiler/grimoire/tokenizer.ts` - Brace-delimited lexer, emits LBRACE/RBRACE tokens
- `packages/core/src/compiler/grimoire/parser.ts` - Recursive descent parser
- `packages/core/src/compiler/grimoire/ast.ts` - AST node type definitions
- `packages/core/src/compiler/grimoire/transformer.ts` - AST -> SpellSource conversion
- `packages/core/src/compiler/ir-generator.ts` - SpellSource -> SpellIR (executable format)
- `packages/core/src/compiler/type-checker.ts` - Compile-time type checker (errors block compilation)
- `packages/core/src/compiler/validator.ts` - IR validation (structural checks)

# Execution Model (Preview / Commit)

Grimoire uses an embedded runtime with a mandatory **preview / commit** model for any action that moves value (onchain or offchain). The runtime is the same whether invoked from the CLI or embedded in an agent.

1. **Preview** -- Full execution against simulated or forked state. Produces a typed **receipt** listing every value-moving action, its parameters, and expected outcomes.
2. **Commit** -- Settlement using an approved receipt. The runtime re-checks drift bounds before submitting transactions. If bounds are violated, commit rejects and requires a fresh preview.

Local computation, state writes, and advisory calls do **not** cross the irreversibility boundary and therefore do not require the preview/commit cycle.

This model is defined by the Value-Flow Mandate Runtime. The same preview/commit semantics apply to both CLI and embedded runtime usage.

# Venues and Adapters

Core is SDK-free. Protocol integrations live in `@grimoirelabs/venues` and are injected at execution time.

Supported adapters:
- `aave_v3` (AaveKit) - lending/borrowing on Ethereum + Base
- `uniswap_v3` - swaps via SwapRouter02
- `uniswap_v4` - swaps via Universal Router + Permit2
- `morpho_blue` - isolated lending markets
- `hyperliquid` (offchain) - spot + perps via API
- `across` (bridge) - cross-chain bridging
- `pendle` - hosted SDK convert routes
- `polymarket` (offchain) - prediction market CLOB execution on Polygon

Adapters can return multi-transaction plans to handle approvals. Offchain venues implement `executeAction`.

## Aave V3 Amount Format

The `@aave/client` SDK uses human-readable BigDecimal amounts, not raw token units:
- supply/borrow: `value: "0.1"` (human-readable)
- withdraw/repay: `value: { exact: "100000" }` (raw units in `exact` wrapper)

The adapter handles this conversion internally using token decimals (USDC=6, WETH=18, etc.).

## Morpho Blue Default Markets

The default adapter ships with well-known Base (chain 8453) markets:
- cbBTC/USDC (86% LLTV)
- WETH/USDC (86% LLTV)

When no collateral is specified in a spell, the first matching market by loan token is selected. To target a specific market, specify the collateral token in the action.

## Across Bridge Minimums

Across enforces minimum bridge amounts per token. For test spells:
- USDC: minimum about 1.00 (1000000 raw)
- WETH: minimum about 0.002 ETH

# State Persistence

Spell state survives across runs via a SQLite-backed store. The `execute()` function stays pure; persistence is handled by the CLI or caller.

## Architecture

```
CLI:  state = await store.load(spellId)
CLI:  result = await execute({ ..., persistentState: state })
CLI:  await store.save(spellId, result.finalState)
CLI:  await store.addRun(spellId, createRunRecord(result))
CLI:  await store.saveLedger(spellId, result.runId, result.ledgerEvents)
```

## Key files

- `packages/core/src/runtime/state-store.ts` - `StateStore` interface, `RunRecord` type, `createRunRecord()` helper
- `packages/core/src/runtime/sqlite-state-store.ts` - `SqliteStateStore` class using `bun:sqlite` with a Node fallback
- `packages/cli/src/commands/state-helpers.ts` - `withStatePersistence()` wrapper for CLI commands

## StateStore interface

```typescript
interface StateStore {
  load(spellId: string): Promise<Record<string, unknown> | null>;
  save(spellId: string, state: Record<string, unknown>): Promise<void>;
  addRun(spellId: string, run: RunRecord): Promise<void>;
  getRunById(runId: string): Promise<RunRecord | null>;
  getRuns(spellId: string, limit?: number): Promise<RunRecord[]>;
  saveLedger(spellId: string, runId: string, entries: LedgerEntry[]): Promise<void>;
  loadLedger(spellId: string, runId: string): Promise<LedgerEntry[] | null>;
  listSpells(): Promise<string[]>;
  upsertRunTrack(track: RunTrackRecord): Promise<void>;
  getRunTracks(runId: string): Promise<RunTrackRecord[]>;
  upsertRunHandoff(handoff: RunHandoffRecord): Promise<void>;
  getRunHandoffs(runId: string): Promise<RunHandoffRecord[]>;
  upsertRunStepResult(step: RunStepResultRecord): Promise<void>;
  getRunStepResults(runId: string): Promise<RunStepResultRecord[]>;
}
```

## SQLite schema

Database lives at `.grimoire/grimoire.db` (configurable via `--state-dir`). Core tables: `spell_state` (persistent state), `runs` (execution history), `ledger` (event logs per run). Cross-chain tables: `run_tracks`, `run_handoffs`, `run_step_results`. Migrations are additive and versioned via `PRAGMA user_version`. Old runs are pruned beyond `maxRuns` (default 100).

## CLI flags

- `--state-dir <dir>` - custom directory for `grimoire.db` (on `simulate`, `cast`, `history`, `log`)
- `--no-state` - disable persistence entirely (on `simulate`, `cast`)
- `--advisory-trace-verbose` - stream detailed advisory trace (prompt/schema, tool payloads, model text/thinking deltas) in non-JSON `simulate`/`cast` runs
- `--destination-spell <spell>` - enable cross-chain orchestration by specifying destination spell
- `--destination-chain <id>` - destination chain ID for cross-chain mode
- `--handoff-timeout-sec <seconds>` - required handoff timeout in cross-chain mode
- `--poll-interval-sec <seconds>` - handoff polling interval (default `30`)
- `--watch` - keep process alive to continue after handoff settlement
- `--morpho-market-id <actionRef>=<marketId>` / `--morpho-market-map <path>` - explicit Morpho market identity mapping for cross-chain runs

# Action Constraints (Slippage)

Action constraints are resolved at runtime and attached to `Action.constraints` for adapter use.

- `max_slippage`, `min_output`, `max_input`, `deadline`
- `max_price_impact`, `min_liquidity`, `require_quote`, `require_simulation`, `max_gas`

For swaps, **always set both `max_slippage` and `min_output`** to prevent unexpected losses.

# Bridge Actions

`bridge` actions compile from `venue.bridge(asset, amount, to_chain)` and are supported by the Across adapter. The IR requires a literal chain ID for `to_chain`.

# CLI

- `grimoire compile <spell>` - compile a `.spell` file to IR
- `grimoire compile-all [dir]` - compile all `.spell` files in a directory
- `grimoire validate <spell> [--strict] [--json]` - validate a `.spell` file
- `grimoire simulate <spell> [--rpc-url <url>|<chainId>=<url>] [--destination-spell <spell>]` - simulate execution (dry run), with state persistence
- `grimoire cast <spell> [--rpc-url <url>|<chainId>=<url>] [--destination-spell <spell>]` - execute a spell onchain, with state persistence
- `grimoire setup [--chain <id>] [--rpc-url <url>] [--adapter <name>] [--keystore <path>] [--password-env <name>] [--key-env <name>] [--import-key] [--no-save-password-env] [--no-doctor] [--non-interactive] [--json]` - guided local execute onboarding (wallet + RPC + readiness checks, with optional `.grimoire/setup.env` writing/autoload)
- `grimoire resume <runId> [--watch]` - resume a waiting cross-chain orchestration run
- `grimoire history [spell]` - view execution history (all spells or runs for one spell)
- `grimoire log <spell> <runId>` - view ledger events for a specific run
- `grimoire venues` - list available venue adapters
- `grimoire venue doctor [--chain <id>] [--adapter <name>] [--rpc-url <url>] [--json]` - venue env/chain/RPC diagnostics
- `grimoire init` - initialize a new `.grimoire` directory
- Per-venue CLIs in `@grimoirelabs/venues`:
  - `grimoire-aave`
  - `grimoire-uniswap`
  - `grimoire-morpho-blue`
  - `grimoire-hyperliquid`
  - `grimoire-pendle`
  - `grimoire-polymarket`

# Documentation and Skills Maintenance

Docs live in `docs/` and follow the Diataxis structure.

Skills live in `skills/` and provide LLM-consumable context:
- `skills/grimoire/` - Core CLI commands
- `skills/grimoire-aave/` - Aave V3 venue CLI + amount format
- `skills/grimoire-uniswap/` - Uniswap V3/V4 venue CLI
- `skills/grimoire-morpho-blue/` - Morpho Blue venue CLI + default markets
- `skills/grimoire-hyperliquid/` - Hyperliquid venue CLI
- `skills/grimoire-pendle/` - Pendle Hosted SDK metadata workflows
- `skills/grimoire-polymarket/` - Polymarket CLOB custom action workflows

Keep docs and skills in sync with code changes:

| Change | Update |
|--------|--------|
| New/changed CLI command or flag | `docs/reference/cli.md`, `skills/grimoire/SKILL.md`, this file |
| New/changed DSL syntax or feature | `docs/reference/grimoire-dsl-spec.md`, `docs/reference/spell-syntax.md` |
| New/changed venue adapter | `docs/reference/venues.md`, matching `skills/grimoire-<venue>/SKILL.md` |
| New venue adapter added | Create `skills/grimoire-<venue>/SKILL.md`, update `docs/reference/venues.md` |
| Test runner changes | `docs/how-to/run-tests.md` |
| Wallet/keystore changes | `docs/reference/cli.md` (setup + wallet sections), `docs/how-to/use-wallet-commands-end-to-end.md` |
| Bridge/amount thresholds | `docs/how-to/bridge-with-across.md`, `docs/reference/venues.md` |
| State persistence changes | This file (State Persistence section) |
| New example spells | `README.md` (Examples section), `docs/reference/grimoire-dsl-spec.md` |

# Runtime Notes (Bun-first, Node-supported)

- Use Bun for local development and tests.
- Packages in `packages/core`, `packages/venues`, and `packages/cli` must remain Node-compatible.
- Prefer standard `fs` APIs over `Bun.file` in shared packages.
- If using `bun:sqlite`, provide a Node fallback (`better-sqlite3`).

# Testing Conventions

```typescript
import { describe, test, expect } from "bun:test";

describe("Feature", () => {
  test("does something", () => {
    expect(result).toBe(expected);
  });
});
```

Test files are named `*.test.ts` and colocated with source files.

# Onchain Test Suite

```bash
# Simulate only (no wallet needed):
./scripts/run-onchain-tests.sh

# Dry-run (builds txs, estimates gas, does NOT send):
./scripts/run-onchain-tests.sh --dry-run

# Live execution on Base:
CHAIN=8453 ./scripts/run-onchain-tests.sh --execute

# Resume from a specific phase after failure:
./scripts/run-onchain-tests.sh --execute --start-phase 4

# Recovery mode - return stranded funds to Base:
./scripts/run-onchain-tests.sh --recover
```

Phases: 0 (compile) -> 1 (simulate pure) -> 2 (simulate features) -> 3 (cast features) -> 4 (cast venues) -> 5 (multi-chain). Phase 5 writes checkpoints to `.grimoire/test-suite/checkpoint` and skips completed sub-steps on resume. Phase 5 is skipped if earlier phases have failures.

# Expression Parser

The expression parser (`packages/core/src/compiler/expression-parser.ts`) handles:
- Arithmetic: `+`, `-`, `*`, `/`, `%`
- Comparison: `==`, `!=`, `<`, `>`, `<=`, `>=`
- Logical: `and`, `or`, `not` (case-insensitive)
- Ternary: `condition ? then : else`
- Function calls: `max(a, b)`, `min(x, y)`, `abs(n)`, `sum(arr)`, `avg(arr)`, `to_number(n)`, `to_bigint(n)`
- Type conversions: `to_number(bigint_val)` → number, `to_bigint(number_val)` → bigint
- Property access: `obj.prop`, `arr[0]`

# Usage Example

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
const persistentState = (await store.load(result.ir.id)) ?? {};

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
