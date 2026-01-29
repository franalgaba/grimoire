import type { Address } from "@grimoire/core";
import type { VenueAdapter } from "@grimoire/core";
import { Token } from "@uniswap/sdk-core";
import { encodeFunctionData, parseAbi } from "viem";
import { buildApprovalIfNeeded } from "./erc20.js";

export interface UniswapV3AdapterConfig {
  routers: Record<number, Address>;
  defaultFee?: number;
  deadlineSeconds?: number;
  slippageBps?: number;
}

export const DEFAULT_SWAP_ROUTER = "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45" as Address;

export const DEFAULT_ROUTERS: Record<number, Address> = {
  1: DEFAULT_SWAP_ROUTER,
  10: DEFAULT_SWAP_ROUTER,
  137: DEFAULT_SWAP_ROUTER,
  42161: DEFAULT_SWAP_ROUTER,
  8453: DEFAULT_SWAP_ROUTER,
};

export const defaultUniswapV3Routers = DEFAULT_ROUTERS;

const SWAP_ROUTER_ABI = parseAbi([
  "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)",
  "function exactOutputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 deadline,uint256 amountOut,uint256 amountInMaximum,uint160 sqrtPriceLimitX96)) payable returns (uint256 amountIn)",
]);

export function createUniswapV3Adapter(
  config: UniswapV3AdapterConfig = { routers: DEFAULT_ROUTERS }
): VenueAdapter {
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

      const tokenIn = resolveToken(action.assetIn, ctx.chainId);
      const tokenOut = resolveToken(action.assetOut, ctx.chainId);

      const fee = config.defaultFee ?? 3000;
      const deadline = BigInt(Math.floor(Date.now() / 1000) + (config.deadlineSeconds ?? 1200));
      const recipient = (ctx.vault ?? ctx.walletAddress) as Address;
      const amount = toBigInt(action.amount);
      const slippageBps = action.constraints?.maxSlippageBps ?? config.slippageBps;

      const minOutput =
        action.constraints?.minOutput ??
        (slippageBps !== undefined ? applyBps(amount, 10_000 - slippageBps) : 0n);
      const maxInput =
        action.constraints?.maxInput ??
        (slippageBps !== undefined ? applyBps(amount, 10_000 + slippageBps) : amount);

      const args = {
        tokenIn: tokenIn.address as Address,
        tokenOut: tokenOut.address as Address,
        fee,
        recipient,
        deadline,
        amountIn: amount,
        amountOutMinimum: minOutput,
        sqrtPriceLimitX96: 0n,
      };

      const data =
        action.mode === "exact_out"
          ? encodeFunctionData({
              abi: SWAP_ROUTER_ABI,
              functionName: "exactOutputSingle",
              args: [
                {
                  ...args,
                  amountOut: amount,
                  amountInMaximum: maxInput,
                },
              ],
            })
          : encodeFunctionData({
              abi: SWAP_ROUTER_ABI,
              functionName: "exactInputSingle",
              args: [args],
            });

      const approvalTxs = await buildApprovalIfNeeded({
        ctx,
        token: tokenIn.address as Address,
        spender: router,
        amount,
        action,
        description: `Approve ${action.assetIn} for Uniswap V3`,
      });

      return [
        ...approvalTxs,
        {
          tx: {
            to: router,
            data,
            value: 0n,
          },
          description: `Uniswap V3 swap ${action.assetIn} → ${action.assetOut}`,
          action,
        },
      ];
    },
  };
}

export const uniswapV3Adapter = createUniswapV3Adapter();

function resolveToken(asset: string, chainId: number): Token {
  const address = resolveAssetAddress(asset);
  const decimals = 18;
  return new Token(chainId, address, decimals);
}

function resolveAssetAddress(asset: string): Address {
  if (asset.startsWith("0x") && asset.length === 42) {
    return asset as Address;
  }

  const KNOWN_TOKENS: Record<string, Address> = {
    USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address,
    USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7" as Address,
    DAI: "0x6B175474E89094C44Da98b954EedeAC495271d0F" as Address,
    WETH: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" as Address,
  };

  const address = KNOWN_TOKENS[asset.toUpperCase()];
  if (!address) {
    throw new Error(`Unknown asset: ${asset}. Provide address directly.`);
  }

  return address;
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

function applyBps(amount: bigint, bps: number): bigint {
  return (amount * BigInt(bps)) / 10_000n;
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
