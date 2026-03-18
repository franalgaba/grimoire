import type { Action, VenueAdapter } from "@grimoirelabs/core";
import type {
  ApiKeyCreds,
  CreateOrderOptions,
  OrderType,
  UserMarketOrder,
  UserOrder,
} from "@polymarket/clob-client";

export type PolymarketOrderSide = "BUY" | "SELL";
export type PolymarketOrderType = "GTC" | "GTD" | "FOK" | "FAK";
export type PolymarketSignatureType = 0 | 1 | 2;

export interface PolymarketOrderRequest {
  tokenID: string;
  price: number;
  side: PolymarketOrderSide;
  size?: number;
  amount?: number;
  expiration?: number;
}

export interface PolymarketOrderOptions {
  tickSize: string;
  negRisk: boolean;
}

export interface PolymarketExecutionClient {
  createAndPostOrder: (
    order: UserOrder,
    options?: Partial<CreateOrderOptions>,
    orderType?: OrderType.GTC | OrderType.GTD
  ) => Promise<unknown>;
  createAndPostMarketOrder: (
    order: UserMarketOrder,
    options?: Partial<CreateOrderOptions>,
    orderType?: OrderType.FOK | OrderType.FAK
  ) => Promise<unknown>;
  cancelOrder: (payload: { orderID: string }) => Promise<unknown>;
  cancelOrders: (orderIds: string[]) => Promise<unknown>;
  cancelAll: () => Promise<unknown>;
  postHeartbeat: (heartbeatId?: string | null) => Promise<unknown>;
}

export interface PolymarketAdapterConfig {
  client?: PolymarketExecutionClient;
  env?: Record<string, string | undefined>;
  host?: string;
  clobChainId?: number;
  privateKey?: `0x${string}`;
  apiCreds?: ApiKeyCreds;
  signatureType?: PolymarketSignatureType;
  funderAddress?: string;
  deriveApiKey?: boolean;
  supportedChains?: number[];
  requiredEnv?: string[];
  defaultTickSize?: string;
  defaultNegRisk?: boolean;
}

export const DEFAULT_SUPPORTED_CHAINS = [137];
export const DEFAULT_REQUIRED_ENV = ["POLYMARKET_PRIVATE_KEY"];
export const DEFAULT_TICK_SIZE = "0.01";
export const DEFAULT_NEG_RISK = false;
export const DEFAULT_HOST = "https://clob.polymarket.com";

export const SUPPORTED_CUSTOM_OPS = [
  "order",
  "cancel_order",
  "cancel_orders",
  "cancel_all",
  "heartbeat",
] as const;

export type SupportedCustomOp = (typeof SUPPORTED_CUSTOM_OPS)[number];
export type SupportedCustomAction = Extract<Action, { type: "custom" }>;

export interface NormalizedOrderPayload {
  order: PolymarketOrderRequest;
  options: PolymarketOrderOptions;
  orderType: PolymarketOrderType;
}

export const POLYMARKET_META_BASE: VenueAdapter["meta"] = {
  name: "polymarket",
  executionType: "offchain",
  supportedChains: DEFAULT_SUPPORTED_CHAINS,
  actions: ["custom"],
  supportedConstraints: [],
  supportsQuote: false,
  supportsSimulation: false,
  supportsPreviewCommit: true,
  requiredEnv: DEFAULT_REQUIRED_ENV,
  dataEndpoints: ["book", "midpoint", "spread", "events", "markets"],
  description: "Polymarket CLOB offchain adapter",
};
