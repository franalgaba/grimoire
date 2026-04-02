# Compass V2 Adapter Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `compass_v2` venue adapter that wraps `@compass-labs/api-sdk` to expose Compass Labs V2 Earn, Credit, Bridge, and Traditional Investing APIs through Grimoire's venue system, with transparent product-account auto-management.

**Architecture:** Thin SDK wrapper using factory + singleton pattern. A single `compass-v2.ts` adapter file implements both `buildAction()` (EVM products) and `executeAction()` (offchain TradFi). EVM actions route to SDK namespaces (`sdk.earn.*`, `sdk.credit.*`, `sdk.bridge.*`). Traditional Investing custom actions route through `executeAction()` to `sdk.traditionalInvesting.*` with EIP-712 signing. Account existence is cached per `(wallet, chain, product)` and account-creation transactions are auto-prepended.

**Tech Stack:** TypeScript, `@compass-labs/api-sdk`, Bun test runner, `incur` CLI framework, `zod` schemas.

**Design doc:** `docs/plans/2026-04-01-compass-v2-adapter/plan.md`

**Diagrams:** `docs/plans/2026-04-01-compass-v2-adapter/diagram.excalidraw`, `blockers.excalidraw`

---

## Key Reference Files

Before starting, familiarise yourself with these files — they define the patterns you must follow:

| File | Why |
|---|---|
| `packages/core/src/venues/types.ts` | `VenueAdapter`, `VenueAdapterMeta`, `VenueAdapterContext`, `BuiltTransaction` interfaces |
| `packages/core/src/types/actions.ts` | All Grimoire `Action` types (`LendAction`, `BorrowAction`, `BridgeAction`, etc.) |
| `packages/venues/src/adapters/aave-v3.ts` | Reference lending adapter — factory pattern, meta, action routing |
| `packages/venues/src/adapters/aave-v3.test.ts` | Reference test pattern — mock injection via factory config, `bun:test` |
| `packages/venues/src/adapters/across.ts` | Reference bridge adapter — `resolveHandoffStatus`, bridge lifecycle |
| `packages/venues/src/adapters/hyperliquid.ts` | Reference offchain adapter — `executeAction`, EIP-712 signing, preview-commit pattern |
| `packages/core/src/wallet/executor.ts` | `tryExecuteOffchainAction` routing — hybrid adapter guard change |
| `packages/venues/src/cli/across.ts` | Reference CLI — `incur` framework, `Cli.create()`, zod options, `c.ok()` |
| `packages/venues/src/index.ts` | Barrel exports — adapters array + named exports |
| `packages/venues/src/shared/discovery.ts` | `BUILTIN_ALIAS_MAP`, `CLI_TO_ADAPTER_MAP` for venue discovery |
| `packages/venues/package.json` | Dependencies and `bin` entries |

---

## Task 1: Install SDK & Scaffold Adapter

**Files:**
- Modify: `packages/venues/package.json`
- Create: `packages/venues/src/adapters/compass-v2.ts`

### Step 1: Add SDK dependency

Add `@compass-labs/api-sdk` to `packages/venues/package.json` dependencies:

```json
"@compass-labs/api-sdk": "latest"
```

### Step 2: Install

Run: `bun install`
Expected: SDK installs successfully, lockfile updates.

### Step 3: Verify SDK is importable

Run: `bun -e "import('@compass-labs/api-sdk').then(m => console.log(Object.keys(m)))"`
Expected: Prints SDK export names (including `CompassApiSDK` or similar).

### Step 4: Create adapter scaffold

Create `packages/venues/src/adapters/compass-v2.ts` with this content:

