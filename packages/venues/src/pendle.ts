import type {
  Action,
  Address,
  BuiltTransaction,
  CustomAction,
  VenueAdapter,
  VenueAdapterContext,
} from "@grimoirelabs/core";
import { assertSupportedConstraints } from "./constraints.js";
import { buildApprovalIfNeeded } from "./erc20.js";
import { isAddressLike, resolveTokenAddress } from "./token-registry.js";

type FetchFn = (
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1]
) => ReturnType<typeof fetch>;

export interface PendleAdapterConfig {
  baseUrl?: string;
  supportedChains?: number[];
  slippageBps?: number;
  tokenMap?: Record<number, Record<string, Address>>;
  fetchFn?: FetchFn;
  enableV2Fallback?: boolean;
}

interface PendleTokenAmount {
  token: string;
  amount: string;
  spender?: string;
}

interface PendleConvertData {
  aggregatorType?: string;
  priceImpact?: number;
  fee?: Record<string, unknown>;
}

interface PendleContractParamInfo {
  method?: string;
}

interface PendleRoute {
  contractParamInfo?: PendleContractParamInfo;
  tx?: {
    to?: string;
    data?: string;
    value?: string;
  };
  outputs?: PendleTokenAmount[];
  data?: PendleConvertData;
}

interface PendleConvertResponse {
  action?: string;
  inputs?: PendleTokenAmount[];
  requiredApprovals?: PendleTokenAmount[];
  routes?: PendleRoute[];
}

interface PendleConvertRequest {
  receiver?: string;
  slippage: number;
  enableAggregator: boolean;
  aggregators?: string[];
  inputs: PendleTokenAmount[];
  outputs: string[];
  redeemRewards?: boolean;
  needScale?: boolean;
  additionalData?: string;
  useLimitOrder?: boolean;
}

interface PendleOptions {
  receiver?: string;
  enableAggregator: boolean;
  aggregators?: string[];
  needScale?: boolean;
  redeemRewards?: boolean;
  additionalData?: string;
  useLimitOrder?: boolean;
}

const DEFAULT_BASE_URL = "https://api-v2.pendle.finance/core";
const DEFAULT_SLIPPAGE_BPS = 50;
const DEFAULT_SUPPORTED_CHAINS = [1, 10, 56, 100, 137, 42161, 8453];

const PENDLE_ACTIONS = [
  "swap",
  "add_liquidity",
  "add_liquidity_dual",
  "remove_liquidity",
  "remove_liquidity_dual",
  "mint_py",
  "redeem_py",
  "mint_sy",
  "redeem_sy",
  "transfer_liquidity",
  "roll_over_pt",
  "exit_market",
  "convert_lp_to_pt",
  "pendle_swap",
] as const;

const SINGLE_INPUT_PENDLE_ACTIONS = new Set([
  "add_liquidity",
  "remove_liquidity",
  "mint_py",
  "redeem_py",
  "mint_sy",
  "redeem_sy",
  "roll_over_pt",
  "convert_lp_to_pt",
]);

const MULTI_INPUT_PENDLE_ACTIONS = new Set([
  "add_liquidity_dual",
  "remove_liquidity_dual",
  "transfer_liquidity",
  "exit_market",
  "pendle_swap",
]);

