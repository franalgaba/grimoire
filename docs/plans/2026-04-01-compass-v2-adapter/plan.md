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

### Hybrid Adapter (`buildAction` + `executeAction`)

The adapter is a **hybrid** — it implements both `buildAction()` for EVM products (Earn, Credit, Bridge) and `executeAction()` for offchain products (Traditional Investing).

**EVM path** (`buildAction`): The Compass API returns unsigned transactions — same model as Aave, Uniswap, Across adapters. The adapter:

1. Receives a Grimoire `Action` (lend, withdraw, borrow, repay, bridge, etc.)
2. Determines the product type (Earn or Credit) from the action
3. Auto-manages the corresponding smart account (create if needed)
4. Maps the action to the corresponding `@compass-labs/api-sdk` method call
5. Extracts the unsigned transaction from the SDK response
6. Returns `BuiltTransaction` (or array, including account creation tx if needed)

**Offchain path** (`executeAction`): Traditional Investing actions use EIP-712 typed data signing (Hyperliquid perps). `CustomAction` with `ti_*` ops are routed through `executeAction()` which:

1. Receives a `CustomAction` with `op: "ti_market_order"` (etc.) and `args: {...}`
2. Auto-manages TradFi account setup (enable unified account + approve builder fee on first trade)
3. Calls the corresponding `sdk.traditionalInvesting.*` method
4. Signs any EIP-712 typed data payloads using the configured `privateKey`
5. Returns `OffchainExecutionResult`

For `buildAction`, custom actions return a dummy preview transaction (to: zeroAddress, data: "0x") — the real execution happens in `executeAction`. This follows the same pattern as the Hyperliquid adapter.

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

#### Traditional Investing Product (`/v2/traditional_investing/*`)

| CustomAction `op` | SDK Method | Endpoint | Notes |
|---|---|---|---|
| `ti_market_order` | `traditionalInvestingMarketOrder` | `POST /v2/traditional_investing/market_order` | Market order on perps |
| `ti_limit_order` | `traditionalInvestingLimitOrder` | `POST /v2/traditional_investing/limit_order` | Limit order on perps |
| `ti_cancel_order` | `traditionalInvestingCancelOrder` | `POST /v2/traditional_investing/cancel_order` | Cancel order |
| `ti_deposit` | `traditionalInvestingDeposit` | `POST /v2/traditional_investing/deposit` | Deposit USDC (EIP-2612 permit) |
| `ti_withdraw` | `traditionalInvestingWithdraw` | `POST /v2/traditional_investing/withdraw` | Withdraw USDC |
| `ti_setup` | enable_unified + approve_builder_fee | Multiple | One-time account setup |
| `ti_set_leverage` | `traditionalInvestingEnsureLeverage` | `POST /v2/traditional_investing/ensure_leverage` | Per-asset leverage config |

Traditional Investing uses Hyperliquid as the execution layer. Actions are signed offchain via EIP-712 typed data. The `ti_` prefix avoids collision with Hyperliquid's own `order` op.

**Auto-setup**: The first trade auto-calls `enable_unified_account` + `approve_builder_fee`. Leverage is explicit via `ti_set_leverage`.

### Configuration

```typescript
interface CompassV2AdapterConfig {
  apiKey?: string;                    // defaults to process.env.COMPASS_API_KEY
  sdk?: CompassApiSDK;               // injectable for testing
  supportedChains?: number[];         // default: [1, 8453, 42161]
  gasSponsorship?: boolean;           // default: false
  privateKey?: `0x${string}`;        // required for Traditional Investing (EIP-712 signing)
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
- Traditional Investing offchain execution via `executeAction()`
- Executor hybrid routing change (`packages/core/src/wallet/executor.ts`)
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

1. **Install SDK & scaffold adapter** — Add `@compass-labs/api-sdk` dependency, create adapter file with factory pattern, meta, chain mapping, and account management helpers (including TI stubs)
2. **Implement Earn actions** — `lend`, `withdraw`, `swap`, `transfer` via SDK earn methods with Earn Account auto-management
3. **Implement Credit actions** — `supply_collateral`, `withdraw_collateral`, `borrow`, `repay` via SDK credit methods with Credit Account auto-management
4. **Implement Bridge action** — `bridge` via CCTP burn, plus `resolveHandoffStatus` for mint lifecycle
5. **Add CLI entry point** — Create `compass.ts` CLI with `incur` framework, data endpoints for vaults/markets/positions
6. **Register & wire up** — Add to adapters array, update discovery maps, update `package.json` bin entry
7. **Write tests** — Unit tests with mocked SDK, covering all action types, account creation flows, and error cases
8. **Traditional Investing** — Executor hybrid routing, TI handlers in `executeAction()`, TI tests, TI CLI commands
