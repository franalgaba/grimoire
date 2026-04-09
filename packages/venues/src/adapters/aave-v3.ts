import { AaveClient, chainId, evmAddress } from "@aave/client";
import { borrow, repay, reserve, supply, withdraw } from "@aave/client/actions";
import type {
  Action,
  Address,
  BuiltTransaction,
  MetricRequest,
  VenueAdapter,
  VenueAdapterContext,
  VenueBuildMetadata,
} from "@grimoirelabs/core";
import { zeroAddress } from "viem";
import { assertSupportedConstraints, assertSupportedMetricSurface } from "../shared/constraints.js";
import { buildApprovalIfNeeded } from "../shared/erc20.js";
import { normalizeAaveApyToBps, toFiniteNumber } from "../shared/metric-selector.js";
import { resolveTokenAddress, resolveTokenDecimals } from "../shared/token-registry.js";

export interface AaveV3AdapterConfig {
  markets: Record<number, Address>;
  client?: AaveClient;
  actions?: Partial<{
    supply: typeof supply;
    withdraw: typeof withdraw;
    borrow: typeof borrow;
    repay: typeof repay;
    reserve: typeof reserve;
  }>;
}

const DEFAULT_MARKETS: Record<number, Address> = {
  1: "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2" as Address,
  8453: "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5" as Address,
};
type AaveBuiltTransaction = BuiltTransaction & { metadata?: VenueBuildMetadata };