```typescript
import type {
  Action,
  Address,
  BuiltTransaction,
  VenueAdapter,
  VenueAdapterContext,
  VenueBuildResult,
} from "@grimoirelabs/core";
import { CompassApiSDK } from "@compass-labs/api-sdk";
import { zeroAddress } from "viem";
import { toBigInt } from "../shared/bigint.js";

// --- Chain mapping ---

const COMPASS_CHAIN_MAP: Record<number, string> = {
  1: "ethereum",
  8453: "base",
  42161: "arbitrum",
};

function resolveCompassChain(chainId: number): string {
  const chain = COMPASS_CHAIN_MAP[chainId];
  if (!chain) {
    throw new Error(
      `Compass V2: unsupported chain ${chainId}. Supported: ${Object.keys(COMPASS_CHAIN_MAP).join(", ")}`
    );
  }
  return chain;
}

// --- Account management ---

type ProductType = "earn" | "credit";

/** Cache key: "wallet:chainId:product" → account exists */
const accountCache = new Map<string, boolean>();

function accountCacheKey(wallet: string, chainId: number, product: ProductType): string {
  return `${wallet}:${chainId}:${product}`;
}

function getProductType(actionType: string): ProductType {
  switch (actionType) {
    case "lend":
    case "withdraw":
    case "swap":
    case "transfer":
      return "earn";
    case "supply_collateral":
    case "withdraw_collateral":
    case "borrow":
    case "repay":
      return "credit";
    default:
      throw new Error(`Compass V2: cannot determine product type for action "${actionType}"`);
  }
}

async function ensureAccount(
  product: ProductType,
  ctx: VenueAdapterContext,
  sdk: CompassApiSDK
): Promise<BuiltTransaction | null> {
  const key = accountCacheKey(ctx.walletAddress, ctx.chainId, product);
  if (accountCache.get(key)) {
    return null;
  }

  const chain = resolveCompassChain(ctx.chainId);

  // Check if account exists
  try {
    if (product === "earn") {
      await sdk.earn.earnBalances({ owner: ctx.walletAddress, chain });
    } else {
      await sdk.credit.creditPositions({ owner: ctx.walletAddress, chain });
    }
    accountCache.set(key, true);
    return null;
  } catch {
    // Account doesn't exist — create it
  }

  const response =
    product === "earn"
      ? await sdk.earn.earnCreateAccount({ owner: ctx.walletAddress, chain })
      : await sdk.credit.creditCreateAccount({ owner: ctx.walletAddress, chain });

  accountCache.set(key, true);

  return extractTransaction(response, `Compass V2: create ${product} account`);
}

// --- Transaction extraction ---

function extractTransaction(response: unknown, description: string): BuiltTransaction {
  const res = response as Record<string, unknown>;
  const tx = (res.unsigned_tx ?? res.unsignedTx ?? res.transaction ?? res) as Record<string, unknown>;
  return {
    tx: {
      to: (tx.to ?? tx.To) as Address,
      data: (tx.data ?? tx.Data ?? "0x") as string,
      value: BigInt((tx.value ?? tx.Value ?? 0) as string | number),
    },
    description,
  };
}

function extractTransactions(response: unknown, description: string): BuiltTransaction[] {
  const res = response as Record<string, unknown>;
  const txs = (res.unsigned_txs ?? res.unsignedTxs ?? res.transactions) as unknown[] | undefined;
  if (Array.isArray(txs)) {
    return txs.map((tx, i) => extractTransaction(tx, `${description} (${i + 1}/${txs.length})`));
  }
  return [extractTransaction(response, description)];
}

// --- Config & factory ---

export interface CompassV2AdapterConfig {
  apiKey?: string;
  sdk?: CompassApiSDK;
  supportedChains?: number[];
  gasSponsorship?: boolean;
  privateKey?: `0x${string}`;        // Required for Traditional Investing (EIP-712 signing)
}

export function createCompassV2Adapter(config: CompassV2AdapterConfig = {}): VenueAdapter {
  const apiKey = config.apiKey ?? process.env.COMPASS_API_KEY;
  if (!apiKey && !config.sdk) {
    throw new Error("Compass V2: COMPASS_API_KEY env var or sdk instance is required");
  }

  const sdk = config.sdk ?? new CompassApiSDK({ apiKey: apiKey! });
  const supportedChains = config.supportedChains ?? [1, 8453, 42161];

  const meta: VenueAdapter["meta"] = {
    name: "compass_v2",
    supportedChains,
    actions: [
      "lend",
      "withdraw",
      "swap",
      "transfer",
      "supply_collateral",
      "withdraw_collateral",
      "borrow",
      "repay",
      "bridge",
      "custom",
    ],
    supportedConstraints: ["max_slippage"],
    requiredEnv: ["COMPASS_API_KEY"],
    description: "Compass Labs V2 multi-product DeFi adapter (Earn, Credit, Bridge, Traditional Investing)",
  };

  // --- Earn handlers ---

  async function handleEarnManage(
    action: Action,
    ctx: VenueAdapterContext
  ): Promise<VenueBuildResult> {
    const chain = resolveCompassChain(ctx.chainId);
    const amount = toBigInt(action.amount, "Compass V2 earn requires a numeric amount");
    const compassAction = action.type === "lend" ? "DEPOSIT" : "WITHDRAW";

    let venue: Record<string, unknown> = { type: "AAVE" };
    if (ctx.vault) {
      venue = { type: "VAULT", vault_address: ctx.vault };
    }

    const txs: BuiltTransaction[] = [];

    const accountTx = await ensureAccount("earn", ctx, sdk);
    if (accountTx) txs.push(accountTx);

    const response = await sdk.earn.earnManage({
      owner: ctx.walletAddress,
      chain,
      action: compassAction,
      token: action.asset,
      amount: amount.toString(),
      ...venue,
    });

    txs.push(...extractTransactions(response, `Compass V2 ${action.type} ${action.asset}`));
    return txs;
  }

  async function handleEarnSwap(
    action: Action,
    ctx: VenueAdapterContext
  ): Promise<VenueBuildResult> {
    const chain = resolveCompassChain(ctx.chainId);
    const amount = toBigInt(action.amount, "Compass V2 swap requires a numeric amount");

    const slippage = action.constraints?.maxSlippageBps
      ? action.constraints.maxSlippageBps / 100
      : 1;

    const txs: BuiltTransaction[] = [];
    const accountTx = await ensureAccount("earn", ctx, sdk);
    if (accountTx) txs.push(accountTx);

    const swapAction = action as Action & { assetIn?: string; assetOut?: string };
    const response = await sdk.earn.earnSwap({
      owner: ctx.walletAddress,
      chain,
      token_in: swapAction.assetIn ?? action.asset,
      token_out: swapAction.assetOut ?? (action as Record<string, unknown>).toAsset as string,
      amount_in: amount.toString(),
      slippage,
    });

    txs.push(...extractTransactions(response, `Compass V2 swap ${action.asset}`));
    return txs;
  }

  async function handleEarnTransfer(
    action: Action,
    ctx: VenueAdapterContext
  ): Promise<VenueBuildResult> {
    const chain = resolveCompassChain(ctx.chainId);
    const amount = toBigInt(action.amount, "Compass V2 transfer requires a numeric amount");

    const transferAction = action as Action & { direction?: string };
    const compassAction = transferAction.direction === "withdraw" ? "WITHDRAW" : "DEPOSIT";

    const txs: BuiltTransaction[] = [];
    const accountTx = await ensureAccount("earn", ctx, sdk);
    if (accountTx) txs.push(accountTx);

    const response = await sdk.earn.earnTransfer({
      owner: ctx.walletAddress,
      chain,
      token: action.asset,
      amount: amount.toString(),
      action: compassAction,
    });

    txs.push(...extractTransactions(response, `Compass V2 transfer ${action.asset} (${compassAction})`));
    return txs;
  }

  // --- Credit handlers ---

  async function handleCreditTransfer(
    action: Action,
    ctx: VenueAdapterContext
  ): Promise<VenueBuildResult> {
    const chain = resolveCompassChain(ctx.chainId);
    const amount = toBigInt(action.amount, "Compass V2 credit transfer requires a numeric amount");
    const compassAction = action.type === "supply_collateral" ? "DEPOSIT" : "WITHDRAW";

    const txs: BuiltTransaction[] = [];
    const accountTx = await ensureAccount("credit", ctx, sdk);
    if (accountTx) txs.push(accountTx);

    const response = await sdk.credit.creditTransfer({
      owner: ctx.walletAddress,
      chain,
      token: action.asset,
      amount: amount.toString(),
      action: compassAction,
    });

    txs.push(...extractTransactions(response, `Compass V2 ${action.type} ${action.asset}`));
    return txs;
  }

  async function handleCreditBorrow(
    action: Action,
    ctx: VenueAdapterContext
  ): Promise<VenueBuildResult> {
    const chain = resolveCompassChain(ctx.chainId);
    const amount = toBigInt(action.amount, "Compass V2 borrow requires a numeric amount");

    const borrowAction = action as Action & {
      collateral?: string;
      collateralAmount?: unknown;
      interestRateMode?: string;
    };

    const txs: BuiltTransaction[] = [];
    const accountTx = await ensureAccount("credit", ctx, sdk);
    if (accountTx) txs.push(accountTx);

    const slippage = action.constraints?.maxSlippageBps
      ? action.constraints.maxSlippageBps / 100
      : undefined;

    const response = await sdk.credit.creditBorrow({
      owner: ctx.walletAddress,
      chain,
      borrow_token: action.asset,
      borrow_amount: amount.toString(),
      collateral_token: borrowAction.collateral ?? action.asset,
      token_in: borrowAction.collateral ?? action.asset,
      interest_rate_mode: borrowAction.interestRateMode ?? "VARIABLE",
      ...(slippage !== undefined && { slippage }),
    });

    txs.push(...extractTransactions(response, `Compass V2 borrow ${action.asset}`));
    return txs;
  }

  async function handleCreditRepay(
    action: Action,
    ctx: VenueAdapterContext
  ): Promise<VenueBuildResult> {
    const chain = resolveCompassChain(ctx.chainId);
    const amount = toBigInt(action.amount, "Compass V2 repay requires a numeric amount");

    const repayAction = action as Action & {
      interestRateMode?: string;
      withdrawToken?: string;
      withdrawAmount?: unknown;
    };

    const txs: BuiltTransaction[] = [];
    const accountTx = await ensureAccount("credit", ctx, sdk);
    if (accountTx) txs.push(accountTx);

    const response = await sdk.credit.creditRepay({
      owner: ctx.walletAddress,
      chain,
      repay_token: action.asset,
      repay_amount: amount.toString(),
      interest_rate_mode: repayAction.interestRateMode ?? "VARIABLE",
    });

    txs.push(...extractTransactions(response, `Compass V2 repay ${action.asset}`));
    return txs;
  }

  // --- Bridge handler ---

  async function handleBridge(
    action: Action,
    ctx: VenueAdapterContext
  ): Promise<VenueBuildResult> {
    if (action.asset?.toUpperCase() !== "USDC") {
      throw new Error("Compass V2 bridge only supports USDC (CCTP)");
    }

    const chain = resolveCompassChain(ctx.chainId);
    const amount = toBigInt(action.amount, "Compass V2 bridge requires a numeric amount");

    if (typeof action.toChain !== "number") {
      throw new Error("Compass V2 bridge requires numeric toChain");
    }
    const destinationChain = resolveCompassChain(action.toChain);

    const response = await sdk.bridge.cctpBurn({
      owner: ctx.walletAddress,
      chain,
      destination_chain: destinationChain,
      amount: amount.toString(),
    });

    return extractTransactions(
      response,
      `Compass V2 bridge USDC ${chain} → ${destinationChain}`
    );
  }

  // --- Handoff status for bridge lifecycle ---

  const resolveHandoffStatus: NonNullable<VenueAdapter["resolveHandoffStatus"]> = async (input) => {
    const reference = input.reference ?? input.originTxHash;
    if (!reference) {
      return { status: "pending" as const };
    }

    try {
      const destinationChain = input.destinationChainId
        ? resolveCompassChain(input.destinationChainId)
        : undefined;

      if (destinationChain) {
        await sdk.bridge.cctpMint({
          chain: destinationChain,
          burn_tx_hash: reference,
        });
        return { status: "settled" as const, reference };
      }
    } catch {
      // Mint not ready yet or failed — treat as pending
    }

    return { status: "pending" as const, reference };
  };

  // --- Main buildAction ---

  return {
    meta,
    async buildAction(action: Action, ctx: VenueAdapterContext): Promise<VenueBuildResult> {
      switch (action.type) {
        // Earn
        case "lend":
        case "withdraw":
          return handleEarnManage(action, ctx);
        case "swap":
          return handleEarnSwap(action, ctx);
        case "transfer":
          return handleEarnTransfer(action, ctx);

        // Credit
        case "supply_collateral":
        case "withdraw_collateral":
          return handleCreditTransfer(action, ctx);
        case "borrow":
          return handleCreditBorrow(action, ctx);
        case "repay":
          return handleCreditRepay(action, ctx);

        // Bridge
        case "bridge":
          return handleBridge(action, ctx);

        // Traditional Investing (preview — real execution in executeAction)
        case "custom":
          return {
            tx: { to: zeroAddress, data: "0x" as `0x${string}`, value: 0n },
            description: `Compass V2 custom action: ${(action as any).op}`,
            action,
          };

        default:
          throw new Error(
            `Compass V2: unsupported action type "${action.type}". Supported: ${meta.actions.join(", ")}`
          );
      }
    },
    async executeAction(action: Action, ctx: VenueAdapterContext) {
      // Stub — implemented in Task 7 (Traditional Investing)
      throw new Error("Compass V2: executeAction not yet implemented");
    },
    bridgeLifecycle: { resolveHandoffStatus },
    resolveHandoffStatus,
  };
}

export const compassV2Adapter = createCompassV2Adapter();
```

