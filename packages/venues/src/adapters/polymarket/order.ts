import {
  resolveOptionalBooleanArg,
  resolveOptionalIntegerArg,
  resolveOptionalNumericArg,
  resolveOptionalStringArg,
  resolveRequiredNumericArg,
  resolveRequiredStringArg,
  resolveRequiredStringArrayArg,
} from "./args.js";
import type {
  NormalizedOrderPayload,
  PolymarketAdapterConfig,
  PolymarketOrderSide,
  PolymarketOrderType,
  SupportedCustomAction,
  SupportedCustomOp,
} from "./types.js";
import { DEFAULT_NEG_RISK, DEFAULT_TICK_SIZE } from "./types.js";

const DECIMAL_STRING_PATTERN = /^\d+(\.\d+)?$/;

export function normalizeOrderPayload(
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

export function normalizeOrderSide(value: string): PolymarketOrderSide {
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

export function normalizeOrderType(value: string): PolymarketOrderType {
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

export function describeBuild(
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

export function resolveTickSize(args: Record<string, unknown>, fallback: string): string {
  let tickSize = resolveOptionalStringArg(args, ["tick_size", "tickSize"]);
  if (!tickSize) {
    const reduceOnly = args.reduce_only ?? args.reduceOnly;
    if (typeof reduceOnly === "string") {
      tickSize = reduceOnly;
    }
  }

  const value = (tickSize ?? fallback).trim();
  if (!DECIMAL_STRING_PATTERN.test(value)) {
    throw new Error(`Polymarket custom order tickSize must be a decimal string, got '${value}'`);
  }
  return value;
}

export function resolveNegRisk(args: Record<string, unknown>, fallback: boolean): boolean {
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
