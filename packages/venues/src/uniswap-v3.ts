import type { Address } from "@grimoire/core";
import type { VenueAdapter } from "@grimoire/core";
import tokenList from "@uniswap/default-token-list";
import { CurrencyAmount, Percent, Token, TradeType } from "@uniswap/sdk-core";
import {
  type FeeAmount,
  Pool,
  Route,
  SwapRouter,
  Trade,
  computePoolAddress,
} from "@uniswap/v3-sdk";
import { type Abi, encodeFunctionData, parseAbi } from "viem";
import { buildApprovalIfNeeded } from "./erc20.js";

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

const POOL_ABI = parseAbi([
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function liquidity() view returns (uint128)",
]);

const WETH_ABI = parseAbi(["function deposit() payable"]);

export function createUniswapV3Adapter(
  config: UniswapV3AdapterConfig = { routers: DEFAULT_ROUTERS }
): VenueAdapter {
  const factories = config.factories ?? DEFAULT_FACTORIES;

  return {
    meta: {
      name: "uniswap_v3",
      supportedChains: Object.keys(config.routers).map((id) => Number.parseInt(id, 10)),
      actions: ["swap"],
      description: "Uniswap V3 swap adapter",
    },
    async buildAction(action, ctx) {
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
      const fee = (config.defaultFee ?? 3000) as FeeAmount;
      const amount = toBigInt(action.amount);
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
            abi: POOL_ABI as unknown as Abi,
            functionName: "slot0",
          }),
          ctx.provider.readContract<bigint>({
            address: poolAddress as Address,
            abi: POOL_ABI as unknown as Abi,
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

      let trade: Trade<Token, Token, TradeType>;
      if (isExactOut) {
        const outputAmount = CurrencyAmount.fromRawAmount(tokenOut, amount.toString());
        const price = pool.priceOf(tokenOut);
        const estimatedInput = price.quote(outputAmount);
        trade = Trade.createUncheckedTrade({
          route: swapRoute,
          inputAmount: CurrencyAmount.fromRawAmount(tokenIn, estimatedInput.quotient.toString()),
          outputAmount,
          tradeType: TradeType.EXACT_OUTPUT,
        });
      } else {
        const inputAmount = CurrencyAmount.fromRawAmount(tokenIn, amount.toString());
        const price = pool.priceOf(tokenIn);
        const estimatedOutput = price.quote(inputAmount);
        trade = Trade.createUncheckedTrade({
          route: swapRoute,
          inputAmount,
          outputAmount: CurrencyAmount.fromRawAmount(tokenOut, estimatedOutput.quotient.toString()),
          tradeType: TradeType.EXACT_INPUT,
        });
      }

      // Generate calldata using SDK's SwapRouter (targets original V3 SwapRouter)
      const defaultSlippageBps = action.constraints?.maxSlippageBps ?? config.slippageBps ?? 50;
      const expectedOut = BigInt(trade.outputAmount.quotient.toString());
      const expectedIn = BigInt(trade.inputAmount.quotient.toString());
      const explicitMinOut = action.constraints?.minOutput;
      const explicitMaxIn = action.constraints?.maxInput;
      let slippageBps = defaultSlippageBps;

      if (!isExactOut && explicitMinOut !== undefined) {
        slippageBps = computeSlippageBpsFromMinOut(expectedOut, explicitMinOut);
      } else if (isExactOut && explicitMaxIn !== undefined) {
        slippageBps = computeSlippageBpsFromMaxIn(expectedIn, explicitMaxIn);
      }

      const slippageTolerance = new Percent(slippageBps, 10_000);
      const deadline = Math.floor(Date.now() / 1000) + (config.deadlineSeconds ?? 1200);

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
      const expectedOutput = trade.outputAmount.toSignificant(6);
      const minOutAmount =
        explicitMinOut !== undefined
          ? CurrencyAmount.fromRawAmount(tokenOut, explicitMinOut.toString())
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

      return [
        ...preTxs,
        {
          tx: {
            to: router,
            data: calldata as `0x${string}`,
            value: BigInt(txValue),
          },
          description: descLines,
          action,
        },
      ];
    },
  };
}

export const uniswapV3Adapter = createUniswapV3Adapter();

/** WETH addresses per chain (native ETH wrapping — not in the Uniswap token list) */
const WETH_BY_CHAIN: Record<number, Address> = {
  1: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" as Address,
  10: "0x4200000000000000000000000000000000000006" as Address,
  137: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619" as Address,
  8453: "0x4200000000000000000000000000000000000006" as Address,
  42161: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1" as Address,
};

/** Build a symbol+chain index from the Uniswap default token list */
const tokenIndex = new Map<string, { address: string; decimals: number }>();
for (const t of tokenList.tokens) {
  tokenIndex.set(`${t.symbol.toUpperCase()}:${t.chainId}`, {
    address: t.address,
    decimals: t.decimals,
  });
}

function resolveToken(asset: string, chainId: number): Token {
  if (asset.startsWith("0x") && asset.length === 42) {
    return new Token(chainId, asset, 18);
  }

  const symbol = asset.toUpperCase();

  // ETH / WETH → use the chain-specific wrapped address
  if (symbol === "ETH" || symbol === "WETH") {
    const weth = WETH_BY_CHAIN[chainId];
    if (!weth) {
      throw new Error(`No WETH address for chain ${chainId}`);
    }
    return new Token(chainId, weth, 18, "WETH", "Wrapped Ether");
  }

  // Look up from Uniswap default token list
  const entry = tokenIndex.get(`${symbol}:${chainId}`);
  if (entry) {
    return new Token(chainId, entry.address, entry.decimals, symbol);
  }

  throw new Error(`Unknown asset: ${asset} on chain ${chainId}. Provide address directly.`);
}

function toBigInt(amount: unknown): bigint {
  if (typeof amount === "bigint") return amount;
  if (typeof amount === "number") return BigInt(Math.floor(amount));
  if (typeof amount === "string") return BigInt(amount);
  if (isLiteralAmount(amount)) {
    return BigInt(amount.value);
  }
  throw new Error("Unsupported amount type for swap");
}

function computeSlippageBpsFromMinOut(expectedOut: bigint, minOut: bigint): number {
  if (expectedOut <= 0n) {
    throw new Error("Cannot compute slippage from zero expected output");
  }
  if (minOut > expectedOut) {
    throw new Error("min_output exceeds expected output");
  }
  const diff = expectedOut - minOut;
  const bps = (diff * 10_000n) / expectedOut;
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
  const bps = (diff * 10_000n) / expectedIn;
  return Number(bps);
}

function isLiteralAmount(
  value: unknown
): value is { kind: "literal"; value: string | number | bigint } {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    (value as { kind?: unknown }).kind === "literal" &&
    "value" in value
  );
}