### Step 5: Verify it compiles

Run: `cd packages/venues && npx tsc --noEmit src/adapters/compass-v2.ts`

Fix any type errors. The SDK types may not match exactly — adjust `extractTransaction` and handler call signatures based on the actual SDK types.

### Step 6: Commit

```bash
git add packages/venues/package.json bun.lockb packages/venues/src/adapters/compass-v2.ts
git commit -m "feat(venues): scaffold compass_v2 adapter with SDK, chain map, account management"
```

---

## Task 2: Write Tests

Tests come before iterating on the implementation — this ensures we know what "done" looks like.

**Files:**
- Create: `packages/venues/src/adapters/compass-v2.test.ts`

### Step 1: Create the test file

Create `packages/venues/src/adapters/compass-v2.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import type {
  Action,
  Address,
  Provider,
  VenueAdapterContext,
} from "@grimoirelabs/core";
import { createCompassV2Adapter } from "./compass-v2.js";

// --- Mock SDK factory ---

function createMockSdk() {
  const calls: Array<{ namespace: string; method: string; args: unknown }> = [];
  const mockTxResponse = {
    unsigned_tx: {
      to: "0x0000000000000000000000000000000000000042",
      data: "0xdeadbeef",
      value: "0",
    },
  };
  const mockCreateAccountResponse = {
    unsigned_tx: {
      to: "0x0000000000000000000000000000000000000099",
      data: "0xaccount",
      value: "0",
    },
  };
  const mockTiResponse = {
    id: "ti-123",
    status: "submitted",
    reference: "0xti-ref",
  };

  return {
    calls,
    sdk: {
      earn: {
        earnBalances: async (args: unknown) => {
          calls.push({ namespace: "earn", method: "earnBalances", args });
          throw new Error("404"); // simulate no account
        },
        earnCreateAccount: async (args: unknown) => {
          calls.push({ namespace: "earn", method: "earnCreateAccount", args });
          return mockCreateAccountResponse;
        },
        earnManage: async (args: unknown) => {
          calls.push({ namespace: "earn", method: "earnManage", args });
          return mockTxResponse;
        },
        earnSwap: async (args: unknown) => {
          calls.push({ namespace: "earn", method: "earnSwap", args });
          return mockTxResponse;
        },
        earnTransfer: async (args: unknown) => {
          calls.push({ namespace: "earn", method: "earnTransfer", args });
          return mockTxResponse;
        },
      },
      credit: {
        creditPositions: async (args: unknown) => {
          calls.push({ namespace: "credit", method: "creditPositions", args });
          throw new Error("404"); // simulate no account
        },
        creditCreateAccount: async (args: unknown) => {
          calls.push({ namespace: "credit", method: "creditCreateAccount", args });
          return mockCreateAccountResponse;
        },
        creditTransfer: async (args: unknown) => {
          calls.push({ namespace: "credit", method: "creditTransfer", args });
          return mockTxResponse;
        },
        creditBorrow: async (args: unknown) => {
          calls.push({ namespace: "credit", method: "creditBorrow", args });
          return mockTxResponse;
        },
        creditRepay: async (args: unknown) => {
          calls.push({ namespace: "credit", method: "creditRepay", args });
          return mockTxResponse;
        },
      },
      bridge: {
        cctpBurn: async (args: unknown) => {
          calls.push({ namespace: "bridge", method: "cctpBurn", args });
          return mockTxResponse;
        },
        cctpMint: async (args: unknown) => {
          calls.push({ namespace: "bridge", method: "cctpMint", args });
          return mockTxResponse;
        },
      },
      traditionalInvesting: {
        traditionalInvestingMarketOrder: async (args: unknown) => {
          calls.push({ namespace: "ti", method: "traditionalInvestingMarketOrder", args });
          return mockTiResponse;
        },
        traditionalInvestingLimitOrder: async (args: unknown) => {
          calls.push({ namespace: "ti", method: "traditionalInvestingLimitOrder", args });
          return mockTiResponse;
        },
        traditionalInvestingCancelOrder: async (args: unknown) => {
          calls.push({ namespace: "ti", method: "traditionalInvestingCancelOrder", args });
          return mockTiResponse;
        },
        traditionalInvestingDeposit: async (args: unknown) => {
          calls.push({ namespace: "ti", method: "traditionalInvestingDeposit", args });
          return mockTiResponse;
        },
        traditionalInvestingWithdraw: async (args: unknown) => {
          calls.push({ namespace: "ti", method: "traditionalInvestingWithdraw", args });
          return mockTiResponse;
        },
        traditionalInvestingEnableUnifiedAccount: async (args: unknown) => {
          calls.push({ namespace: "ti", method: "traditionalInvestingEnableUnifiedAccount", args });
          return {};
        },
        traditionalInvestingApproveBuilderFee: async (args: unknown) => {
          calls.push({ namespace: "ti", method: "traditionalInvestingApproveBuilderFee", args });
          return {};
        },
        traditionalInvestingEnsureLeverage: async (args: unknown) => {
          calls.push({ namespace: "ti", method: "traditionalInvestingEnsureLeverage", args });
          return mockTiResponse;
        },
      },
    },
  };
}

// --- Shared test fixtures ---

const ctx: VenueAdapterContext = {
  provider: { chainId: 1 } as unknown as Provider,
  walletAddress: "0x0000000000000000000000000000000000000001" as Address,
  chainId: 1,
};

const amount1 = { kind: "literal" as const, value: 1000000n, type: "int" as const };

// --- Tests ---

describe("Compass V2 adapter", () => {
  // --- Meta ---

  test("meta.name is compass_v2", () => {
    const { sdk } = createMockSdk();
    const adapter = createCompassV2Adapter({ sdk: sdk as any });
    expect(adapter.meta.name).toBe("compass_v2");
  });

  test("meta.supportedChains contains expected chains", () => {
    const { sdk } = createMockSdk();
    const adapter = createCompassV2Adapter({ sdk: sdk as any });
    expect(adapter.meta.supportedChains).toContain(1);
    expect(adapter.meta.supportedChains).toContain(8453);
    expect(adapter.meta.supportedChains).toContain(42161);
  });

  test("meta.actions lists all supported types", () => {
    const { sdk } = createMockSdk();
    const adapter = createCompassV2Adapter({ sdk: sdk as any });
    expect(adapter.meta.actions).toEqual(
      expect.arrayContaining([
        "lend", "withdraw", "swap", "transfer",
        "supply_collateral", "withdraw_collateral", "borrow", "repay",
        "bridge", "custom",
      ])
    );
  });

  // --- Account auto-management ---

  test("first earn action creates account, second skips", async () => {
    const { sdk, calls } = createMockSdk();
    // Override to succeed on second call (account exists after creation)
    let balanceCalled = 0;
    sdk.earn.earnBalances = async (args: unknown) => {
      balanceCalled++;
      if (balanceCalled === 1) throw new Error("404");
      return {} as any;
    };

    const adapter = createCompassV2Adapter({ sdk: sdk as any });
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    const lendAction: Action = {
      type: "lend",
      venue: "compass_v2",
      asset: "USDC",
      amount: amount1,
    };

    // First call — should create account
    const result1 = await adapter.buildAction(lendAction, ctx);
    const built1 = Array.isArray(result1) ? result1 : [result1];
    expect(built1.length).toBeGreaterThanOrEqual(2); // create_account + lend tx
    expect(built1[0]?.description).toContain("create");

    // Second call — should skip account creation (cached)
    const result2 = await adapter.buildAction(lendAction, ctx);
    const built2 = Array.isArray(result2) ? result2 : [result2];
    expect(built2.length).toBe(1); // just the lend tx
  });

  test("earn and credit accounts are independent", async () => {
    const { sdk, calls } = createMockSdk();
    const adapter = createCompassV2Adapter({ sdk: sdk as any });
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    const lendAction: Action = {
      type: "lend",
      venue: "compass_v2",
      asset: "USDC",
      amount: amount1,
    };
    const supplyAction: Action = {
      type: "supply_collateral",
      venue: "compass_v2",
      asset: "USDC",
      amount: amount1,
    };

    await adapter.buildAction(lendAction, ctx);
    await adapter.buildAction(supplyAction, ctx);

    const createCalls = calls.filter((c) => c.method.includes("CreateAccount"));
    expect(createCalls).toHaveLength(2);
    expect(createCalls[0]?.namespace).toBe("earn");
    expect(createCalls[1]?.namespace).toBe("credit");
  });

  // --- Earn actions ---

  test("lend calls earnManage with DEPOSIT", async () => {
    const { sdk, calls } = createMockSdk();
    const adapter = createCompassV2Adapter({ sdk: sdk as any });
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    const action: Action = {
      type: "lend",
      venue: "compass_v2",
      asset: "USDC",
      amount: amount1,
    };

    await adapter.buildAction(action, ctx);

    const manageCalls = calls.filter((c) => c.method === "earnManage");
    expect(manageCalls).toHaveLength(1);
    expect((manageCalls[0]?.args as any).action).toBe("DEPOSIT");
  });

  test("lend with vault uses VAULT type", async () => {
    const { sdk, calls } = createMockSdk();
    const adapter = createCompassV2Adapter({ sdk: sdk as any });
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    const action: Action = {
      type: "lend",
      venue: "compass_v2",
      asset: "USDC",
      amount: amount1,
    };

    const vaultCtx = {
      ...ctx,
      vault: "0x1234567890abcdef1234567890abcdef12345678" as Address,
    };

    await adapter.buildAction(action, vaultCtx);

    const manageCalls = calls.filter((c) => c.method === "earnManage");
    expect((manageCalls[0]?.args as any).type).toBe("VAULT");
  });

  test("withdraw calls earnManage with WITHDRAW", async () => {
    const { sdk, calls } = createMockSdk();
    const adapter = createCompassV2Adapter({ sdk: sdk as any });
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    const action: Action = {
      type: "withdraw",
      venue: "compass_v2",
      asset: "USDC",
      amount: amount1,
    };

    await adapter.buildAction(action, ctx);

    const manageCalls = calls.filter((c) => c.method === "earnManage");
    expect(manageCalls).toHaveLength(1);
    expect((manageCalls[0]?.args as any).action).toBe("WITHDRAW");
  });

  test("swap calls earnSwap with correct token mapping", async () => {
    const { sdk, calls } = createMockSdk();
    const adapter = createCompassV2Adapter({ sdk: sdk as any });
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    const action = {
      type: "swap",
      venue: "compass_v2",
      asset: "USDC",
      assetIn: "USDC",
      assetOut: "WETH",
      amount: amount1,
      constraints: { maxSlippageBps: 50 },
    } as unknown as Action;

    await adapter.buildAction(action, ctx);

    const swapCalls = calls.filter((c) => c.method === "earnSwap");
    expect(swapCalls).toHaveLength(1);
    expect((swapCalls[0]?.args as any).token_in).toBe("USDC");
    expect((swapCalls[0]?.args as any).token_out).toBe("WETH");
    expect((swapCalls[0]?.args as any).slippage).toBe(0.5);
  });

  test("transfer calls earnTransfer with correct direction", async () => {
    const { sdk, calls } = createMockSdk();
    const adapter = createCompassV2Adapter({ sdk: sdk as any });
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    const action = {
      type: "transfer",
      venue: "compass_v2",
      asset: "USDC",
      amount: amount1,
      direction: "withdraw",
    } as unknown as Action;

    await adapter.buildAction(action, ctx);

    const transferCalls = calls.filter((c) => c.method === "earnTransfer");
    expect(transferCalls).toHaveLength(1);
    expect((transferCalls[0]?.args as any).action).toBe("WITHDRAW");
  });

  // --- Credit actions ---

  test("supply_collateral calls creditTransfer with DEPOSIT", async () => {
    const { sdk, calls } = createMockSdk();
    const adapter = createCompassV2Adapter({ sdk: sdk as any });
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    const action: Action = {
      type: "supply_collateral",
      venue: "compass_v2",
      asset: "WETH",
      amount: amount1,
    };

    await adapter.buildAction(action, ctx);

    const transferCalls = calls.filter((c) => c.method === "creditTransfer");
    expect(transferCalls).toHaveLength(1);
    expect((transferCalls[0]?.args as any).action).toBe("DEPOSIT");
  });

  test("withdraw_collateral calls creditTransfer with WITHDRAW", async () => {
    const { sdk, calls } = createMockSdk();
    const adapter = createCompassV2Adapter({ sdk: sdk as any });
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    const action: Action = {
      type: "withdraw_collateral",
      venue: "compass_v2",
      asset: "WETH",
      amount: amount1,
    };

    await adapter.buildAction(action, ctx);

    const transferCalls = calls.filter((c) => c.method === "creditTransfer");
    expect(transferCalls).toHaveLength(1);
    expect((transferCalls[0]?.args as any).action).toBe("WITHDRAW");
  });

  test("borrow calls creditBorrow with correct params", async () => {
    const { sdk, calls } = createMockSdk();
    const adapter = createCompassV2Adapter({ sdk: sdk as any });
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    const action = {
      type: "borrow",
      venue: "compass_v2",
      asset: "USDC",
      amount: amount1,
      collateral: "WETH",
    } as unknown as Action;

    await adapter.buildAction(action, ctx);

    const borrowCalls = calls.filter((c) => c.method === "creditBorrow");
    expect(borrowCalls).toHaveLength(1);
    expect((borrowCalls[0]?.args as any).borrow_token).toBe("USDC");
    expect((borrowCalls[0]?.args as any).collateral_token).toBe("WETH");
    expect((borrowCalls[0]?.args as any).interest_rate_mode).toBe("VARIABLE");
  });

  test("repay calls creditRepay with correct params", async () => {
    const { sdk, calls } = createMockSdk();
    const adapter = createCompassV2Adapter({ sdk: sdk as any });
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    const action: Action = {
      type: "repay",
      venue: "compass_v2",
      asset: "USDC",
      amount: amount1,
    };

    await adapter.buildAction(action, ctx);

    const repayCalls = calls.filter((c) => c.method === "creditRepay");
    expect(repayCalls).toHaveLength(1);
    expect((repayCalls[0]?.args as any).repay_token).toBe("USDC");
    expect((repayCalls[0]?.args as any).interest_rate_mode).toBe("VARIABLE");
  });

  // --- Bridge ---

  test("bridge with USDC calls cctpBurn", async () => {
    const { sdk, calls } = createMockSdk();
    const adapter = createCompassV2Adapter({ sdk: sdk as any });
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    const action = {
      type: "bridge",
      venue: "compass_v2",
      asset: "USDC",
      amount: amount1,
      toChain: 8453,
    } as unknown as Action;

    await adapter.buildAction(action, ctx);

    const burnCalls = calls.filter((c) => c.method === "cctpBurn");
    expect(burnCalls).toHaveLength(1);
    expect((burnCalls[0]?.args as any).chain).toBe("ethereum");
    expect((burnCalls[0]?.args as any).destination_chain).toBe("base");
  });

  test("bridge with non-USDC throws", async () => {
    const { sdk } = createMockSdk();
    const adapter = createCompassV2Adapter({ sdk: sdk as any });
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    const action = {
      type: "bridge",
      venue: "compass_v2",
      asset: "WETH",
      amount: amount1,
      toChain: 8453,
    } as unknown as Action;

    await expect(adapter.buildAction(action, ctx)).rejects.toThrow("USDC");
  });

  // --- Error cases ---

  test("unsupported chain throws descriptive error", async () => {
    const { sdk } = createMockSdk();
    const adapter = createCompassV2Adapter({ sdk: sdk as any });
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    const action: Action = {
      type: "lend",
      venue: "compass_v2",
      asset: "USDC",
      amount: amount1,
    };

    const badCtx = { ...ctx, chainId: 999 };

    await expect(adapter.buildAction(action, badCtx)).rejects.toThrow("unsupported chain 999");
  });

  test("unsupported action type throws descriptive error", async () => {
    const { sdk } = createMockSdk();
    const adapter = createCompassV2Adapter({ sdk: sdk as any });
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    const action = {
      type: "unknown_action",
      venue: "compass_v2",
      asset: "USDC",
      amount: amount1,
    } as unknown as Action;

    await expect(adapter.buildAction(action, ctx)).rejects.toThrow("unsupported action type");
  });

  test("missing API key without SDK throws clear error", () => {
    const origKey = process.env.COMPASS_API_KEY;
    delete process.env.COMPASS_API_KEY;
    try {
      expect(() => createCompassV2Adapter()).toThrow("COMPASS_API_KEY");
    } finally {
      if (origKey) process.env.COMPASS_API_KEY = origKey;
    }
  });
});
```

