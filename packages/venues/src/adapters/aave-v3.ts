import { AaveClient, chainId, evmAddress } from "@aave/client";
import { borrow, repay, supply, withdraw } from "@aave/client/actions";
import type {
  Action,
  Address,
  BuiltTransaction,
  VenueAdapter,
  VenueBuildMetadata,
} from "@grimoirelabs/core";
import { assertSupportedConstraints } from "../shared/constraints.js";
import { resolveTokenAddress, resolveTokenDecimals } from "../shared/token-registry.js";

export interface AaveV3AdapterConfig {
  markets: Record<number, Address>;
  client?: AaveClient;
  actions?: {
    supply: typeof supply;
    withdraw: typeof withdraw;
    borrow: typeof borrow;
    repay: typeof repay;
  };
}

const DEFAULT_MARKETS: Record<number, Address> = {
  1: "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2" as Address,
  8453: "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5" as Address,
};
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;
type AaveBuiltTransaction = BuiltTransaction & { metadata?: VenueBuildMetadata };

export function createAaveV3Adapter(
  config: AaveV3AdapterConfig = { markets: DEFAULT_MARKETS }
): VenueAdapter {
  const client = config.client ?? AaveClient.create();
  const actions = config.actions ?? { supply, withdraw, borrow, repay };
  const meta: VenueAdapter["meta"] = {
    name: "aave_v3",
    supportedChains: Object.keys(config.markets).map((id) => Number.parseInt(id, 10)),
    actions: ["lend", "withdraw", "borrow", "repay"],
    supportedConstraints: [],
    supportsQuote: false,
    supportsSimulation: false,
    supportsPreviewCommit: true,
    dataEndpoints: ["health", "chains", "markets", "market", "reserve", "reserves"],
    description: "Aave V3 adapter",
  };

  return {
    meta,
    async buildAction(action, ctx) {
      assertSupportedConstraints(meta, action);

      const market = config.markets[ctx.chainId];
      if (!market) {
        throw new Error(`No Aave V3 market configured for chain ${ctx.chainId}`);
      }

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
            amount: { erc20: { currency: evmAddress(assetAddress), value: { exact: rawAmount } } },
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
            amount: { erc20: { currency: evmAddress(assetAddress), value: { exact: rawAmount } } },
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

      return buildAaveTransactions(plan, action, metadataContext);
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
      to: ZERO_ADDRESS,
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
      amountFormat:
        action.type === "lend" || action.type === "borrow" ? "human_decimal" : "exact_raw",
      approval: options.isApproval === true,
    },
  };
}
