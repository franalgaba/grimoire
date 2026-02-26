import { Wallet } from "@ethersproject/wallet";
import type { Action, VenueAdapter } from "@grimoirelabs/core";
import {
  type ApiKeyCreds,
  ClobClient,
  type CreateOrderOptions,
  OrderType,
  Side,
  type UserMarketOrder,
  type UserOrder,
} from "@polymarket/clob-client";
import { zeroAddress } from "viem";
import { assertSupportedConstraints } from "./constraints.js";

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

const DEFAULT_SUPPORTED_CHAINS = [137];
const DEFAULT_REQUIRED_ENV = ["POLYMARKET_PRIVATE_KEY"];
const DEFAULT_TICK_SIZE = "0.01";
const DEFAULT_NEG_RISK = false;
const DEFAULT_HOST = "https://clob.polymarket.com";

const SUPPORTED_CUSTOM_OPS = [
  "order",
  "cancel_order",
  "cancel_orders",
  "cancel_all",
  "heartbeat",
] as const;

type SupportedCustomOp = (typeof SUPPORTED_CUSTOM_OPS)[number];
type SupportedCustomAction = Extract<Action, { type: "custom" }>;

interface NormalizedOrderPayload {
  order: PolymarketOrderRequest;
  options: PolymarketOrderOptions;
  orderType: PolymarketOrderType;
}

