---
"@grimoirelabs/core": minor
"@grimoirelabs/venues": minor
"@grimoirelabs/cli": minor
---

Wire QueryProvider through the execution pipeline. Adds pluggable `QueryProvider` interface that flows from CLI through `ExecuteOptions` → `ExecutionContext` → `createEvalContext()`, enabling `price()` and `balance()` query functions at runtime. Includes Alchemy-backed implementation (`createAlchemyQueryProvider`) with auto-extracted API key from RPC URL. Type checker now supports optional arguments on built-in functions (`price(base, quote, source?)`, `balance(asset, address?)`).
