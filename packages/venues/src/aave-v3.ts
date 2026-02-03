import { AaveClient, chainId, evmAddress } from "@aave/client";
import { borrow, repay, supply, withdraw } from "@aave/client/actions";
import type { Action, Address, BuiltTransaction, VenueAdapter } from "@grimoirelabs/core";

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

export function createAaveV3Adapter(
  config: AaveV3AdapterConfig = { markets: DEFAULT_MARKETS }
): VenueAdapter {
  const client = config.client ?? AaveClient.create();
  const actions = config.actions ?? { supply, withdraw, borrow, repay };

  return {
    meta: {
      name: "aave_v3",
      supportedChains: Object.keys(config.markets).map((id) => Number.parseInt(id, 10)),
      actions: ["lend", "withdraw", "borrow", "repay"],
      description: "Aave V3 adapter",
    },
    async buildAction(action, ctx) {
      const market = config.markets[ctx.chainId];
      if (!market) {
        throw new Error(`No Aave V3 market configured for chain ${ctx.chainId}`);
      }

      if (!isAaveAction(action)) {
        throw new Error(`Unsupported Aave action: ${action.type}`);
      }

      const assetAddress = resolveAssetAddress(action.asset, ctx.chainId);
      const decimals = resolveAssetDecimals(action.asset, ctx.chainId);
      const humanAmount = toHumanAmount(action.amount, decimals);
      const rawAmount = toRawAmountString(action.amount);
      const address = evmAddress(ctx.walletAddress);
      const marketAddress = evmAddress(market);
      const chain = chainId(ctx.chainId);

      const requestBase = {
        market: marketAddress,
        chainId: chain,
      } as { market: ReturnType<typeof evmAddress>; chainId: ReturnType<typeof chainId> };

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
            recipient: address,
          } as unknown as Parameters<typeof actions.withdraw>[1];
          result = await actions.withdraw(client, request);
          break;
        }
        case "borrow": {
          const request = {
            ...requestBase,
            sender: address,
            amount: { erc20: { currency: evmAddress(assetAddress), value: humanAmount } },
            recipient: address,
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
        return [buildInsufficientBalancePlaceholder(plan, action, ctx.mode)];
      }

      return buildAaveTransactions(plan, action);
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

function buildAaveTransactions(plan: AaveExecutionPlan, action: AaveAction): BuiltTransaction[] {
  if (isApprovalRequired(plan)) {
    return [
      toBuiltTx(plan.approval, action, `Aave V3 approve ${action.asset}`),
      toBuiltTx(plan.originalTransaction, action, `Aave V3 ${action.type} ${action.asset}`),
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

  return [toBuiltTx(plan, action, `Aave V3 ${action.type} ${action.asset}`)];
}

function buildInsufficientBalancePlaceholder(
  plan: AaveExecutionPlan,
  action: AaveAction,
  mode?: "simulate" | "dry-run" | "execute"
): BuiltTransaction {
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
  };
}

function toBuiltTx(
  request: AaveTransactionRequest,
  action: AaveAction,
  description: string
): BuiltTransaction {
  return {
    tx: {
      to: request.to as Address,
      data: request.data as string,
      value: toBigIntValue(request.value),
    },
    description,
    action,
  };
}

function toBigIntValue(value?: string | number | bigint): bigint {
  if (value === undefined) return 0n;
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  if (typeof value === "string") return BigInt(value);
  return 0n;
}

function resolveAssetAddress(asset?: string, chainId?: number): Address {
  if (!asset) {
    throw new Error("Asset is required for Aave action");
  }
  if (asset.startsWith("0x") && asset.length === 42) {
    return asset as Address;
  }

  const KNOWN_TOKENS: Record<number, Record<string, Address>> = {
    1: {
      USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address,
      USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7" as Address,
      DAI: "0x6B175474E89094C44Da98b954EedeAC495271d0F" as Address,
      WETH: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" as Address,
    },
    8453: {
      USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Address,
      WETH: "0x4200000000000000000000000000000000000006" as Address,
    },
  };

  const chainTokens = KNOWN_TOKENS[chainId ?? 1] ?? KNOWN_TOKENS[1];
  const address = chainTokens?.[asset.toUpperCase()];
  if (!address) {
    throw new Error(`Unknown asset: ${asset} on chain ${chainId ?? 1}. Provide address directly.`);
  }

  return address;
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

function resolveAssetDecimals(asset?: string, _chainId?: number): number {
  const KNOWN_DECIMALS: Record<string, number> = {
    USDC: 6,
    USDT: 6,
    DAI: 18,
    WETH: 18,
    ETH: 18,
  };
  if (asset && !asset.startsWith("0x")) {
    const d = KNOWN_DECIMALS[asset.toUpperCase()];
    if (d !== undefined) return d;
  }
  return 18; // default to 18 decimals
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