const POLYMARKET_META_BASE: VenueAdapter["meta"] = {
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

export function createPolymarketAdapter(config: PolymarketAdapterConfig = {}): VenueAdapter {
  const env = config.env ?? process.env;
  const meta: VenueAdapter["meta"] = {
    ...POLYMARKET_META_BASE,
    supportedChains: config.supportedChains ?? DEFAULT_SUPPORTED_CHAINS,
    requiredEnv: config.requiredEnv ?? DEFAULT_REQUIRED_ENV,
  };

  let cachedClientPromise: Promise<PolymarketExecutionClient> | undefined;

  const getClient = async (): Promise<PolymarketExecutionClient> => {
    if (config.client) {
      return config.client;
    }

    if (!cachedClientPromise) {
      cachedClientPromise = createClobExecutionClient(config, env);
    }

    return cachedClientPromise;
  };

  return {
    meta,
    async buildAction(action, ctx) {
      assertSupportedConstraints(meta, action);
      assertChainSupported(meta, ctx.chainId);

      const customAction = toCustomAction(action);
      const op = normalizeCustomOp(customAction.op);
      const description = describeBuild(op, customAction, config);

      return {
        tx: {
          to: zeroAddress,
          data: "0x",
          value: 0n,
        },
        description,
        action,
        metadata: {
          route: {
            op,
            execution: "offchain",
          },
        },
      };
    },
    async executeAction(action, ctx) {
      assertSupportedConstraints(meta, action);
      assertChainSupported(meta, ctx.chainId);

      const client = await getClient();
      const customAction = toCustomAction(action);
      const op = normalizeCustomOp(customAction.op);

      switch (op) {
        case "order": {
          const payload = normalizeOrderPayload(customAction, config);
          const raw = await postOrderFromPayload(client, payload);
          const reference =
            readStringField(raw, ["orderID", "orderId", "id"]) ?? payload.order.tokenID;
          const status = readStringField(raw, ["status", "state"]) ?? "submitted";
          return {
            id: reference,
            status,
            reference,
            raw,
          };
        }
        case "cancel_order": {
          const orderId = resolveRequiredStringArg(customAction.args, [
            "order_id",
            "orderId",
            "id",
            "arg0",
          ]);
          const raw = await client.cancelOrder({ orderID: orderId });
          return {
            id: orderId,
            status: readStringField(raw, ["status", "state"]) ?? "submitted",
            reference: orderId,
            raw,
          };
        }
        case "cancel_orders": {
          const orderIds = resolveRequiredStringArrayArg(customAction.args, [
            "order_ids",
            "orderIds",
            "ids",
            "arg0",
          ]);
          const raw = await client.cancelOrders(orderIds);
          const reference = orderIds.join(",");
          return {
            id: reference,
            status: readStringField(raw, ["status", "state"]) ?? "submitted",
            reference,
            raw,
          };
        }
        case "cancel_all": {
          const raw = await client.cancelAll();
          const reference = readStringField(raw, ["requestId", "id"]) ?? "all";
          return {
            id: `cancel-all:${reference}`,
            status: readStringField(raw, ["status", "state"]) ?? "submitted",
            reference,
            raw,
          };
        }
        case "heartbeat": {
          const heartbeatId = resolveOptionalStringArg(customAction.args, [
            "heartbeat_id",
            "heartbeatId",
            "id",
            "arg0",
          ]);
          const raw = await client.postHeartbeat(heartbeatId ?? null);
          const nextHeartbeatId =
            readStringField(raw, ["heartbeat_id", "heartbeatId", "id"]) ?? heartbeatId ?? "";
          return {
            id: nextHeartbeatId || "heartbeat",
            status: readStringField(raw, ["status", "state"]) ?? "ok",
            reference: nextHeartbeatId || undefined,
            raw,
          };
        }
      }
    },
  };
}

export const polymarketAdapter: VenueAdapter = createPolymarketAdapter();

async function createClobExecutionClient(
  config: PolymarketAdapterConfig,
  env: Record<string, string | undefined>
): Promise<PolymarketExecutionClient> {
  const host =
    resolveString(config.host, readEnv(env, ["POLYMARKET_CLOB_HOST", "CLOB_API_URL"])) ??
    DEFAULT_HOST;
  const chainId = resolveNumber(
    config.clobChainId,
    readEnv(env, ["POLYMARKET_CLOB_CHAIN_ID", "CLOB_CHAIN_ID"]),
    137
  );
  const privateKey = resolveString(
    config.privateKey,
    readEnv(env, ["POLYMARKET_PRIVATE_KEY", "CLOB_PRIVATE_KEY", "PK", "PRIVATE_KEY"])
  );

  if (!privateKey) {
    throw new Error(
      "Polymarket adapter requires a private key. Set POLYMARKET_PRIVATE_KEY (or pass config.privateKey)."
    );
  }

  const wallet = new Wallet(privateKey);
  const funderAddress = resolveString(
    config.funderAddress,
    readEnv(env, ["POLYMARKET_FUNDER", "CLOB_FUNDER", "FUNDER_ADDRESS"])
  );
  const signatureType = resolveSignatureType(config.signatureType, funderAddress, env);
  const shouldDeriveApiKey = resolveBoolean(
    config.deriveApiKey,
    readEnv(env, ["POLYMARKET_DERIVE_API_KEY", "CLOB_DERIVE_API_KEY"]),
    true
  );

  let apiCreds = config.apiCreds ?? readApiCredsFromEnv(env);
  if (!apiCreds && shouldDeriveApiKey) {
    const authClient = new ClobClient(host, chainId, wallet);
    apiCreds = await authClient.createOrDeriveApiKey();
  }

  if (!apiCreds) {
    throw new Error(
      "Polymarket adapter missing API credentials. Set POLYMARKET_API_KEY/POLYMARKET_API_SECRET/POLYMARKET_API_PASSPHRASE or enable deriveApiKey."
    );
  }

  return new ClobClient(host, chainId, wallet, apiCreds, signatureType, funderAddress);
}

async function postOrderFromPayload(
  client: PolymarketExecutionClient,
  payload: NormalizedOrderPayload
): Promise<unknown> {
  const side = payload.order.side === "BUY" ? Side.BUY : Side.SELL;
  const tickSize = payload.options.tickSize;
  const negRisk = payload.options.negRisk;
  const createOptions: Partial<CreateOrderOptions> = {
    tickSize: tickSize as CreateOrderOptions["tickSize"],
    negRisk,
  };

  if (payload.orderType === "FOK" || payload.orderType === "FAK") {
    const amount = payload.order.amount ?? payload.order.size;
    if (amount === undefined) {
      throw new Error(
        `Polymarket ${payload.orderType} order requires args.amount (or args.size for compatibility)`
      );
    }

    const order: UserMarketOrder = {
      tokenID: payload.order.tokenID,
      price: payload.order.price,
      amount,
      side,
    };
    return client.createAndPostMarketOrder(
      order,
      createOptions,
      payload.orderType === "FOK" ? OrderType.FOK : OrderType.FAK
    );
  }

  const size = payload.order.size ?? payload.order.amount;
  if (size === undefined) {
    throw new Error(`Polymarket ${payload.orderType} order requires args.size`);
  }

  const order: UserOrder = {
    tokenID: payload.order.tokenID,
    price: payload.order.price,
    size,
    side,
    ...(payload.order.expiration !== undefined ? { expiration: payload.order.expiration } : {}),
  };

  return client.createAndPostOrder(
    order,
    createOptions,
    payload.orderType === "GTC" ? OrderType.GTC : OrderType.GTD
  );
}

function assertChainSupported(meta: VenueAdapter["meta"], chainId: number): void {
  if (!meta.supportedChains.includes(chainId)) {
    throw new Error(`Polymarket adapter is not configured for chain ${chainId}`);
  }
}

function toCustomAction(action: Action): SupportedCustomAction {
  if (action.type !== "custom") {
    throw new Error("Polymarket adapter only supports custom actions");
  }
  return action;
}

function normalizeCustomOp(op: string): SupportedCustomOp {
  const normalized = op.trim().toLowerCase();
  if (isSupportedCustomOp(normalized)) {
    return normalized;
  }

  throw new Error(
    `Polymarket adapter does not support custom op '${op}'. Supported ops: ${SUPPORTED_CUSTOM_OPS.join(", ")}`
  );
}

function isSupportedCustomOp(value: string): value is SupportedCustomOp {
  return SUPPORTED_CUSTOM_OPS.includes(value as SupportedCustomOp);
}

function describeBuild(
  op: SupportedCustomOp,
  action: SupportedCustomAction,
  config: PolymarketAdapterConfig
): string {
  if (op === "order") {
    const payload = normalizeOrderPayload(action, config);
    const quantity = payload.order.size ?? payload.order.amount;
    return `Polymarket order ${payload.order.side} ${quantity} @ ${payload.order.price} (${payload.orderType})`;
  }

  if (op === "cancel_order") {
    const orderId = resolveRequiredStringArg(action.args, ["order_id", "orderId", "id", "arg0"]);
    return `Polymarket cancel order ${orderId}`;
  }

  if (op === "cancel_orders") {
    const orderIds = resolveRequiredStringArrayArg(action.args, [
      "order_ids",
      "orderIds",
      "ids",
      "arg0",
    ]);
    return `Polymarket cancel ${orderIds.length} orders`;
  }

  if (op === "cancel_all") {
    return "Polymarket cancel all orders";
  }

  return "Polymarket heartbeat";
}

function normalizeOrderPayload(
  action: SupportedCustomAction,
  config: PolymarketAdapterConfig
): NormalizedOrderPayload {
  const tokenID = resolveRequiredStringArg(action.args, [
    "tokenID",
    "token_id",
    "tokenId",
    "coin",
    "market",
    "arg0",
  ]);
  const price = resolveRequiredNumericArg(action.args, ["price", "arg1"], "price");
  const side = normalizeOrderSide(
    resolveRequiredStringArg(action.args, ["side", "order_side", "intent", "arg3"])
  );
  const size = resolveOptionalNumericArg(action.args, ["size", "quantity", "shares", "arg2"]);
  const amount = resolveOptionalNumericArg(action.args, [
    "amount",
    "cash_order_qty",
    "cashOrderQty",
  ]);

  if (size === undefined && amount === undefined) {
    throw new Error("Polymarket custom order requires args.size or args.amount");
  }

  const expiration = resolveOptionalIntegerArg(action.args, [
    "expiration",
    "good_till_time",
    "goodTillTime",
  ]);
  const orderType = normalizeOrderType(
    resolveOptionalStringArg(action.args, ["order_type", "orderType", "tif", "arg5"]) ?? "GTC"
  );
  const tickSize = resolveTickSize(action.args, config.defaultTickSize ?? DEFAULT_TICK_SIZE);
  const negRisk = resolveNegRisk(action.args, config.defaultNegRisk ?? DEFAULT_NEG_RISK);

  return {
    order: {
      tokenID,
      price,
      side,
      ...(size !== undefined ? { size } : {}),
      ...(amount !== undefined ? { amount } : {}),
      ...(expiration !== undefined ? { expiration } : {}),
    },
    options: {
      tickSize,
      negRisk,
    },
    orderType,
  };
}

function normalizeOrderSide(value: string): PolymarketOrderSide {
  const normalized = value.trim().toUpperCase();
  if (
    normalized === "BUY" ||
    normalized === "ORDER_SIDE_BUY" ||
    normalized === "ORDER_INTENT_BUY_LONG" ||
    normalized === "ORDER_INTENT_BUY_SHORT"
  ) {
    return "BUY";
  }
  if (
    normalized === "SELL" ||
    normalized === "ORDER_SIDE_SELL" ||
    normalized === "ORDER_INTENT_SELL_LONG" ||
    normalized === "ORDER_INTENT_SELL_SHORT"
  ) {
    return "SELL";
  }
  throw new Error(
    "Polymarket custom order args.side must be BUY or SELL (supports ORDER_SIDE_* and ORDER_INTENT_* aliases)"
  );
}

function normalizeOrderType(value: string): PolymarketOrderType {
  const normalized = value.trim().toUpperCase();
  if (
    normalized === "GTC" ||
    normalized === "TIME_IN_FORCE_GOOD_TILL_CANCEL" ||
    normalized === "ORDER_TYPE_GTC"
  ) {
    return "GTC";
  }
  if (
    normalized === "GTD" ||
    normalized === "TIME_IN_FORCE_GOOD_TILL_DATE" ||
    normalized === "ORDER_TYPE_GTD"
  ) {
    return "GTD";
  }
  if (
    normalized === "FOK" ||
    normalized === "TIME_IN_FORCE_FILL_OR_KILL" ||
    normalized === "ORDER_TYPE_FOK"
  ) {
    return "FOK";
  }
  if (
    normalized === "FAK" ||
    normalized === "IOC" ||
    normalized === "TIME_IN_FORCE_IMMEDIATE_OR_CANCEL" ||
    normalized === "ORDER_TYPE_FAK"
  ) {
    return "FAK";
  }
  throw new Error("Polymarket custom order args.order_type must be one of GTC, GTD, FOK, FAK");
}

function resolveTickSize(args: Record<string, unknown>, fallback: string): string {
  let tickSize = resolveOptionalStringArg(args, ["tick_size", "tickSize"]);
  if (!tickSize) {
    const reduceOnly = args.reduce_only ?? args.reduceOnly;
    if (typeof reduceOnly === "string") {
      tickSize = reduceOnly;
    }
  }

  const value = (tickSize ?? fallback).trim();
  if (!/^\d+(\.\d+)?$/.test(value)) {
    throw new Error(`Polymarket custom order tickSize must be a decimal string, got '${value}'`);
  }
  return value;
}

function resolveNegRisk(args: Record<string, unknown>, fallback: boolean): boolean {
  const direct = resolveOptionalBooleanArg(args, ["neg_risk", "negRisk"]);
  if (direct !== undefined) {
    return direct;
  }

  const reduceOnly = args.reduce_only ?? args.reduceOnly;
  if (typeof reduceOnly === "boolean") {
    return reduceOnly;
  }

  return fallback;
}

function resolveRequiredStringArg(args: Record<string, unknown>, keys: string[]): string {
  const value = resolveOptionalStringArg(args, keys);
  if (!value) {
    throw new Error(`Missing required Polymarket argument: ${keys[0]}`);
  }
  return value;
}

function resolveOptionalStringArg(
  args: Record<string, unknown>,
  keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
  }
  return undefined;
}

