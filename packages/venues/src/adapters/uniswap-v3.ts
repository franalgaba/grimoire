import type { Address, VenueAdapter } from "@grimoirelabs/core";
import { CurrencyAmount, Percent, Token, TradeType } from "@uniswap/sdk-core";
import {
  computePoolAddress,
  type FeeAmount,
  Pool,
  Route,
  SwapRouter,
  Trade,
} from "@uniswap/v3-sdk";
import { type Abi, encodeFunctionData, parseAbi } from "viem";
import { toBigInt } from "../shared/bigint.js";
import { BPS_DENOMINATOR } from "../shared/bps.js";
import { assertSupportedConstraints, validateGasConstraints } from "../shared/constraints.js";
import { buildApprovalIfNeeded } from "../shared/erc20.js";
import { estimateGasIfSupported } from "../shared/gas.js";
import { resolveToken as resolveVenueToken } from "../shared/token-registry.js";

export interface UniswapV3AdapterConfig {
  routers: Record<number, Address>;
  factories?: Record<number, Address>;
  defaultFee?: number;
  deadlineSeconds?: number;
  slippageBps?: number;
}

/** Original V3 SwapRouter — matches the SDK's SwapRouter.swapCallParameters() encoding */
export const DEFAULT_SWAP_ROUTER = "0xE592427A0AEce92De3Edee1F18E0157C05861564" as Address;

export const DEFAULT_ROUTERS: Record<number, Address> = {
  1: DEFAULT_SWAP_ROUTER,
  10: DEFAULT_SWAP_ROUTER,
  137: DEFAULT_SWAP_ROUTER,
  42161: DEFAULT_SWAP_ROUTER,
  8453: DEFAULT_SWAP_ROUTER,
};

export const defaultUniswapV3Routers = DEFAULT_ROUTERS;

const DEFAULT_FACTORY = "0x1F98431c8aD98523631AE4a59f267346ea31F984" as Address;

const DEFAULT_FACTORIES: Record<number, Address> = {
  1: DEFAULT_FACTORY,
  10: DEFAULT_FACTORY,
  137: DEFAULT_FACTORY,
  42161: DEFAULT_FACTORY,
  8453: "0x33128a8fC17869897dcE68Ed026d694621f6FDfD" as Address,
};

export const defaultUniswapV3Factories = DEFAULT_FACTORIES;

const POOL_ABI: Abi = parseAbi([
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function liquidity() view returns (uint128)",
]);

const WETH_ABI = parseAbi(["function deposit() payable"]);

const _DEFAULT_FEE = 3000;
const DEFAULT_DEADLINE_SECONDS = 1200;
const DEFAULT_SLIPPAGE_BPS = 50;

