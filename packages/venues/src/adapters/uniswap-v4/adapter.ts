import type { Address, BuiltTransaction, VenueAdapter } from "@grimoirelabs/core";
import { encodeAbiParameters, encodeFunctionData } from "viem";
import { toBigInt } from "../../shared/bigint.js";
import { BPS_DENOMINATOR } from "../../shared/bps.js";
import { assertSupportedConstraints, validateGasConstraints } from "../../shared/constraints.js";
import { estimateGasIfSupported } from "../../shared/gas.js";
import { resolveTokenAddress as resolveVenueTokenAddress } from "../../shared/token-registry.js";
import {
  Commands,
  DEFAULT_QUOTERS,
  DEFAULT_ROUTERS,
  MSG_SENDER,
  NATIVE_ETH,
  type PoolKey,
  QUOTER_ABI,
  UNIVERSAL_ROUTER_ABI,
  ZERO_HOOKS,
} from "./constants.js";
import {
  computeSlippageBpsFromMaxIn,
  computeSlippageBpsFromMinOut,
  encodeV4SwapInput,
} from "./encoding.js";
import { buildPermit2Approvals } from "./permit2.js";

// ─── Adapter ──────────────────────────────────────────────────────────────────

export interface UniswapV4AdapterConfig {
  routers?: Record<number, Address>;
  quoters?: Record<number, Address>;
  defaultFee?: number;
  defaultTickSpacing?: number;
  deadlineSeconds?: number;
  slippageBps?: number;
}

const _DEFAULT_FEE = 3000;
const DEFAULT_TICK_SPACING = 60;
const DEFAULT_DEADLINE_SECONDS = 1200;
const DEFAULT_SLIPPAGE_BPS = 50;

/** Standard fee → tickSpacing mapping (matches Uniswap V4 pool defaults) */
const FEE_TO_TICK_SPACING: Record<number, number> = {
  100: 1,
  500: 10,
  3000: 60,
  10000: 200,
};

