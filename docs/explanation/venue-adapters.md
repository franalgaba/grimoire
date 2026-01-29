# Venue adapter model

Adapters are pluggable integrations that translate high-level actions into transactions or offchain operations.

## Responsibilities

- Validate action types
- Build one or more transactions
- Handle approvals when needed
- Mark execution type (`evm` or `offchain`)

## Registry routing

The executor uses a registry to route by `action.venue`. If an adapter supports the current chain, it is used to build transactions; otherwise the executor falls back to the core transaction builder.

## Multi-transaction plans

Adapters can return a single `BuiltTransaction` or an array to represent approval + action flows.

## Offchain execution

Adapters like Hyperliquid can implement `executeAction` to submit orders without on-chain transactions.
