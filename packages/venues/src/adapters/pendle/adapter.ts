import type { Action, Address, VenueAdapter, VenueAdapterContext } from "@grimoirelabs/core";
import { assertSupportedConstraints, validateGasConstraints } from "../../shared/constraints.js";
import { requestConvert } from "./api.js";
import { toConvertRequest } from "./convert.js";
import {
  applyBps,
  buildPendleApprovals,
  estimateGasIfSupported,
  resolveSlippageBps,
  sumTokenAmounts,
  toBigIntIfPossible,
  toBigIntStrict,
} from "./helpers.js";
import type { FetchFn, PendleAdapterConfig } from "./types.js";

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

      // Merge spell-defined asset addresses into config tokenMap
      const configWithSpellAssets = mergeSpellAssets(config, ctx);

      // Pre-resolve Pendle PT/YT/SY tokens that aren't in the shared registry
      const resolvedConfig = await preResolvePendleTokens(
        action,
        ctx.chainId,
        configWithSpellAssets,
        baseUrl,
        fetchFn
      );

      const slippageBps = resolveSlippageBps(
        action.constraints?.maxSlippageBps,
        config.slippageBps,
        DEFAULT_SLIPPAGE_BPS
      );
      const request = toConvertRequest(
        action,
        ctx,
        resolvedConfig,
        slippageBps,
        SINGLE_INPUT_PENDLE_ACTIONS,
        MULTI_INPUT_PENDLE_ACTIONS
      );

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
      if (routes.length > 1) {
        ctx.onWarning?.(
          `Pendle returned ${routes.length} routes; using first (best) route. Review outputs to confirm expected behavior.`
        );
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
      validateGasConstraints({
        gasLimit: gasEstimate?.gasLimit,
        constraints: action.constraints,
        venueName: "Pendle adapter",
      });

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

export function isSupportedPendleAction(action: Action): boolean {
  if ((PENDLE_ACTIONS as readonly string[]).includes(action.type)) {
    return true;
  }
  return action.type === "custom" && action.op === "convert";
}

/**
 * Merge spell-defined asset addresses into the adapter config tokenMap
 * so that resolveAssetAddress can find them by symbol.
 */
function mergeSpellAssets(
  config: PendleAdapterConfig,
  ctx: VenueAdapterContext
): PendleAdapterConfig {
  if (!ctx.assets || ctx.assets.length === 0) return config;

  const relevantAssets = ctx.assets.filter((a) => a.chain === ctx.chainId && a.address);
  if (relevantAssets.length === 0) return config;

  const existing = config.tokenMap?.[ctx.chainId] ?? {};
  const merged: Record<string, Address> = { ...existing };
  for (const asset of relevantAssets) {
    if (!merged[asset.symbol]) {
      merged[asset.symbol] = asset.address;
    }
  }

  return { ...config, tokenMap: { ...config.tokenMap, [ctx.chainId]: merged } };
}

const PENDLE_TOKEN_PREFIX = /^(PT|YT|SY)[_-]/i;

/**
 * Extract all asset symbols from an action that might need Pendle API resolution.
 */
function collectAssetSymbols(action: Action): string[] {
  const symbols: string[] = [];
  if ("asset" in action && typeof action.asset === "string") symbols.push(action.asset);
  if ("assetIn" in action && typeof action.assetIn === "string") symbols.push(action.assetIn);
  if ("assetOut" in action && typeof action.assetOut === "string") symbols.push(action.assetOut);
  if ("outputs" in action && Array.isArray(action.outputs)) {
    for (const o of action.outputs) {
      if (typeof o === "string") symbols.push(o);
    }
  }
  if ("inputs" in action && Array.isArray(action.inputs)) {
    for (const i of action.inputs) {
      if (i && typeof i === "object" && "asset" in i && typeof i.asset === "string") {
        symbols.push(i.asset);
      }
    }
  }
  return symbols;
}

/**
 * Pre-resolve Pendle PT/YT/SY token symbols via the Pendle API.
 * Returns a config with resolved addresses injected into tokenMap.
 */
async function preResolvePendleTokens(
  action: Action,
  chainId: number,
  config: PendleAdapterConfig,
  baseUrl: string,
  fetchFn: FetchFn
): Promise<PendleAdapterConfig> {
  const symbols = collectAssetSymbols(action);
  const pendleSymbols = symbols.filter((s) => PENDLE_TOKEN_PREFIX.test(s) && !s.startsWith("0x"));

  if (pendleSymbols.length === 0) return config;

  // Check which symbols aren't already in tokenMap
  const existing = config.tokenMap?.[chainId] ?? {};
  const missing = pendleSymbols.filter(
    (s) => !existing[s] && !existing[s.toUpperCase()] && !existing[s.toLowerCase()]
  );

  if (missing.length === 0) return config;

  const resolved: Record<string, Address> = {};
  for (const symbol of missing) {
    const address = await searchPendleAsset(baseUrl, chainId, symbol, fetchFn);
    if (address) {
      resolved[symbol] = address;
    }
  }

  if (Object.keys(resolved).length === 0) return config;

  // Merge into a new config with resolved tokens
  const mergedMap = { ...config.tokenMap };
  mergedMap[chainId] = { ...existing, ...resolved };
  return { ...config, tokenMap: mergedMap };
}

/**
 * Search the Pendle API for a token by symbol prefix.
 * Converts underscore-delimited symbols (PT_FXSAVE) to dash-delimited (PT-fxSAVE)
 * and picks the first match.
 */
async function searchPendleAsset(
  baseUrl: string,
  chainId: number,
  symbol: string,
  fetchFn: FetchFn
): Promise<Address | undefined> {
  // Convert PT_FXSAVE → fxSAVE for search query
  const query = symbol.replace(PENDLE_TOKEN_PREFIX, "");
  // Extract type prefix for filtering (PT, YT, SY)
  const typePrefix = symbol.match(PENDLE_TOKEN_PREFIX)?.[1]?.toUpperCase();

  try {
    const url = `${baseUrl}/v1/${chainId}/assets?q=${encodeURIComponent(query)}&limit=20`;
    const response = await fetchFn(url);
    if (!response.ok) return undefined;

    const data = (await response.json()) as {
      results?: Array<{ address: string; symbol: string; baseType?: string }>;
    };
    if (!data.results || data.results.length === 0) return undefined;

    // Find best match: same type prefix (PT/YT/SY) and matching query
    const match = data.results.find(
      (r) =>
        r.baseType === typePrefix &&
        r.symbol
          .replace(/-/g, "_")
          .toUpperCase()
          .startsWith(symbol.replace(/-/g, "_").toUpperCase())
    );
    if (match) return match.address as Address;

    // Fallback: any result with matching type
    const typeMatch = data.results.find((r) => r.baseType === typePrefix);
    if (typeMatch) return typeMatch.address as Address;

    return undefined;
  } catch {
    return undefined;
  }
}
