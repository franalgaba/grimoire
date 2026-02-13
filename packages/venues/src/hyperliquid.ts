import type { Action, VenueAdapter, VenueAdapterContext } from "@grimoirelabs/core";
import { ExchangeClient, HttpTransport } from "@nktkas/hyperliquid";
import { zeroAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { assertSupportedConstraints } from "./constraints.js";

export interface HyperliquidAdapterConfig {
  privateKey: `0x${string}`;
  assetMap: Record<string, number>;
  exchange?: ExchangeClient;
  transport?: HttpTransport;
}

const HYPERLIQUID_META: VenueAdapter["meta"] = {
  name: "hyperliquid",
  supportedChains: [0, 999],
  actions: ["custom", "withdraw"],
  supportedConstraints: [],
  supportsQuote: false,
  supportsSimulation: false,
  supportsPreviewCommit: true,
  requiredEnv: ["HYPERLIQUID_PRIVATE_KEY"],
  dataEndpoints: ["mids", "l2-book", "open-orders", "meta", "spot-meta"],
  description: "Hyperliquid offchain adapter",
  executionType: "offchain",
};

export function createHyperliquidAdapter(config: HyperliquidAdapterConfig): VenueAdapter {
  const account = privateKeyToAccount(config.privateKey);
  const transport = config.transport ?? new HttpTransport();
  const exchange = config.exchange ?? new ExchangeClient({ transport, wallet: account });

  return {
    meta: HYPERLIQUID_META,
    async buildAction(action, _ctx) {
      assertSupportedConstraints(HYPERLIQUID_META, action);

      if (isWithdrawAction(action)) {
        return {
          tx: { to: zeroAddress, data: "0x", value: 0n },
          description: `Hyperliquid withdraw ${action.amount} USDC`,
          action,
        };
      }

      const order = normalizeOrder(action);
      return {
        tx: {
          to: zeroAddress,
          data: "0x",
          value: 0n,
        },
        description: `Hyperliquid order ${order.coin} ${order.isBuy ? "buy" : "sell"} ${order.size}`,
        action,
      };
    },
    async executeAction(action, ctx: VenueAdapterContext) {
      assertSupportedConstraints(HYPERLIQUID_META, action);

      if (isWithdrawAction(action)) {
        const amount = amountToString(action.amount);
        const destination = ((action as { to?: string }).to ?? ctx.walletAddress) as `0x${string}`;
        const result = await exchange.withdraw3({ destination, amount });
        return {
          id: JSON.stringify(result),
          status: "submitted",
          reference: extractReference(result),
          raw: result,
        };
      }

      const order = normalizeOrder(action);
      const asset = config.assetMap[order.coin];
      if (asset === undefined) {
        throw new Error(`Unknown Hyperliquid asset mapping for ${order.coin}`);
      }

      const orderType = (order.orderType ?? {
        limit: { tif: "Gtc" as const },
      }) as HyperliquidOrderType;

      const result = await exchange.order({
        orders: [
          {
            a: asset,
            b: order.isBuy,
            p: order.price,
            s: order.size,
            r: order.reduceOnly ?? false,
            t: orderType,
          },
        ],
        grouping: "na",
      });

      return {
        id: JSON.stringify(result),
        status: "submitted",
        reference: extractReference(result),
        raw: result,
      };
    },
  };
}

export const hyperliquidAdapter: VenueAdapter = {
  meta: HYPERLIQUID_META,
  async buildAction() {
    throw new Error("Hyperliquid adapter requires a private key. Use createHyperliquidAdapter().");
  },
  async executeAction() {
    throw new Error("Hyperliquid adapter requires a private key. Use createHyperliquidAdapter().");
  },
};

type HyperliquidOrderType =
  | {
      limit: {
        tif: "Gtc" | "Ioc" | "Alo" | "FrontendMarket" | "LiquidationMarket";
      };
    }
  | {
      trigger: {
        isMarket: boolean;
        triggerPx: string | number;
        tpsl: "tp" | "sl";
      };
    };

type NormalizedOrder = {
  coin: string;
  isBuy: boolean;
  price: string;
  size: string;
  reduceOnly?: boolean;
  orderType?: HyperliquidOrderType;
};

type HyperliquidOrderArgs = {
  coin?: unknown;
  price?: unknown;
  size?: unknown;
  side?: unknown;
  isBuy?: unknown;
  is_buy?: unknown;
  reduceOnly?: unknown;
  reduce_only?: unknown;
  orderType?: unknown;
  order_type?: unknown;
};

type HyperliquidWithdrawAction = Extract<Action, { type: "withdraw" }>;

function isWithdrawAction(action: Action): action is HyperliquidWithdrawAction {
  return action.type === "withdraw";
}

function isOrderAction(
  action: Action
): action is Extract<Action, { type: "custom" }> & { op: "order"; args: Record<string, unknown> } {
  return action.type === "custom" && action.op === "order";
}

function normalizeOrder(action: Action): NormalizedOrder {
  if (!isOrderAction(action)) {
    throw new Error("Hyperliquid order actions must use custom op 'order'");
  }

  const args = action.args as HyperliquidOrderArgs;

  if (typeof args.coin !== "string" || args.coin.trim().length === 0) {
    throw new Error("Hyperliquid custom order requires args.coin");
  }
  if (args.price === undefined) {
    throw new Error("Hyperliquid custom order requires args.price");
  }
  if (args.size === undefined) {
    throw new Error("Hyperliquid custom order requires args.size");
  }

  const isBuy = resolveOrderSide(args);
  const orderTypeCandidate = args.orderType ?? args.order_type;
  if (orderTypeCandidate !== undefined && !isHyperliquidOrderType(orderTypeCandidate)) {
    throw new Error("Hyperliquid custom order has invalid args.order_type");
  }

  const reduceOnlyCandidate = args.reduceOnly ?? args.reduce_only;
  const reduceOnly =
    reduceOnlyCandidate === undefined
      ? undefined
      : parseBoolean(reduceOnlyCandidate, "reduce_only");

  return {
    coin: args.coin,
    isBuy,
    price: String(args.price),
    size: String(args.size),
    reduceOnly,
    orderType: orderTypeCandidate,
  };
}

function resolveOrderSide(args: HyperliquidOrderArgs): boolean {
  if (typeof args.side === "string") {
    const normalized = args.side.toLowerCase();
    if (normalized === "buy") return true;
    if (normalized === "sell") return false;
    throw new Error("Hyperliquid custom order args.side must be 'buy' or 'sell'");
  }

  const isBuyCandidate = args.isBuy ?? args.is_buy;
  if (isBuyCandidate === undefined) {
    throw new Error("Hyperliquid custom order requires args.side or args.isBuy");
  }

  return parseBoolean(isBuyCandidate, "isBuy");
}

function parseBoolean(value: unknown, field: string): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  throw new Error(`Hyperliquid custom order args.${field} must be boolean`);
}