function resolveRequiredStringArrayArg(args: Record<string, unknown>, keys: string[]): string[] {
  const values = resolveOptionalStringArrayArg(args, keys);
  if (!values || values.length === 0) {
    throw new Error(`Missing required Polymarket argument: ${keys[0]}`);
  }
  return values;
}

function resolveOptionalStringArrayArg(
  args: Record<string, unknown>,
  keys: string[]
): string[] | undefined {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        return [trimmed];
      }
    }
    if (Array.isArray(value)) {
      const items: string[] = [];
      for (const entry of value) {
        if (typeof entry !== "string" || entry.trim().length === 0) {
          throw new Error(`Polymarket argument '${key}' must contain only non-empty strings`);
        }
        items.push(entry.trim());
      }
      if (items.length > 0) {
        return items;
      }
    }
  }
  return undefined;
}

function resolveRequiredNumericArg(
  args: Record<string, unknown>,
  keys: string[],
  label: string
): number {
  const value = resolveOptionalNumericArg(args, keys);
  if (value === undefined) {
    throw new Error(`Missing required Polymarket numeric argument: ${label}`);
  }
  return value;
}

function resolveOptionalNumericArg(
  args: Record<string, unknown>,
  keys: string[]
): number | undefined {
  for (const key of keys) {
    const value = toFiniteNumber(args[key]);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function resolveOptionalIntegerArg(
  args: Record<string, unknown>,
  keys: string[]
): number | undefined {
  for (const key of keys) {
    const raw = args[key];
    const value = toFiniteNumber(raw);
    if (value === undefined) {
      continue;
    }
    if (!Number.isInteger(value)) {
      throw new Error(`Polymarket argument '${key}' must be an integer`);
    }
    return value;
  }
  return undefined;
}

function resolveOptionalBooleanArg(
  args: Record<string, unknown>,
  keys: string[]
): boolean | undefined {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "boolean") {
      return value;
    }
  }
  return undefined;
}

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return undefined;
    return value;
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) return undefined;
    return parsed;
  }

  return undefined;
}