export function createUniswapV3Adapter(
  config: UniswapV3AdapterConfig = { routers: DEFAULT_ROUTERS }
): VenueAdapter {
  const factories = config.factories ?? DEFAULT_FACTORIES;
  const meta: VenueAdapter["meta"] = {
    name: "uniswap_v3",
    supportedChains: Object.keys(config.routers).map((id) => Number.parseInt(id, 10)),
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
    dataEndpoints: ["info", "routers", "tokens", "pools"],
    description: "Uniswap V3 swap adapter",
  };

  return {
    meta,
    async buildAction(action, ctx) {
      assertSupportedConstraints(meta, action);

      if (action.type !== "swap") {
        throw new Error(`Uniswap adapter only supports swap actions (got ${action.type})`);
      }

      const router = config.routers[ctx.chainId];
      if (!router) {
        throw new Error(`No Uniswap router configured for chain ${ctx.chainId}`);
      }

      const factory = factories[ctx.chainId] ?? DEFAULT_FACTORY;
      const isNativeEth = action.assetIn?.toUpperCase() === "ETH";
      const tokenIn = resolveToken(action.assetIn, ctx.chainId);
      const tokenOut = resolveToken(action.assetOut, ctx.chainId);

      if (action.feeTier === undefined) {
        throw new Error(
          `Uniswap V3 swap requires explicit fee_tier. Use: with (fee_tier=3000) or with (fee_tier=500)`
        );
      }
      const fee = action.feeTier as FeeAmount;
      const amount = toBigInt(action.amount, "Unsupported amount type for swap");
      const recipient = (ctx.vault ?? ctx.walletAddress) as string;

      // Compute pool address using the SDK
      const poolAddress = computePoolAddress({
        factoryAddress: factory,
        tokenA: tokenIn,
        tokenB: tokenOut,
        fee,
      });

      // Fetch on-chain pool state (slot0 + liquidity) for quoting
      let sqrtPriceX96: bigint;
      let tick: number;
      let liquidity: bigint;
      try {
        const [slot0Result, liquidityResult] = await Promise.all([
          ctx.provider.readContract<
            readonly [bigint, number, number, number, number, number, boolean]
          >({
            address: poolAddress as Address,
            abi: POOL_ABI,
            functionName: "slot0",
          }),
          ctx.provider.readContract<bigint>({
            address: poolAddress as Address,
            abi: POOL_ABI,
            functionName: "liquidity",
          }),
        ]);
        sqrtPriceX96 = slot0Result[0];
        tick = Number(slot0Result[1]);
        liquidity = liquidityResult;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(
          `Failed to fetch pool state for ${action.assetIn}/${action.assetOut} (pool ${poolAddress}): ${msg}`
        );
      }

      // Construct Pool from on-chain state
      const pool = new Pool(
        tokenIn,
        tokenOut,
        fee,
        sqrtPriceX96.toString(),
        liquidity.toString(),
        tick
      );

      // Build trade using SDK (same pattern as docs.uniswap.org/sdk/v3/guides/swaps/trading)
      const isExactOut = action.mode === "exact_out";
      const swapRoute = new Route([pool], tokenIn, tokenOut);
      const quoteTimestampMs = Date.now();

      let trade: Trade<Token, Token, TradeType>;
      let zeroQuote = false;
      if (isExactOut) {
        const outputAmount = CurrencyAmount.fromRawAmount(tokenOut, amount.toString());
        const price = pool.priceOf(tokenOut);
        const estimatedInput = price.quote(outputAmount);
        zeroQuote = estimatedInput.quotient.toString() === "0";
        trade = Trade.createUncheckedTrade({
          route: swapRoute,
          inputAmount: CurrencyAmount.fromRawAmount(
            tokenIn,
            zeroQuote ? amount.toString() : estimatedInput.quotient.toString()
          ),
          outputAmount,
          tradeType: TradeType.EXACT_OUTPUT,
        });
      } else {
        const inputAmount = CurrencyAmount.fromRawAmount(tokenIn, amount.toString());
        const price = pool.priceOf(tokenIn);
        const estimatedOutput = price.quote(inputAmount);
        zeroQuote = estimatedOutput.quotient.toString() === "0";
        trade = Trade.createUncheckedTrade({
          route: swapRoute,
          inputAmount,
          outputAmount: CurrencyAmount.fromRawAmount(
            tokenOut,
            zeroQuote ? "1" : estimatedOutput.quotient.toString()
          ),
          tradeType: TradeType.EXACT_INPUT,
        });
      }

      // Generate calldata using SDK's SwapRouter (targets original V3 SwapRouter)
      const defaultSlippageBps =
        action.constraints?.maxSlippageBps ?? config.slippageBps ?? DEFAULT_SLIPPAGE_BPS;
      const expectedOut = BigInt(trade.outputAmount.quotient.toString());
      const expectedIn = BigInt(trade.inputAmount.quotient.toString());
      const explicitMinOut = action.constraints?.minOutput;
      const explicitMaxIn = action.constraints?.maxInput;
      let slippageBps = defaultSlippageBps;

      if (!zeroQuote && !isExactOut && explicitMinOut !== undefined && expectedOut > 0n) {
        slippageBps = computeSlippageBpsFromMinOut(expectedOut, explicitMinOut);
      } else if (!zeroQuote && isExactOut && explicitMaxIn !== undefined && expectedIn > 0n) {
        slippageBps = computeSlippageBpsFromMaxIn(expectedIn, explicitMaxIn);
      }

      const slippageTolerance = new Percent(slippageBps, 10_000);
      const deadline =
        Math.floor(Date.now() / 1000) +
        (action.constraints?.deadline ?? config.deadlineSeconds ?? DEFAULT_DEADLINE_SECONDS);

      const { calldata, value: txValue } = SwapRouter.swapCallParameters([trade], {
        slippageTolerance,
        recipient,
        deadline,
      });

      // Build pre-swap transactions
      const preTxs = [];
      const maxInputAmount =
        isExactOut && explicitMaxIn === undefined
          ? BigInt(trade.maximumAmountIn(slippageTolerance).quotient.toString())
          : undefined;
      const approvalAmount = isExactOut ? (explicitMaxIn ?? maxInputAmount ?? amount) : amount;

      if (isNativeEth) {
        // Step 1: Wrap ETH → WETH (call WETH.deposit() with value)
        const wethAddress = tokenIn.address as Address;
        const wrapData = encodeFunctionData({
          abi: WETH_ABI,
          functionName: "deposit",
        });
        preTxs.push({
          tx: { to: wethAddress, data: wrapData, value: approvalAmount },
          description: `Wrap ${approvalAmount.toString()} wei ETH → WETH`,
          action,
        });

        // Step 2: Approve WETH to router
        const wethApprovalTxs = await buildApprovalIfNeeded({
          ctx,
          token: wethAddress,
          spender: router,
          amount: approvalAmount,
          action,
          description: "Approve WETH for Uniswap V3",
        });
        preTxs.push(...wethApprovalTxs);
      } else {
        // ERC20: just approve
        const approvalTxs = await buildApprovalIfNeeded({
          ctx,
          token: tokenIn.address as Address,
          spender: router,
          amount: approvalAmount,
          action,
          description: `Approve ${action.assetIn} for Uniswap V3`,
        });
        preTxs.push(...approvalTxs);
      }

      const shortAddr = (a: string) => `${a.slice(0, 6)}...${a.slice(-4)}`;
      const expectedOutput = zeroQuote ? "0" : trade.outputAmount.toSignificant(6);
      const minOutAmount =
        explicitMinOut !== undefined
          ? CurrencyAmount.fromRawAmount(tokenOut, explicitMinOut.toString())
          : zeroQuote
            ? CurrencyAmount.fromRawAmount(tokenOut, "0")
            : trade.minimumAmountOut(slippageTolerance);
      const minOut = minOutAmount.toSignificant(6);
      const descLines = [
        `Uniswap V3 swap ${action.assetIn} → ${action.assetOut}`,
        `  tokenIn:    ${action.assetIn} (${shortAddr(tokenIn.address)})`,
        `  tokenOut:   ${action.assetOut} (${shortAddr(tokenOut.address)})`,
        `  amount:     ${amount.toString()} wei`,
        `  expected:   ~${expectedOutput} ${action.assetOut}`,
        `  min output: ${minOut} ${action.assetOut} (${slippageBps / 100}% slippage)`,
        `  fee tier:   ${fee / 10_000}%`,
        `  pool:       ${shortAddr(poolAddress)}`,
        `  router:     ${shortAddr(router)}`,
        `  recipient:  ${shortAddr(recipient)}`,
      ].join("\n");
      const gasEstimate = await estimateGasIfSupported(ctx, {
        to: router,
        data: calldata as `0x${string}`,
        value: BigInt(txValue),
      });
      const hasQuote = true;
      if (action.constraints?.requireQuote === true && !hasQuote) {
        throw new Error("Uniswap V3 could not resolve quote while require_quote is enabled");
      }
      if (action.constraints?.requireSimulation === true && gasEstimate?.gasLimit === undefined) {
        throw new Error(
          "Uniswap V3 requires gas simulation support while require_simulation is enabled"
        );
      }
      validateGasConstraints({
        gasLimit: gasEstimate?.gasLimit,
        constraints: action.constraints,
        venueName: "Uniswap V3",
      });
      let priceImpactBps: number | undefined;
      if (!zeroQuote) {
        const priceImpactPct = Number.parseFloat(trade.priceImpact.toFixed(6));
        priceImpactBps = Number.isFinite(priceImpactPct)
          ? Math.max(0, Math.round(priceImpactPct * 100))
          : undefined;
      }

      const swapTx = {
        tx: {
          to: router,
          data: calldata as `0x${string}`,
          value: BigInt(txValue),
        },
        description: descLines,
        gasEstimate,
        action,
        metadata: {
          quote: {
            expectedIn,
            expectedOut,
            minOut: BigInt(minOutAmount.quotient.toString()),
            maxIn: maxInputAmount ?? explicitMaxIn,
            slippageBps,
          },
          route: {
            factory,
            poolAddress,
            fee,
            tokenIn: tokenIn.address,
            tokenOut: tokenOut.address,
            recipient,
            deadline,
            quoteTimestampMs,
            priceImpactBpsEstimate: priceImpactBps,
          },
          fees: {
            feeTierBps: fee,
          },
        },
      };

      return [...preTxs, swapTx];
    },
  };
}

export const uniswapV3Adapter = createUniswapV3Adapter();

function resolveToken(asset: string, chainId: number): Token {
  const token = resolveVenueToken(asset, chainId, {
    treatEthAsWrapped: true,
    defaultDecimals: 18,
  });
  return new Token(chainId, token.address, token.decimals, token.symbol);
}

function computeSlippageBpsFromMinOut(expectedOut: bigint, minOut: bigint): number {
  if (expectedOut <= 0n) {
    throw new Error("Cannot compute slippage from zero expected output");
  }
  if (minOut > expectedOut) {
    throw new Error("min_output exceeds expected output");
  }
  const diff = expectedOut - minOut;
  const bps = (diff * BPS_DENOMINATOR) / expectedOut;
  return Number(bps);
}

function computeSlippageBpsFromMaxIn(expectedIn: bigint, maxIn: bigint): number {
  if (expectedIn <= 0n) {
    throw new Error("Cannot compute slippage from zero expected input");
  }
  if (maxIn < expectedIn) {
    throw new Error("max_input is below expected input");
  }
  const diff = maxIn - expectedIn;
  const bps = (diff * BPS_DENOMINATOR) / expectedIn;
  return Number(bps);
}