export function createAaveV3Adapter(
  config: AaveV3AdapterConfig = { markets: DEFAULT_MARKETS }
): VenueAdapter {
  const client = config.client ?? AaveClient.create();
  const actions = {
    supply,
    withdraw,
    borrow,
    repay,
    reserve,
    ...config.actions,
  };
  const meta: VenueAdapter["meta"] = {
    name: "aave_v3",
    supportedChains: Object.keys(config.markets).map((id) => Number.parseInt(id, 10)),
    actions: ["lend", "withdraw", "borrow", "repay"],
    supportedConstraints: [],
    supportsQuote: false,
    supportsSimulation: false,
    supportsPreviewCommit: true,
    metricSurfaces: ["apy"],
    dataEndpoints: ["health", "chains", "markets", "market", "reserve", "reserves"],
    description: "Aave V3 adapter",
  };

  function getMarketForChain(chain: number): Address {
    const market = config.markets[chain];
    if (!market) {
      throw new Error(`No Aave V3 market configured for chain ${chain}`);
    }
    return market;
  }

  return {
    meta,
    async readMetric(request: MetricRequest, ctx: VenueAdapterContext): Promise<number> {
      assertSupportedMetricSurface(meta, request);
      if (!request.asset) {
        throw new Error("Aave V3 APY metric requires an asset");
      }

      const market = getMarketForChain(ctx.chainId);
      const assetAddress = resolveTokenAddress(request.asset, ctx.chainId, {
        treatEthAsWrapped: true,
      });
      const reserveResult = await actions.reserve(client, {
        chainId: chainId(ctx.chainId),
        market: evmAddress(market),
        underlyingToken: evmAddress(assetAddress),
      } as unknown as Parameters<typeof reserve>[1]);
      const payload = unwrapAaveResult<Record<string, unknown>>(reserveResult);
      const apy = extractAaveApyBps(payload);
      if (apy === null) {
        throw new Error(
          `Aave V3 APY metric unavailable for asset '${request.asset}' on chain ${ctx.chainId}`
        );
      }
      return apy;
    },
    async buildAction(action, ctx) {
      assertSupportedConstraints(meta, action);

      const market = getMarketForChain(ctx.chainId);

      if (!isAaveAction(action)) {
        throw new Error(`Unsupported Aave action: ${action.type}`);
      }
      if (!action.asset) {
        throw new Error("Asset is required for Aave action");
      }

      const assetAddress = resolveTokenAddress(action.asset, ctx.chainId, {
        treatEthAsWrapped: true,
      });
      const decimals = resolveTokenDecimals(action.asset, ctx.chainId, {
        treatEthAsWrapped: true,
        defaultDecimals: 18,
      });
      const humanAmount = toHumanAmount(action.amount, decimals);
      const rawAmount = toRawAmountString(action.amount);
      const address = evmAddress(ctx.walletAddress);
      const marketAddress = evmAddress(market);
      const chain = chainId(ctx.chainId);

      const requestBase = {
        market: marketAddress,
        chainId: chain,
      } as { market: ReturnType<typeof evmAddress>; chainId: ReturnType<typeof chainId> };
      const metadataContext: AaveMetadataContext = {
        chainId: ctx.chainId,
        market,
        assetAddress,
        decimals,
        rawAmount: BigInt(rawAmount),
        humanAmount,
      };

      let result: unknown;

      switch (action.type) {
        case "lend": {
          const request = {
            ...requestBase,
            sender: address,
            amount: { erc20: { currency: evmAddress(assetAddress), value: humanAmount } },
          } as unknown as Parameters<typeof actions.supply>[1];
          result = await actions.supply(client, request);
          break;
        }
        case "withdraw": {
          const request = {
            ...requestBase,
            sender: address,
            amount: {
              erc20: { currency: evmAddress(assetAddress), value: { exact: humanAmount } },
            },
          } as unknown as Parameters<typeof actions.withdraw>[1];
          result = await actions.withdraw(client, request);
          break;
        }
        case "borrow": {
          const request = {
            ...requestBase,
            sender: address,
            amount: { erc20: { currency: evmAddress(assetAddress), value: humanAmount } },
          } as unknown as Parameters<typeof actions.borrow>[1];
          result = await actions.borrow(client, request);
          break;
        }
        case "repay": {
          const request = {
            ...requestBase,
            sender: address,
            amount: {
              erc20: { currency: evmAddress(assetAddress), value: { exact: humanAmount } },
            },
          } as unknown as Parameters<typeof actions.repay>[1];
          result = await actions.repay(client, request);
          break;
        }
        default:
          throw new Error("Unsupported Aave action");
      }

      const planResult = await result;
      const planWrapper = planResult as AaveActionResult | undefined;
      if (planWrapper?.isErr?.()) {
        throw new Error(planWrapper.error?.message ?? "Aave action failed");
      }

      const plan = extractExecutionPlan(planResult);
      const allowInsufficientBalance = ctx.mode === "dry-run" || ctx.mode === "simulate";
      if (
        allowInsufficientBalance &&
        plan &&
        typeof plan === "object" &&
        "__typename" in plan &&
        plan.__typename === "InsufficientBalanceError"
      ) {
        return [buildInsufficientBalancePlaceholder(plan, action, metadataContext, ctx.mode)];
      }

      const txs = buildAaveTransactions(plan, action, metadataContext);

      // The Aave SDK may skip approval generation (e.g. on Base) even when the
      // wallet has no allowance. Inject an ERC20 approve if the SDK didn't
      // return ApprovalRequired and the action pulls tokens from the wallet.
      // Only check when a provider with readContract is available — otherwise
      // trust the SDK's own plan.
      const needsTokenInput = action.type === "lend" || action.type === "repay";
      const hasApprovalTx = txs.some(
        (tx) => tx.description?.toLowerCase().includes("approve") || tx.metadata?.route?.approval
      );
      const canCheckAllowance = !!ctx.provider.getClient?.()?.readContract;
      if (needsTokenInput && !hasApprovalTx && canCheckAllowance) {
        const spender = market;
        const approvalTxs = await buildApprovalIfNeeded({
          ctx,
          token: assetAddress,
          spender,
          amount: metadataContext.rawAmount,
          action,
          description: `Approve ${action.asset} for Aave V3`,
        });
        if (approvalTxs.length > 0) {
          return [...approvalTxs, ...txs];
        }
      }

      return txs;
    },
  };
}

export const aaveV3Adapter = createAaveV3Adapter();

type AaveActionResult = {
  isErr?: () => boolean;
  error?: { message?: string };
};

type AaveAction = Extract<Action, { type: "lend" | "withdraw" | "borrow" | "repay" }>;

type AaveTransactionRequest = {
  __typename: "TransactionRequest";
  to: string;
  data: string;
  value?: string | number | bigint;
};

type AaveApprovalRequired = {
  __typename: "ApprovalRequired";
  approval: AaveTransactionRequest;
  originalTransaction: AaveTransactionRequest;
};

type AaveExecutionPlan = AaveTransactionRequest | AaveApprovalRequired | { __typename: string };
type AaveMetadataContext = {
  chainId: number;
  market: Address;
  assetAddress: Address;
  decimals: number;
  rawAmount: bigint;
  humanAmount: string;
};

