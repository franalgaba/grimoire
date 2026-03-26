import type { Action, Address, CustomAction, VenueAdapterContext } from "@grimoirelabs/core";
import { isAddressLike, resolveTokenAddress } from "../../shared/token-registry.js";
import {
  bpsToDecimal,
  parseBigIntList,
  parseOptionalBoolean,
  parseOptionalString,
  parseOptionalStringList,
  parseStringList,
  toBigIntStrict,
} from "./helpers.js";
import type { PendleAdapterConfig, PendleConvertRequest, PendleOptions } from "./types.js";

export function toConvertRequest(
  action: Action,
  ctx: VenueAdapterContext,
  config: PendleAdapterConfig,
  slippageBps: number,
  singleInputActions: Set<string>,
  multiInputActions: Set<string>
): PendleConvertRequest {
  const ZERO = "0x0000000000000000000000000000000000000000";
  const defaultReceiver = (
    ctx.vault && ctx.vault !== ZERO ? ctx.vault : ctx.walletAddress
  ) as string;

  if (action.type === "custom") {
    return buildRequestFromCustomConvert(action, ctx.chainId, config, slippageBps, defaultReceiver);
  }

  const options = readPendleOptions(action);
  const receiver = options.receiver ?? defaultReceiver;

  if (action.type === "swap") {
    const tokenIn = resolveAssetAddress(action.assetIn, ctx.chainId, config.tokenMap);
    const tokenOut = resolveAssetAddress(action.assetOut, ctx.chainId, config.tokenMap);
    const amountIn = toBigIntStrict(action.amount, "swap amount");
    return {
      receiver,
      slippage: bpsToDecimal(slippageBps),
      enableAggregator: options.enableAggregator,
      aggregators: options.aggregators,
      needScale: options.needScale,
      redeemRewards: options.redeemRewards,
      additionalData: options.additionalData,
      useLimitOrder: options.useLimitOrder,
      inputs: [{ token: tokenIn, amount: amountIn.toString() }],
      outputs: [tokenOut],
    };
  }

  if (singleInputActions.has(action.type)) {
    const single = action as Extract<
      Action,
      {
        type:
          | "add_liquidity"
          | "remove_liquidity"
          | "mint_py"
          | "redeem_py"
          | "mint_sy"
          | "redeem_sy"
          | "roll_over_pt"
          | "convert_lp_to_pt";
      }
    >;
    const tokenIn = resolveAssetAddress(single.asset, ctx.chainId, config.tokenMap);
    const amountIn = toBigIntStrict(single.amount, `${single.type} amount`);
    const outputs = resolveOutputTokens(
      single.assetOut,
      single.outputs,
      ctx.chainId,
      config.tokenMap
    );
    return {
      receiver,
      slippage: bpsToDecimal(slippageBps),
      enableAggregator: options.enableAggregator,
      aggregators: options.aggregators,
      needScale: options.needScale,
      redeemRewards: options.redeemRewards,
      additionalData: options.additionalData,
      useLimitOrder: options.useLimitOrder,
      inputs: [{ token: tokenIn, amount: amountIn.toString() }],
      outputs,
    };
  }

  if (multiInputActions.has(action.type)) {
    const multi = action as Extract<
      Action,
      {
        type:
          | "add_liquidity_dual"
          | "remove_liquidity_dual"
          | "transfer_liquidity"
          | "exit_market"
          | "pendle_swap";
      }
    >;
    const inputs = multi.inputs.map((input, index) => ({
      token: resolveAssetAddress(input.asset, ctx.chainId, config.tokenMap),
      amount: toBigIntStrict(input.amount, `${multi.type} input #${index + 1}`).toString(),
    }));
    const outputs = resolveOutputTokens(undefined, multi.outputs, ctx.chainId, config.tokenMap);
    return {
      receiver,
      slippage: bpsToDecimal(slippageBps),
      enableAggregator: options.enableAggregator,
      aggregators: options.aggregators,
      needScale: options.needScale,
      redeemRewards: options.redeemRewards,
      additionalData: options.additionalData,
      useLimitOrder: options.useLimitOrder,
      inputs,
      outputs,
    };
  }

  throw new Error(`Unsupported Pendle action '${action.type}'`);
}