export function createPendleAdapter(config: PendleAdapterConfig = {}): VenueAdapter {
  const baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  const fetchFn = config.fetchFn ?? fetch;
  const enableV2Fallback = config.enableV2Fallback ?? true;
  const meta: VenueAdapter["meta"] = {
    name: "pendle",
    executionType: "evm",
    supportedChains: config.supportedChains ?? DEFAULT_SUPPORTED_CHAINS,
    actions: [...PENDLE_ACTIONS, "custom"],
    supportedConstraints: ["max_slippage", "min_output", "require_quote", "max_gas"],
    supportsQuote: true,
    supportsSimulation: false,
    supportsPreviewCommit: true,
    dataEndpoints: ["chains", "supported-aggregators", "markets", "assets", "market-tokens"],
    requiredEnv: [
      "KYBERSWAP-API-KEY",
      "ODOS-API-KEY",
      "OKX-ACCESS-KEY",
      "OKX-ACCESS-SECRET",
      "OKX-PASSPHRASE",
      "PARASWAP-API-KEY",
    ],
    description: "Pendle Hosted SDK convert adapter",
  };

  return {
    meta,
    async buildAction(action, ctx) {
      assertSupportedConstraints(meta, action);

      if (!meta.supportedChains.includes(ctx.chainId)) {
        throw new Error(`Pendle adapter is not configured for chain ${ctx.chainId}`);
      }

      if (action.type === "swap" && action.mode === "exact_out") {
        throw new Error("Pendle swap exact_out is not supported in V1");
      }

      if (!isSupportedPendleAction(action)) {
        throw new Error(`Pendle adapter does not support action '${action.type}'`);
      }

      const slippageBps = resolveSlippageBps(
        action.constraints?.maxSlippageBps,
        config.slippageBps
      );
      const request = toConvertRequest(action, ctx, config, slippageBps);

      const convert = await requestConvert({
        baseUrl,
        chainId: ctx.chainId,
        request,
        fetchFn,
        enableV2Fallback,
      });
      const warnings = [...convert.warnings];

      const routes = convert.response.routes ?? [];
      if (routes.length === 0) {
        const noRouteMessage = request.enableAggregator
          ? "No Pendle route found for requested inputs/outputs."
          : "No Pendle route without aggregator; set enable_aggregator=true or change inputs.";
        ctx.onWarning?.(noRouteMessage);
        throw new Error(noRouteMessage);
      }
      const route = routes[0];
      if (!route || !route.tx?.to || !route.tx?.data) {
        throw new Error("Pendle convert response did not return a usable tx route");
      }

      const routeOutAmount = toBigIntIfPossible(route.outputs?.[0]?.amount);
      if (action.constraints?.minOutput !== undefined) {
        if (routeOutAmount === undefined) {
          throw new Error(
            "Pendle route did not return output amount required for min_output check"
          );
        }
        if (routeOutAmount < action.constraints.minOutput) {
          throw new Error(
            `Pendle route output ${routeOutAmount.toString()} is below min_output ${action.constraints.minOutput.toString()}`
          );
        }
      }

      const txTo = route.tx.to as Address;
      const txData = route.tx.data as `0x${string}`;
      const txValue =
        route.tx.value === undefined ? 0n : toBigIntStrict(route.tx.value, "route tx value");

      const approvalTxs = await buildPendleApprovals({
        action,
        ctx,
        requiredApprovals: convert.response.requiredApprovals ?? [],
        defaultSpender: txTo,
      });

      const gasEstimate = await estimateGasIfSupported(ctx, {
        to: txTo,
        data: txData,
        value: txValue,
      });
      if (action.constraints?.maxGas !== undefined) {
        if (!gasEstimate?.gasLimit) {
          throw new Error("Pendle adapter could not estimate gas while max_gas is enabled");
        }
        if (gasEstimate.gasLimit > action.constraints.maxGas) {
          throw new Error(
            `Pendle gas estimate ${gasEstimate.gasLimit.toString()} exceeds max_gas ${action.constraints.maxGas.toString()}`
          );
        }
      }

      const expectedIn = sumTokenAmounts(convert.response.inputs);
      const expectedOut = routeOutAmount;
      const minOut =
        action.constraints?.minOutput ??
        (expectedOut !== undefined ? applyBps(expectedOut, 10_000 - slippageBps) : undefined);

      if (convert.usedV2Fallback) {
        warnings.push("Used /v2/sdk/{chainId}/convert fallback after v3 convert response issue.");
      }

      const mainTx = {
        tx: {
          to: txTo,
          data: txData,
          value: txValue,
        },
        description: `Pendle ${action.type} convert (${request.inputs.length} in -> ${request.outputs.length} out)`,
        gasEstimate,
        action,
        metadata: {
          quote: {
            expectedIn,
            expectedOut,
            minOut,
            slippageBps,
          },
          route: {
            pendleAction: convert.response.action ?? action.type,
            method: route.contractParamInfo?.method,
            aggregatorType: route.data?.aggregatorType,
            priceImpact: route.data?.priceImpact,
            gasEstimate: gasEstimate?.gasLimit,
          },
          fees: route.data?.fee,
          warnings: warnings.length > 0 ? warnings : undefined,
        },
      };

      return [...approvalTxs, mainTx];
    },
  };
}

export const pendleAdapter = createPendleAdapter();

function isSupportedPendleAction(action: Action): boolean {
  if ((PENDLE_ACTIONS as readonly string[]).includes(action.type)) {
    return true;
  }
  return action.type === "custom" && action.op === "convert";
}

