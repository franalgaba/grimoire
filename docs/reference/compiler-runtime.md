# Compiler and Runtime API Reference

This page documents the programmatic API exported by `@grimoirelabs/core`.

## Compiler API

Source: `packages/core/src/compiler/index.ts`

### `compile(source: string): CompilationResult`

Compiles Grimoire source text.

Stages:

1. parse AST
2. transform to SpellSource
3. generate IR
4. type-check IR
5. validate IR

Returns:

- `success`
- `ir` when successful
- `errors`
- `warnings`

### `compileFile(filePath: string): Promise<CompilationResult>`

Reads a `.spell` file and compiles it.

### `parseSpell(content: string): ParseResult`

Parses source into `SpellSource` (without full compile/validate pipeline).

### `parseSpellFile(filePath: string): Promise<ParseResult>`

File path variant for parse-only workflow.

### Expression helpers

- `parseExpression`
- `tryParseExpression`

## Runtime API

Source: `packages/core/src/runtime/interpreter.ts`

Runtime semantics are consistent across CLI and library entry points.

### `preview(options: PreviewOptions): Promise<PreviewResult>`

Runs full spell in simulation mode and emits a receipt.

Key responsibilities:

- guard checks
- step execution loop (actions as planned actions)
- advisory output capture
- value-flow evaluation and constraints
- receipt generation

Accepts an optional `queryProvider` for blockchain data queries (see Query Provider API below).

### `commit(options: CommitOptions): Promise<CommitResult>`

Commits planned actions from a `ready` preview receipt.

Validation and safety gates:

- receipt status/identity checks
- in-process preview receipt provenance checks
- drift checks and optional max-age policy

### `execute(options: ExecuteOptions): Promise<ExecutionResult>`

Backward-compatible wrapper that also accepts an optional `queryProvider`:

- always runs `preview()`
- commits only if runtime mode requires commit and wallet is present

Execution-mode behavior:

- `simulate` -> preview only
- `dry-run` -> preview only
- `execute` + wallet + planned actions -> preview + commit

## Session API

Source: `packages/core/src/runtime/session.ts`

- `runSession`
- `runOneShotSession`
- `runManagedSession`

These normalize trigger metadata for one-shot and managed runs while reusing `execute()` semantics.

## State Store API

Source: `packages/core/src/runtime/state-store.ts`

`StateStore` contract:

- `load(spellId)`
- `save(spellId, state)`
- `addRun(spellId, run)`
- `getRuns(spellId, limit?)`
- `saveLedger(spellId, runId, entries)`
- `loadLedger(spellId, runId)`
- `listSpells()`

Helper:

- `createRunRecord(result, provenance?)`

SQLite implementation:

- `SqliteStateStore` in `runtime/sqlite-state-store.ts`
- Bun path: `bun:sqlite`
- Node fallback: `better-sqlite3`

## Key Runtime Types

### `SpellIR`

Defines compiled spell metadata, config, steps, guards, triggers, source map.

### `ExecutionResult`

Includes:

- run IDs and duration
- success/error info
- metrics
- final state
- ledger events
- preview receipt
- commit result (when applicable)

### `Receipt`

Preview artifact includes:

- guard and advisory results
- planned actions
- value deltas and accounting
- constraint results
- drift keys
- approval requirement signal
- final state and metrics

## Query Provider API

Source: `packages/core/src/types/query-provider.ts`

`QueryProvider` is a pluggable interface that supplies blockchain data (balances, prices, APY, etc.) to spell expressions at runtime.

### `QueryProvider`

```ts
interface QueryProvider {
  meta: QueryProviderMeta;
  queryBalance?: (asset: string, address?: string) => Promise<bigint>;
  queryPrice?: (base: string, quote: string, source?: string) => Promise<number>;
  queryApy?: (venue: string, asset: string) => Promise<number>;
  queryHealthFactor?: (venue: string) => Promise<number>;
  queryPosition?: (venue: string, asset: string) => Promise<unknown>;
  queryDebt?: (venue: string, asset: string) => Promise<bigint>;
}
```

All query methods are optional. The provider declares which queries it supports via `meta.supportedQueries`.

### `QueryProviderMeta`

```ts
interface QueryProviderMeta {
  name: string;
  supportedQueries: Array<"balance" | "price" | "apy" | "health_factor" | "position" | "debt">;
  description?: string;
}
```

### Data flow

1. Caller passes `queryProvider` on `PreviewOptions` or `ExecuteOptions`.
2. `createContext()` copies it onto `ExecutionContext.queryProvider`.
3. `createEvalContext()` binds each provider method onto the `EvalContext`.
4. Expression evaluator maps spell functions (`balance()`, `price()`, `get_apy()`, `health_factor()`, `position()`, `debt()`) to the corresponding `query*` method on `EvalContext`.

If a spell calls a query function and no provider (or no matching method) is available, the evaluator throws at runtime.

## Wallet and Provider API

Source: `packages/core/src/wallet/*`

Exports include:

- key loading and keystore helpers
- wallet creation
- provider creation
- transaction builder
- executor

Execution modes:

- `simulate`
- `dry-run`
- `execute`

Executor delegates venue-specific action building/execution to adapter registry when available.

## Builder API

`@grimoirelabs/core` exports fluent builders from `packages/core/src/builders` for programmatic spell construction.

Examples of exported builder helpers:

- `spell`
- `action`
- `compute`
- `conditional`
- `repeat`
- `forLoop`
- `parallel`
- `pipeline`
- `advisory`
- `emit`

## Minimal Example

```ts
import { compile, execute } from "@grimoirelabs/core";
import { adapters } from "@grimoirelabs/venues";

const compiled = compile(sourceText);
if (!compiled.success || !compiled.ir) throw new Error("compile failed");

const result = await execute({
  spell: compiled.ir,
  vault: "0x0000000000000000000000000000000000000000",
  chain: 1,
  params: {},
  simulate: true,
  adapters,
});

console.log(result.success, result.receipt?.status);
```
