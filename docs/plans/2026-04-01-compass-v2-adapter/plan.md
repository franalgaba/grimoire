# Compass V2 Venue Adapter

## Overview

Add a `compass_v2` venue adapter that wraps the `@compass-labs/api-sdk` TypeScript SDK to expose the full Compass Labs V2 API surface through Grimoire's venue system.

The Compass V2 API is a non-custodial DeFi API that returns unsigned transaction payloads. It operates through **product-specific smart accounts** (Earn Account, Credit Account) that sit between the user's EOA and DeFi protocols, enabling transaction bundling and gas sponsorship.

## Goals

1. Single `compass_v2` venue that routes all V2 actions through the SDK
2. Proper account mapping — auto-manage Earn/Credit smart accounts transparently
3. Follow existing adapter patterns (factory + singleton, shared utilities, colocated tests)
4. In-repo implementation inside `packages/venues/`
5. When the SDK is updated with new methods, the adapter can be extended with minimal code changes

## Architecture

### Adapter Type: EVM (`buildAction`)

The Compass API returns unsigned transactions — same model as Aave, Uniswap, Across adapters. The adapter implements `buildAction()` which:

1. Receives a Grimoire `Action` (lend, withdraw, borrow, repay, bridge, etc.)
2. Determines the product type (Earn or Credit) from the action
3. Auto-manages the corresponding smart account (create if needed)
4. Maps the action to the corresponding `@compass-labs/api-sdk` method call
5. Extracts the unsigned transaction from the SDK response
6. Returns `BuiltTransaction` (or array, including account creation tx if needed)

### Account Model

The core design challenge. Compass V2 uses isolated smart accounts per product:

```
User EOA (ctx.walletAddress)
  ├── Earn Account (per chain) — for deposit/withdraw from yield venues
  │     └── holds tokens, interacts with Aave/Vaults/Pendle
  └── Credit Account (per chain) — for borrow/repay with collateral
        └── holds collateral, manages Aave debt positions
```

The adapter:
- Uses `ctx.walletAddress` as the `owner` parameter in all API calls
- Before any Earn action: checks if Earn Account exists, prepends `create_account` tx if not
- Before any Credit action: checks if Credit Account exists, prepends `create_account` tx if not
- Caches account existence per (walletAddress, chainId, product) to avoid redundant checks
- Transfer actions move tokens between EOA ↔ product account

### Action Mapping

#### Earn Product (`/v2/earn/*`)

| Grimoire Action    | SDK Method                    | Compass V2 Endpoint              | Notes |
|--------------------|-------------------------------|----------------------------------|-------|
| `lend`             | `sdk.earn.earnManage()`       | `POST /v2/earn/manage` (DEPOSIT) | Deposit into AAVE/VAULT/PENDLE_PT |
| `withdraw`         | `sdk.earn.earnManage()`       | `POST /v2/earn/manage` (WITHDRAW)| Withdraw from AAVE/VAULT/PENDLE_PT |
| `transfer`         | `sdk.earn.earnTransfer()`     | `POST /v2/earn/transfer`         | Move tokens EOA ↔ Earn Account |
| `swap`             | `sdk.earn.earnSwap()`         | `POST /v2/earn/swap`             | Swap within Earn Account |

Venue type resolution for `earnManage`:
- `action.vault` is set → `{ type: "VAULT", vault_address: action.vault }`
- Action has Pendle PT context → `{ type: "PENDLE_PT" }`
- Default → `{ type: "AAVE" }`

#### Credit Product (`/v2/credit/*`)

| Grimoire Action        | SDK Method                     | Compass V2 Endpoint          | Notes |
|------------------------|--------------------------------|------------------------------|-------|
| `supply_collateral`    | `sdk.credit.creditTransfer()`  | `POST /v2/credit/transfer` (DEPOSIT) | Move collateral into Credit Account |
| `withdraw_collateral`  | `sdk.credit.creditTransfer()`  | `POST /v2/credit/transfer` (WITHDRAW)| Move collateral out of Credit Account |
| `borrow`               | `sdk.credit.creditBorrow()`    | `POST /v2/credit/borrow`    | Combined: supply collateral + borrow (handles swap if token_in ≠ collateral_token) |
| `repay`                | `sdk.credit.creditRepay()`     | `POST /v2/credit/repay`     | Combined: repay debt + withdraw collateral (handles swap if needed) |

The Credit API is designed to bundle operations. The `/credit/borrow` endpoint accepts `token_in`, `collateral_token`, and `borrow_token` — if `token_in ≠ collateral_token`, it swaps first, then supplies, then borrows. Similarly `/credit/repay` bundles repay + withdraw + optional swap. The adapter supports both:
- **Granular**: `supply_collateral` / `withdraw_collateral` via `credit/transfer`
- **Combined**: `borrow` / `repay` via the bundled endpoints

#### Bridge (`/v2/bridge/*`)

| Grimoire Action | SDK Method                | Compass V2 Endpoint        | Notes |
|-----------------|---------------------------|----------------------------|-------|
| `bridge`        | `sdk.bridge.cctpBurn()`   | `POST /v2/bridge/cctp/burn`| USDC only, CCTP protocol |

Bridge lifecycle: burn on source → poll attestation → mint on destination.

### Configuration

```typescript
interface CompassV2AdapterConfig {
  apiKey?: string;                    // defaults to process.env.COMPASS_API_KEY
  sdk?: CompassApiSDK;               // injectable for testing
  supportedChains?: number[];         // default: [1, 8453, 42161]
  gasSponsorship?: boolean;           // default: false
}
```

### Chain Mapping

The Compass API uses string chain names; Grimoire uses numeric chain IDs:

| Chain ID | Compass Name |
|----------|-------------|
| 1        | `ethereum`  |
| 8453     | `base`      |
| 42161    | `arbitrum`  |

## Scope

### In Scope
- Adapter implementation (`packages/venues/src/adapters/compass-v2.ts`)
- Account auto-management (create if not exists, cache state)
- Unit tests (`packages/venues/src/adapters/compass-v2.test.ts`)
- CLI entry point (`packages/venues/src/cli/compass.ts`)
- Registration in `packages/venues/src/index.ts`
- Discovery maps in `packages/venues/src/shared/discovery.ts`
- Bridge lifecycle for CCTP (burn → mint two-phase flow)

### Out of Scope
- Gas sponsorship relay execution (future enhancement)
- Bundle endpoint support (future — would require Grimoire runtime changes)
- External npm package packaging

## Tasks

1. **Install SDK & scaffold adapter** — Add `@compass-labs/api-sdk` dependency, create adapter file with factory pattern, meta, chain mapping, and account management helpers
2. **Implement Earn actions** — `lend`, `withdraw`, `swap`, `transfer` via SDK earn methods with Earn Account auto-management
3. **Implement Credit actions** — `supply_collateral`, `withdraw_collateral`, `borrow`, `repay` via SDK credit methods with Credit Account auto-management
4. **Implement Bridge action** — `bridge` via CCTP burn, plus `resolveHandoffStatus` for mint lifecycle
5. **Add CLI entry point** — Create `compass.ts` CLI with `incur` framework, data endpoints for vaults/markets/positions
6. **Register & wire up** — Add to adapters array, update discovery maps, update `package.json` bin entry
7. **Write tests** — Unit tests with mocked SDK, covering all action types, account creation flows, and error cases