function toConvertRequest(
  action: Action,
  ctx: VenueAdapterContext,
  config: PendleAdapterConfig,
  slippageBps: number
): PendleConvertRequest {
  const defaultReceiver = (ctx.vault ?? ctx.walletAddress) as string;

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

  if (SINGLE_INPUT_PENDLE_ACTIONS.has(action.type)) {
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

  if (MULTI_INPUT_PENDLE_ACTIONS.has(action.type)) {
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

function buildRequestFromCustomConvert(
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

function requireCustomArg(action: CustomAction, key: string): unknown {
  const value = action.args[key];
  if (value === undefined || value === null) {
    throw new Error(`Pendle custom convert requires '${key}'`);
  }
  return value;
}

function readPendleOptions(action: Action): PendleOptions {
  const record = action as unknown as Record<string, unknown>;
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

function resolveOutputTokens(
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

function resolveAssetAddress(
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

  return resolveTokenAddress(asset, chainId);
}

async function requestConvert(input: {
  baseUrl: string;
  chainId: number;
  request: PendleConvertRequest;
  fetchFn: FetchFn;
  enableV2Fallback: boolean;
}): Promise<{ response: PendleConvertResponse; warnings: string[]; usedV2Fallback: boolean }> {
  const warnings: string[] = [];
  try {
    const response = await requestConvertV3(
      input.baseUrl,
      input.chainId,
      input.request,
      input.fetchFn
    );
    if ((response.routes ?? []).length > 0 || !input.enableV2Fallback) {
      return { response, warnings, usedV2Fallback: false };
    }
    const fallback = await requestConvertV2(
      input.baseUrl,
      input.chainId,
      input.request,
      input.fetchFn
    );
    warnings.push("Pendle v3 convert returned no routes.");
    return { response: fallback, warnings, usedV2Fallback: true };
  } catch (error) {
    if (!input.enableV2Fallback) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    const fallback = await requestConvertV2(
      input.baseUrl,
      input.chainId,
      input.request,
      input.fetchFn
    );
    warnings.push(`Pendle v3 convert failed (${message}).`);
    return { response: fallback, warnings, usedV2Fallback: true };
  }
}

async function requestConvertV3(
  baseUrl: string,
  chainId: number,
  request: PendleConvertRequest,
  fetchFn: FetchFn
): Promise<PendleConvertResponse> {
  const response = await fetchFn(`${baseUrl}/v3/sdk/${chainId}/convert`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(request),
  });
  return await parseJsonResponse<PendleConvertResponse>(response, `/v3/sdk/${chainId}/convert`);
}

async function requestConvertV2(
  baseUrl: string,
  chainId: number,
  request: PendleConvertRequest,
  fetchFn: FetchFn
): Promise<PendleConvertResponse> {
  const params = new URLSearchParams();
  if (request.receiver) params.set("receiver", request.receiver);
  params.set("slippage", request.slippage.toString());
  params.set("tokensIn", request.inputs.map((input) => input.token).join(","));
  params.set("amountsIn", request.inputs.map((input) => input.amount).join(","));
  params.set("tokensOut", request.outputs.join(","));
  params.set("enableAggregator", request.enableAggregator ? "true" : "false");
  if (request.aggregators && request.aggregators.length > 0) {
    params.set("aggregators", request.aggregators.join(","));
  }
  if (request.redeemRewards !== undefined) {
    params.set("redeemRewards", request.redeemRewards ? "true" : "false");
  }
  if (request.needScale !== undefined) {
    params.set("needScale", request.needScale ? "true" : "false");
  }
  if (request.additionalData) {
    params.set("additionalData", request.additionalData);
  }
  if (request.useLimitOrder !== undefined) {
    params.set("useLimitOrder", request.useLimitOrder ? "true" : "false");
  }

  const response = await fetchFn(`${baseUrl}/v2/sdk/${chainId}/convert?${params.toString()}`, {
    method: "GET",
  });
  return await parseJsonResponse<PendleConvertResponse>(response, `/v2/sdk/${chainId}/convert`);
}

async function parseJsonResponse<T>(response: Response, endpoint: string): Promise<T> {
  const text = await response.text();
  let payload: unknown;
  try {
    payload = text.length > 0 ? (JSON.parse(text) as unknown) : {};
  } catch {
    throw new Error(`Pendle API ${endpoint} returned non-JSON response`);
  }

  if (!response.ok) {
    const details =
      payload && typeof payload === "object" && "message" in payload
        ? String((payload as { message?: unknown }).message)
        : text;
    throw new Error(`Pendle API ${endpoint} failed (${response.status}): ${details}`);
  }

  return payload as T;
}

async function buildPendleApprovals(input: {
  action: Action;
  ctx: VenueAdapterContext;
  requiredApprovals: PendleTokenAmount[];
  defaultSpender: Address;
}): Promise<BuiltTransaction[]> {
  const approvalsByToken = new Map<string, bigint>();
  const spenderByToken = new Map<string, Address>();

  for (const approval of input.requiredApprovals) {
    if (!approval?.token || !approval?.amount) continue;
    const token = approval.token.toLowerCase();
    const amount = toBigIntIfPossible(approval.amount) ?? 0n;
    if (amount <= 0n) continue;
    const current = approvalsByToken.get(token) ?? 0n;
    if (amount > current) {
      approvalsByToken.set(token, amount);
    }

    const spenderRaw = approval.spender;
    const spender =
      spenderRaw && isAddressLike(spenderRaw) ? (spenderRaw as Address) : input.defaultSpender;
    spenderByToken.set(token, spender);
  }

  const approvalTxs: BuiltTransaction[] = [];
  for (const [token, amount] of approvalsByToken.entries()) {
    const spender = spenderByToken.get(token) ?? input.defaultSpender;
    const txs = await buildApprovalIfNeeded({
      ctx: input.ctx,
      token: token as Address,
      spender,
      amount,
      action: input.action,
      description: `Approve ${token} for Pendle convert`,
    });
    approvalTxs.push(...txs);
  }

  return approvalTxs;
}

function sumTokenAmounts(items: PendleTokenAmount[] | undefined): bigint | undefined {
  if (!items || items.length === 0) {
    return undefined;
  }
  let total = 0n;
  let hasValue = false;
  for (const item of items) {
    const value = toBigIntIfPossible(item.amount);
    if (value === undefined) continue;
    total += value;
    hasValue = true;
  }
  return hasValue ? total : undefined;
}

function parseStringList(value: unknown, field: string): string[] {
  const list = parseOptionalStringList(value);
  if (!list || list.length === 0) {
    throw new Error(`Pendle custom convert requires '${field}'`);
  }
  return list;
}

function parseBigIntList(value: unknown, field: string): bigint[] {
  if (Array.isArray(value)) {
    return value.map((entry, index) => toBigIntStrict(entry, `${field}[${index}]`));
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
      .map((entry, index) => toBigIntStrict(entry, `${field}[${index}]`));
  }
  return [toBigIntStrict(value, field)];
}

function parseOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseOptionalStringList(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const items = value
      .map((entry) => (typeof entry === "string" ? entry.trim() : String(entry)))
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    return items.length > 0 ? items : undefined;
  }
  if (typeof value === "string") {
    const items = value
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    return items.length > 0 ? items : undefined;
  }
  return undefined;
}

function parseOptionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value === "true") return true;
    if (value === "false") return false;
  }
  return undefined;
}

function resolveSlippageBps(actionBps: number | undefined, configBps: number | undefined): number {
  const source = actionBps ?? configBps ?? DEFAULT_SLIPPAGE_BPS;
  return validateSlippageBps(source);
}

function validateSlippageBps(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error(`Pendle max_slippage must be a finite integer bps value; received ${value}`);
  }
  if (!Number.isInteger(value)) {
    throw new Error(`Pendle max_slippage must be an integer bps value; received ${value}`);
  }
  if (value < 0 || value > 10_000) {
    throw new Error(`Pendle max_slippage must be within [0, 10000] bps; received ${value}`);
  }
  return value;
}