export function createUniswapV4Adapter(config: UniswapV4AdapterConfig = {}): VenueAdapter {
  const routers = config.routers ?? DEFAULT_ROUTERS;
  const quoters = config.quoters ?? DEFAULT_QUOTERS;
  const meta: VenueAdapter["meta"] = {
    name: "uniswap_v4",
    supportedChains: Object.keys(routers).map((id) => Number.parseInt(id, 10)),
    actions: ["swap"],
    supportedConstraints: [
      "max_slippage",
      "min_output",
      "max_input",
      "deadline",
      "require_quote",
      "require_simulation",
      "max_gas",
    ],
    supportsQuote: true,
    supportsSimulation: true,
    supportsPreviewCommit: true,
    description: "Uniswap V4 swap adapter (Universal Router v2)",
  };

  return {
    meta,

    async buildAction(action, ctx) {
      assertSupportedConstraints(meta, action);

      if (action.type !== "swap") {
        throw new Error(`Uniswap V4 adapter only supports swap actions (got ${action.type})`);
      }

      const router = routers[ctx.chainId];
      if (!router) {
        throw new Error(`No Universal Router configured for chain ${ctx.chainId}`);
      }

      const isNativeEthIn = action.assetIn?.toUpperCase() === "ETH";
      const isNativeEthOut = action.assetOut?.toUpperCase() === "ETH";

      // Resolve currency addresses (ETH = address(0) in V4)
      const currencyIn = isNativeEthIn
        ? NATIVE_ETH
        : resolveTokenAddress(action.assetIn, ctx.chainId);
      const currencyOut = isNativeEthOut
        ? NATIVE_ETH
        : resolveTokenAddress(action.assetOut, ctx.chainId);

      // Build PoolKey (currencies must be numerically sorted)
      if (action.feeTier === undefined) {
        throw new Error(
          `Uniswap V4 swap requires explicit fee_tier. Use: with (fee_tier=3000) or with (fee_tier=500)`
        );
      }
      const fee = action.feeTier;
      const tickSpacing =
        config.defaultTickSpacing ?? FEE_TO_TICK_SPACING[fee] ?? DEFAULT_TICK_SPACING;
      const [currency0, currency1] = sortCurrencies(currencyIn, currencyOut);
      const zeroForOne = currency0.toLowerCase() === currencyIn.toLowerCase();

      const poolKey: PoolKey = {
        currency0,
        currency1,
        fee,
        tickSpacing,
        hooks: ZERO_HOOKS,
      };

      const amount = toBigInt(action.amount, "Unsupported amount type for swap");
      const isExactOut = action.mode === "exact_out";
      const defaultSlippageBps =
        action.constraints?.maxSlippageBps ?? config.slippageBps ?? DEFAULT_SLIPPAGE_BPS;

      // Quote expected output/input via on-chain Quoter
      const quoter = quoters[ctx.chainId];
      let expectedAmount = amount; // fallback if no quoter
      let quoteGasEstimate: bigint | undefined;
      let quoteTimestampMs: number | undefined;

      let hasQuote = false;
      if (quoter) {
        try {
          const quoteParams = {
            poolKey,
            zeroForOne,
            exactAmount: amount,
            hookData: "0x" as `0x${string}`,
          };

          if (isExactOut) {
            const result = await ctx.provider.readContract<readonly [bigint, bigint]>({
              address: quoter,
              abi: QUOTER_ABI,
              functionName: "quoteExactOutputSingle",
              args: [quoteParams],
            });
            expectedAmount = result[0]; // amountIn needed
            quoteGasEstimate = result[1];
          } else {
            const result = await ctx.provider.readContract<readonly [bigint, bigint]>({
              address: quoter,
              abi: QUOTER_ABI,
              functionName: "quoteExactInputSingle",
              args: [quoteParams],
            });
            expectedAmount = result[0]; // amountOut expected
            quoteGasEstimate = result[1];
          }
          quoteTimestampMs = Date.now();
          hasQuote = true;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          throw new Error(
            `Failed to quote ${action.assetIn}/${action.assetOut} on V4 ` +
              `(fee=${fee}, tickSpacing=${tickSpacing}): ${msg}`
          );
        }
      }
      if (action.constraints?.requireQuote === true && !hasQuote) {
        throw new Error("Uniswap V4 could not resolve quote while require_quote is enabled");
      }

      const explicitMinOut = action.constraints?.minOutput;
      const explicitMaxIn = action.constraints?.maxInput;
      let slippageBps = defaultSlippageBps;

      if (!isExactOut && explicitMinOut !== undefined && hasQuote) {
        slippageBps = computeSlippageBpsFromMinOut(expectedAmount, explicitMinOut);
      } else if (isExactOut && explicitMaxIn !== undefined && hasQuote) {
        slippageBps = computeSlippageBpsFromMaxIn(expectedAmount, explicitMaxIn);
      }

      // Calculate amounts with slippage
      let amountOutMinimum: bigint;
      let settleAmount: bigint;

      if (isExactOut) {
        amountOutMinimum = amount;
        if (explicitMaxIn !== undefined) {
          if (hasQuote && explicitMaxIn < expectedAmount) {
            throw new Error("max_input is below expected input");
          }
          settleAmount = explicitMaxIn;
        } else {
          settleAmount = expectedAmount + (expectedAmount * BigInt(slippageBps)) / BPS_DENOMINATOR;
        }
      } else {
        if (explicitMinOut !== undefined) {
          if (hasQuote && explicitMinOut > expectedAmount) {
            throw new Error("min_output exceeds expected output");
          }
          amountOutMinimum = explicitMinOut;
        } else {
          amountOutMinimum =
            expectedAmount - (expectedAmount * BigInt(slippageBps)) / BPS_DENOMINATOR;
        }
        settleAmount = amount;
      }

      // Build the V4_SWAP encoded actions
      const v4Input = encodeV4SwapInput({
        poolKey,
        zeroForOne,
        amount,
        amountOutMinimum,
        settleAmount,
        isExactOut,
        currencyIn,
        currencyOut,
      });

      // Build Universal Router commands + inputs
      const deadline =
        Math.floor(Date.now() / 1000) +
        (action.constraints?.deadline ?? config.deadlineSeconds ?? DEFAULT_DEADLINE_SECONDS);
      let commands: `0x${string}`;
      let inputs: `0x${string}`[];
      let txValue: bigint;

      if (isExactOut && isNativeEthIn) {
        // exact_out with native ETH: add SWEEP to refund excess
        commands =
          `0x${Commands.V4_SWAP.toString(16).padStart(2, "0")}${Commands.SWEEP.toString(16).padStart(2, "0")}` as `0x${string}`;
        const sweepInput = encodeAbiParameters(
          [{ type: "address" }, { type: "address" }, { type: "uint256" }],
          [NATIVE_ETH, MSG_SENDER, 0n]
        );
        inputs = [v4Input, sweepInput];
        txValue = settleAmount;
      } else {
        // Single V4_SWAP command
        commands = `0x${Commands.V4_SWAP.toString(16).padStart(2, "0")}` as `0x${string}`;
        inputs = [v4Input];
        txValue = isNativeEthIn ? settleAmount : 0n;
      }

      const calldata = encodeFunctionData({
        abi: UNIVERSAL_ROUTER_ABI,
        functionName: "execute",
        args: [commands, inputs, BigInt(deadline)],
      });

      // Build pre-swap transactions (Permit2 approvals for ERC20 input)
      const preTxs: BuiltTransaction[] = [];

      if (!isNativeEthIn) {
        const approvalTxs = await buildPermit2Approvals({
          ctx,
          token: currencyIn,
          router,
          amount: settleAmount,
          action,
        });
        preTxs.push(...approvalTxs);
      }

      // Build description
      const shortAddr = (a: string) => `${a.slice(0, 6)}...${a.slice(-4)}`;
      const descLines = [
        `Uniswap V4 swap ${action.assetIn} → ${action.assetOut}`,
        `  currencyIn:  ${action.assetIn} (${shortAddr(currencyIn)})`,
        `  currencyOut: ${action.assetOut} (${shortAddr(currencyOut)})`,
        `  amount:      ${amount.toString()} wei`,
        `  expected:    ~${expectedAmount.toString()} wei`,
        `  min output:  ${amountOutMinimum.toString()} wei (${slippageBps / 100}% slippage)`,
        ...(isExactOut && explicitMaxIn !== undefined
          ? [`  max input:  ${explicitMaxIn.toString()} wei`]
          : []),
        `  fee tier:    ${fee / 10_000}%`,
        `  tickSpacing: ${tickSpacing}`,
        `  router:      ${shortAddr(router)}`,
      ].join("\n");
      const gasEstimate = await estimateGasIfSupported(ctx, {
        to: router,
        data: calldata as `0x${string}`,
        value: txValue,
      });
      const effectiveGas = gasEstimate?.gasLimit ?? quoteGasEstimate;
      if (action.constraints?.requireSimulation === true && effectiveGas === undefined) {
        throw new Error(
          "Uniswap V4 requires gas simulation support while require_simulation is enabled"
        );
      }
      validateGasConstraints({
        gasLimit: effectiveGas,
        constraints: action.constraints,
        venueName: "Uniswap V4",
      });
      const swapTx = {
        tx: {
          to: router,
          data: calldata as `0x${string}`,
          value: txValue,
        },
        description: descLines,
        gasEstimate,
        action,
        metadata: {
          quote: {
            expectedIn: isExactOut ? expectedAmount : amount,
            expectedOut: isExactOut ? amount : expectedAmount,
            minOut: amountOutMinimum,
            maxIn: settleAmount,
            slippageBps,
          },
          route: {
            poolKey,
            zeroForOne,
            router,
            quoter,
            deadline,
            quoteTimestampMs,
            quoteAvailable: hasQuote,
            gasEstimate: quoteGasEstimate,
          },
          fees: {
            feeTierBps: fee,
          },
          warnings: hasQuote ? [] : ["quoter_unavailable"],
        },
      };

      return [...preTxs, swapTx];
    },
  };
}

export const uniswapV4Adapter = createUniswapV4Adapter();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function resolveTokenAddress(asset: string, chainId: number): Address {
  return resolveVenueTokenAddress(asset, chainId, {
    treatEthAsWrapped: true,
    defaultDecimals: 18,
  });
}

function sortCurrencies(a: Address, b: Address): [Address, Address] {
  const aNum = BigInt(a);
  const bNum = BigInt(b);
  return aNum < bNum ? [a, b] : [b, a];
}