### Step 2: Run tests to see initial results

Run: `bun test packages/venues/src/adapters/compass-v2.test.ts`

Some tests may fail if the adapter's SDK method signatures don't match the mock — this is expected. Use the failures to iterate on the adapter code until all tests pass.

### Step 3: Iterate on adapter until tests pass

Fix any mismatches between the mock SDK's expected method signatures and the actual adapter code. Common issues:
- SDK method names might differ (check actual SDK exports)
- Transaction extraction shape might differ
- Amount conversion may need adjustment

### Step 4: Commit

```bash
git add packages/venues/src/adapters/compass-v2.test.ts
git commit -m "test(venues): add compass_v2 adapter tests with mock SDK"
```

---

## Task 3: CLI Entry Point

**Files:**
- Create: `packages/venues/src/cli/compass.ts`

### Step 1: Create the CLI file

Create `packages/venues/src/cli/compass.ts`:

```typescript
#!/usr/bin/env node

import { Cli, z } from "incur";
import { CompassApiSDK } from "@compass-labs/api-sdk";

const SUPPORTED_CHAINS: Record<number, string> = {
  1: "Ethereum",
  8453: "Base",
  42161: "Arbitrum",
};

const COMPASS_CHAIN_MAP: Record<number, string> = {
  1: "ethereum",
  8453: "base",
  42161: "arbitrum",
};

function getSDK(): CompassApiSDK {
  const apiKey = process.env.COMPASS_API_KEY;
  if (!apiKey) throw new Error("COMPASS_API_KEY environment variable is required");
  return new CompassApiSDK({ apiKey });
}

function serializeBigInts(obj: unknown): unknown {
  if (typeof obj === "bigint") return obj.toString();
  if (Array.isArray(obj)) return obj.map(serializeBigInts);
  if (obj && typeof obj === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = serializeBigInts(v);
    }
    return out;
  }
  return obj;
}

const cli = Cli.create("grimoire-compass", {
  description: "Compass Labs V2 — Earn, Credit, Bridge, and Traditional Investing operations",
  sync: {
    suggestions: [
      "list Aave earn markets on Ethereum",
      "show ERC-4626 vaults on Base",
      "check earn positions for an address",
      "check credit positions for an address",
      "list Traditional Investing opportunities",
      "show TI positions for an address",
    ],
  },
})
  .use(async (c, next) => {
    const start = performance.now();
    await next();
    if (!c.agent) console.error(`Done in ${(performance.now() - start).toFixed(0)}ms`);
  })
  .command("info", {
    description: "Show adapter info and supported chains",
    run(c) {
      return c.ok(
        {
          name: "compass_v2",
          actions: [
            "lend", "withdraw", "swap", "transfer",
            "supply_collateral", "withdraw_collateral", "borrow", "repay",
            "bridge", "custom",
          ],
          supportedChains: SUPPORTED_CHAINS,
          products: ["earn", "credit", "bridge", "traditional_investing"],
        },
        { cta: { commands: ["aave-markets --chain 1", "vaults --chain 1"] } }
      );
    },
  })
  .command("aave-markets", {
    description: "List Aave V3 earn markets",
    options: z.object({
      chain: z.coerce.number().describe("Chain ID (1, 8453, 42161)"),
    }),
    async run(c) {
      const sdk = getSDK();
      const chain = COMPASS_CHAIN_MAP[c.options.chain];
      if (!chain) throw new Error(`Unsupported chain ${c.options.chain}`);
      const result = await sdk.earn.earnAaveMarkets({ chain });
      return c.ok(serializeBigInts(result), {
        cta: { commands: ["vaults --chain " + c.options.chain] },
      });
    },
  })
  .command("vaults", {
    description: "List ERC-4626 yield vaults",
    options: z.object({
      chain: z.coerce.number().describe("Chain ID (1, 8453, 42161)"),
    }),
    async run(c) {
      const sdk = getSDK();
      const chain = COMPASS_CHAIN_MAP[c.options.chain];
      if (!chain) throw new Error(`Unsupported chain ${c.options.chain}`);
      const result = await sdk.earn.earnVaults({ chain });
      return c.ok(serializeBigInts(result));
    },
  })
  .command("positions", {
    description: "Show earn positions for an address",
    options: z.object({
      owner: z.string().describe("Wallet address (0x...)"),
      chain: z.coerce.number().describe("Chain ID"),
    }),
    async run(c) {
      const sdk = getSDK();
      const chain = COMPASS_CHAIN_MAP[c.options.chain];
      if (!chain) throw new Error(`Unsupported chain ${c.options.chain}`);
      const result = await sdk.earn.earnPositions({
        owner: c.options.owner,
        chain,
      });
      return c.ok(serializeBigInts(result));
    },
  })
  .command("balances", {
    description: "Show earn account balances",
    options: z.object({
      owner: z.string().describe("Wallet address (0x...)"),
      chain: z.coerce.number().describe("Chain ID"),
    }),
    async run(c) {
      const sdk = getSDK();
      const chain = COMPASS_CHAIN_MAP[c.options.chain];
      if (!chain) throw new Error(`Unsupported chain ${c.options.chain}`);
      const result = await sdk.earn.earnBalances({
        owner: c.options.owner,
        chain,
      });
      return c.ok(serializeBigInts(result));
    },
  })
  .command("credit-positions", {
    description: "Show credit positions for an address",
    options: z.object({
      owner: z.string().describe("Wallet address (0x...)"),
      chain: z.coerce.number().describe("Chain ID"),
    }),
    async run(c) {
      const sdk = getSDK();
      const chain = COMPASS_CHAIN_MAP[c.options.chain];
      if (!chain) throw new Error(`Unsupported chain ${c.options.chain}`);
      const result = await sdk.credit.creditPositions({
        owner: c.options.owner,
        chain,
      });
      return c.ok(serializeBigInts(result));
    },
  })
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
  });

cli.serve();
```