function readApiCredsFromEnv(env: Record<string, string | undefined>): ApiKeyCreds | undefined {
  const key = readEnv(env, ["POLYMARKET_API_KEY", "CLOB_API_KEY", "POLY_API_KEY"]);
  const secret = readEnv(env, ["POLYMARKET_API_SECRET", "CLOB_SECRET", "POLY_API_SECRET"]);
  const passphrase = readEnv(env, [
    "POLYMARKET_API_PASSPHRASE",
    "CLOB_PASS_PHRASE",
    "POLY_API_PASSPHRASE",
  ]);

  if (!key || !secret || !passphrase) {
    return undefined;
  }

  return { key, secret, passphrase };
}

function resolveSignatureType(
  explicit: PolymarketSignatureType | undefined,
  funderAddress: string | undefined,
  env: Record<string, string | undefined>
): PolymarketSignatureType {
  if (explicit !== undefined) {
    return explicit;
  }

  const fromEnv = readEnv(env, ["POLYMARKET_SIGNATURE_TYPE", "CLOB_SIGNATURE_TYPE"]);
  if (fromEnv) {
    const parsed = Number(fromEnv);
    if (parsed === 0 || parsed === 1 || parsed === 2) {
      return parsed;
    }
    throw new Error(
      `Invalid Polymarket signature type '${fromEnv}'. Expected 0 (EOA), 1 (POLY_PROXY), or 2 (GNOSIS_SAFE).`
    );
  }

  return funderAddress ? 2 : 0;
}

function resolveBoolean(
  explicit: boolean | undefined,
  fromEnv: string | undefined,
  fallback: boolean
): boolean {
  if (explicit !== undefined) {
    return explicit;
  }
  if (!fromEnv) {
    return fallback;
  }

  const normalized = fromEnv.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no") {
    return false;
  }
  throw new Error(`Invalid boolean value '${fromEnv}'`);
}

function resolveNumber(
  explicit: number | undefined,
  fromEnv: string | undefined,
  fallback: number
): number {
  if (explicit !== undefined) {
    return explicit;
  }
  if (!fromEnv) {
    return fallback;
  }
  const parsed = Number(fromEnv);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric value '${fromEnv}'`);
  }
  return parsed;
}

function resolveString(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function readEnv(env: Record<string, string | undefined>, names: string[]): string | undefined {
  for (const name of names) {
    const value = env[name];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function readStringField(payload: unknown, keys: string[]): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const record = payload as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}
