# Task 08: Traditional Investing

## What to Build

Add Traditional Investing (perpetual futures on stocks/commodities/forex via Hyperliquid) to the compass_v2 adapter. This makes compass_v2 a **hybrid adapter**: `buildAction` for EVM products (Earn, Credit, Bridge) + `executeAction` for offchain TradFi.

This task covers four sub-tasks:
1. Executor hybrid routing change (Task 6 in implementation plan)
2. TI handler implementation (Task 7)
3. TI tests (Task 8)
4. TI CLI commands (Task 9)

## Sub-task 6: Executor Hybrid Routing

### What

Modify `tryExecuteOffchainAction()` in `packages/core/src/wallet/executor.ts` to allow `CustomAction`s on adapters with `executeAction`, even when `executionType !== "offchain"`.

### Change

At line ~539, change:

```typescript
if (!adapter || adapter.meta.executionType !== "offchain") {
  return null;
}
```

To:

```typescript
if (!adapter) return null;
if (adapter.meta.executionType !== "offchain") {
  if (action.type !== "custom" || !adapter.executeAction) return null;
}
```

### Rationale

- Pure offchain adapters (Hyperliquid): unchanged — all actions route through `executeAction`
- Hybrid adapters (compass_v2): only `custom` actions go through `executeAction`
- Pure EVM adapters (Aave, Across): unchanged — they don't have `executeAction`

This is backward-compatible. Existing tests must still pass.

## Sub-task 7: TI Handlers in compass-v2.ts

### Config Changes

Add to `CompassV2AdapterConfig`:

```typescript
privateKey?: `0x${string}`;   // Required for TI (EIP-712 signing)
```

### New Imports

```typescript
import { privateKeyToAccount } from "viem/accounts";
import { zeroAddress } from "viem";
import type { CustomAction } from "@grimoirelabs/core";
```

### TI Setup Cache

```typescript
// Cache key: "wallet:chainId" → TradFi setup complete
const tiSetupCache = new Map<string, boolean>();

async function ensureTradFiSetup(ctx: VenueAdapterContext): Promise<void> {
  const key = `${ctx.walletAddress}:${ctx.chainId}`;
  if (tiSetupCache.get(key)) return;

  const chain = resolveCompassChain(ctx.chainId);
  await sdk.traditionalInvesting.traditionalInvestingEnableUnifiedAccount({
    owner: ctx.walletAddress, chain,
  });
  await sdk.traditionalInvesting.traditionalInvestingApproveBuilderFee({
    owner: ctx.walletAddress, chain,
  });
  tiSetupCache.set(key, true);
}
```

### buildAction Changes

Add `case "custom"` before `default:`:

```typescript
case "custom":
  return {
    tx: { to: zeroAddress, data: "0x", value: 0n },
    description: `Compass V2 custom action: ${(action as CustomAction).op}`,
    action,
  };
```

### executeAction Implementation

Add `executeAction` to the returned adapter object. It routes by `CustomAction.op`:

| Op | SDK Method | Notes |
|---|---|---|
| `ti_market_order` | `traditionalInvestingMarketOrder` | Sign + submit |
| `ti_limit_order` | `traditionalInvestingLimitOrder` | Sign + submit |
| `ti_cancel_order` | `traditionalInvestingCancelOrder` | Sign + submit |
| `ti_deposit` | `traditionalInvestingDeposit` | EIP-2612 permit |
| `ti_withdraw` | `traditionalInvestingWithdraw` | Sign + submit |
| `ti_setup` | (auto-setup) | Calls `ensureTradFiSetup` explicitly |
| `ti_set_leverage` | `traditionalInvestingEnsureLeverage` | Per-asset config |

Auto-setup: ops other than `ti_setup` and `ti_set_leverage` auto-call `ensureTradFiSetup()` before executing.

### Meta Changes

```typescript
actions: [...existing, "custom"],
description: "Compass Labs V2 multi-product DeFi adapter (Earn, Credit, Bridge, Traditional Investing)",
```

## Sub-task 8: TI Tests

### Mock SDK Extension

Add `traditionalInvesting` namespace to `createMockSdk()`:

```typescript
traditionalInvesting: {
  traditionalInvestingMarketOrder: async (args) => { ... },
  traditionalInvestingLimitOrder: async (args) => { ... },
  traditionalInvestingCancelOrder: async (args) => { ... },
  traditionalInvestingDeposit: async (args) => { ... },
  traditionalInvestingWithdraw: async (args) => { ... },
  traditionalInvestingEnableUnifiedAccount: async (args) => { ... },
  traditionalInvestingApproveBuilderFee: async (args) => { ... },
  traditionalInvestingEnsureLeverage: async (args) => { ... },
}
```

### Test Cases

| Test | What it validates |
|---|---|
| `custom action in buildAction returns dummy preview tx` | `buildAction` handles `type: "custom"` with dummy tx |
| `ti_market_order via executeAction` | Routes to SDK, returns result |
| `ti_limit_order via executeAction` | Routes to SDK, returns result |
| `first TI trade triggers auto-setup` | `ensureTradFiSetup` calls enable + approve |
| `second TI trade skips setup (cached)` | Cache prevents redundant setup |
| `ti_setup explicitly triggers setup` | Direct setup op works |
| `ti_set_leverage calls ensureLeverage` | Leverage config works |
| `missing privateKey throws clear error` | Error message mentions privateKey |
| `unknown TI op throws` | Unknown op rejected |

## Sub-task 9: TI CLI Commands

### New Commands

**`ti-opportunities`** — List available Traditional Investing assets (perpetual futures):

```typescript
.command("ti-opportunities", {
  description: "List available Traditional Investing assets (perpetual futures)",
  options: z.object({
    chain: z.coerce.number().describe("Chain ID"),
  }),
  async run(c) {
    const sdk = getSDK();
    const chain = COMPASS_CHAIN_MAP[c.options.chain];
    if (!chain) throw new Error(`Unsupported chain ${c.options.chain}`);
    const result = await sdk.traditionalInvesting.traditionalInvestingOpportunities({ chain });
    return c.ok(serializeBigInts(result));
  },
})
```

**`ti-positions`** — Show TI positions for an address:

```typescript
.command("ti-positions", {
  description: "Show Traditional Investing positions",
  options: z.object({
    owner: z.string().describe("Wallet address (0x...)"),
    chain: z.coerce.number().describe("Chain ID"),
  }),
  async run(c) {
    const sdk = getSDK();
    const chain = COMPASS_CHAIN_MAP[c.options.chain];
    if (!chain) throw new Error(`Unsupported chain ${c.options.chain}`);
    const result = await sdk.traditionalInvesting.traditionalInvestingPositions({
      owner: c.options.owner,
      chain,
    });
    return c.ok(serializeBigInts(result));
  },
})
```

### CLI Metadata Updates

- Description: `"Compass Labs V2 — Earn, Credit, Bridge, and Traditional Investing operations"`
- Add TI suggestions to `sync.suggestions`

## Acceptance Criteria

- [ ] Executor hybrid routing allows custom actions on adapters with `executeAction` regardless of `executionType`
- [ ] Existing executor tests still pass after the guard change
- [ ] `privateKey` is accepted in `CompassV2AdapterConfig`
- [ ] `meta.actions` includes `"custom"`
- [ ] `buildAction` handles `type: "custom"` with a dummy preview tx
- [ ] `executeAction` routes all `ti_*` ops to the correct SDK methods
- [ ] Auto-setup fires on first trade and is cached for subsequent trades
- [ ] `ti_setup` and `ti_set_leverage` skip auto-setup
- [ ] Missing `privateKey` throws a clear error in `executeAction`
- [ ] Unknown `ti_*` op throws
- [ ] All TI test cases pass
- [ ] `ti-opportunities` and `ti-positions` CLI commands work
- [ ] No regressions in existing Earn/Credit/Bridge tests

## Files to Modify

- `packages/core/src/wallet/executor.ts` — hybrid routing guard
- `packages/venues/src/adapters/compass-v2.ts` — TI handlers + executeAction
- `packages/venues/src/adapters/compass-v2.test.ts` — TI test cases
- `packages/venues/src/cli/compass.ts` — TI CLI commands

## Dependencies

- Tasks 1-5 (Earn, Credit, Bridge must be scaffolded first)
- Task 6 (executor) must be done before Task 7 (TI handlers)