### Step 2: Verify it parses

Run: `bun packages/venues/src/cli/compass.ts --help`
Expected: Shows CLI help with all commands listed.

### Step 3: Commit

```bash
git add packages/venues/src/cli/compass.ts
git commit -m "feat(venues): add compass_v2 CLI entry point"
```

---

## Task 4: Register & Wire Up

**Files:**
- Modify: `packages/venues/src/index.ts`
- Modify: `packages/venues/src/shared/discovery.ts`
- Modify: `packages/venues/package.json`

### Step 1: Update index.ts

Add import and registration in `packages/venues/src/index.ts`:

```typescript
// Add import (after existing adapter imports):
import { compassV2Adapter, createCompassV2Adapter } from "./adapters/compass-v2.js";

// Add to adapters array:
// compassV2Adapter,   (add at end of array)

// Add to named exports:
// compassV2Adapter,
// createCompassV2Adapter,
```

### Step 2: Update discovery.ts

Add to `BUILTIN_ALIAS_MAP`:
```typescript
compass: ["compass-v2", "compass_v2"],
```

Add to `CLI_TO_ADAPTER_MAP`:
```typescript
compass: ["compass-v2"],
```

### Step 3: Update package.json bin

Add to `packages/venues/package.json` `bin` section:
```json
"grimoire-compass": "dist/cli/compass.js"
```