function isAaveAction(action: Action): action is AaveAction {
  return ["lend", "withdraw", "borrow", "repay"].includes(action.type);
}

function isApprovalRequired(plan: AaveExecutionPlan): plan is AaveApprovalRequired {
  return plan.__typename === "ApprovalRequired";
}

function isTransactionRequest(plan: AaveExecutionPlan): plan is AaveTransactionRequest {
  return plan.__typename === "TransactionRequest";
}

function extractExecutionPlan(planResult: unknown): AaveExecutionPlan {
  if (planResult && typeof planResult === "object" && "__typename" in planResult) {
    return planResult as AaveExecutionPlan;
  }

  if (
    planResult &&
    typeof planResult === "object" &&
    "value" in planResult &&
    planResult.value &&
    typeof planResult.value === "object" &&
    "__typename" in planResult.value
  ) {
    return planResult.value as AaveExecutionPlan;
  }

  return planResult as AaveExecutionPlan;
}

function unwrapAaveResult<T>(result: unknown): T {
  if (result && typeof result === "object" && "isErr" in result) {
    const wrapped = result as {
      isErr?: () => boolean;
      error?: { message?: string };
      value?: unknown;
    };
    if (wrapped.isErr?.()) {
      throw new Error(wrapped.error?.message ?? "Aave request failed");
    }
    if (wrapped.value !== undefined) {
      return wrapped.value as T;
    }
  }

  return result as T;
}

const AAVE_APY_KEYS = ["liquidityApy", "supplyApy", "depositApy", "liquidityRate", "apy"];
const MAX_TRAVERSAL_DEPTH = 10;

function extractAaveApyBps(payload: Record<string, unknown>): number | null {
  for (const key of AAVE_APY_KEYS) {
    const values = collectNumericValues(payload, key);
    for (const value of values) {
      if (Number.isFinite(value)) {
        return normalizeAaveApyToBps(value);
      }
    }
  }
  return null;
}

function collectNumericValues(node: unknown, targetKey: string): number[] {
  const out: number[] = [];

  const visit = (value: unknown, depth: number): void => {
    if (depth > MAX_TRAVERSAL_DEPTH || !value || typeof value !== "object") {
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item, depth + 1);
      }
      return;
    }
    const record = value as Record<string, unknown>;
    for (const [key, next] of Object.entries(record)) {
      if (key === targetKey) {
        const numeric = extractWrappedNumber(next);
        if (numeric !== null) {
          out.push(numeric);
        }
      }
      visit(next, depth + 1);
    }
  };

  visit(node, 0);
  return out;
}

function extractWrappedNumber(value: unknown): number | null {
  const direct = toFiniteNumber(value);
  if (direct !== null) {
    return direct;
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const nested = [record.value, record.formatted, record.raw]
      .map((entry) => toFiniteNumber(entry))
      .find((entry) => entry !== null);
    if (nested !== undefined) {
      return nested as number;
    }
  }

  return null;
}

function buildAaveTransactions(
  plan: AaveExecutionPlan,
  action: AaveAction,
  metadataContext: AaveMetadataContext
): AaveBuiltTransaction[] {
  if (isApprovalRequired(plan)) {
    return [
      toBuiltTx(plan.approval, action, metadataContext, {
        description: `Aave V3 approve ${action.asset}`,
        isApproval: true,
      }),
      toBuiltTx(plan.originalTransaction, action, metadataContext, {
        description: `Aave V3 ${action.type} ${action.asset}`,
      }),
    ];
  }

  if (plan.__typename === "InsufficientBalanceError") {
    const err = plan as unknown as {
      required?: { raw?: string; value?: string };
      available?: { raw?: string; value?: string };
    };
    const required = err.required?.value ?? err.required?.raw ?? "unknown";
    const available = err.available?.value ?? err.available?.raw ?? "unknown";
    throw new Error(
      `Aave V3 ${action.type}: insufficient balance (required: ${required}, available: ${available})`
    );
  }

  if (!isTransactionRequest(plan)) {
    throw new Error(`Unsupported Aave execution plan: ${plan.__typename}`);
  }

  return [
    toBuiltTx(plan, action, metadataContext, {
      description: `Aave V3 ${action.type} ${action.asset}`,
    }),
  ];
}

