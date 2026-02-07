# DefiHack Multi-Track Detailed Implementation Spec

This document defines a single Grimoire submission that can qualify for multiple sponsor tracks with one coherent product and demo.

## 1. Submission Strategy

### 1.1 Product

Project name: **Grimoire Session Vault**

Core flow:

1. User executes session-based offchain actions.
2. Session settles onchain once.
3. Funds rebalance on Uniswap v4.
4. Optional cross-chain rebalance executes through LI.FI.
5. Strategy profile and payout identity are resolved from ENS.

### 1.2 Tracks Covered

- Yellow Network
- Uniswap Foundation (Uniswap v4 Agentic Finance)
- LI.FI (AI x Smart App)
- ENS (Integrate ENS + creative ENS for DeFi)

### 1.3 Why One Submission Works

- One intent engine (`.spell`) drives all sponsor integrations.
- One deterministic runtime (`simulate` + `cast`) produces proof artifacts.
- One demo video can show all required user and transaction flows.

## 2. External Requirements Mapped to Features

### 2.1 Yellow

From Yellow docs, session operations are executed through NitroRPC app-session methods and signed state updates:

- `create_app_session`
- `submit_app_state`
- `close_app_session`

State update invariants to enforce in adapter:

- `version` must increment exactly by 1.
- `allocations` are the full final distribution, not a delta.
- `intent` must be one of `operate`, `deposit`, `withdraw`.
- signatures must satisfy quorum rules.

Grimoire feature mapping:

- New offchain `yellow` adapter with explicit session lifecycle operations.
- Spell executes repeated instant offchain operations and one onchain settlement close.

### 2.2 Uniswap v4

Track requires functional, programmatic v4 interaction and proof transactions.

Grimoire feature mapping:

- Reuse existing `uniswap_v4` adapter for post-settlement rebalance.
- Keep reliability constraints explicit in spell:
  - `max_slippage`
  - `min_output`
- Verify router/Permit2 addresses against Uniswap deployment docs before final demo.

### 2.3 LI.FI

LI.FI docs confirm the route lifecycle:

- build route via `getRoutes` (or quote via `getQuote`)
- execute route via `executeRoute`/`executeStep`
- monitor with status endpoint (`/v1/status`) or SDK hooks

Grimoire feature mapping:

- New `lifi` adapter for cross-chain rebalance.
- Route constraints enforced from spell action constraints.
- CLI/demo loop: monitor -> decide -> execute.

### 2.4 ENS

ENS docs support:

- text records for arbitrary preferences
- resolution via ENS name APIs
- resolver writes through `setText` on Public Resolver

Grimoire feature mapping:

- ENS profile helper for runtime preference hydration.
- Resolve payout target from ENS name.
- Read records like risk profile and slippage policy.

## 3. Scope and Non-Goals

### 3.1 In Scope

- Multi-track MVP with one production-like strategy flow.
- Adapter-level integrations (Yellow, LI.FI).
- ENS read path (mandatory), write path (optional but planned).
- Full proof artifacts: logs, TxIDs, commands, demo script.

### 3.2 Out of Scope

- New front-end framework migration.
- New chain runtime outside existing EVM-first stack.
- Major DSL syntax changes beyond a minimal generic action extension.

## 4. Dependency Plan (Pinned)

Add only in the package where used:

- `@erc7824/nitrolite` at `0.3.2`
- `@erc7824/nitrolite-wallet` at `0.0.12`
- `@lifi/sdk` at `3.11.5`

Do not add `ensjs`; use existing `viem` ENS APIs already used in repo stack.

## 5. Architecture Changes

### 5.1 Core Compiler/Runtime Extension

Problem: current IR transformation rejects unknown action types.

Solution: add a minimal generic action:

- `type: "custom"`
- `venue: string`
- `op: string`
- `args: Record<string, ...>`

Files:

- `packages/core/src/types/actions.ts`
- `packages/core/src/compiler/grimoire/transformer.ts`
- `packages/core/src/compiler/ir-generator.ts`
- `packages/core/src/runtime/steps/action.ts`
- `packages/core/src/wallet/tx-builder.ts`

Behavior:

- Unknown venue methods compile to `custom` action (`op=method_name`).
- Runtime resolves expression arguments recursively.
- If no adapter handles a `custom` action, fail with explicit, user-readable error.

### 5.2 Venue Adapters

### Yellow

New file: `packages/venues/src/yellow.ts`

- `meta.executionType = "offchain"`
- Supported ops:
  - `session_open` -> maps to `create_app_session`
  - `session_update` -> maps to `submit_app_state`
  - `session_close_settle` -> maps to `close_app_session`
- Optional helper op for simple demos:
  - `session_transfer` (compiled internally to allocation update + submit)

Validation rules inside adapter:

- enforce allowed intents
- enforce version monotonicity
- reject empty allocations
- reject quorum/signer mismatch

### LI.FI

New file: `packages/venues/src/lifi.ts`

- Supports native Grimoire actions first:
  - `swap`
  - `bridge`
- Optional `custom` op:
  - `compose_execute`

Execution flow:

1. Build route/quote.
2. Check action constraints.
3. Execute route/step.
4. Emit structured execution metadata for logs and demo.

### 5.3 ENS Profile Helper

New helper file:

- `packages/cli/src/lib/ens-profile.ts`

Responsibilities:

- resolve ENS name -> address
- read text records for strategy prefs
- optional write path for demo setup (`setText`)

Recommended keys:

- `io.grimoire.risk_profile`
- `io.grimoire.max_slippage_bps`
- `io.grimoire.preferred_settlement_chain`

### 5.4 Adapter Exports and Registry

Update:

- `packages/venues/src/index.ts`

Add exports:

- `createYellowAdapter`, `yellowAdapter`
- `createLifiAdapter`, `lifiAdapter`

Default adapter registration rule:

- include only adapters that do not require mandatory secrets at construction time.

## 6. Configuration Spec

### 6.1 Environment Variables

Yellow:

- `YELLOW_RPC_URL` (NitroRPC endpoint)
- `YELLOW_WS_URL` (clear node websocket)
- `YELLOW_PRIVATE_KEY`
- `YELLOW_CHAIN_ID`
- `YELLOW_APP_ID` (if required by session definition)

LI.FI:

- `LIFI_INTEGRATOR` (required in LI.FI config)
- `LIFI_API_URL` (default `https://li.quest/v1`)
- `LIFI_API_KEY` (optional, if used)

ENS:

- `ENS_RPC_URL`
- `ENS_OPERATOR_KEY` (only if write demo is enabled)

General:

- `PRIVATE_KEY`
- `RPC_URL`

### 6.2 Runtime Secrets Policy

- never hardcode keys or app IDs
- use env vars only
- redact secrets in CLI logs

## 7. Spell and Demo Assets

Add folder:

- `spells/defihack/`

Files:

- `session-vault.spell` (primary end-to-end)
- `yellow-session-only.spell`
- `uniswap-v4-rebalance.spell`
- `lifi-crosschain-rebalance.spell`

Primary spell flow:

1. `yellow.session_open(...)`
2. repeated `yellow.session_update(...)`
3. `yellow.session_close_settle(...)`
4. `uniswap_v4.swap(...) with max_slippage and min_output`
5. `if` drift across chains -> `lifi.bridge(...)`
6. `emit` structured events for judge-friendly logs

## 8. Implementation Plan by PR

### PR-1 Core Action Extension

Changes:

- add `custom` action type end-to-end
- compiler + IR + runtime + tx-builder behavior

Tests:

- new unit tests for transform/IR/runtime
- regression tests for existing actions

Done when:

- unknown venue methods compile and execute through adapters
- no regressions in existing spells/tests

