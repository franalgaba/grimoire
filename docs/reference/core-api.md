# Core API reference

The `@grimoire/core` package exposes compiler, runtime, state persistence, and wallet utilities.

## Compiler

```ts
import { compile, compileFile, parseSpell, parseExpression, validateIR } from "@grimoire/core";
```

- `compile(source: string)` → `CompilationResult`
- `compileFile(path: string)` → `CompilationResult`
- `parseSpell(source: string)` → `ParseResult`
- `parseExpression(expr: string)` → `Expression`
- `validateIR(ir: SpellIR)` → `ValidationResult`

## Runtime

```ts
import { execute, createContext, InMemoryLedger } from "@grimoire/core";
```

- `execute(options: ExecuteOptions)` → `Promise<ExecutionResult>`
- `createContext(options: CreateContextOptions)` → `ExecutionContext`
- `InMemoryLedger` for events

### ExecuteOptions

```ts
interface ExecuteOptions {
  spell: SpellIR;
  vault: Address;
  chain: ChainId;
  params?: Record<string, unknown>;
  persistentState?: Record<string, unknown>;  // loaded from StateStore
  simulate?: boolean;
  executionMode?: ExecutionMode;
  wallet?: Wallet;
  provider?: Provider;
  adapters?: VenueAdapter[];
}
```

### ExecutionResult

```ts
interface ExecutionResult {
  success: boolean;
  runId: string;
  startTime: number;
  endTime: number;
  duration: number;
  error?: string;
  metrics: ExecutionMetrics;
  finalState: Record<string, unknown>;  // save to StateStore
  ledgerEvents: LedgerEntry[];          // save to StateStore
}
```

## State Persistence

```ts
import { SqliteStateStore, createRunRecord } from "@grimoire/core";
import type { StateStore, RunRecord, RunMetrics } from "@grimoire/core";
```

### StateStore interface

Abstract interface for persisting spell state and run history.

```ts
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

### SqliteStateStore

SQLite-backed implementation using `bun:sqlite`. Zero external dependencies.

```ts
const store = new SqliteStateStore({
  dbPath: ".grimoire/grimoire.db",  // default
  maxRuns: 100,                      // default, prunes older runs
});
```

Creates tables automatically on first use. Uses WAL mode for performance.

### createRunRecord

Converts an `ExecutionResult` into a `RunRecord` for storage. Serializes `bigint` fields (gasUsed) to strings for JSON compatibility.

```ts
const record = createRunRecord(result);
await store.addRun(spell.id, record);
```

### RunRecord

```ts
interface RunRecord {
  runId: string;
  timestamp: string;       // ISO 8601
  success: boolean;
  error?: string;
  duration: number;
  metrics: RunMetrics;
  finalState: Record<string, unknown>;
}

interface RunMetrics {
  stepsExecuted: number;
  actionsExecuted: number;
  gasUsed: string;          // bigint serialized as string
  advisoryCalls: number;
  errors: number;
  retries: number;
}
```

### Usage pattern

```ts
const store = new SqliteStateStore();

// Load → Execute → Save
const state = await store.load("my-spell") ?? {};
const result = await execute({ spell, vault, chain: 1, persistentState: state });
await store.save("my-spell", result.finalState);
await store.addRun("my-spell", createRunRecord(result));
await store.saveLedger("my-spell", result.runId, result.ledgerEvents);

// Query history
const runs = await store.getRuns("my-spell", 10);
const ledger = await store.loadLedger("my-spell", runs[0].runId);
const allSpells = await store.listSpells();

store.close();
```

## Wallet

```ts
import {
  createProvider,
  createWallet,
  createWalletFromConfig,
  Executor,
  TransactionBuilder,
} from "@grimoire/core";
```

- `createProvider(chainId, rpcUrl?)`
- `createWallet(privateKey, chainId, rpcUrl)`
- `createWalletFromConfig(config, chainId, rpcUrl)`
- `Executor` routes actions to adapters or fallback tx builder

## Venues

```ts
import { createVenueRegistry } from "@grimoire/core";
```

- `createVenueRegistry(adapters)`

## Types

Key types:

- `SpellIR`
- `Action`, `ActionConstraints`
- `VenueAdapter`, `VenueAdapterContext`
- `ExecutionResult`, `ExecutionMetrics`, `LedgerEntry`
- `StateStore`, `RunRecord`, `RunMetrics`
