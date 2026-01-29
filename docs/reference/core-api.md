# Core API reference

The `@grimoire/core` package exposes compiler, runtime, and wallet utilities.

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

- `execute(options: ExecuteOptions)`
- `createContext(options: CreateContextOptions)`
- `InMemoryLedger` for events

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
