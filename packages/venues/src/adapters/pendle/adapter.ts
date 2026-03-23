import type { Action, Address, VenueAdapter } from "@grimoirelabs/core";
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
import type { PendleAdapterConfig } from "./types.js";

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
        config.slippageBps,
        DEFAULT_SLIPPAGE_BPS
      );
      const request = toConvertRequest(
        action,
        ctx,
        config,
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
