import type { VenueAdapter, VenueAdapterContext } from "@grimoirelabs/core";
import { ExchangeClient, HttpTransport } from "@nktkas/hyperliquid";
import { zeroAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export interface HyperliquidAdapterConfig {
  privateKey: `0x${string}`;
  assetMap: Record<string, number>;
  exchange?: ExchangeClient;
  transport?: HttpTransport;
}

const HYPERLIQUID_META: VenueAdapter["meta"] = {
  name: "hyperliquid",
  supportedChains: [0, 999],
  actions: ["swap", "withdraw"],
  description: "Hyperliquid spot & perps adapter",
  executionType: "offchain",
};

export function createHyperliquidAdapter(config: HyperliquidAdapterConfig): VenueAdapter {
  const account = privateKeyToAccount(config.privateKey);
  const transport = config.transport ?? new HttpTransport();
  const exchange = config.exchange ?? new ExchangeClient({ transport, wallet: account });

  return {
    meta: HYPERLIQUID_META,
    async buildAction(action, _ctx) {
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
        description: `Hyperliquid ${order.coin} ${order.isBuy ? "buy" : "sell"} ${order.size}`,
        action,
      };
    },
    async executeAction(action, ctx: VenueAdapterContext) {
      if (isWithdrawAction(action)) {
        const amount = String(
          typeof action.amount === "object" &&
            action.amount !== null &&
            "value" in (action.amount as object)
            ? (action.amount as { value: unknown }).value
            : action.amount
        );
        const destination = (action.to ?? ctx.walletAddress) as `0x${string}`;
        const result = await exchange.withdraw3({ destination, amount });
        return {
          id: JSON.stringify(result),
          status: "submitted",
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

type HyperliquidOrderAction = {
  coin: string;
  price: string | number;
  size: string | number;
  isBuy?: boolean;
  reduceOnly?: boolean;
  orderType?: HyperliquidOrderType;
};

type NormalizedOrder = {
  coin: string;
  isBuy: boolean;
  price: string;
  size: string;
  reduceOnly?: boolean;
  orderType?: HyperliquidOrderType;
};

interface WithdrawAction {
  type: "withdraw";
  asset?: string;
  amount: unknown;
  to?: string;
}

function isWithdrawAction(action: unknown): action is WithdrawAction {
  return (
    !!action &&
    typeof action === "object" &&
    "type" in action &&
    (action as { type: unknown }).type === "withdraw"
  );
}

function normalizeOrder(action: unknown): NormalizedOrder {
  if (!action || typeof action !== "object") {
    throw new Error("Hyperliquid adapter requires action object");
  }

  const order = action as Partial<HyperliquidOrderAction>;

  if (!order.coin) {
    throw new Error("Hyperliquid adapter requires action.coin");
  }
  if (order.price === undefined) {
    throw new Error("Hyperliquid adapter requires action.price");
  }
  if (order.size === undefined) {
    throw new Error("Hyperliquid adapter requires action.size");
  }

  return {
    coin: order.coin,
    isBuy: Boolean(order.isBuy),
    price: String(order.price),
    size: String(order.size),
    reduceOnly: order.reduceOnly,
    orderType: order.orderType,
  };
}