### PR-2 Yellow Adapter

Changes:

- implement `yellow` adapter with session lifecycle ops
- add config parsing and validation

Tests:

- adapter unit tests with mocked client
- invalid intent/version/signature path tests

Done when:

- one spell can open/update/close a session in dry-run
- one testnet run yields settlement proof tx/hash

### PR-3 LI.FI Adapter

Changes:

- route + execute for `swap`/`bridge`
- constraint enforcement

Tests:

- route available/unavailable
- slippage guard failures
- structured result output

Done when:

- cross-chain spell path runs in simulate + dry-run
- one live proof path completed on testnet

### PR-4 ENS Profile Integration

Changes:

- ENS resolve + text read
- optional text write helper for setup

Tests:

- malformed record fallback
- missing record default policy

Done when:

- spell params can be derived from ENS profile in CLI flow

### PR-5 Submission Packaging

Changes:

- README track matrix with proof links
- architecture diagram
- demo commands and runbook

Done when:

- all track requirements map to reproducible commands and artifacts

## 9. Acceptance Criteria by Track

### Yellow

- adapter uses Yellow session protocol methods
- demo shows multiple offchain updates and one close/settle
- repository contains reproducible run steps

### Uniswap v4

- spell executes v4 swap action in deterministic flow
- proof TxID and dry-run log provided

### LI.FI

- at least one cross-chain action through LI.FI route/quote + execution path
- monitor/decide/act loop visible in logs or CLI output

### ENS

- ENS code is explicit (no wallet-kit-only integration)
- at least one meaningful preference read from text records in runtime
- optional bonus: preference write path shown in setup script

## 10. Validation and QA Plan

For code PRs:

- `bun run validate`
- focused adapter tests
- `grimoire simulate` for each new spell
- `grimoire cast --dry-run` for each new spell
- limited live testnet runs for proof TxIDs

For docs-only PRs:

- no test run required

## 11. Risk Register and Fallbacks

- Yellow integration complexity.
  - Fallback: narrow MVP to required open/update/close session lifecycle only.
- LI.FI route volatility.
  - Fallback: restrict assets/chains and fail closed.
- ENS write permission friction.
  - Fallback: keep ENS read path as required integration.
- Time risk.
  - Fallback track priority: Yellow + Uniswap + ENS first, LI.FI second.

## 12. Demo Runbook (2-3 min video)

1. Show one `.spell` defining full strategy.
2. Run `simulate` and explain offchain session steps.
3. Run `cast --dry-run` to show deterministic transaction plan.
4. Execute one live proof path and show TxID(s).
5. Show ENS profile lookup affecting runtime behavior.
6. Show cross-chain LI.FI path (or fallback explanation if disabled).

## 13. Deliverables Checklist

- public repo with all integration code
- README with per-track mapping and proof links
- architecture diagram
- demo video <= 3 minutes
- transaction evidence and run logs

## 14. Source References

- Yellow learn/docs root: https://docs.yellow.org/docs/learn
- Yellow quickstart: https://docs.yellow.org/docs/build/quickstart
- Yellow app session methods: https://docs.yellow.org/docs/build/api-reference/app-session-methods
- Yellow implementation checklist: https://docs.yellow.org/docs/build/implementation-checklist
- Uniswap v4 overview: https://docs.uniswap.org/contracts/v4/overview
- Uniswap v4 deployments: https://docs.uniswap.org/contracts/v4/deployments
- LI.FI docs root: https://docs.li.fi/
- LI.FI SDK execute routes: https://docs.li.fi/sdk/execute-routes
- LI.FI API reference: https://docs.li.fi/api-reference/introduction
- ENS docs root: https://docs.ens.domains
- ENS records (text records): https://docs.ens.domains/web/records
- ENS resolution: https://docs.ens.domains/resolution/
- ENS resolver interaction and `setText`: https://docs.ens.domains/resolvers/interacting-with-resolvers