function buildInsufficientBalancePlaceholder(
  plan: AaveExecutionPlan,
  action: AaveAction,
  metadataContext: AaveMetadataContext,
  mode?: "simulate" | "dry-run" | "execute"
): AaveBuiltTransaction {
  const err = plan as unknown as {
    required?: { raw?: string; value?: string };
    available?: { raw?: string; value?: string };
  };
  const required = err.required?.value ?? err.required?.raw;
  const available = err.available?.value ?? err.available?.raw;
  const balanceInfo =
    required && available ? ` (required: ${required}, available: ${available})` : "";
  const modeLabel = mode ? ` ${mode}` : "";

  return {
    tx: {
      to: zeroAddress,
      data: "0x",
      value: 0n,
    },
    description: `Aave V3 ${action.type} ${action.asset}${modeLabel} placeholder${balanceInfo}`,
    action,
    metadata: {
      ...buildAaveMetadata(action, metadataContext),
      warnings: [
        `insufficient_balance${balanceInfo.length > 0 ? balanceInfo : ""}`,
        "placeholder_transaction_generated",
      ],
    },
  };
}

function toBuiltTx(
  request: AaveTransactionRequest,
  action: AaveAction,
  metadataContext: AaveMetadataContext,
  options: {
    description: string;
    isApproval?: boolean;
  }
): AaveBuiltTransaction {
  return {
    tx: {
      to: request.to as Address,
      data: request.data as string,
      value: toBigIntValue(request.value),
    },
    description: options.description,
    action,
    metadata: buildAaveMetadata(action, metadataContext, { isApproval: options.isApproval }),
  };
}

function toBigIntValue(value?: string | number | bigint): bigint {
  if (value === undefined) return 0n;
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  if (typeof value === "string") return BigInt(value);
  return 0n;
}

function toRawAmountString(amount: AaveAction["amount"]): string {
  if (amount === "max") {
    throw new Error("Aave adapter requires explicit amount, not 'max'");
  }
  if (typeof amount === "bigint") return amount.toString();
  if (typeof amount === "number") return Math.floor(amount).toString();
  if (typeof amount === "string") return amount;
  if (typeof amount === "object" && amount?.kind === "literal") {
    return String(amount.value);
  }
  throw new Error("Unsupported amount type for Aave action");
}

/**
 * Convert a raw amount (e.g. 100000 for 0.1 USDC) to the human-readable
 * BigDecimal string the Aave SDK expects (e.g. "0.1").
 */
function toHumanAmount(amount: AaveAction["amount"], decimals: number): string {
  if (amount === "max") {
    throw new Error("Aave adapter requires explicit amount, not 'max'");
  }
  let raw: bigint;
  if (typeof amount === "bigint") raw = amount;
  else if (typeof amount === "number") raw = BigInt(Math.floor(amount));
  else if (typeof amount === "string") raw = BigInt(amount);
  else if (typeof amount === "object" && amount?.kind === "literal") {
    const lit = amount.value;
    if (typeof lit === "bigint") raw = lit;
    else if (typeof lit === "number") raw = BigInt(Math.floor(lit));
    else if (typeof lit === "string") raw = BigInt(lit);
    else if (typeof lit === "boolean") raw = BigInt(lit ? 1 : 0);
    else throw new Error("Unsupported literal amount type for Aave action");
  } else throw new Error("Unsupported amount type for Aave action");

  const divisor = 10n ** BigInt(decimals);
  const whole = raw / divisor;
  const frac = raw % divisor;

  if (frac === 0n) return whole.toString();

  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole}.${fracStr}`;
}

function buildAaveMetadata(
  action: AaveAction,
  metadataContext: AaveMetadataContext,
  options: { isApproval?: boolean } = {}
): VenueBuildMetadata {
  const quote =
    action.type === "borrow" || action.type === "withdraw"
      ? { expectedOut: metadataContext.rawAmount }
      : { expectedIn: metadataContext.rawAmount };

  return {
    quote: options.isApproval ? undefined : quote,
    route: {
      chainId: metadataContext.chainId,
      market: metadataContext.market,
      action: action.type,
      asset: action.asset,
      assetAddress: metadataContext.assetAddress,
      assetDecimals: metadataContext.decimals,
      amountRaw: metadataContext.rawAmount,
      amountHuman: metadataContext.humanAmount,
      amountFormat: "human_decimal",
      approval: options.isApproval === true,
    },
  };
}