function isHyperliquidOrderType(value: unknown): value is HyperliquidOrderType {
  if (!value || typeof value !== "object") {
    return false;
  }

  if ("limit" in value) {
    const limit = (value as { limit?: { tif?: unknown } }).limit;
    if (!limit || typeof limit !== "object") return false;
    return (
      limit.tif === "Gtc" ||
      limit.tif === "Ioc" ||
      limit.tif === "Alo" ||
      limit.tif === "FrontendMarket" ||
      limit.tif === "LiquidationMarket"
    );
  }

  if ("trigger" in value) {
    const trigger = (
      value as { trigger?: { isMarket?: unknown; triggerPx?: unknown; tpsl?: unknown } }
    ).trigger;
    if (!trigger || typeof trigger !== "object") return false;
    const validTpsl = trigger.tpsl === "tp" || trigger.tpsl === "sl";
    const validIsMarket = typeof trigger.isMarket === "boolean";
    const validTriggerPx =
      typeof trigger.triggerPx === "string" || typeof trigger.triggerPx === "number";
    return validTpsl && validIsMarket && validTriggerPx;
  }

  return false;
}

function amountToString(value: unknown): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }
  if (typeof value === "object" && value !== null && "value" in value) {
    return String((value as { value: unknown }).value);
  }
  throw new Error("Hyperliquid withdraw amount must be string, number, bigint, or literal value");
}

function extractReference(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }

  const keys = ["id", "orderId", "oid", "txHash", "hash"] as const;
  for (const key of keys) {
    const value = (payload as Record<string, unknown>)[key];
    if (typeof value === "string" || typeof value === "number") {
      return String(value);
    }
  }

  const nestedKeys = ["response", "data", "result"] as const;
  for (const key of nestedKeys) {
    const nested = (payload as Record<string, unknown>)[key];
    const nestedReference = extractReference(nested);
    if (nestedReference) {
      return nestedReference;
    }
  }

  return undefined;
}
