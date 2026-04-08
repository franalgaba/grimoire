import type {
  Action,
  Address,
  BridgeLifecycleStatusInput,
  BuiltTransaction,
  CustomAction,
  OffchainExecutionResult,
  VenueAdapter,
  VenueAdapterContext,
  VenueBuildResult,
} from "@grimoirelabs/core";

/** Narrowed action types that include the constraints intersection from the Action union. */
type NarrowAction<T extends Action["type"]> = Extract<Action, { type: T }>;

import { CompassApiSDK } from "@compass-labs/api-sdk";
import type { AaveVenue, VaultVenue } from "@compass-labs/api-sdk/models/components";
import { zeroAddress } from "viem";
import { toBigInt } from "../shared/bigint.js";

// --- Chain mapping ---

/**
 * The set of chain names supported by the Compass V2 SDK.
 * Each endpoint may use its own enum type, but the string values are the same.
 */
type CompassChain = "ethereum" | "base" | "arbitrum";

const COMPASS_CHAIN_MAP: Record<number, CompassChain> = {
  1: "ethereum",
  8453: "base",
  42161: "arbitrum",
} as const;

function resolveCompassChain(chainId: number): CompassChain {
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

// --- Transaction extraction ---

function extractTransaction(
  response: unknown,
  action: Action,
  description: string
): BuiltTransaction {
  const res = response as Record<string, unknown>;
  const tx = (res.unsigned_tx ?? res.unsignedTx ?? res.transaction ?? res) as Record<
    string,
    unknown
  >;
  return {
    tx: {
      to: (tx.to ?? tx.To) as Address,
      data: (tx.data ?? tx.Data ?? "0x") as string as `0x${string}`,
      value: BigInt((tx.value ?? tx.Value ?? 0) as string | number),
    },
    description,
    action,
  };
}

function extractTransactions(
  response: unknown,
  action: Action,
  description: string
): BuiltTransaction[] {
  const res = response as Record<string, unknown>;
  const txs = (res.unsigned_txs ?? res.unsignedTxs ?? res.transactions) as unknown[] | undefined;
  if (Array.isArray(txs)) {
    return txs.map((tx, i) =>
      extractTransaction(tx, action, `${description} (${i + 1}/${txs.length})`)
    );
  }
  return [extractTransaction(response, action, description)];
}

// --- Config & factory ---

export interface CompassV2AdapterConfig {
  apiKey?: string;
  sdk?: CompassApiSDK;
  supportedChains?: number[];
  gasSponsorship?: boolean;
  /** Required for Traditional Investing (EIP-712 signing) */
  privateKey?: `0x${string}`;
}

export function createCompassV2Adapter(config: CompassV2AdapterConfig = {}): VenueAdapter {
  const apiKey = config.apiKey ?? process.env.COMPASS_API_KEY;
  if (!apiKey && !config.sdk) {
    throw new Error("Compass V2: COMPASS_API_KEY env var or sdk instance is required");
  }

  const sdk = config.sdk ?? new CompassApiSDK({ apiKeyAuth: apiKey as string });
  const supportedChains = config.supportedChains ?? [1, 8453, 42161];

  // --- Caches (per adapter instance for test isolation) ---

  /** Cache key: "wallet:chainId:product" -> account exists */
  const accountCache = new Map<string, boolean>();

  function accountCacheKey(wallet: string, chainId: number, product: ProductType): string {
    return `${wallet}:${chainId}:${product}`;
  }

  async function ensureAccount(
    product: ProductType,
    ctx: VenueAdapterContext
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
        await sdk.credit.creditPositions({
          owner: ctx.walletAddress,
          chain,
        });
      }
      accountCache.set(key, true);
      return null;
    } catch {
      // Account doesn't exist -- create it
    }

    const response =
      product === "earn"
        ? await sdk.earn.earnCreateAccount({
            owner: ctx.walletAddress,
            chain,
            sender: ctx.walletAddress,
          })
        : await sdk.credit.creditCreateAccount({
            owner: ctx.walletAddress,
            chain,
            sender: ctx.walletAddress,
          });

    accountCache.set(key, true);

    // Synthesize a minimal action for the account-creation tx
    const accountAction: Action = {
      type: product === "earn" ? "lend" : "supply_collateral",
      asset: "ETH",
      amount: 0n,
      venue: "compass_v2",
    } as Action;

    return extractTransaction(response, accountAction, `Compass V2: create ${product} account`);
  }

  /** TI setup cache: "wallet:chainId" -> setup complete */
  const tiSetupCache = new Map<string, boolean>();

  async function ensureTradFiSetup(ctx: VenueAdapterContext): Promise<void> {
    const key = `${ctx.walletAddress}:${ctx.chainId}`;
    if (tiSetupCache.get(key)) return;

    const chain = resolveCompassChain(ctx.chainId);
    const ti = (sdk as unknown as Record<string, unknown>).traditionalInvesting as
      | Record<string, (...args: unknown[]) => Promise<unknown>>
      | undefined;

    if (!ti) {
      throw new Error("Compass V2: Traditional Investing is not available in this SDK version");
    }

    await ti.traditionalInvestingEnableUnifiedAccount({
      owner: ctx.walletAddress,
      chain,
    });
    await ti.traditionalInvestingApproveBuilderFee({
      owner: ctx.walletAddress,
      chain,
    });
    tiSetupCache.set(key, true);
  }

  // --- Meta ---

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
    description:
      "Compass Labs V2 multi-product DeFi adapter (Earn, Credit, Bridge, Traditional Investing)",
  };

  // --- Earn handlers ---

  async function handleEarnManage(
    action: NarrowAction<"lend"> | NarrowAction<"withdraw">,
    ctx: VenueAdapterContext
  ): Promise<VenueBuildResult> {
    const chain = resolveCompassChain(ctx.chainId);
    const amount = toBigInt(action.amount, "Compass V2 earn requires a numeric amount");
    const compassAction = action.type === "lend" ? "DEPOSIT" : "WITHDRAW";

    let venue: AaveVenue | VaultVenue;
    if (ctx.vault) {
      venue = { type: "VAULT", vaultAddress: ctx.vault };
    } else {
      venue = { type: "AAVE", token: action.asset };
    }

    const txs: BuiltTransaction[] = [];

    const accountTx = await ensureAccount("earn", ctx);
    if (accountTx) txs.push(accountTx);

    const response = await sdk.earn.earnManage({
      owner: ctx.walletAddress,
      chain,
      action: compassAction,
      venue,
      amount: amount.toString(),
    });

    txs.push(...extractTransactions(response, action, `Compass V2 ${action.type} ${action.asset}`));
    return txs;
  }

  async function handleEarnSwap(
    action: NarrowAction<"swap">,
    ctx: VenueAdapterContext
  ): Promise<VenueBuildResult> {
    const chain = resolveCompassChain(ctx.chainId);
    const amount = toBigInt(action.amount, "Compass V2 swap requires a numeric amount");

    const slippage = action.constraints?.maxSlippageBps
      ? action.constraints.maxSlippageBps / 100
      : 1;

    const txs: BuiltTransaction[] = [];
    const accountTx = await ensureAccount("earn", ctx);
    if (accountTx) txs.push(accountTx);

    const response = await sdk.earn.earnSwap({
      owner: ctx.walletAddress,
      chain,
      tokenIn: action.assetIn,
      tokenOut: action.assetOut,
      amountIn: amount.toString(),
      slippage,
    });

    txs.push(
      ...extractTransactions(
        response,
        action,
        `Compass V2 swap ${action.assetIn} -> ${action.assetOut}`
      )
    );
    return txs;
  }

  async function handleEarnTransfer(
    action: NarrowAction<"transfer">,
    ctx: VenueAdapterContext
  ): Promise<VenueBuildResult> {
    const chain = resolveCompassChain(ctx.chainId);
    const amount = toBigInt(action.amount, "Compass V2 transfer requires a numeric amount");

    // TransferAction uses "to" field; for earn transfer direction we default to DEPOSIT
    const compassAction = "DEPOSIT" as const;

    const txs: BuiltTransaction[] = [];
    const accountTx = await ensureAccount("earn", ctx);
    if (accountTx) txs.push(accountTx);

    const response = await sdk.earn.earnTransfer({
      owner: ctx.walletAddress,
      chain,
      token: action.asset,
      amount: amount.toString(),
      action: compassAction,
    });

    txs.push(
      ...extractTransactions(
        response,
        action,
        `Compass V2 transfer ${action.asset} (${compassAction})`
      )
    );
    return txs;
  }

  // --- Credit handlers ---

  async function handleCreditTransfer(
    action: NarrowAction<"supply_collateral"> | NarrowAction<"withdraw_collateral">,
    ctx: VenueAdapterContext
  ): Promise<VenueBuildResult> {
    const chain = resolveCompassChain(ctx.chainId);
    const amount = toBigInt(action.amount, "Compass V2 credit transfer requires a numeric amount");
    const compassAction = action.type === "supply_collateral" ? "DEPOSIT" : "WITHDRAW";

    const txs: BuiltTransaction[] = [];
    const accountTx = await ensureAccount("credit", ctx);
    if (accountTx) txs.push(accountTx);

    const response = await sdk.credit.creditTransfer({
      owner: ctx.walletAddress,
      chain,
      token: action.asset,
      amount: amount.toString(),
      action: compassAction,
    });

    txs.push(...extractTransactions(response, action, `Compass V2 ${action.type} ${action.asset}`));
    return txs;
  }

  async function handleCreditBorrow(
    action: NarrowAction<"borrow">,
    ctx: VenueAdapterContext
  ): Promise<VenueBuildResult> {
    const chain = resolveCompassChain(ctx.chainId);
    const amount = toBigInt(action.amount, "Compass V2 borrow requires a numeric amount");

    const txs: BuiltTransaction[] = [];
    const accountTx = await ensureAccount("credit", ctx);
    if (accountTx) txs.push(accountTx);

    const slippage = action.constraints?.maxSlippageBps
      ? action.constraints.maxSlippageBps / 100
      : undefined;

    const response = await sdk.credit.creditBorrow({
      owner: ctx.walletAddress,
      chain,
      borrowToken: action.asset,
      borrowAmount: amount.toString(),
      collateralToken: action.collateral ?? action.asset,
      tokenIn: action.collateral ?? action.asset,
      interestRateMode: "variable",
      ...(slippage !== undefined && { slippage }),
    });

    txs.push(...extractTransactions(response, action, `Compass V2 borrow ${action.asset}`));
    return txs;
  }

  async function handleCreditRepay(
    action: NarrowAction<"repay">,
    ctx: VenueAdapterContext
  ): Promise<VenueBuildResult> {
    const chain = resolveCompassChain(ctx.chainId);
    const amount = toBigInt(action.amount, "Compass V2 repay requires a numeric amount");

    const txs: BuiltTransaction[] = [];
    const accountTx = await ensureAccount("credit", ctx);
    if (accountTx) txs.push(accountTx);

    const response = await sdk.credit.creditRepay({
      owner: ctx.walletAddress,
      chain,
      repayToken: action.asset,
      repayAmount: amount.toString(),
      interestRateMode: "variable",
    });

    txs.push(...extractTransactions(response, action, `Compass V2 repay ${action.asset}`));
    return txs;
  }

  // --- Bridge handler ---

  async function handleBridge(
    action: NarrowAction<"bridge">,
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
      destinationChain,
      amount: amount.toString(),
    });

    return extractTransactions(
      response,
      action,
      `Compass V2 bridge USDC ${chain} -> ${destinationChain}`
    );
  }

  // --- Handoff status for bridge lifecycle ---

  const resolveHandoffStatus: NonNullable<VenueAdapter["resolveHandoffStatus"]> = async (
    input: BridgeLifecycleStatusInput
  ) => {
    const reference = input.reference ?? input.originTxHash;
    if (!reference) {
      return { status: "pending" as const };
    }

    try {
      if (reference) {
        await sdk.bridge.cctpMint({
          bridgeId: reference,
          burnTxHash: reference,
          sender: input.walletAddress ?? zeroAddress,
        });
        return { status: "settled" as const, reference };
      }
    } catch {
      // Mint not ready yet or failed -- treat as pending
    }

    return { status: "pending" as const, reference };
  };

  // --- TI executeAction ---

  async function handleExecuteAction(
    action: Action,
    ctx: VenueAdapterContext
  ): Promise<OffchainExecutionResult> {
    if (action.type !== "custom") {
      throw new Error(`Compass V2 executeAction only handles custom actions, got "${action.type}"`);
    }

    if (!config.privateKey) {
      throw new Error("Compass V2: privateKey is required for Traditional Investing actions");
    }

    const customAction = action as CustomAction;
    const chain = resolveCompassChain(ctx.chainId);
    const ti = (sdk as unknown as Record<string, unknown>).traditionalInvesting as
      | Record<string, (...args: unknown[]) => Promise<unknown>>
      | undefined;

    if (!ti) {
      throw new Error("Compass V2: Traditional Investing is not available in this SDK version");
    }

    const args = (customAction.args ?? {}) as Record<string, unknown>;

    // Auto-setup on first trade (skip for setup/leverage ops)
    if (!["ti_setup", "ti_set_leverage"].includes(customAction.op)) {
      await ensureTradFiSetup(ctx);
    }

    switch (customAction.op) {
      case "ti_market_order": {
        const result = await ti.traditionalInvestingMarketOrder({
          owner: ctx.walletAddress,
          chain,
          ...args,
        });
        return toExecutionResult(result, customAction.op);
      }
      case "ti_limit_order": {
        const result = await ti.traditionalInvestingLimitOrder({
          owner: ctx.walletAddress,
          chain,
          ...args,
        });
        return toExecutionResult(result, customAction.op);
      }
      case "ti_cancel_order": {
        const result = await ti.traditionalInvestingCancelOrder({
          owner: ctx.walletAddress,
          chain,
          ...args,
        });
        return toExecutionResult(result, customAction.op);
      }
      case "ti_deposit": {
        const result = await ti.traditionalInvestingDeposit({
          owner: ctx.walletAddress,
          chain,
          ...args,
        });
        return toExecutionResult(result, customAction.op);
      }
      case "ti_withdraw": {
        const result = await ti.traditionalInvestingWithdraw({
          owner: ctx.walletAddress,
          chain,
          ...args,
        });
        return toExecutionResult(result, customAction.op);
      }
      case "ti_setup": {
        await ensureTradFiSetup(ctx);
        return { id: "setup", status: "completed", reference: "setup" };
      }
      case "ti_set_leverage": {
        const result = await ti.traditionalInvestingEnsureLeverage({
          owner: ctx.walletAddress,
          chain,
          ...args,
        });
        return toExecutionResult(result, customAction.op);
      }
      default:
        throw new Error(`Compass V2: unknown TI op "${customAction.op}"`);
    }
  }

  function toExecutionResult(result: unknown, op: string): OffchainExecutionResult {
    const res = result as Record<string, unknown>;
    return {
      id: (res.id as string) ?? op,
      status: (res.status as string) ?? "submitted",
      reference: res.reference as string | undefined,
      raw: result,
    };
  }

  // --- Main adapter ---

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

        // Traditional Investing (preview -- real execution in executeAction)
        case "custom":
          return {
            tx: {
              to: zeroAddress,
              data: "0x" as `0x${string}`,
              value: 0n,
            },
            description: `Compass V2 custom action: ${(action as CustomAction).op}`,
            action,
          };

        default:
          throw new Error(
            `Compass V2: unsupported action type "${action.type}". Supported: ${meta.actions.join(", ")}`
          );
      }
    },
    executeAction: handleExecuteAction,
    bridgeLifecycle: { resolveHandoffStatus },
    resolveHandoffStatus,
  };
}

/** Default singleton -- stubs throw until a configured instance is created via createCompassV2Adapter(). */
export const compassV2Adapter: VenueAdapter = {
  meta: {
    name: "compass_v2",
    supportedChains: [1, 8453, 42161],
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
    description:
      "Compass Labs V2 multi-product DeFi adapter (Earn, Credit, Bridge, Traditional Investing)",
  },
  async buildAction() {
    throw new Error("Compass V2 adapter requires configuration. Use createCompassV2Adapter().");
  },
  async executeAction() {
    throw new Error("Compass V2 adapter requires configuration. Use createCompassV2Adapter().");
  },
};