function bpsToDecimal(bps: number): number {
  return bps / 10_000;
}

function toBigIntStrict(value: unknown, label: string): bigint {
  const parsed = toBigIntIfPossible(value);
  if (parsed === undefined) {
    throw new Error(`Pendle adapter requires numeric value for ${label}`);
  }
  return parsed;
}

function toBigIntIfPossible(value: unknown): bigint | undefined {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return undefined;
    return BigInt(Math.floor(value));
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    try {
      return BigInt(trimmed);
    } catch {
      return undefined;
    }
  }
  if (value && typeof value === "object" && "kind" in value && "value" in value) {
    const literal = value as { kind?: unknown; value?: unknown };
    if (literal.kind === "literal") {
      return toBigIntIfPossible(literal.value);
    }
  }
  return undefined;
}

function applyBps(amount: bigint, bps: number): bigint {
  return (amount * BigInt(bps)) / 10_000n;
}

async function estimateGasIfSupported(
  ctx: VenueAdapterContext,
  tx: { to: Address; data?: string; value?: bigint }
): Promise<BuiltTransaction["gasEstimate"] | undefined> {
  if (typeof ctx.provider.getGasEstimate !== "function") {
    return undefined;
  }

  try {
    return await ctx.provider.getGasEstimate({
      ...tx,
      from: ctx.walletAddress,
    });
  } catch {
    return undefined;
  }
}
