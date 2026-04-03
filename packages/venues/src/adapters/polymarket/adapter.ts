import { Wallet } from "@ethersproject/wallet";
import type { Action, MetricRequest, VenueAdapter } from "@grimoirelabs/core";
import {
  ClobClient,
  type CreateOrderOptions,
  OrderType,
  Side,
  type UserMarketOrder,
  type UserOrder,
} from "@polymarket/clob-client";
import { zeroAddress } from "viem";
import { assertSupportedConstraints } from "../../shared/constraints.js";
import { parseMetricSelector, readMetricSelectorString } from "../../shared/metric-selector.js";
import {
  readApiCredsFromEnv,
  readEnv,
  readStringField,
  resolveBoolean,
  resolveNumber,
  resolveOptionalStringArg,
  resolveRequiredStringArg,
  resolveRequiredStringArrayArg,
  resolveSignatureType,
  resolveString,
} from "./args.js";
import { describeBuild, normalizeOrderPayload } from "./order.js";
import type {
  NormalizedOrderPayload,
  PolymarketAdapterConfig,
  PolymarketExecutionClient,
  SupportedCustomAction,
  SupportedCustomOp,
} from "./types.js";
import {
  DEFAULT_HOST,
  DEFAULT_REQUIRED_ENV,
  DEFAULT_SUPPORTED_CHAINS,
  POLYMARKET_META_BASE,
  SUPPORTED_CUSTOM_OPS,
} from "./types.js";

export function createPolymarketAdapter(config: PolymarketAdapterConfig = {}): VenueAdapter {
  const env = config.env ?? process.env;
  const meta: VenueAdapter["meta"] = {
    ...POLYMARKET_META_BASE,
    supportedChains: config.supportedChains ?? DEFAULT_SUPPORTED_CHAINS,
    requiredEnv: config.requiredEnv ?? DEFAULT_REQUIRED_ENV,
    metricSurfaces: ["mid_price"],
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
    async readMetric(request: MetricRequest, ctx) {
      if (request.surface !== "mid_price") {
        throw new Error(`Polymarket does not support metric surface '${request.surface}'`);
      }

      const selector = parseMetricSelector(request.selector);
      const tokenId =
        readMetricSelectorString(selector, ["token_id", "tokenid", "market_id", "id"], {
          fallback: request.asset,
          required: true,
          label: "token_id",
        }) ?? "";
      const host =
        resolveString(config.host, readEnv(env, ["POLYMARKET_CLOB_HOST", "CLOB_API_URL"])) ??
        DEFAULT_HOST;
      const chainId = resolveNumber(
        config.clobChainId,
        readEnv(env, ["POLYMARKET_CLOB_CHAIN_ID", "CLOB_CHAIN_ID"]),
        ctx.chainId
      );
      return await readPolymarketMidPrice(host, chainId, tokenId);
    },
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

export async function createClobExecutionClient(
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

export async function postOrderFromPayload(
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

export function assertChainSupported(meta: VenueAdapter["meta"], chainId: number): void {
  if (!meta.supportedChains.includes(chainId)) {
    throw new Error(`Polymarket adapter is not configured for chain ${chainId}`);
  }
}

export function toCustomAction(action: Action): SupportedCustomAction {
  if (action.type !== "custom") {
    throw new Error("Polymarket adapter only supports custom actions");
  }
  return action;
}

export function normalizeCustomOp(op: string): SupportedCustomOp {
  const normalized = op.trim().toLowerCase();
  if (isSupportedCustomOp(normalized)) {
    return normalized;
  }

  throw new Error(
    `Polymarket adapter does not support custom op '${op}'. Supported ops: ${SUPPORTED_CUSTOM_OPS.join(", ")}`
  );
}

export function isSupportedCustomOp(value: string): value is SupportedCustomOp {
  return SUPPORTED_CUSTOM_OPS.includes(value as SupportedCustomOp);
}

async function readPolymarketMidPrice(
  host: string,
  chainId: number,
  tokenId: string
): Promise<number> {
  const client = new ClobClient(host, chainId);
  const payload = await client.getMidpoint(tokenId);
  if (payload && typeof payload === "object") {
    const status = (payload as { status?: unknown }).status;
    const error = (payload as { error?: unknown }).error;
    if ((typeof status === "number" && status >= 400) || typeof error === "string") {
      throw new Error(
        `Polymarket midpoint query failed for token '${tokenId}': ${String(error ?? `status ${status}`)}`
      );
    }
  }
  const price = pickFiniteNumber(payload);
  if (price === null) {
    throw new Error(`Polymarket midpoint unavailable for token '${tokenId}'`);
  }
  return price;
}

function pickFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (!value || typeof value !== "object") {
    return null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const candidate = pickFiniteNumber(item);
      if (candidate !== null) return candidate;
    }
    return null;
  }

  const record = value as Record<string, unknown>;
  const priorityKeys = ["mid", "midpoint", "price", "value", "result"];
  for (const key of priorityKeys) {
    if (key in record) {
      const candidate = pickFiniteNumber(record[key]);
      if (candidate !== null) return candidate;
    }
  }
  for (const nested of Object.values(record)) {
    const candidate = pickFiniteNumber(nested);
    if (candidate !== null) return candidate;
  }
  return null;
}