### Step 4: Verify registration

Run: `bun -e "import { adapters } from './packages/venues/src/index.js'; console.log(adapters.map(a => a.meta.name))"`
Expected: List includes `compass_v2`.

### Step 5: Commit

```bash
git add packages/venues/src/index.ts packages/venues/src/shared/discovery.ts packages/venues/package.json
git commit -m "feat(venues): register compass_v2 adapter and wire up CLI"
```

---

## Task 5: Final Verification

### Step 1: Run full test suite

Run: `bun test packages/venues/src/adapters/compass-v2.test.ts`
Expected: All tests pass.

### Step 2: Type check

Run: `cd packages/venues && npx tsc --noEmit`
Expected: No type errors.

### Step 3: Run broader test suite to check nothing is broken

Run: `bun test packages/venues/`
Expected: All existing tests still pass + compass tests pass.

### Step 4: Final commit if any fixups needed

```bash
git add -A
git commit -m "fix(venues): compass_v2 adapter fixups from verification"
```

---

## Task 6: Executor Hybrid Routing

**Files:**
- Modify: `packages/core/src/wallet/executor.ts`

### What

Modify `tryExecuteOffchainAction()` to allow custom actions on adapters that have `executeAction`, even when `executionType !== "offchain"`. This enables the compass_v2 hybrid adapter (EVM for Earn/Credit/Bridge, offchain for Traditional Investing).

