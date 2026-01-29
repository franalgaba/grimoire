import { AaveClient, chainId, evmAddress } from "@aave/client";
import { borrow, repay, supply, withdraw } from "@aave/client/actions";
import type { Action, Address, BuiltTransaction, VenueAdapter } from "@grimoire/core";

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
};

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

      const assetAddress = resolveAssetAddress(action.asset);
      const amount = toAmountString(action.amount);
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
            supplier: address,
            amount: { erc20: { currency: evmAddress(assetAddress), value: amount } },
          } as unknown as Parameters<typeof actions.supply>[1];
          result = await actions.supply(client, request);
          break;
        }
        case "withdraw": {
          const request = {
            ...requestBase,
            withdrawer: address,
            amount: { erc20: { currency: evmAddress(assetAddress), value: amount } },
            recipient: address,
          } as unknown as Parameters<typeof actions.withdraw>[1];
          result = await actions.withdraw(client, request);
          break;
        }
        case "borrow": {
          const request = {
            ...requestBase,
            borrower: address,
            amount: { erc20: { currency: evmAddress(assetAddress), value: amount } },
            recipient: address,
          } as unknown as Parameters<typeof actions.borrow>[1];
          result = await actions.borrow(client, request);
          break;
        }
        case "repay": {
          const request = {
            ...requestBase,
            repayer: address,
            amount: { erc20: { currency: evmAddress(assetAddress), value: amount } },
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

  if (!isTransactionRequest(plan)) {
    throw new Error(`Unsupported Aave execution plan: ${plan.__typename}`);
  }

  return [toBuiltTx(plan, action, `Aave V3 ${action.type} ${action.asset}`)];
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

function resolveAssetAddress(asset?: string): Address {
  if (!asset) {
    throw new Error("Asset is required for Aave action");
  }
  if (asset.startsWith("0x") && asset.length === 42) {
    return asset as Address;
  }

  const KNOWN_TOKENS: Record<string, Address> = {
    USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address,
    USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7" as Address,
    DAI: "0x6B175474E89094C44Da98b954EedeAC495271d0F" as Address,
    WETH: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" as Address,
  };

  const address = KNOWN_TOKENS[asset.toUpperCase()];
  if (!address) {
    throw new Error(`Unknown asset: ${asset}. Provide address directly.`);
  }

  return address;
}

function toAmountString(amount: AaveAction["amount"]): string {
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