export function buildRequestFromCustomConvert(
  action: CustomAction,
  chainId: number,
  config: PendleAdapterConfig,
  slippageBps: number,
  defaultReceiver: string
): PendleConvertRequest {
  const tokensInRaw = requireCustomArg(action, "tokens_in");
  const amountsInRaw = requireCustomArg(action, "amounts_in");
  const tokensOutRaw = requireCustomArg(action, "tokens_out");
  const tokensIn = parseStringList(tokensInRaw, "tokens_in");
  const amountsIn = parseBigIntList(amountsInRaw, "amounts_in");
  const tokensOut = parseStringList(tokensOutRaw, "tokens_out");

  if (tokensIn.length !== amountsIn.length) {
    throw new Error(
      "Pendle custom convert requires tokens_in and amounts_in with matching lengths"
    );
  }

  const inputs = tokensIn.map((token, index) => ({
    token: resolveAssetAddress(token, chainId, config.tokenMap),
    amount: (amountsIn[index] ?? 0n).toString(),
  }));
  const outputs = tokensOut.map((token) => resolveAssetAddress(token, chainId, config.tokenMap));

  const receiver = parseOptionalString(action.args.receiver) ?? defaultReceiver;
  const enableAggregator = parseOptionalBoolean(action.args.enable_aggregator) ?? false;
  const aggregators = parseOptionalStringList(action.args.aggregators);
  const needScale = parseOptionalBoolean(action.args.need_scale);
  const redeemRewards = parseOptionalBoolean(action.args.redeem_rewards);
  const additionalData = parseOptionalString(action.args.additional_data);
  const useLimitOrder = parseOptionalBoolean(action.args.use_limit_order);

  return {
    receiver,
    slippage: bpsToDecimal(slippageBps),
    enableAggregator,
    aggregators,
    needScale,
    redeemRewards,
    additionalData,
    useLimitOrder,
    inputs,
    outputs,
  };
}

export function requireCustomArg(action: CustomAction, key: string): unknown {
  const value = action.args[key];
  if (value === undefined || value === null) {
    throw new Error(`Pendle custom convert requires '${key}'`);
  }
  return value;
}

export function readPendleOptions(action: Action): PendleOptions {
  const record: Record<string, unknown> = { ...action };
  return {
    receiver: parseOptionalString(record.receiver),
    enableAggregator:
      parseOptionalBoolean(record.enableAggregator ?? record.enable_aggregator) ?? false,
    aggregators: parseOptionalStringList(record.aggregators),
    needScale: parseOptionalBoolean(record.needScale ?? record.need_scale),
    redeemRewards: parseOptionalBoolean(record.redeemRewards ?? record.redeem_rewards),
    additionalData: parseOptionalString(record.additionalData ?? record.additional_data),
    useLimitOrder: parseOptionalBoolean(record.useLimitOrder ?? record.use_limit_order),
  };
}

export function resolveOutputTokens(
  assetOut: string | undefined,
  outputs: string[] | undefined,
  chainId: number,
  tokenMap: PendleAdapterConfig["tokenMap"]
): string[] {
  const outputAssets = outputs && outputs.length > 0 ? outputs : assetOut ? [assetOut] : [];
  if (outputAssets.length === 0) {
    throw new Error("Pendle action requires output token(s) via assetOut or outputs");
  }
  return outputAssets.map((asset) => resolveAssetAddress(asset, chainId, tokenMap));
}

export function resolveAssetAddress(
  asset: string,
  chainId: number,
  tokenMap: PendleAdapterConfig["tokenMap"]
): Address {
  if (isAddressLike(asset)) {
    return asset as Address;
  }

  const map = tokenMap?.[chainId];
  if (map) {
    const direct = map[asset] ?? map[asset.toUpperCase()] ?? map[asset.toLowerCase()];
    if (direct) return direct;
  }

  try {
    return resolveTokenAddress(asset, chainId);
  } catch {
    // Pendle PT/YT/SY tokens aren't in the shared token registry.
    // Provide a helpful error message so the agent can retry with an address.
    const isPendleToken = /^(PT|YT|SY)[_-]/i.test(asset);
    if (isPendleToken) {
      throw new Error(
        `Unknown Pendle asset '${asset}' on chain ${chainId}. ` +
          `PT/YT/SY tokens require explicit addresses. ` +
          `Use 'grimoire venue pendle assets --chain ${chainId} --query ${asset.replace(/^(PT|YT|SY)[_-]/i, "")}' to find the address, ` +
          `then use the 0x address directly in the spell.`
      );
    }
    throw new Error(`Unknown asset '${asset}' on chain ${chainId}. Provide address directly.`);
  }
}