### Step 1: Update the guard in `tryExecuteOffchainAction`

In `packages/core/src/wallet/executor.ts` around line 539, change:

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

This is a 3-line change. The logic:
- Pure offchain adapters (like Hyperliquid): all actions go through `executeAction` — unchanged
- Hybrid adapters (like compass_v2): only `custom` actions go through `executeAction`, everything else goes through `buildAction` as before
- Pure EVM adapters: unchanged (they don't have `executeAction`)

### Step 2: Verify existing tests still pass

Run: `bun test packages/core/`
Expected: All existing tests pass. The change is backward-compatible.

### Step 3: Commit

```bash
git add packages/core/src/wallet/executor.ts
git commit -m "feat(core): allow hybrid adapters to route custom actions to executeAction"
```

---

## Task 7: Traditional Investing Handlers

**Files:**
- Modify: `packages/venues/src/adapters/compass-v2.ts`

### Step 1: Add `privateKey` to config and imports

Add to `CompassV2AdapterConfig`:
```typescript
privateKey?: `0x${string}`;
```

Add import:
```typescript
import { privateKeyToAccount } from "viem/accounts";
import { zeroAddress } from "viem";
```

### Step 2: Add TI setup cache and auto-manager

Inside the factory closure:

```typescript
// TI setup cache: "wallet:chainId" → setup complete
const tiSetupCache = new Map<string, boolean>();

async function ensureTradFiSetup(ctx: VenueAdapterContext): Promise<void> {
  const key = `${ctx.walletAddress}:${ctx.chainId}`;
  if (tiSetupCache.get(key)) return;

  const chain = resolveCompassChain(ctx.chainId);

  // Enable unified account
  await sdk.traditionalInvesting.traditionalInvestingEnableUnifiedAccount({
    owner: ctx.walletAddress,
    chain,
  });

  // Approve builder fee
  await sdk.traditionalInvesting.traditionalInvestingApproveBuilderFee({
    owner: ctx.walletAddress,
    chain,
  });

  tiSetupCache.set(key, true);
}
```

### Step 3: Add `case "custom"` to `buildAction` switch

Before the `default:` case:

```typescript
case "custom":
  return {
    tx: { to: zeroAddress, data: "0x", value: 0n },
    description: `Compass V2 custom action: ${(action as any).op}`,
    action,
  };
```

This returns a dummy preview transaction — real execution happens in `executeAction`.

### Step 4: Add `executeAction()` method

Add `executeAction` to the returned adapter object:

```typescript
async executeAction(action: Action, ctx: VenueAdapterContext) {
  if (action.type !== "custom") {
    throw new Error(`Compass V2 executeAction only handles custom actions, got "${action.type}"`);
  }

  if (!config.privateKey) {
    throw new Error("Compass V2: privateKey is required for Traditional Investing actions");
  }

  const customAction = action as CustomAction;
  const chain = resolveCompassChain(ctx.chainId);
  const account = privateKeyToAccount(config.privateKey);
  const args = customAction.args as Record<string, unknown>;

  // Auto-setup on first trade (skip for setup/leverage ops)
  if (!["ti_setup", "ti_set_leverage"].includes(customAction.op)) {
    await ensureTradFiSetup(ctx);
  }

  switch (customAction.op) {
    case "ti_market_order": {
      const result = await sdk.traditionalInvesting.traditionalInvestingMarketOrder({
        owner: ctx.walletAddress, chain, ...args,
      });
      // Sign any EIP-712 payloads
      return signAndSubmit(result, account, customAction.op);
    }
    case "ti_limit_order": { /* similar pattern */ }
    case "ti_cancel_order": { /* similar pattern */ }
    case "ti_deposit": { /* similar pattern */ }
    case "ti_withdraw": { /* similar pattern */ }
    case "ti_setup": {
      await ensureTradFiSetup(ctx);
      return { id: "setup", status: "completed", reference: "setup" };
    }
    case "ti_set_leverage": {
      const result = await sdk.traditionalInvesting.traditionalInvestingEnsureLeverage({
        owner: ctx.walletAddress, chain, ...args,
      });
      return signAndSubmit(result, account, customAction.op);
    }
    default:
      throw new Error(`Compass V2: unknown TI op "${customAction.op}"`);
  }
}
```

### Step 5: Update meta

Update `meta.actions` to include `"custom"`:
```typescript
actions: [
  "lend", "withdraw", "swap", "transfer",
  "supply_collateral", "withdraw_collateral", "borrow", "repay",
  "bridge", "custom",
],
```

Update `meta.description`:
```typescript
description: "Compass Labs V2 multi-product DeFi adapter (Earn, Credit, Bridge, Traditional Investing)",
```

### Step 6: Commit

```bash
git add packages/venues/src/adapters/compass-v2.ts
git commit -m "feat(venues): add Traditional Investing handlers to compass_v2 adapter"
```

---

## Task 8: TI Tests

**Files:**
- Modify: `packages/venues/src/adapters/compass-v2.test.ts`

### Step 1: Extend mock SDK with TI namespace

Add to `createMockSdk()`:

```typescript
traditionalInvesting: {
  traditionalInvestingMarketOrder: async (args) => { calls.push(...); return mockTiResponse; },
  traditionalInvestingLimitOrder: async (args) => { ... },
  traditionalInvestingCancelOrder: async (args) => { ... },
  traditionalInvestingDeposit: async (args) => { ... },
  traditionalInvestingWithdraw: async (args) => { ... },
  traditionalInvestingEnableUnifiedAccount: async (args) => { ... },
  traditionalInvestingApproveBuilderFee: async (args) => { ... },
  traditionalInvestingEnsureLeverage: async (args) => { ... },
},
```

### Step 2: Add TI test cases

```typescript
describe("Traditional Investing", () => {
  test("custom action in buildAction returns dummy preview tx", async () => { ... });
  test("ti_market_order via executeAction calls SDK and returns result", async () => { ... });
  test("ti_limit_order via executeAction calls SDK and returns result", async () => { ... });
  test("first TI trade triggers auto-setup", async () => { ... });
  test("second TI trade skips setup (cached)", async () => { ... });
  test("ti_setup explicitly triggers setup", async () => { ... });
  test("ti_set_leverage calls ensureLeverage", async () => { ... });
  test("missing privateKey throws clear error", async () => { ... });
  test("unknown TI op throws", async () => { ... });
});
```

### Step 3: Verify tests pass

Run: `bun test packages/venues/src/adapters/compass-v2.test.ts`

### Step 4: Commit

```bash
git add packages/venues/src/adapters/compass-v2.test.ts
git commit -m "test(venues): add Traditional Investing test cases for compass_v2"
```

---

## Task 9: TI CLI Commands

**Files:**
- Modify: `packages/venues/src/cli/compass.ts`

### Step 1: Add `ti-opportunities` command

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

### Step 2: Add `ti-positions` command

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

### Step 3: Update CLI description

```typescript
description: "Compass Labs V2 — Earn, Credit, Bridge, and Traditional Investing operations",
```

### Step 4: Add suggestions

```typescript
suggestions: [
  // ... existing suggestions ...
  "list Traditional Investing opportunities",
  "show TI positions for an address",
],
```

### Step 5: Commit

```bash
git add packages/venues/src/cli/compass.ts
git commit -m "feat(venues): add Traditional Investing CLI commands to compass_v2"
```

---

## Execution Order & Dependencies

```
Tasks 1-5 (existing EVM) ──→ Task 6 (executor hybrid routing) ──→ Task 7 (TI handlers) ──→ Task 8 (TI tests) ──→ Task 9 (TI CLI)
```

Tasks 1-5 cover the EVM products (Earn, Credit, Bridge) and are unchanged. Tasks 6-9 add Traditional Investing on top:

- **Task 6** (executor): Must come first — enables hybrid adapter routing in the core executor
- **Task 7** (TI handlers): Depends on Task 6 — implements the actual TI logic in the adapter
- **Task 8** (TI tests): Depends on Task 7 — validates TI behavior
- **Task 9** (TI CLI): Can be done in parallel with Task 8 — adds data query commands

## Important Notes for the Implementer

1. **SDK types are unknown until installed.** The `@compass-labs/api-sdk` may have different method signatures than what's shown here. After `bun install`, check the actual SDK types with `bun -e "import { CompassApiSDK } from '@compass-labs/api-sdk'; const sdk = new CompassApiSDK({}); console.log(Object.keys(sdk))"` and adjust accordingly.

2. **Account cache is module-scoped.** The `accountCache` Map persists for the adapter's lifetime. This is intentional — it avoids redundant API calls. However, it means tests that check account creation must use a fresh adapter instance per test (the factory creates a new closure each time, but the cache is shared). If this causes flaky tests, move the cache inside the factory closure.

3. **`extractTransaction` is defensive.** The SDK response shape may vary between endpoints. The function checks multiple possible field names (`unsigned_tx`, `unsignedTx`, `transaction`). If none match, it falls back to treating the entire response as a transaction object.

4. **Bridge is USDC-only.** The Compass V2 CCTP bridge only supports USDC. The adapter throws for any other asset. This is by design — Compass may add more bridge protocols later, at which point the SDK will have new methods.

5. **`toBigInt` import.** The shared utility `packages/venues/src/shared/bigint.ts` provides `toBigInt(value, errorMessage)` which handles `Expression` objects, raw bigints, strings, and numbers. Use it for all amount conversions.
